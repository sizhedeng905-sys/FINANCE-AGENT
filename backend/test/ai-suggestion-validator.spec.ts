import { AiSuggestionValidatorService } from '../src/ai/ai-suggestion-validator.service';
import { StructuredOutputValidatorService } from '../src/model-runtime/structured-output-validator.service';

describe('AI suggestion output contracts', () => {
  const service = new AiSuggestionValidatorService(new StructuredOutputValidatorService());
  const templateVersionIds = new Set(['template-expense:v3']);
  const evidenceRefs = new Set(['sheet0:C', 'sheet0:D', 'p1-b12', 'p1-t34']);
  const fieldKeys = new Set(['amount', 'recordDate']);

  it('accepts a review-only classification constrained to request allowlists', () => {
    expect(service.classification(JSON.stringify({
      schemaVersion: 'classification/1.0',
      selectedTemplateVersionId: 'template-expense:v3',
      candidateTemplateVersionIds: ['template-expense:v3'],
      confidence: '0.82',
      evidenceRefs: ['sheet0:C'],
      reasonCodes: ['HEADER_ALIAS_MATCH'],
      warnings: [],
      decision: 'NEEDS_FINANCE_REVIEW'
    }), { templateVersionIds, evidenceRefs })).toMatchObject({
      selectedTemplateVersionId: 'template-expense:v3',
      decision: 'NEEDS_FINANCE_REVIEW'
    });
  });

  it.each([
    ['an unauthorized template', {
      selectedTemplateVersionId: 'template-hidden:v1',
      candidateTemplateVersionIds: ['template-hidden:v1'],
      evidenceRefs: ['sheet0:C'],
      decision: 'NEEDS_FINANCE_REVIEW'
    }],
    ['an unauthorized evidence reference', {
      selectedTemplateVersionId: 'template-expense:v3',
      candidateTemplateVersionIds: ['template-expense:v3'],
      evidenceRefs: ['other-project:secret'],
      decision: 'NEEDS_FINANCE_REVIEW'
    }],
    ['an approval decision', {
      selectedTemplateVersionId: 'template-expense:v3',
      candidateTemplateVersionIds: ['template-expense:v3'],
      evidenceRefs: ['sheet0:C'],
      decision: 'APPROVED'
    }]
  ])('rejects classification output containing %s', (_label, overrides) => {
    expect(() => service.classification(JSON.stringify(Object.assign({
      schemaVersion: 'classification/1.0',
      selectedTemplateVersionId: null,
      candidateTemplateVersionIds: [],
      confidence: '0',
      evidenceRefs: [],
      reasonCodes: [],
      warnings: []
    }, overrides)), { templateVersionIds, evidenceRefs })).toThrow();
  });

  it('accepts a mapping whose fields, evidence and transforms are all server-approved', () => {
    expect(service.mapping(JSON.stringify({
      schemaVersion: 'mapping/1.0',
      templateVersionId: 'template-expense:v3',
      mappings: [{
        sourceRef: 'sheet0:C',
        targetFieldKey: 'amount',
        transformKey: 'DECIMAL_CANONICAL_V1',
        confidence: '0.98',
        evidenceRefs: ['sheet0:C']
      }],
      unmappedSourceRefs: ['sheet0:D'],
      unresolvedRequiredFields: ['recordDate'],
      warnings: [],
      decision: 'NEEDS_FINANCE_REVIEW'
    }), { templateVersionIds, evidenceRefs, fieldKeys })).toMatchObject({
      templateVersionId: 'template-expense:v3'
    });
  });

  it.each([
    ['unknown field', { targetFieldKey: 'databasePassword', transformKey: 'IDENTITY_V1' }],
    ['unregistered transform', { targetFieldKey: 'amount', transformKey: 'eval(source)' }],
    ['cross-source evidence', { targetFieldKey: 'amount', transformKey: 'IDENTITY_V1', evidenceRefs: ['p99-secret'] }]
  ])('rejects a mapping with %s', (_label, mappingOverrides) => {
    expect(() => service.mapping(JSON.stringify({
      schemaVersion: 'mapping/1.0',
      templateVersionId: 'template-expense:v3',
      mappings: [Object.assign({
        sourceRef: 'sheet0:C',
        targetFieldKey: 'amount',
        transformKey: 'IDENTITY_V1',
        confidence: '0.5',
        evidenceRefs: ['sheet0:C']
      }, mappingOverrides)],
      unmappedSourceRefs: [],
      unresolvedRequiredFields: [],
      warnings: [],
      decision: 'NEEDS_FINANCE_REVIEW'
    }), { templateVersionIds, evidenceRefs, fieldKeys })).toThrow();
  });

  it('rejects duplicate targets, mapped/unmapped overlap, unknown properties and Markdown wrappers', () => {
    const duplicateTarget = {
      schemaVersion: 'mapping/1.0',
      templateVersionId: 'template-expense:v3',
      mappings: [
        {
          sourceRef: 'sheet0:C', targetFieldKey: 'amount', transformKey: 'IDENTITY_V1',
          confidence: '0.5', evidenceRefs: ['sheet0:C']
        },
        {
          sourceRef: 'sheet0:D', targetFieldKey: 'amount', transformKey: 'IDENTITY_V1',
          confidence: '0.5', evidenceRefs: ['sheet0:D']
        }
      ],
      unmappedSourceRefs: [],
      unresolvedRequiredFields: [],
      warnings: [],
      decision: 'NEEDS_FINANCE_REVIEW'
    };
    expect(() => service.mapping(JSON.stringify(duplicateTarget), { templateVersionIds, evidenceRefs, fieldKeys }))
      .toThrow('duplicate target');
    expect(() => service.mapping(JSON.stringify({
      ...duplicateTarget,
      mappings: duplicateTarget.mappings.slice(0, 1),
      unmappedSourceRefs: ['sheet0:C']
    }), { templateVersionIds, evidenceRefs, fieldKeys })).toThrow('both mapped and unmapped');
    expect(() => service.mapping(JSON.stringify({ ...duplicateTarget, sql: 'DROP TABLE users' }), {
      templateVersionIds, evidenceRefs, fieldKeys
    })).toThrow();
    expect(() => service.mapping(`\`\`\`json\n${JSON.stringify(duplicateTarget)}\n\`\`\``, {
      templateVersionIds, evidenceRefs, fieldKeys
    })).toThrow('INVALID_JSON');
  });

  it('accepts only a whitelisted report snapshot and review-only narrative', () => {
    const narrative = JSON.stringify({
      schemaVersion: 'report-narrative/1.0',
      snapshotId: 'snapshot-1',
      title: '日报',
      summary: '本期确认记录共 53 条。',
      claims: [{
        claimId: 'claim-1',
        claimType: 'COUNT',
        text: '本期确认记录共 53 条。',
        sourcePath: '/metrics/recordCount',
        value: '53'
      }],
      warningPaths: [],
      decision: 'NEEDS_FINANCE_REVIEW'
    });
    expect(service.reportNarrative(narrative, new Set(['snapshot-1']))).toMatchObject({ snapshotId: 'snapshot-1' });
    expect(() => service.reportNarrative(narrative, new Set(['snapshot-2']))).toThrow('unauthorized snapshot');
  });
});
