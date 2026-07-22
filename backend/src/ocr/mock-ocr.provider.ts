import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FieldType, SemanticType } from '@prisma/client';

import {
  OcrFieldCandidate,
  OcrProvider,
  OcrProviderInput,
  OcrProviderResult,
  OcrProviderSnapshot,
  OcrTemplateField
} from './ocr-provider';

@Injectable()
export class MockOcrProvider implements OcrProvider {
  readonly name = 'mock';
  private readonly modelName: string;
  private readonly modelVersion: string;

  constructor(config: ConfigService) {
    this.modelName = config.get<string>('ocr.model') ?? 'mock-ocr-v1';
    this.modelVersion = config.get<string>('ocr.modelVersion') ?? '1';
  }

  snapshot(): OcrProviderSnapshot {
    return {
      provider: this.name,
      modelName: this.modelName,
      modelVersion: this.modelVersion,
      timeoutMs: 30_000,
      maxConcurrency: 5,
      configSummary: { source: 'environment', deterministic: true }
    };
  }

  async recognize(input: OcrProviderInput): Promise<OcrProviderResult> {
    if (input.scenario === 'failure' || (input.scenario === 'failure_once' && input.attemptNo === 1)) {
      throw new Error('Mock OCR 按测试场景返回识别失败');
    }

    const visibleFields = input.fields.filter((field) => field.isVisible);
    const omittedField = input.scenario === 'missing_field'
      ? visibleFields.find((field) => field.isRequired) ?? visibleFields[0]
      : undefined;
    const candidates = visibleFields
      .filter((field) => field.id !== omittedField?.id)
      .map((field, index) => this.candidate(field, index, input));
    if (input.scenario === 'low_confidence' && candidates.length > 0) {
      candidates[0] = { ...candidates[0], confidence: 0.55, evidence: 'Mock 模糊区域，需人工确认' };
    }

    const sourcePage = input.pages[0]?.page ?? 1;
    const extractedText = candidates
      .map((candidate) => `${candidate.sourceLabel}：${this.display(candidate.normalizedValue)}`)
      .join('\n');
    return {
      documentId: input.documentId,
      extractedText,
      pages: input.pages,
      textBlocks: extractedText ? [{ page: sourcePage, text: extractedText, confidence: 0.94 }] : [],
      tables: [],
      fieldCandidates: candidates,
      rawResult: {
        provider: this.name,
        scenario: input.scenario ?? 'normal',
        candidateCount: candidates.length
      },
      rawResultRef: `db://ocr-tasks/${input.documentId}/attempts/${input.attemptNo}`
    };
  }

  private candidate(field: OcrTemplateField, index: number, input: OcrProviderInput): OcrFieldCandidate {
    const value = this.valueFor(field, input);
    const sourcePage = input.pages[0]?.page ?? 1;
    return {
      targetFieldId: field.id,
      targetFieldKey: field.fieldKey,
      sourceLabel: field.fieldName,
      rawValue: value,
      normalizedValue: value,
      page: sourcePage,
      boundingBox: { x: 32, y: 40 + index * 28, width: 220, height: 20 },
      confidence: Math.max(0.82, 0.98 - index * 0.01),
      evidence: `Mock OCR 从第 ${sourcePage} 页识别“${field.fieldName}”`
    };
  }

  private valueFor(field: OcrTemplateField, input: OcrProviderInput): string | number | string[] {
    if (field.fieldType === FieldType.file || field.semanticType === SemanticType.file) return [input.rawFileId];
    if (field.fieldType === FieldType.date || field.semanticType === SemanticType.date) return this.chinaDate();
    if (field.fieldType === FieldType.money || field.semanticType === SemanticType.amount) return '1280.50';
    if (field.fieldType === FieldType.number) return '3';
    if (field.semanticType === SemanticType.person) return '临时仓库';
    if (field.semanticType === SemanticType.category) return '票据费用';
    if (field.semanticType === SemanticType.location) return '太和中转场';
    if (field.fieldType === FieldType.select) return '其他';
    return `Mock识别-${field.fieldName}`;
  }

  private chinaDate() {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(new Date());
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
  }

  private display(value: unknown) {
    return Array.isArray(value) ? value.join('、') : String(value ?? '');
  }
}
