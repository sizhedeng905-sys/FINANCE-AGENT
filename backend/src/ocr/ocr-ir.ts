import { BadGatewayException } from '@nestjs/common';

import { canonicalJsonSha256 } from '../common/utils/canonical-json';
import {
  OcrBoundingBox,
  OcrDocumentPage,
  OcrFieldCandidate
} from './ocr-provider';

export const OCR_IR_SCHEMA_VERSION = 'ocr-ir/1.0';
export const OCR_IR_COORDINATE_VERSION = 'page-native-top-left-v1';
export const OCR_PREPROCESSING_VERSION = 'ocr-preprocess-v1';

const MAX_BLOCK_TEXT_LENGTH = 10_000;

export interface OcrIrToken {
  tokenId: string;
  text: string;
  textSha256: string;
  bbox: [number, number, number, number] | null;
  confidence: string | null;
  truncated: boolean;
}

export interface OcrIrBlock {
  blockId: string;
  page: number;
  text: string;
  textSha256: string;
  bbox: [number, number, number, number] | null;
  confidence: string | null;
  tokens: OcrIrToken[];
  truncated: boolean;
}

export interface OcrIrCandidateEvidence {
  evidenceId: string;
  kind: 'provider_field_candidate';
  sourceLabel: string;
  rawValueHash: string;
  bbox: [number, number, number, number] | null;
  confidence: string;
}

export interface OcrIrPage {
  page: number;
  width: number | null;
  height: number | null;
  sourceRotation: number;
  rotationApplied: number;
  coordinateVersion: typeof OCR_IR_COORDINATE_VERSION;
  preprocessingVersion: string;
  preprocessingOperations: string[];
  warnings: string[];
  blocks: OcrIrBlock[];
  candidateEvidence: OcrIrCandidateEvidence[];
}

export interface NormalizedOcrIr {
  schemaVersion: typeof OCR_IR_SCHEMA_VERSION;
  sourceId: string;
  sourceSha256: string;
  providerVersion: string;
  coordinateVersion: typeof OCR_IR_COORDINATE_VERSION;
  pages: OcrIrPage[];
  hash: string;
}

export interface NormalizeOcrIrInput {
  sourceId: string;
  sourceSha256: string;
  providerVersion: string;
  pages: OcrDocumentPage[];
  textBlocks: Array<Record<string, unknown>>;
  fieldCandidates: OcrFieldCandidate[];
}

export interface NormalizeOcrIrResult {
  ir: NormalizedOcrIr;
  candidateEvidenceRefs: string[][];
  normalizedTextBlocks: OcrIrBlock[];
}

export function normalizeOcrIr(input: NormalizeOcrIrInput): NormalizeOcrIrResult {
  const pages = input.pages.map((page) => normalizePage(page));
  const byPage = new Map(pages.map((page) => [page.page, page]));
  if (byPage.size !== pages.length) throw invalid('OCR 页面编号重复');

  input.textBlocks.forEach((source, index) => {
    const pageNumber = positiveInteger(source.page, 'OCR 文本块页码');
    const page = byPage.get(pageNumber);
    if (!page) throw invalid('OCR 文本块引用了任务范围之外的页面');
    page.blocks.push(normalizeBlock(source, page, page.blocks.length + 1, index));
  });

  const candidateEvidenceRefs = input.fieldCandidates.map((candidate, index) => {
    const page = byPage.get(positiveInteger(candidate.page, 'OCR 字段候选页码'));
    if (!page) throw invalid('OCR 字段候选引用了任务范围之外的页面');
    const bbox = normalizeBoundingBox(candidate.boundingBox, page, 'OCR 字段候选 bbox');
    const matched = page.blocks.filter((block) => evidenceMatches(block, candidate, bbox));
    if (matched.length > 0) return matched.map((block) => block.blockId);
    const evidenceId = `p${page.page}-c${index + 1}`;
    page.candidateEvidence.push({
      evidenceId,
      kind: 'provider_field_candidate',
      sourceLabel: boundedText(candidate.sourceLabel, 256).value,
      rawValueHash: canonicalJsonSha256(candidate.rawValue ?? null),
      bbox,
      confidence: canonicalConfidence(candidate.confidence, 'OCR 字段候选置信度')!
    });
    return [evidenceId];
  });

  const core = {
    schemaVersion: OCR_IR_SCHEMA_VERSION,
    sourceSha256: input.sourceSha256,
    providerVersion: input.providerVersion,
    coordinateVersion: OCR_IR_COORDINATE_VERSION,
    pages
  } as const;
  const ir: NormalizedOcrIr = {
    ...core,
    sourceId: input.sourceId,
    hash: canonicalJsonSha256(core)
  };
  return {
    ir,
    candidateEvidenceRefs,
    normalizedTextBlocks: pages.flatMap((page) => page.blocks)
  };
}

function normalizePage(source: OcrDocumentPage): OcrIrPage {
  const page = positiveInteger(source.page, 'OCR 页面编号');
  const width = optionalPositiveNumber(source.width, 'OCR 页面宽度');
  const height = optionalPositiveNumber(source.height, 'OCR 页面高度');
  const preprocessingVersion = source.preprocessing.version ?? OCR_PREPROCESSING_VERSION;
  const operations = source.preprocessing.operations ?? [];
  if (!Array.isArray(operations) || operations.some((value) => typeof value !== 'string' || value.length > 64)) {
    throw invalid('OCR 预处理操作列表无效');
  }
  return {
    page,
    width,
    height,
    sourceRotation: finiteNumber(source.rotation ?? 0, 'OCR 原始页面旋转'),
    rotationApplied: finiteNumber(source.preprocessing.rotationApplied ?? 0, 'OCR 实际旋转'),
    coordinateVersion: OCR_IR_COORDINATE_VERSION,
    preprocessingVersion,
    preprocessingOperations: [...operations],
    warnings: width === null || height === null ? ['PAGE_DIMENSIONS_UNKNOWN'] : [],
    blocks: [],
    candidateEvidence: []
  };
}

function normalizeBlock(
  source: Record<string, unknown>,
  page: OcrIrPage,
  pageBlockIndex: number,
  globalIndex: number
): OcrIrBlock {
  const bounded = boundedText(typeof source.text === 'string' ? source.text : '', MAX_BLOCK_TEXT_LENGTH);
  const blockId = `p${page.page}-b${pageBlockIndex}`;
  const tokenSources = Array.isArray(source.tokens) ? source.tokens : [];
  const tokens = tokenSources.map((token, tokenIndex) => {
    if (!token || typeof token !== 'object' || Array.isArray(token)) throw invalid('OCR token 结构无效');
    const value = token as Record<string, unknown>;
    const text = boundedText(typeof value.text === 'string' ? value.text : '', MAX_BLOCK_TEXT_LENGTH);
    return {
      tokenId: `${blockId}-t${tokenIndex + 1}`,
      text: text.value,
      textSha256: canonicalJsonSha256(text.original),
      bbox: normalizeUnknownBoundingBox(value.bbox ?? value.boundingBox, page, 'OCR token bbox'),
      confidence: canonicalConfidence(value.confidence, 'OCR token 置信度'),
      truncated: text.truncated
    } satisfies OcrIrToken;
  });
  return {
    blockId,
    page: page.page,
    text: bounded.value,
    textSha256: canonicalJsonSha256(bounded.original),
    bbox: normalizeUnknownBoundingBox(source.bbox ?? source.boundingBox, page, 'OCR 文本块 bbox'),
    confidence: canonicalConfidence(source.confidence, 'OCR 文本块置信度'),
    tokens,
    truncated: bounded.truncated
  };
}

function evidenceMatches(
  block: OcrIrBlock,
  candidate: OcrFieldCandidate,
  candidateBox: [number, number, number, number] | null
) {
  if (candidateBox && block.bbox && overlaps(candidateBox, block.bbox)) return true;
  const value = typeof candidate.rawValue === 'string' ? candidate.rawValue.trim() : '';
  return value.length > 0 && block.text.includes(value);
}

function overlaps(left: [number, number, number, number], right: [number, number, number, number]) {
  return left[0] < right[2] && left[2] > right[0] && left[1] < right[3] && left[3] > right[1];
}

function normalizeUnknownBoundingBox(
  value: unknown,
  page: OcrIrPage,
  label: string
): [number, number, number, number] | null {
  if (value === undefined || value === null) return null;
  if (Array.isArray(value) && value.length === 4) {
    const [left, top, right, bottom] = value.map((item) => finiteNumber(item, label));
    return assertBoundingBox([left, top, right, bottom], page, label);
  }
  if (typeof value !== 'object' || Array.isArray(value)) throw invalid(`${label} 结构无效`);
  return normalizeBoundingBox(value as OcrBoundingBox, page, label);
}

function normalizeBoundingBox(
  value: OcrBoundingBox | undefined,
  page: OcrIrPage,
  label: string
): [number, number, number, number] | null {
  if (!value) return null;
  const x = finiteNumber(value.x, label);
  const y = finiteNumber(value.y, label);
  const width = finiteNumber(value.width, label);
  const height = finiteNumber(value.height, label);
  if (width <= 0 || height <= 0) throw invalid(`${label} 宽高必须大于 0`);
  return assertBoundingBox([x, y, x + width, y + height], page, label);
}

function assertBoundingBox(
  value: [number, number, number, number],
  page: OcrIrPage,
  label: string
): [number, number, number, number] {
  const [left, top, right, bottom] = value;
  if (left < 0 || top < 0 || right <= left || bottom <= top) throw invalid(`${label} 坐标无效`);
  if (page.width !== null && right > page.width) throw invalid(`${label} 超出页面宽度`);
  if (page.height !== null && bottom > page.height) throw invalid(`${label} 超出页面高度`);
  return value;
}

function canonicalConfidence(value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null;
  const parsed = finiteNumber(value, label);
  if (parsed < 0 || parsed > 1) throw invalid(`${label} 必须位于 0 到 1`);
  return String(Math.round(parsed * 1_000_000) / 1_000_000);
}

function positiveInteger(value: unknown, label: string) {
  if (!Number.isInteger(value) || Number(value) < 1) throw invalid(`${label} 无效`);
  return Number(value);
}

function optionalPositiveNumber(value: unknown, label: string) {
  if (value === undefined || value === null) return null;
  const parsed = finiteNumber(value, label);
  if (parsed <= 0) throw invalid(`${label} 必须大于 0`);
  return parsed;
}

function finiteNumber(value: unknown, label: string) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw invalid(`${label} 必须是有限数字`);
  return Object.is(value, -0) ? 0 : value;
}

function boundedText(value: string, maxLength: number) {
  return {
    original: value,
    value: value.slice(0, maxLength),
    truncated: value.length > maxLength
  };
}

function invalid(message: string) {
  return new BadGatewayException(message);
}
