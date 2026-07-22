import {
  OCR_EVALUATION_FIELDS,
  OCR_KEY_FIELD_KEYS,
  OcrEvaluationField,
  OcrEvaluationFieldType
} from './ocr-field-catalog';

export type OcrEvaluationSplit = 'calibration' | 'validation' | 'blind';
export type OcrReviewStatus = 'unlabeled' | 'in_review' | 'reviewed';

export interface OcrGroundTruthField {
  fieldKey: string;
  fieldType: OcrEvaluationFieldType;
  expected: boolean | null;
  value?: string | number | null;
  page?: number | null;
}

export interface OcrGroundTruthLabel {
  schemaVersion: 1;
  sampleId: string;
  family: string;
  split: OcrEvaluationSplit;
  reviewStatus: OcrReviewStatus;
  expectedDocumentType: string | null;
  allowPosting: boolean | null;
  fields: OcrGroundTruthField[];
}

export interface OcrPredictionCandidate {
  targetFieldKey?: string;
  normalizedValue: unknown;
  confidence: number;
  page?: number;
}

export interface OcrEvaluationPrediction {
  sampleId: string;
  documentType?: string | null;
  fieldCandidates: OcrPredictionCandidate[];
}

export interface OcrEvaluationOptions {
  lowConfidenceThreshold?: number;
  unconfirmedAutoRecordCount?: number | null;
}

type Outcome = 'correct' | 'missing' | 'incorrect' | 'unexpected' | 'absent';

interface FieldAccumulator {
  truePositive: number;
  falsePositive: number;
  falseNegative: number;
}

export function createOcrLabelSkeleton(
  sampleId: string,
  family: string,
  split: OcrEvaluationSplit,
  fields: readonly OcrEvaluationField[] = OCR_EVALUATION_FIELDS
): OcrGroundTruthLabel {
  return {
    schemaVersion: 1,
    sampleId,
    family,
    split,
    reviewStatus: 'unlabeled',
    expectedDocumentType: null,
    allowPosting: null,
    fields: fields.map((item) => ({
      fieldKey: item.fieldKey,
      fieldType: item.fieldType,
      expected: null,
      value: null,
      page: null
    }))
  };
}

export function validateOcrGroundTruthLabel(
  value: unknown,
  fields: readonly OcrEvaluationField[] = OCR_EVALUATION_FIELDS
): asserts value is OcrGroundTruthLabel {
  if (!isRecord(value) || value.schemaVersion !== 1) throw new Error('OCR label schemaVersion must be 1');
  requireText(value.sampleId, 'sampleId', 128);
  requireText(value.family, 'family', 64);
  if (!['calibration', 'validation', 'blind'].includes(String(value.split))) {
    throw new Error('OCR label split is invalid');
  }
  if (!['unlabeled', 'in_review', 'reviewed'].includes(String(value.reviewStatus))) {
    throw new Error('OCR label reviewStatus is invalid');
  }
  if (value.expectedDocumentType !== null) requireText(value.expectedDocumentType, 'expectedDocumentType', 128);
  if (value.allowPosting !== null && typeof value.allowPosting !== 'boolean') {
    throw new Error('OCR label allowPosting must be boolean or null');
  }
  if (!Array.isArray(value.fields)) throw new Error('OCR label fields must be an array');

  const catalog = new Map(fields.map((item) => [item.fieldKey, item]));
  const seen = new Set<string>();
  for (const [index, item] of value.fields.entries()) {
    if (!isRecord(item)) throw new Error(`OCR label fields[${index}] must be an object`);
    const fieldKey = requireText(item.fieldKey, `fields[${index}].fieldKey`, 128);
    const definition = catalog.get(fieldKey);
    if (!definition) throw new Error(`OCR label contains unknown fieldKey: ${fieldKey}`);
    if (seen.has(fieldKey)) throw new Error(`OCR label contains duplicate fieldKey: ${fieldKey}`);
    seen.add(fieldKey);
    if (item.fieldType !== definition.fieldType) throw new Error(`OCR label fieldType mismatch: ${fieldKey}`);
    if (item.expected !== null && typeof item.expected !== 'boolean') {
      throw new Error(`OCR label expected must be boolean or null: ${fieldKey}`);
    }
    if (item.page !== undefined && item.page !== null && (!Number.isInteger(item.page) || Number(item.page) < 1)) {
      throw new Error(`OCR label page must be a positive integer: ${fieldKey}`);
    }
    if (item.expected === true && !isScalar(item.value)) {
      throw new Error(`OCR label expected value is required: ${fieldKey}`);
    }
    if (value.reviewStatus === 'reviewed' && item.expected === null) {
      throw new Error(`Reviewed OCR label must decide every field: ${fieldKey}`);
    }
  }
  if (value.reviewStatus === 'reviewed' && seen.size !== catalog.size) {
    throw new Error('Reviewed OCR label must contain every catalog field');
  }
}

export function evaluateOcrPredictions(
  labels: readonly OcrGroundTruthLabel[],
  predictions: readonly OcrEvaluationPrediction[],
  options: OcrEvaluationOptions = {},
  fields: readonly OcrEvaluationField[] = OCR_EVALUATION_FIELDS
) {
  const threshold = options.lowConfidenceThreshold ?? 0.8;
  if (!Number.isFinite(threshold) || threshold <= 0 || threshold > 1) {
    throw new Error('lowConfidenceThreshold must be greater than 0 and at most 1');
  }
  const predictionBySample = uniqueBySample(predictions, 'prediction');
  const labelBySample = uniqueBySample(labels, 'label');
  const reviewed = [...labelBySample.values()].filter((label) => label.reviewStatus === 'reviewed');
  for (const label of labels) validateOcrGroundTruthLabel(label, fields);

  const totals: FieldAccumulator = { truePositive: 0, falsePositive: 0, falseNegative: 0 };
  const perField = new Map<string, FieldAccumulator>();
  const outcomes: Array<{ sampleId: string; fieldKey: string; outcome: Outcome; confidence: number | null }> = [];
  let errorCases = 0;
  let lowConfidenceErrors = 0;
  let highConfidenceErrors = 0;
  let highConfidencePredictions = 0;
  let amountAndNumberErrors = 0;
  let dateErrors = 0;
  let expectedTypedFields = 0;
  let correctTypedFields = 0;
  let expectedDateFields = 0;
  let correctDateFields = 0;
  let keyFieldExpected = 0;
  let keyFieldCorrect = 0;
  let duplicateCandidates = 0;
  let unexpectedCandidateKeys = 0;
  let documentTypeEvaluated = 0;
  let documentTypeCorrect = 0;
  const catalogKeys = new Set(fields.map((item) => item.fieldKey));

  for (const label of reviewed) {
    const prediction = predictionBySample.get(label.sampleId);
    const candidates = new Map<string, OcrPredictionCandidate>();
    for (const candidate of prediction?.fieldCandidates ?? []) {
      const fieldKey = candidate.targetFieldKey;
      if (!fieldKey || !catalogKeys.has(fieldKey)) {
        unexpectedCandidateKeys += 1;
        continue;
      }
      if (!Number.isFinite(candidate.confidence) || candidate.confidence < 0 || candidate.confidence > 1) {
        throw new Error(`OCR prediction confidence is invalid: ${label.sampleId}/${fieldKey}`);
      }
      const existing = candidates.get(fieldKey);
      if (existing) duplicateCandidates += 1;
      if (!existing || candidate.confidence > existing.confidence) candidates.set(fieldKey, candidate);
    }
    highConfidencePredictions += [...candidates.values()]
      .filter((candidate) => candidate.confidence >= threshold).length;

    if (label.expectedDocumentType) {
      documentTypeEvaluated += 1;
      if (normalizeText(prediction?.documentType ?? '') === normalizeText(label.expectedDocumentType)) {
        documentTypeCorrect += 1;
      }
    }

    for (const truth of label.fields) {
      if (truth.expected === null) continue;
      const candidate = candidates.get(truth.fieldKey);
      const accumulator = perField.get(truth.fieldKey) ?? { truePositive: 0, falsePositive: 0, falseNegative: 0 };
      perField.set(truth.fieldKey, accumulator);
      let outcome: Outcome;

      if (truth.expected) {
        const correct = candidate !== undefined && valuesEqual(truth.value, candidate.normalizedValue, truth.fieldType);
        if (correct) {
          outcome = 'correct';
          totals.truePositive += 1;
          accumulator.truePositive += 1;
        } else if (candidate) {
          outcome = 'incorrect';
          totals.falsePositive += 1;
          totals.falseNegative += 1;
          accumulator.falsePositive += 1;
          accumulator.falseNegative += 1;
        } else {
          outcome = 'missing';
          totals.falseNegative += 1;
          accumulator.falseNegative += 1;
        }
        if (truth.fieldType === 'money' || truth.fieldType === 'number') {
          expectedTypedFields += 1;
          if (correct) correctTypedFields += 1;
          else amountAndNumberErrors += 1;
        }
        if (truth.fieldType === 'date') {
          expectedDateFields += 1;
          if (correct) correctDateFields += 1;
          else dateErrors += 1;
        }
        if (label.family === 'RB-EINV' && OCR_KEY_FIELD_KEYS.has(truth.fieldKey)) {
          keyFieldExpected += 1;
          if (correct) keyFieldCorrect += 1;
        }
      } else if (candidate) {
        outcome = 'unexpected';
        totals.falsePositive += 1;
        accumulator.falsePositive += 1;
      } else {
        outcome = 'absent';
      }

      if (outcome === 'missing' || outcome === 'incorrect' || outcome === 'unexpected') {
        errorCases += 1;
        if (candidate && candidate.confidence < threshold) lowConfidenceErrors += 1;
        if (candidate && candidate.confidence >= threshold) highConfidenceErrors += 1;
      }
      outcomes.push({
        sampleId: label.sampleId,
        fieldKey: truth.fieldKey,
        outcome,
        confidence: candidate?.confidence ?? null
      });
    }
  }

  const precision = ratio(totals.truePositive, totals.truePositive + totals.falsePositive);
  const recall = ratio(totals.truePositive, totals.truePositive + totals.falseNegative);
  const microF1 = f1(precision, recall);
  const perFieldMetrics = [...perField.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([fieldKey, value]) => {
    const fieldPrecision = ratio(value.truePositive, value.truePositive + value.falsePositive);
    const fieldRecall = ratio(value.truePositive, value.truePositive + value.falseNegative);
    return { fieldKey, ...value, precision: fieldPrecision, recall: fieldRecall, f1: f1(fieldPrecision, fieldRecall) };
  });
  const f1Values = perFieldMetrics.map((item) => item.f1).filter((value): value is number => value !== null);
  const macroF1 = f1Values.length ? rounded(f1Values.reduce((sum, value) => sum + value, 0) / f1Values.length) : null;
  const fieldSlots = outcomes.length;
  const metrics = {
    documentClassificationAccuracy: ratio(documentTypeCorrect, documentTypeEvaluated),
    clearElectronicKeyFieldAccuracy: ratio(keyFieldCorrect, keyFieldExpected),
    macroF1,
    microF1,
    precision,
    recall,
    amountAndNumberAccuracy: ratio(correctTypedFields, expectedTypedFields),
    dateAccuracy: ratio(correctDateFields, expectedDateFields),
    lowConfidenceRecall: errorCases === 0 ? 1 : ratio(lowConfidenceErrors, errorCases),
    highConfidenceErrorRate: highConfidencePredictions === 0 ? 0 : ratio(highConfidenceErrors, highConfidencePredictions),
    unconfirmedAutoRecordCount: options.unconfirmedAutoRecordCount ?? null
  };
  const gate = reviewed.length === 0
    ? 'awaiting_labels'
    : releaseTargetsMet(metrics)
      ? 'targets_met'
      : 'human_assisted';

  return {
    schemaVersion: 1,
    gate,
    threshold,
    samples: {
      labels: labels.length,
      reviewed: reviewed.length,
      predictions: predictions.length,
      missingPredictions: reviewed.filter((label) => !predictionBySample.has(label.sampleId)).length
    },
    counts: {
      ...totals,
      fieldSlots,
      errorCases,
      lowConfidenceErrors,
      highConfidenceErrors,
      highConfidencePredictions,
      amountAndNumberErrors,
      dateErrors,
      duplicateCandidates,
      unexpectedCandidateKeys
    },
    metrics,
    perField: perFieldMetrics,
    outcomes
  };
}

export function normalizeOcrValue(value: unknown, fieldType: OcrEvaluationFieldType): string | null {
  if (value === null || value === undefined) return null;
  if (fieldType === 'money' || fieldType === 'number') return normalizeDecimal(value);
  if (fieldType === 'date') return normalizeDate(value);
  return normalizeText(value);
}

function valuesEqual(expected: unknown, actual: unknown, fieldType: OcrEvaluationFieldType) {
  const left = normalizeOcrValue(expected, fieldType);
  const right = normalizeOcrValue(actual, fieldType);
  return left !== null && right !== null && left === right;
}

function normalizeDecimal(value: unknown) {
  let source = String(value).normalize('NFKC').trim().replace(/[\s,]/g, '');
  let negative = false;
  if (/^\(.+\)$/.test(source)) {
    negative = true;
    source = source.slice(1, -1);
  }
  source = source
    .replace(/^(?:CNY|RMB|CN¥|[¥￥])/i, '')
    .replace(/(?:元|圆)$/, '');
  if (!/^[-+]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(source)) return null;
  if (source.startsWith('-')) {
    negative = !negative;
    source = source.slice(1);
  } else if (source.startsWith('+')) {
    source = source.slice(1);
  }
  const [integerSource, fractionSource = ''] = source.split('.');
  const integer = (integerSource || '0').replace(/^0+(?=\d)/, '') || '0';
  const fraction = fractionSource.replace(/0+$/, '');
  const normalized = fraction ? `${integer}.${fraction}` : integer;
  return negative && normalized !== '0' ? `-${normalized}` : normalized;
}

function normalizeDate(value: unknown) {
  const source = String(value).normalize('NFKC').trim();
  const match = /^(\d{4})[年./-](\d{1,2})[月./-](\d{1,2})(?:日)?$/.exec(source);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
}

function normalizeText(value: unknown) {
  return String(value).normalize('NFKC').trim().replace(/\s+/g, '').toLocaleLowerCase('zh-CN');
}

function uniqueBySample<T extends { sampleId: string }>(items: readonly T[], label: string) {
  const values = new Map<string, T>();
  for (const item of items) {
    if (!item.sampleId || item.sampleId.length > 128) throw new Error(`OCR ${label} sampleId is invalid`);
    if (values.has(item.sampleId)) throw new Error(`Duplicate OCR ${label} sampleId: ${item.sampleId}`);
    values.set(item.sampleId, item);
  }
  return values;
}

function releaseTargetsMet(metrics: ReturnType<typeof metricShape>) {
  return metrics.documentClassificationAccuracy !== null && metrics.documentClassificationAccuracy >= 0.95
    && metrics.clearElectronicKeyFieldAccuracy !== null && metrics.clearElectronicKeyFieldAccuracy >= 0.95
    && metrics.macroF1 !== null && metrics.macroF1 >= 0.9
    && metrics.amountAndNumberAccuracy !== null && metrics.amountAndNumberAccuracy >= 0.95
    && metrics.dateAccuracy !== null && metrics.dateAccuracy >= 0.95
    && metrics.lowConfidenceRecall !== null && metrics.lowConfidenceRecall >= 0.95
    && metrics.highConfidenceErrorRate !== null && metrics.highConfidenceErrorRate <= 0.02
    && metrics.unconfirmedAutoRecordCount === 0;
}

// Keeps releaseTargetsMet structurally typed without exporting an implementation-only interface.
function metricShape() {
  return {
    documentClassificationAccuracy: null as number | null,
    clearElectronicKeyFieldAccuracy: null as number | null,
    macroF1: null as number | null,
    microF1: null as number | null,
    precision: null as number | null,
    recall: null as number | null,
    amountAndNumberAccuracy: null as number | null,
    dateAccuracy: null as number | null,
    lowConfidenceRecall: null as number | null,
    highConfidenceErrorRate: null as number | null,
    unconfirmedAutoRecordCount: null as number | null
  };
}

function ratio(numerator: number, denominator: number) {
  return denominator > 0 ? rounded(numerator / denominator) : null;
}

function f1(precision: number | null, recall: number | null) {
  if (precision === null || recall === null) return null;
  return precision + recall === 0 ? 0 : rounded((2 * precision * recall) / (precision + recall));
}

function rounded(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isScalar(value: unknown): value is string | number {
  return (typeof value === 'string' && value.trim().length > 0) || (typeof value === 'number' && Number.isFinite(value));
}

function requireText(value: unknown, label: string, maxLength: number) {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) {
    throw new Error(`OCR label ${label} is invalid`);
  }
  return value;
}
