import { ConfigService } from '@nestjs/config';

import { AiFeaturePolicyService } from '../src/ai-policy/ai-feature-policy.service';
import { AiProviderService } from '../src/ai/ai-provider.service';

function config(values: Record<string, unknown>) {
  return { get: (key: string) => values[key] } as ConfigService;
}

describe('AI feature and provider policy', () => {
  it('fails closed when feature mode configuration is missing', () => {
    const policy = new AiFeaturePolicyService(config({}));
    expect(policy.effectiveMode('ingestion')).toBe('disabled');
    expect(policy.effectiveMode('report')).toBe('disabled');
    expect(() => policy.assertCallAllowed({
      capability: 'ingestion',
      providerClass: 'mock',
      dataClassification: 'synthetic'
    })).toThrow('suggestions are disabled');
  });

  it('uses the most conservative global, organization, project and template mode', () => {
    const policy = new AiFeaturePolicyService(config({
      'ai.ingestionMode': 'suggest',
      'ai.reportMode': 'suggest',
      'ai.globalKillSwitch': false
    }));
    expect(policy.effectiveMode('ingestion')).toBe('suggest');
    expect(policy.effectiveMode('ingestion', { organizationMode: 'suggest', projectMode: 'disabled' }))
      .toBe('disabled');
    expect(policy.effectiveMode('report', { organizationMode: 'suggest', projectMode: 'suggest', templateMode: 'suggest' }))
      .toBe('suggest');
  });

  it('gives the global kill switch priority over in-flight scope settings', () => {
    const policy = new AiFeaturePolicyService(config({
      'ai.ingestionMode': 'suggest',
      'ai.reportMode': 'suggest',
      'ai.globalKillSwitch': true
    }));
    expect(policy.effectiveMode('ingestion', { projectMode: 'suggest' })).toBe('disabled');
    expect(() => policy.assertCallAllowed({
      capability: 'assistant',
      providerClass: 'local',
      dataClassification: 'real'
    })).toThrow('AI_GLOBAL_KILL_SWITCH');
    expect(policy.snapshot('report')).toMatchObject({
      policyVersion: 'ai-feature-policy/1.0',
      effectiveMode: 'disabled',
      globalKillSwitch: true
    });
  });

  it('keeps external providers closed for real or unknown data pending H12', () => {
    const disabled = new AiFeaturePolicyService(config({ 'ai.externalProviderMode': 'disabled' }));
    expect(() => disabled.assertCallAllowed({
      capability: 'assistant',
      providerClass: 'external',
      dataClassification: 'synthetic'
    })).toThrow('pending H12');

    const syntheticOnly = new AiFeaturePolicyService(config({ 'ai.externalProviderMode': 'synthetic-only' }));
    expect(() => syntheticOnly.assertCallAllowed({
      capability: 'assistant',
      providerClass: 'external',
      dataClassification: 'real'
    })).toThrow('explicitly synthetic');
    expect(() => syntheticOnly.assertCallAllowed({
      capability: 'assistant',
      providerClass: 'external',
      dataClassification: 'unknown'
    })).toThrow('explicitly synthetic');
    expect(() => syntheticOnly.assertCallAllowed({
      capability: 'assistant',
      providerClass: 'external',
      dataClassification: 'synthetic'
    })).not.toThrow();
  });

  it('applies policy before dispatching to any provider', async () => {
    const mock = { generate: jest.fn(async () => ({ text: '{}', inputTokens: 0, outputTokens: 0, raw: {} })) };
    const http = { generate: jest.fn() };
    const policy = new AiFeaturePolicyService(config({
      'ai.ingestionMode': 'disabled',
      'ai.globalKillSwitch': false
    }));
    const provider = new AiProviderService(mock as any, http as any, policy);
    const request = {
      provider: 'mock',
      model: 'mock',
      capability: 'ingestion' as const,
      providerClass: 'mock' as const,
      dataClassification: 'synthetic' as const,
      instructions: 'return JSON',
      question: 'classify',
      history: [],
      contexts: []
    };
    expect(() => provider.generate(request)).toThrow('suggestions are disabled');
    expect(mock.generate).not.toHaveBeenCalled();
    expect(http.generate).not.toHaveBeenCalled();
  });
});
