import { Injectable } from '@nestjs/common';

import { AiFeaturePolicyService, AiProviderClass } from '../ai-policy/ai-feature-policy.service';
import { AiProviderRequest } from './ai.types';
import { HttpAiProviderService } from './http-ai-provider.service';
import { MockAiProviderService } from './mock-ai-provider.service';

@Injectable()
export class AiProviderService {
  constructor(
    private readonly mock: MockAiProviderService,
    private readonly http: HttpAiProviderService,
    private readonly policy: AiFeaturePolicyService
  ) {}

  generate(request: AiProviderRequest) {
    this.policy.assertCallAllowed({
      capability: request.capability ?? 'assistant',
      providerClass: request.providerClass ?? this.inferProviderClass(request.provider),
      dataClassification: request.dataClassification ?? 'unknown',
      scopeModes: request.scopeModes
    });
    if (request.provider === 'mock') return this.mock.generate(request);
    if (request.provider === 'openai' || request.provider === 'openai_compatible') return this.http.generate(request);
    throw new Error(`Unsupported AI provider: ${request.provider}`);
  }

  private inferProviderClass(provider: string): AiProviderClass {
    return provider === 'mock' ? 'mock' : 'external';
  }
}
