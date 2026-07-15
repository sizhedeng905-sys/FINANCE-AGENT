import { OCR_EVALUATION_FIELDS } from '../src/real-data-test/ocr-field-catalog';
import {
  createOcrLabelSkeleton,
  evaluateOcrPredictions,
  normalizeOcrValue,
  OcrEvaluationPrediction,
  OcrGroundTruthLabel,
  validateOcrGroundTruthLabel
} from '../src/real-data-test/ocr-evaluation';

function reviewedLabel(values: Record<string, string | number>, sampleId = 'RB-EINV-PDF-001') {
  const label = createOcrLabelSkeleton(sampleId, 'RB-EINV', 'calibration');
  label.reviewStatus = 'reviewed';
  label.expectedDocumentType = 'electronic_invoice';
  label.allowPosting = true;
  for (const field of label.fields) {
    field.expected = Object.prototype.hasOwnProperty.call(values, field.fieldKey);
    field.value = field.expected ? values[field.fieldKey] : null;
  }
  return label;
}

function prediction(label: OcrGroundTruthLabel, confidence = 0.99): OcrEvaluationPrediction {
  return {
    sampleId: label.sampleId,
    documentType: label.expectedDocumentType,
    fieldCandidates: label.fields
      .filter((field) => field.expected)
      .map((field) => ({
        targetFieldKey: field.fieldKey,
        normalizedValue: field.value,
        confidence
      }))
  };
}

describe('real OCR evaluation', () => {
  it('keeps an unreviewed truth set in awaiting-labels state', () => {
    const label = createOcrLabelSkeleton('RB-SHOT-JPG-001', 'RB-SHOT', 'validation');
    const result = evaluateOcrPredictions([label], []);

    expect(result.gate).toBe('awaiting_labels');
    expect(result.samples.reviewed).toBe(0);
    expect(result.metrics.macroF1).toBeNull();
  });

  it('computes exact normalized targets without exposing field values in outcomes', () => {
    const label = reviewedLabel({
      record_date: '2026-07-15',
      amount: '1,280.50',
      invoice_number: 'INV-001',
      invoice_date: '2026年7月15日',
      tax_inclusive_amount: '1280.50',
      tax_amount: '80.50',
      seller: '示例供应商'
    });
    const result = evaluateOcrPredictions([label], [prediction(label)], {
      unconfirmedAutoRecordCount: 0
    });

    expect(result.gate).toBe('targets_met');
    expect(result.metrics).toMatchObject({
      documentClassificationAccuracy: 1,
      clearElectronicKeyFieldAccuracy: 1,
      macroF1: 1,
      amountAndNumberAccuracy: 1,
      dateAccuracy: 1,
      lowConfidenceRecall: 1,
      highConfidenceErrorRate: 0,
      unconfirmedAutoRecordCount: 0
    });
    expect(JSON.stringify(result.outcomes)).not.toContain('1280');
    expect(JSON.stringify(result.outcomes)).not.toContain('示例供应商');
  });

  it('counts missing, wrong, unexpected, and high-confidence errors conservatively', () => {
    const label = reviewedLabel({ record_date: '2026-07-15', amount: '100.00' }, 'RB-EINV-PDF-002');
    const result = evaluateOcrPredictions([label], [{
      sampleId: label.sampleId,
      documentType: 'wrong_type',
      fieldCandidates: [
        { targetFieldKey: 'amount', normalizedValue: '101.00', confidence: 0.6 },
        { targetFieldKey: 'seller', normalizedValue: 'unexpected', confidence: 0.95 }
      ]
    }], { unconfirmedAutoRecordCount: 0 });

    expect(result.gate).toBe('human_assisted');
    expect(result.counts).toMatchObject({ falsePositive: 2, falseNegative: 2, errorCases: 3 });
    expect(result.metrics.lowConfidenceRecall).toBeCloseTo(1 / 3, 6);
    expect(result.metrics.highConfidenceErrorRate).toBeCloseTo(1 / OCR_EVALUATION_FIELDS.length, 6);
    expect(result.samples.missingPredictions).toBe(0);
  });

  it('normalizes money and dates exactly and rejects incomplete reviewed labels', () => {
    expect(normalizeOcrValue('（￥1,280.500元）', 'money')).toBe('-1280.5');
    expect(normalizeOcrValue('2026年7月5日', 'date')).toBe('2026-07-05');
    expect(normalizeOcrValue('2026-02-30', 'date')).toBeNull();

    const incomplete = createOcrLabelSkeleton('RB-SHOT-JPG-002', 'RB-SHOT', 'blind');
    incomplete.reviewStatus = 'reviewed';
    expect(() => validateOcrGroundTruthLabel(incomplete)).toThrow('must decide every field');
  });
});
