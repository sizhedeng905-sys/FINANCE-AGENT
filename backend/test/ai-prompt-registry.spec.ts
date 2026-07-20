import { AiPromptRegistryService } from '../src/model-runtime/ai-prompt-registry.service';
import {
  AI_PROMPT_DEFINITIONS,
  AI_PROMPT_MANIFEST,
  AI_PROMPT_MANIFEST_KEYS,
  FINANCE_CORE_GUARD,
  promptContentSha256
} from '../src/model-runtime/ai-prompt-registry';

function record(definition: typeof AI_PROMPT_DEFINITIONS[number], overrides: Record<string, unknown> = {}) {
  return {
    id: `prompt-${definition.promptKey}-v${definition.versionNo}`,
    promptKey: definition.promptKey,
    versionNo: definition.versionNo,
    title: definition.title,
    purpose: definition.purpose,
    systemPrompt: definition.systemTemplate,
    userPromptTemplate: definition.userPromptTemplate,
    inputSchemaVersion: definition.inputSchemaVersion,
    outputSchemaVersion: definition.outputSchemaVersion,
    outputSchemaJson: definition.outputSchema,
    allowedProviderClasses: definition.allowedProviderClasses,
    maxInputBudget: definition.maxInputBudget,
    timeoutPolicy: definition.timeoutPolicy,
    redactionPolicyVersion: definition.redactionPolicyVersion,
    requiredComponents: definition.requiredComponents,
    contentSha256: definition.contentSha256,
    isActive: true,
    retiredAt: null,
    createdBy: 'system',
    createdAt: new Date('2026-07-18T00:00:00.000Z'),
    ...overrides
  } as any;
}

describe('versioned AI prompt registry', () => {
  it('contains the fixed manifest exactly once and composes the finance core guard', () => {
    expect(AI_PROMPT_MANIFEST.map((item) => item.promptKey)).toEqual(AI_PROMPT_MANIFEST_KEYS);
    expect(new Set(AI_PROMPT_DEFINITIONS.map((item) => `${item.promptKey}:v${item.versionNo}`)).size)
      .toBe(AI_PROMPT_DEFINITIONS.length);
    for (const definition of AI_PROMPT_DEFINITIONS) {
      expect(definition.contentSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(promptContentSha256(definition)).toBe(definition.contentSha256);
      if (definition.promptKey !== FINANCE_CORE_GUARD.promptKey) {
        expect(definition.requiredComponents).toEqual([{
          promptKey: FINANCE_CORE_GUARD.promptKey,
          versionNo: FINANCE_CORE_GUARD.versionNo,
          contentSha256: FINANCE_CORE_GUARD.contentSha256
        }]);
      }
    }
  });

  it('changes the content hash when any executable contract changes', () => {
    const definition = AI_PROMPT_MANIFEST[0];
    expect(promptContentSha256({ ...definition, purpose: `${definition.purpose} changed` }))
      .not.toBe(definition.contentSha256);
    expect(promptContentSha256({ ...definition, outputSchemaVersion: 'tampered/9.9' }))
      .not.toBe(definition.contentSha256);
  });

  it('resolves an active prompt and immutable core component into one audited bundle', async () => {
    const prompt = AI_PROMPT_MANIFEST.find((item) => item.promptKey === 'report_narrative')!;
    const promptRecord = record(prompt);
    const guardRecord = record(FINANCE_CORE_GUARD);
    const prisma: any = {
      aiPromptVersion: {
        findFirst: jest.fn(async () => promptRecord),
        findUnique: jest.fn(async ({ where }) =>
          where.promptKey_versionNo?.promptKey === FINANCE_CORE_GUARD.promptKey ? guardRecord : null)
      }
    };
    const registry = new AiPromptRegistryService(prisma);
    const bundle = await registry.resolveActive('report_narrative', 'mock');
    expect(bundle.instructions).toContain('untrusted data');
    expect(bundle.instructions).toContain('Choose only from allowedClaims');
    expect(bundle.instructions).toContain('without paraphrasing or adding facts');
    expect(bundle.versionVector).toMatchObject({
      prompt: { contentSha256: prompt.contentSha256 },
      inputSchemaVersion: 'report-narrative-input/1.0',
      outputSchemaVersion: 'report-narrative/1.0',
      components: [{ contentSha256: FINANCE_CORE_GUARD.contentSha256 }]
    });
    expect(bundle.bundleSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('fails closed for tampered, incomplete, retired or unknown executable versions', async () => {
    const prompt = AI_PROMPT_MANIFEST[0];
    const registry = new AiPromptRegistryService({
      aiPromptVersion: {
        findFirst: jest.fn(async () => record(prompt, { systemPrompt: 'tampered' }))
      }
    } as any);
    await expect(registry.resolveActive(prompt.promptKey, 'mock')).rejects.toThrow('hash mismatch');
    expect(() => registry.verifyStoredPrompt(record(prompt, { contentSha256: null }))).toThrow('not executable');

    const missing = new AiPromptRegistryService({
      aiPromptVersion: { findFirst: jest.fn(async () => null) }
    } as any);
    await expect(missing.resolveActive(prompt.promptKey, 'mock')).rejects.toThrow('No active prompt');
  });
});
