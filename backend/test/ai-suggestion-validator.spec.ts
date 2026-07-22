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

  it('enforces complete source coverage, server-derived required fields, and field-specific transforms', () => {
    const strictAllowlist = {
      templateVersionIds,
      evidenceRefs: new Set(['sheet0:C', 'sheet0:D']),
      sourceRefs: new Set(['sheet0:C', 'sheet0:D']),
      fieldKeys,
      requiredFieldKeys: new Set(['amount', 'recordDate']),
      transformKeysByField: new Map([
        ['amount', new Set(['DECIMAL_CANONICAL_V1'])],
        ['recordDate', new Set(['DATE_ISO_WITH_LOCALE_V1'])]
      ]),
      requireSourceEvidence: true
    };
    const valid = {
      schemaVersion: 'mapping/1.0',
      templateVersionId: 'template-expense:v3',
      mappings: [{
        sourceRef: 'sheet0:C',
        targetFieldKey: 'amount',
        transformKey: 'DECIMAL_CANONICAL_V1',
        confidence: '0.9',
        evidenceRefs: ['sheet0:C']
      }],
      unmappedSourceRefs: ['sheet0:D'],
      unresolvedRequiredFields: ['recordDate'],
      warnings: [],
      decision: 'NEEDS_FINANCE_REVIEW'
    };
    expect(service.mapping(JSON.stringify(valid), strictAllowlist)).toMatchObject({
      unresolvedRequiredFields: ['recordDate']
    });
    expect(() => service.mapping(JSON.stringify({
      ...valid,
      unmappedSourceRefs: []
    }), strictAllowlist)).toThrow('omitted source reference');
    expect(() => service.mapping(JSON.stringify({
      ...valid,
      unresolvedRequiredFields: []
    }), strictAllowlist)).toThrow('unresolved required fields');
    expect(() => service.mapping(JSON.stringify({
      ...valid,
      mappings: [{ ...valid.mappings[0], transformKey: 'IDENTITY_V1' }]
    }), strictAllowlist)).toThrow('unauthorized field transform');
    expect(() => service.mapping(JSON.stringify({
      ...valid,
      mappings: [{ ...valid.mappings[0], evidenceRefs: ['sheet0:D'] }]
    }), strictAllowlist)).toThrow('source evidence is missing');
  });

  it('binds OCR evidence to its source candidate and blocks conflicted candidates', () => {
    const allowlist = {
      templateVersionIds,
      evidenceRefs: new Set(['p1-b1', 'p2-b1']),
      sourceRefs: new Set(['candidate:amount']),
      fieldKeys,
      requiredFieldKeys: new Set(['amount']),
      transformKeysByField: new Map([['amount', new Set(['DECIMAL_CANONICAL_V1'])]]),
      evidenceRefsBySource: new Map([['candidate:amount', new Set(['p1-b1'])]])
    };
    const output = {
      schemaVersion: 'mapping/1.0',
      templateVersionId: 'template-expense:v3',
      mappings: [{
        sourceRef: 'candidate:amount',
        targetFieldKey: 'amount',
        transformKey: 'DECIMAL_CANONICAL_V1',
        confidence: '0.9',
        evidenceRefs: ['p1-b1']
      }],
      unmappedSourceRefs: [],
      unresolvedRequiredFields: [],
      warnings: [],
      decision: 'NEEDS_FINANCE_REVIEW'
    };

    expect(service.mapping(JSON.stringify(output), allowlist)).toMatchObject({
      mappings: [{ sourceRef: 'candidate:amount', evidenceRefs: ['p1-b1'] }]
    });
    expect(() => service.mapping(JSON.stringify({
      ...output,
      mappings: [{ ...output.mappings[0], evidenceRefs: ['p2-b1'] }]
    }), allowlist)).toThrow('source-bound evidence');
    expect(() => service.mapping(JSON.stringify(output), {
      ...allowlist,
      blockedSourceRefs: new Set(['candidate:amount'])
    })).toThrow('blocked source reference');
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

  it('keeps template drafts and unmapped suggestions inside existing field allowlists', () => {
    const draft = JSON.stringify({
      schemaVersion: 'template-draft/1.0',
      proposedName: 'Transport expense draft',
      recordType: 'transport',
      existingFieldKeys: ['amount', 'recordDate'],
      warnings: [],
      decision: 'NEEDS_FINANCE_REVIEW'
    });
    expect(service.templateDraft(draft, fieldKeys)).toMatchObject({ recordType: 'transport' });
    expect(() => service.templateDraft(draft, new Set(['amount']))).toThrow('unauthorized existing field');

    const unmapped = JSON.stringify({
      schemaVersion: 'unmapped-field-suggestion/1.0',
      suggestions: [{
        sourceRef: 'sheet0:C',
        candidateExistingFieldKeys: ['amount'],
        reasonCode: 'HEADER_ALIAS_MATCH'
      }],
      decision: 'NEEDS_FINANCE_REVIEW'
    });
    expect(service.unmappedFields(unmapped, evidenceRefs, fieldKeys)).toMatchObject({
      suggestions: [{ sourceRef: 'sheet0:C' }]
    });
    expect(() => service.unmappedFields(unmapped, evidenceRefs, new Set(['recordDate'])))
      .toThrow('unauthorized existing field');
  });

  it('validates anomaly evidence and report fact-check references against server facts', () => {
    const anomaly = JSON.stringify({
      schemaVersion: 'mapping-anomaly-review/1.0',
      issues: [{
        code: 'AMBIGUOUS_AMOUNT',
        severity: 'BLOCKING',
        evidenceRefs: ['p1-t34'],
        explanation: 'Multiple amount candidates require finance review.'
      }],
      decision: 'NEEDS_FINANCE_REVIEW'
    });
    expect(service.anomalyReview(anomaly, evidenceRefs)).toMatchObject({ issues: [{ severity: 'BLOCKING' }] });
    expect(() => service.anomalyReview(anomaly, new Set(['p1-b12']))).toThrow('unauthorized evidence');

    const factCheck = JSON.stringify({
      schemaVersion: 'report-fact-check/1.0',
      snapshotId: 'snapshot-1',
      narrativeHash: 'a'.repeat(64),
      issues: [{ claimId: 'claim-1', code: 'VALUE_MISMATCH', sourcePath: '/metrics/income' }],
      decision: 'NEEDS_FINANCE_REVIEW'
    });
    const allowlist = {
      snapshotIds: new Set(['snapshot-1']),
      narrativeHashes: new Set(['a'.repeat(64)]),
      claimIds: new Set(['claim-1']),
      sourcePaths: new Set(['/metrics/income'])
    };
    expect(service.reportFactCheck(factCheck, allowlist)).toMatchObject({ snapshotId: 'snapshot-1' });
    expect(() => service.reportFactCheck(factCheck, { ...allowlist, claimIds: new Set(['claim-2']) }))
      .toThrow('unauthorized claim');
  });
});
