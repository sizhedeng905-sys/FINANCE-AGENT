import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

describe('AI ingestion dependency boundary', () => {
  const source = (relativePath: string) =>
    readFile(resolve(process.cwd(), 'src', relativePath), 'utf8');

  it('keeps AI classification and mapping outside formal record writers', async () => {
    const [executor, excel, ocr] = await Promise.all([
      source('ai/ai-structured-suggestion.service.ts'),
      source('import-tasks/excel-ai-suggestion.service.ts'),
      source('ocr/ocr-ai-suggestion.service.ts')
    ]);
    const combined = `${executor}\n${excel}\n${ocr}`;

    expect(combined).not.toContain('records.service');
    expect(combined).not.toContain('work-order-records.service');
    expect(combined).not.toMatch(/\.businessRecord\.(create|createMany|update|upsert|delete)/);
    expect(combined).not.toMatch(/\.mappingDecision\.(create|createMany|update|upsert|delete)/);
    expect(excel).toContain("businessRecordsCreated: 0");
    expect(excel).toContain("decision: 'NEEDS_FINANCE_REVIEW'");
    expect(ocr).toContain('businessRecordsCreated: 0');
    expect(ocr).toContain("decision: 'NEEDS_FINANCE_REVIEW'");
  });

  it('uses bounded structured input, strict output contracts, and idempotent provider requests', async () => {
    const [excel, ocr, provider] = await Promise.all([
      source('import-tasks/excel-ai-suggestion.service.ts'),
      source('ocr/ocr-ai-suggestion.service.ts'),
      source('ai/http-ai-provider.service.ts')
    ]);

    expect(excel).toContain('MAX_CANDIDATE_TEMPLATES');
    expect(excel).toContain('MAX_SOURCE_COLUMNS');
    expect(excel).toContain('CLASSIFICATION_INPUT_MAX_BYTES');
    expect(excel).toContain("excludes: ['raw_file_binary', 'full_rows', 'credentials', 'other_projects']");
    expect(ocr).toContain('MAX_EVIDENCE_REFS');
    expect(ocr).toContain("excludes: ['raw_file_binary', 'full_ocr_text', 'credentials', 'other_projects']");
    expect(provider).toContain("type: 'json_schema'");
    expect(provider).toContain('strict: true');
    expect(provider).toContain("headers['Idempotency-Key']");
    expect(provider).toContain('<untrusted_structured_input_json>');
  });

  it('keeps report AI read-only and behind the independent report policy', async () => {
    const [narratives, grounding] = await Promise.all([
      source('ai/report-narratives.service.ts'),
      source('ai/report-narrative-grounding.service.ts')
    ]);
    const combined = `${narratives}\n${grounding}`;

    expect(combined).not.toContain('records.service');
    expect(combined).not.toContain('work-order-records.service');
    expect(combined).not.toMatch(/\.businessRecord\.(create|createMany|update|upsert|delete)/);
    expect(narratives).toContain("capability: 'report'");
    expect(narratives).toContain("decision: 'NEEDS_FINANCE_REVIEW'");
    expect(grounding).toContain('warning paths do not exactly cover');
    expect(grounding).toContain('ungrounded numeric token');
  });
});
