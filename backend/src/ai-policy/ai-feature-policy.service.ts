import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export const AI_POLICY_VERSION = 'ai-feature-policy/1.0';

export type AiFeatureCapability = 'assistant' | 'ingestion' | 'report';
export type AiFeatureMode = 'disabled' | 'suggest';
export type AiProviderClass = 'mock' | 'local' | 'external';
export type AiDataClassification = 'synthetic' | 'real' | 'unknown';
export type AiExternalProviderMode = 'disabled' | 'synthetic-only';

export interface AiScopeModes {
  organizationMode?: AiFeatureMode;
  projectMode?: AiFeatureMode;
  templateMode?: AiFeatureMode;
}

export interface AiCallPolicyInput {
  capability: AiFeatureCapability;
  providerClass: AiProviderClass;
  dataClassification: AiDataClassification;
  scopeModes?: AiScopeModes;
}

@Injectable()
export class AiFeaturePolicyService {
  constructor(private readonly config: ConfigService) {}

  effectiveMode(capability: Exclude<AiFeatureCapability, 'assistant'>, scopeModes: AiScopeModes = {}): AiFeatureMode {
    if (this.killSwitchEnabled()) return 'disabled';
    const globalMode = this.config.get<AiFeatureMode>(
      capability === 'ingestion' ? 'ai.ingestionMode' : 'ai.reportMode'
    ) ?? 'disabled';
    const modes = [
      globalMode,
      scopeModes.organizationMode,
      scopeModes.projectMode,
      scopeModes.templateMode
    ].filter((mode): mode is AiFeatureMode => mode !== undefined);
    return modes.includes('disabled') ? 'disabled' : 'suggest';
  }

  assertCallAllowed(input: AiCallPolicyInput) {
    if (this.killSwitchEnabled()) {
      throw new ServiceUnavailableException('AI_GLOBAL_KILL_SWITCH is active; no new AI calls are allowed');
    }
    if (input.capability !== 'assistant' && this.effectiveMode(input.capability, input.scopeModes) !== 'suggest') {
      throw new ServiceUnavailableException(`AI ${input.capability} suggestions are disabled`);
    }
    if (input.providerClass !== 'external') return;

    const externalMode = this.config.get<AiExternalProviderMode>('ai.externalProviderMode') ?? 'disabled';
    if (externalMode === 'disabled') {
      throw new ServiceUnavailableException('External AI provider calls are disabled pending H12 approval');
    }
    if (input.dataClassification !== 'synthetic') {
      throw new ServiceUnavailableException('External AI providers may only receive explicitly synthetic data');
    }
  }

  snapshot(capability: Exclude<AiFeatureCapability, 'assistant'>, scopeModes: AiScopeModes = {}) {
    return {
      schemaVersion: 'ai-policy-snapshot/1.0',
      policyVersion: AI_POLICY_VERSION,
      capability,
      globalMode: this.config.get<AiFeatureMode>(
        capability === 'ingestion' ? 'ai.ingestionMode' : 'ai.reportMode'
      ) ?? 'disabled',
      scopeModes: {
        organization: scopeModes.organizationMode ?? null,
        project: scopeModes.projectMode ?? null,
        template: scopeModes.templateMode ?? null
      },
      effectiveMode: this.effectiveMode(capability, scopeModes),
      globalKillSwitch: this.killSwitchEnabled(),
      externalProviderMode: this.config.get<AiExternalProviderMode>('ai.externalProviderMode') ?? 'disabled'
    } as const;
  }

  private killSwitchEnabled() {
    return this.config.get<boolean>('ai.globalKillSwitch') === true;
  }
}
