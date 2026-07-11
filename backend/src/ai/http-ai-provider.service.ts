import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AiProviderRequest, AiProviderResult } from './ai.types';

@Injectable()
export class HttpAiProviderService {
  constructor(private readonly config: ConfigService) {}

  async generate(request: AiProviderRequest): Promise<AiProviderResult> {
    if (request.provider === 'openai') return this.openAiResponses(request);
    return this.openAiCompatible(request);
  }

  private async openAiResponses(request: AiProviderRequest): Promise<AiProviderResult> {
    const apiKey = this.apiKey();
    if (!apiKey) throw new Error('AI_API_KEY/OPENAI_API_KEY 未配置');
    const response = await this.post(`${this.baseUrl(request.baseUrl)}/responses`, apiKey, {
      model: request.model,
      instructions: request.instructions,
      input: this.input(request)
    });
    const text =
      typeof response.output_text === 'string'
        ? response.output_text
        : Array.isArray(response.output)
          ? response.output
              .flatMap((item: any) => (Array.isArray(item.content) ? item.content : []))
              .filter((item: any) => item.type === 'output_text' && typeof item.text === 'string')
              .map((item: any) => item.text)
              .join('\n')
          : '';
    if (!text) throw new Error('模型未返回文本');
    return {
      text,
      inputTokens: Number(response.usage?.input_tokens ?? 0),
      outputTokens: Number(response.usage?.output_tokens ?? 0),
      raw: response
    };
  }

  private async openAiCompatible(request: AiProviderRequest): Promise<AiProviderResult> {
    const response = await this.post(`${this.baseUrl(request.baseUrl)}/chat/completions`, this.apiKey(), {
      model: request.model,
      temperature: 0,
      messages: [
        { role: 'system', content: request.instructions },
        { role: 'user', content: this.input(request) }
      ]
    });
    const text = response.choices?.[0]?.message?.content;
    if (typeof text !== 'string' || !text.trim()) throw new Error('模型未返回文本');
    return {
      text,
      inputTokens: Number(response.usage?.prompt_tokens ?? 0),
      outputTokens: Number(response.usage?.completion_tokens ?? 0),
      raw: response
    };
  }

  private async post(url: string, apiKey: string, body: unknown): Promise<any> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const timeoutMs = this.config.get<number>('ai.timeoutMs') ?? 30000;
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs)
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = payload?.error?.message || `AI provider HTTP ${response.status}`;
      throw new Error(String(message));
    }
    return payload;
  }

  private input(request: AiProviderRequest) {
    return `用户问题：${request.question}\n工具返回的结构化上下文：\n${JSON.stringify(request.contexts)}`;
  }

  private baseUrl(override?: string | null) {
    return (override || this.config.get<string>('ai.baseUrl') || 'https://api.openai.com/v1').replace(/\/+$/, '');
  }

  private apiKey() {
    return this.config.get<string>('ai.apiKey') || '';
  }
}
