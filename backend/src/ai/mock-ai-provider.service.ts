import { Injectable } from '@nestjs/common';

import { AiAnswerGroundingService } from './ai-answer-grounding.service';
import { AiProviderRequest, AiProviderResult } from './ai.types';

@Injectable()
export class MockAiProviderService {
  constructor(
    private readonly grounding: AiAnswerGroundingService = new AiAnswerGroundingService()
  ) {}

  async generate(request: AiProviderRequest): Promise<AiProviderResult> {
    const envelope = {
      claims: request.claimCandidates ?? this.grounding.createExpectedEnvelope(request.contexts, request.question).claims
    };
    const text = JSON.stringify(envelope);
    return {
      text,
      inputTokens: 0,
      outputTokens: 0,
      raw: { provider: 'mock', tools: request.contexts.map((item) => item.name), envelope }
    };
  }
}
