import { AiSuggestionValidatorService } from '../src/ai/ai-suggestion-validator.service';
import { MockAiProviderService } from '../src/ai/mock-ai-provider.service';
import { canonicalJsonSha256 } from '../src/common/utils/canonical-json';
import {
  AiInvocationVersionVectorInput,
  buildAiInvocationVersionVector,
  completeAiInvocationVersionVector
} from '../src/model-runtime/ai-invocation-version-vector';
import { StructuredOutputValidatorService } from '../src/model-runtime/structured-output-validator.service';

const sha = (value: string) => canonicalJsonSha256(value);

function vectorInput(): AiInvocationVersionVectorInput {
  return {
    source: {
      kind: 'excel',
      sourceId: 'import-task-1',
      sourceSha256: sha('source'),
      irHash: sha('ir'),
      irSchemaVersion: 'excel-ir/1.0',
      processorVersion: 'exceljs-evidence-v1'
    },
    template: {
      templateVersionId: 'template-expense:v3',
      templateContentSha256: sha('template'),
      candidateSetSha256: sha('candidates')
    },
    prompt: {
      promptKey: 'excel_column_mapping',
      versionNo: 1,
      contentSha256: sha('prompt'),
      bundleSha256: sha('prompt-bundle')
    },
    contracts: {
      inputSchemaVersion: 'excel-mapping-input/1.0',
      outputSchemaVersion: 'mapping/1.0'
    },
    provider: {
      providerClass: 'mock',
      provider: 'mock',
      deploymentId: 'model-deployment-mock-text',
      modelConfigId: 'ai-model-mock-default',
      modelName: 'mock-structured-v1',
      modelRevision: '1',
      configSha256: sha('provider-config')
    },
    transformRegistryVersion: 'transform-registry/1.0',
    validationRuleVersion: 'ingestion-validation/1.0',
    mappingProfileVersion: null,
    redactionPolicyVersion: 'ai-redaction/1.0',
    authorizationPolicyVersion: 'finance-ingestion-authz/1.0',
    featurePolicyVersion: 'ai-feature-policy/1.0',
    featurePolicySnapshotSha256: sha('policy'),
    inputSha256: sha('input')
  };
}

describe('complete AI invocation version vector', () => {
  it('is stable for identical facts and changes when any frozen contract changes', () => {
    const first = buildAiInvocationVersionVector(vectorInput());
    const second = buildAiInvocationVersionVector(vectorInput());
    expect(first).toEqual(second);
    expect(first.vectorSha256).toMatch(/^[0-9a-f]{64}$/);

    const changed = vectorInput();
    changed.validationRuleVersion = 'ingestion-validation/1.1';
    expect(buildAiInvocationVersionVector(changed).vectorSha256).not.toBe(first.vectorSha256);
    const changedPolicy = vectorInput();
    changedPolicy.authorizationPolicyVersion = 'finance-ingestion-authz/2.0';
    expect(buildAiInvocationVersionVector(changedPolicy).vectorSha256).not.toBe(first.vectorSha256);
  });

  it('rejects incomplete hashes and creates a content-addressed completion', () => {
    const invalid = vectorInput();
    invalid.source.irHash = 'not-a-hash';
    expect(() => buildAiInvocationVersionVector(invalid)).toThrow('source.irHash');
    const vector = buildAiInvocationVersionVector(vectorInput());
    const completion = completeAiInvocationVersionVector(vector, sha('output'));
    expect(completion).toMatchObject({ vectorSha256: vector.vectorSha256, outputSha256: sha('output') });
    expect(completion.completionSha256).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('explicit Mock AI scenarios', () => {
  const provider = new MockAiProviderService();
  const validator = new AiSuggestionValidatorService(new StructuredOutputValidatorService());
  const baseRequest = {
    provider: 'mock',
    model: 'mock-structured-v1',
    instructions: 'return strict JSON',
    question: 'map columns',
    history: [],
    contexts: []
  };
  const allowlist = {
    templateVersionIds: new Set(['template-expense:v3']),
    evidenceRefs: new Set(['sheet0:C']),
    fieldKeys: new Set(['amount'])
  };

  it('covers valid and explicitly unmapped review outputs', async () => {
    const validOutput = {
      schemaVersion: 'mapping/1.0',
      templateVersionId: 'template-expense:v3',
      mappings: [{
        sourceRef: 'sheet0:C',
        targetFieldKey: 'amount',
        transformKey: 'DECIMAL_CANONICAL_V1',
        confidence: '0.9',
        evidenceRefs: ['sheet0:C']
      }],
      unmappedSourceRefs: [],
      unresolvedRequiredFields: [],
      warnings: [],
      decision: 'NEEDS_FINANCE_REVIEW'
    };
    const beforeProviderRequest = jest.fn(async () => undefined);
    const success = await provider.generate({
      ...baseRequest,
      mockScenario: 'success',
      mockOutput: validOutput,
      beforeProviderRequest
    });
    expect(beforeProviderRequest).toHaveBeenCalledTimes(1);
    expect(success.raw).toMatchObject({ provider: 'mock', mock: true, scenario: 'success' });
    expect(validator.mapping(success.text, allowlist)).toMatchObject({ mappings: [{ targetFieldKey: 'amount' }] });

    const unmapped = await provider.generate({
      ...baseRequest,
      mockScenario: 'unmapped',
      mockTemplateVersionId: 'template-expense:v3'
    });
    expect(validator.mapping(unmapped.text, allowlist)).toMatchObject({ mappings: [], decision: 'NEEDS_FINANCE_REVIEW' });
  });

  it('covers invalid JSON, timeout and injection outputs without masquerading as success', async () => {
    const invalid = await provider.generate({ ...baseRequest, mockScenario: 'invalid_json' });
    expect(() => validator.mapping(invalid.text, allowlist)).toThrow('INVALID_JSON');
    await expect(provider.generate({ ...baseRequest, mockScenario: 'timeout' })).rejects.toThrow('timeout');
    const injection = await provider.generate({ ...baseRequest, mockScenario: 'injection' });
    expect(() => validator.mapping(injection.text, allowlist)).toThrow();
    expect(injection.raw).toMatchObject({ provider: 'mock', mock: true, scenario: 'injection' });
  });
});
