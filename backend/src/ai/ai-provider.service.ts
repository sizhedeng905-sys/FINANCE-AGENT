import { Injectable } from '@nestjs/common';

import { AiProviderRequest } from './ai.types';
import { HttpAiProviderService } from './http-ai-provider.service';
import { MockAiProviderService } from './mock-ai-provider.service';

@Injectable()
export class AiProviderService {
  constructor(
    private readonly mock: MockAiProviderService,
    private readonly http: HttpAiProviderService
  ) {}

  generate(request: AiProviderRequest) {
    if (request.provider === 'mock') return this.mock.generate(request);
    if (request.provider === 'openai' || request.provider === 'openai_compatible') return this.http.generate(request);
    throw new Error(`不支持的AI Provider：${request.provider}`);
  }

  generateSafe(request: AiProviderRequest) {
    return this.mock.generate({
      ...request,
      provider: 'mock',
      model: 'mock-structured-v1',
      baseUrl: undefined,
      apiKey: undefined
    });
  }
}
