import { PrismaClient } from '@prisma/client';

import { MockAiProviderService } from '../ai/mock-ai-provider.service';
import { AiSuggestionValidatorService } from '../ai/ai-suggestion-validator.service';
import { PrismaService } from '../prisma/prisma.service';
import { AiPromptRegistryService } from './ai-prompt-registry.service';
import { resolveModelDeployment } from './model-deployment-config';
import { StructuredOutputValidatorService } from './structured-output-validator.service';

export interface SystemRegistryMockSmokeResult {
  taskType: 'excel_column_mapping';
  deploymentKey: string;
  provider: 'mock';
  promptKey: 'excel_column_mapping';
  promptVersion: number;
  promptBundleSha256: string;
  executionSha256: string;
  mappingCount: number;
  decision: 'NEEDS_FINANCE_REVIEW';
}

export async function runSystemRegistryMockSmoke(
  prisma: PrismaClient
): Promise<SystemRegistryMockSmokeResult> {
  const taskType = 'excel_column_mapping' as const;
  const route = await prisma.taskModelRoute.findFirst({
    where: {
      taskType,
      isEnabled: true,
      deployment: { isEnabled: true }
    },
    include: { deployment: true },
    orderBy: { priority: 'asc' }
  });
  if (!route) throw new Error(`Mock smoke route is unavailable: ${taskType}.`);
  const deployment = resolveModelDeployment(route.deployment);
  if (deployment.provider !== 'mock') {
    throw new Error(`Mock smoke refuses a non-mock route: ${deployment.key}.`);
  }

  const promptRegistry = new AiPromptRegistryService(prisma as unknown as PrismaService);
  const prompt = await promptRegistry.resolveActive(taskType, 'mock');
  const execution = promptRegistry.prepareExecution(prompt, {
    schemaVersion: 'system-registry-smoke-input/1.0',
    sourceColumns: [{ sourceRef: 'sheet0:C', normalizedHeader: 'amount', inferredType: 'decimal-string' }],
    templateVersionIds: ['template-smoke:v1'],
    fieldKeys: ['amount'],
    transformKeys: ['DECIMAL_CANONICAL_V1']
  });

  const output = {
    schemaVersion: 'mapping/1.0',
    templateVersionId: 'template-smoke:v1',
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
  } as const;
  const provider = new MockAiProviderService();
  const result = await provider.generate({
    provider: deployment.provider,
    providerClass: 'mock',
    model: deployment.modelName,
    modelVersion: deployment.modelVersion,
    deploymentId: deployment.id,
    deploymentKey: deployment.key,
    instructions: prompt.instructions,
    question: 'Map the synthetic amount column.',
    history: [],
    contexts: [],
    renderedUserPrompt: execution.renderedUserPrompt,
    outputSchema: execution.outputSchema,
    mockScenario: 'success',
    mockOutput: output
  });
  const validator = new AiSuggestionValidatorService(new StructuredOutputValidatorService());
  const validated = validator.mapping(result.text, {
    templateVersionIds: new Set(['template-smoke:v1']),
    sourceRefs: new Set(['sheet0:C']),
    evidenceRefs: new Set(['sheet0:C']),
    fieldKeys: new Set(['amount']),
    requiredFieldKeys: new Set(['amount']),
    transformKeysByField: new Map([['amount', new Set(['DECIMAL_CANONICAL_V1'])]]),
    evidenceRefsBySource: new Map([['sheet0:C', new Set(['sheet0:C'])]]),
    requireSourceEvidence: true
  });

  return {
    taskType,
    deploymentKey: deployment.key,
    provider: 'mock',
    promptKey: taskType,
    promptVersion: prompt.promptVersion.versionNo,
    promptBundleSha256: prompt.bundleSha256,
    executionSha256: execution.executionSha256,
    mappingCount: validated.mappings.length,
    decision: validated.decision
  };
}
