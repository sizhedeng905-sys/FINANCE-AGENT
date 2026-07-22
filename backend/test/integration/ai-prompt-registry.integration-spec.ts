import { PrismaClient } from '@prisma/client';

import { AiPromptRegistryService } from '../../src/model-runtime/ai-prompt-registry.service';
import {
  AI_PROMPT_DEFINITIONS,
  FINANCE_CORE_GUARD
} from '../../src/model-runtime/ai-prompt-registry';

describe('AI prompt registry PostgreSQL integration', () => {
  const prisma = new PrismaClient();

  beforeAll(async () => prisma.$connect());

  afterAll(async () => {
    await prisma.aiPromptVersion.deleteMany({ where: { promptKey: 'integration_prompt' } });
    await prisma.$disconnect();
  });

  it('seeds every immutable runtime definition with matching contracts and hashes', async () => {
    const records = await prisma.aiPromptVersion.findMany({
      where: { promptKey: { in: AI_PROMPT_DEFINITIONS.map((definition) => definition.promptKey) } },
      orderBy: [{ promptKey: 'asc' }, { versionNo: 'asc' }]
    });
    expect(records.length).toBeGreaterThanOrEqual(AI_PROMPT_DEFINITIONS.length);
    for (const definition of AI_PROMPT_DEFINITIONS) {
      const record = records.find((item) =>
        item.promptKey === definition.promptKey && item.versionNo === definition.versionNo);
      expect(record).toMatchObject({
        contentSha256: definition.contentSha256,
        inputSchemaVersion: definition.inputSchemaVersion,
        outputSchemaVersion: definition.outputSchemaVersion,
        redactionPolicyVersion: definition.redactionPolicyVersion,
        isActive: true,
        retiredAt: null
      });
      expect(record?.outputSchemaJson).toEqual(definition.outputSchema);
      expect(record?.requiredComponents).toEqual(definition.requiredComponents);
    }
  });

  it('resolves the active prompt plus guard and keeps retired history readable but non-executable', async () => {
    const registry = new AiPromptRegistryService(prisma as any);
    const active = await registry.resolveActive('report_narrative', 'mock');
    expect(active.componentVersions).toHaveLength(1);
    expect(active.componentVersions[0]).toMatchObject({
      promptKey: FINANCE_CORE_GUARD.promptKey,
      contentSha256: FINANCE_CORE_GUARD.contentSha256
    });

    const rollback = new Error('ROLLBACK_PROMPT_RETIREMENT_TEST');
    await expect(prisma.$transaction(async (tx) => {
      const prompt = await tx.aiPromptVersion.findFirstOrThrow({ where: { promptKey: 'report_narrative' } });
      await tx.aiPromptVersion.update({
        where: { id: prompt.id },
        data: { isActive: false, retiredAt: new Date() }
      });
      const isolatedRegistry = new AiPromptRegistryService(tx as any);
      await expect(isolatedRegistry.resolveActive('report_narrative', 'mock')).rejects.toThrow('No active prompt');
      await expect(isolatedRegistry.historical(prompt.id)).resolves.toMatchObject({ id: prompt.id });
      throw rollback;
    })).rejects.toBe(rollback);
    await expect(registry.resolveActive('report_narrative', 'mock')).resolves.toMatchObject({
      promptVersion: { isActive: true, retiredAt: null }
    });
  });

  it('enforces one active version per key and registry metadata constraints in PostgreSQL', async () => {
    await prisma.aiPromptVersion.create({
      data: {
        promptKey: 'integration_prompt',
        versionNo: 1,
        systemPrompt: 'test',
        isActive: true
      }
    });
    await expect(prisma.aiPromptVersion.create({
      data: {
        promptKey: 'integration_prompt',
        versionNo: 2,
        systemPrompt: 'test',
        isActive: true
      }
    })).rejects.toThrow();
    await expect(prisma.aiPromptVersion.create({
      data: {
        promptKey: 'integration_prompt_invalid',
        versionNo: 1,
        systemPrompt: 'test',
        contentSha256: 'not-a-sha256',
        isActive: false
      }
    })).rejects.toThrow();
  });
});
