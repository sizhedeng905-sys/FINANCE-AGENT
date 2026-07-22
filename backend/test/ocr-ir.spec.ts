import { normalizeOcrIr } from '../src/ocr/ocr-ir';
import { OcrDocumentPage, OcrFieldCandidate } from '../src/ocr/ocr-provider';

const pages: OcrDocumentPage[] = [{
  page: 1,
  width: 1000,
  height: 1400,
  rotation: 90,
  preprocessing: {
    rotationReserved: true,
    compressionReserved: true,
    scalingReserved: true,
    renderingReserved: false,
    version: 'ocr-preprocess-v1',
    operations: [],
    rotationApplied: 0
  }
}];

const candidates: OcrFieldCandidate[] = [{
  targetFieldId: 'amount-field',
  sourceLabel: 'Amount',
  rawValue: '125.60',
  normalizedValue: '125.60',
  page: 1,
  boundingBox: { x: 100, y: 200, width: 200, height: 50 },
  confidence: 0.97,
  evidence: 'provider candidate'
}];

describe('normalized OCR evidence IR', () => {
  it('creates stable page/block/token evidence and a task-independent content hash', () => {
    const source = {
      sourceId: 'task-a',
      sourceSha256: 'a'.repeat(64),
      providerVersion: 'local_paddle/PaddleOCR-VL/v1/config-hash',
      pages,
      textBlocks: [{
        page: 1,
        text: 'Total 125.60',
        bbox: [80, 180, 340, 270],
        confidence: 0.93,
        tokens: [{ text: '125.60', bbox: [100, 200, 300, 250], confidence: 0.98 }]
      }],
      fieldCandidates: candidates
    };
    const first = normalizeOcrIr(source);
    const replay = normalizeOcrIr({ ...source, sourceId: 'task-b' });

    expect(first.ir).toMatchObject({
      schemaVersion: 'ocr-ir/1.0',
      sourceId: 'task-a',
      sourceSha256: 'a'.repeat(64),
      coordinateVersion: 'page-native-top-left-v1',
      hash: expect.stringMatching(/^[a-f0-9]{64}$/),
      pages: [{
        page: 1,
        width: 1000,
        height: 1400,
        sourceRotation: 90,
        rotationApplied: 0,
        preprocessingOperations: [],
        warnings: [],
        blocks: [{
          blockId: 'p1-b1',
          page: 1,
          bbox: [80, 180, 340, 270],
          confidence: '0.93',
          tokens: [{
            tokenId: 'p1-b1-t1',
            text: '125.60',
            bbox: [100, 200, 300, 250],
            confidence: '0.98'
          }]
        }]
      }]
    });
    expect(first.candidateEvidenceRefs).toEqual([['p1-b1']]);
    expect(first.ir.hash).toBe(replay.ir.hash);
  });

  it('keeps unmatched provider candidates as explicit evidence instead of fabricating OCR tokens', () => {
    const result = normalizeOcrIr({
      sourceId: 'task-a',
      sourceSha256: 'b'.repeat(64),
      providerVersion: 'mock/v1',
      pages,
      textBlocks: [],
      fieldCandidates: candidates
    });

    expect(result.candidateEvidenceRefs).toEqual([['p1-c1']]);
    expect(result.ir.pages[0].blocks).toEqual([]);
    expect(result.ir.pages[0].candidateEvidence).toEqual([expect.objectContaining({
      evidenceId: 'p1-c1',
      kind: 'provider_field_candidate',
      bbox: [100, 200, 300, 250],
      confidence: '0.97'
    })]);
  });

  it('fails closed for duplicate pages, out-of-range coordinates, and invalid confidence', () => {
    const base = {
      sourceId: 'task-a',
      sourceSha256: 'c'.repeat(64),
      providerVersion: 'mock/v1',
      pages,
      textBlocks: [],
      fieldCandidates: candidates
    };
    expect(() => normalizeOcrIr({ ...base, pages: [...pages, pages[0]] })).toThrow('页面编号重复');
    expect(() => normalizeOcrIr({
      ...base,
      fieldCandidates: [{ ...candidates[0], boundingBox: { x: 990, y: 10, width: 20, height: 20 } }]
    })).toThrow('超出页面宽度');
    expect(() => normalizeOcrIr({
      ...base,
      fieldCandidates: [{ ...candidates[0], confidence: 1.1 }]
    })).toThrow('必须位于 0 到 1');
  });
});
