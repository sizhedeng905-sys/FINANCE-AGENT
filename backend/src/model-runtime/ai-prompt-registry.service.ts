import { Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { AiPromptVersion, Prisma } from '@prisma/client';

import { AiProviderClass } from '../ai-policy/ai-feature-policy.service';
import { canonicalJsonSha256 } from '../common/utils/canonical-json';
import { PrismaService } from '../prisma/prisma.service';
import {
  AiPromptComponentRef,
  AiPromptDefinition,
  getPromptDefinition,
  promptContentSha256
} from './ai-prompt-registry';

@Injectable()
export class AiPromptRegistryService {
  constructor(private readonly prisma: PrismaService) {}

  async resolveActive(promptKey: string, providerClass: AiProviderClass) {
    const prompt = await this.prisma.aiPromptVersion.findFirst({
      where: { promptKey, isActive: true, retiredAt: null },
      orderBy: { versionNo: 'desc' }
    });
    if (!prompt) throw new ServiceUnavailableException(`No active prompt version for ${promptKey}`);
    const definition = this.verifyStoredPrompt(prompt);
    if (!definition.allowedProviderClasses.includes(providerClass)) {
      throw new ServiceUnavailableException(`Prompt ${promptKey} does not allow provider class ${providerClass}`);
    }

    const components: AiPromptVersion[] = [];
    for (const reference of definition.requiredComponents) {
      const component = await this.prisma.aiPromptVersion.findUnique({
        where: {
          promptKey_versionNo: { promptKey: reference.promptKey, versionNo: reference.versionNo }
        }
      });
      if (!component || !component.isActive || component.retiredAt) {
        throw new ServiceUnavailableException(`Required prompt component is unavailable: ${reference.promptKey}`);
      }
      const componentDefinition = this.verifyStoredPrompt(component);
      if (componentDefinition.contentSha256 !== reference.contentSha256) {
        throw new ServiceUnavailableException(`Required prompt component hash changed: ${reference.promptKey}`);
      }
      components.push(component);
    }

    const versionVector = {
      schemaVersion: 'ai-prompt-bundle/1.0',
      prompt: this.versionRef(prompt),
      components: components.map((component) => this.versionRef(component)),
      inputSchemaVersion: prompt.inputSchemaVersion,
      outputSchemaVersion: prompt.outputSchemaVersion,
      redactionPolicyVersion: prompt.redactionPolicyVersion
    };
    return {
      promptVersion: prompt,
      componentVersions: components,
      instructions: [...components.map((component) => component.systemPrompt), prompt.systemPrompt].join('\n'),
      versionVector,
      bundleSha256: canonicalJsonSha256(versionVector),
      maxInputBudget: prompt.maxInputBudget,
      timeoutPolicy: definition.timeoutPolicy
    };
  }

  async historical(id: string) {
    const prompt = await this.prisma.aiPromptVersion.findUnique({ where: { id } });
    if (!prompt) throw new NotFoundException('AI prompt version not found');
    return prompt;
  }

  verifyStoredPrompt(prompt: AiPromptVersion): AiPromptDefinition {
    const definition = getPromptDefinition(prompt.promptKey, prompt.versionNo);
    if (!definition || !prompt.contentSha256) {
      throw new ServiceUnavailableException(`Prompt ${prompt.promptKey}:v${prompt.versionNo} is not executable`);
    }
    const storedDefinition = this.toDefinition(prompt);
    const computed = promptContentSha256(storedDefinition);
    if (computed !== prompt.contentSha256 || definition.contentSha256 !== prompt.contentSha256) {
      throw new ServiceUnavailableException(`Prompt registry hash mismatch: ${prompt.promptKey}:v${prompt.versionNo}`);
    }
    return { ...storedDefinition, contentSha256: computed };
  }

  private toDefinition(prompt: AiPromptVersion): Omit<AiPromptDefinition, 'contentSha256'> {
    if (
      !prompt.title ||
      !prompt.purpose ||
      !prompt.inputSchemaVersion ||
      !prompt.outputSchemaVersion ||
      !prompt.outputSchemaJson ||
      !prompt.maxInputBudget ||
      !prompt.timeoutPolicy ||
      !prompt.redactionPolicyVersion
    ) {
      throw new ServiceUnavailableException(`Prompt registry metadata is incomplete: ${prompt.promptKey}`);
    }
    return {
      promptKey: prompt.promptKey,
      versionNo: prompt.versionNo,
      title: prompt.title,
      purpose: prompt.purpose,
      systemTemplate: prompt.systemPrompt,
      userPromptTemplate: prompt.userPromptTemplate,
      inputSchemaVersion: prompt.inputSchemaVersion,
      outputSchemaVersion: prompt.outputSchemaVersion,
      outputSchema: prompt.outputSchemaJson as Record<string, unknown>,
      allowedProviderClasses: this.providerClasses(prompt.allowedProviderClasses),
      maxInputBudget: prompt.maxInputBudget,
      timeoutPolicy: this.timeoutPolicy(prompt.timeoutPolicy),
      redactionPolicyVersion: prompt.redactionPolicyVersion,
      requiredComponents: this.componentRefs(prompt.requiredComponents)
    };
  }

  private providerClasses(value: Prisma.JsonValue): AiProviderClass[] {
    if (!Array.isArray(value) || value.some((item) => !['mock', 'local', 'external'].includes(String(item)))) {
      throw new ServiceUnavailableException('Prompt allowed provider classes are invalid');
    }
    return value.map((item) => String(item) as AiProviderClass);
  }

  private timeoutPolicy(value: Prisma.JsonValue): AiPromptDefinition['timeoutPolicy'] {
    if (!value || Array.isArray(value) || typeof value !== 'object') {
      throw new ServiceUnavailableException('Prompt timeout policy is invalid');
    }
    const timeoutMs = Number(value.timeoutMs);
    const maxAttempts = Number(value.maxAttempts);
    if (
      !Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 300_000 ||
      !Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 10 ||
      value.onFailure !== 'MANUAL_REVIEW'
    ) {
      throw new ServiceUnavailableException('Prompt timeout policy is invalid');
    }
    return { timeoutMs, maxAttempts, onFailure: 'MANUAL_REVIEW' };
  }

  private componentRefs(value: Prisma.JsonValue): AiPromptComponentRef[] {
    if (!Array.isArray(value)) throw new ServiceUnavailableException('Prompt component list is invalid');
    return value.map((item) => {
      if (!item || Array.isArray(item) || typeof item !== 'object') {
        throw new ServiceUnavailableException('Prompt component reference is invalid');
      }
      const promptKey = String(item.promptKey ?? '');
      const versionNo = Number(item.versionNo);
      const contentSha256 = String(item.contentSha256 ?? '');
      if (
        !/^[a-z][a-z0-9_]{1,63}$/.test(promptKey) ||
        !Number.isInteger(versionNo) || versionNo < 1 ||
        !/^[0-9a-f]{64}$/.test(contentSha256)
      ) {
        throw new ServiceUnavailableException('Prompt component reference is invalid');
      }
      return { promptKey, versionNo, contentSha256 };
    });
  }

  private versionRef(prompt: AiPromptVersion) {
    return {
      id: prompt.id,
      promptKey: prompt.promptKey,
      versionNo: prompt.versionNo,
      contentSha256: prompt.contentSha256
    };
  }
}
