import { ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiMessageRole, Prisma } from '@prisma/client';

import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CurrentUser, RequestContext } from '../common/types/current-user';
import { PrismaService } from '../prisma/prisma.service';
import { AiChatDto } from './dto/ai-chat.dto';
import { QueryAiCallLogsDto } from './dto/query-ai-call-logs.dto';
import { AiProviderService } from './ai-provider.service';
import { AiToolsService } from './ai-tools.service';

const DEFAULT_SYSTEM_PROMPT = [
  '你是物流企业老板的财务运营助手。',
  '只能依据工具返回的结构化上下文回答，不得编造金额、项目、工单或人员。',
  '工具没有提供答案时，明确回答“需要人工确认”。',
  '金额和数量必须原样引用，风险建议必须说明对应规则或异常原因。',
  '不要声称自己直接查询了数据库。'
].join('\n');

@Injectable()
export class AiService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tools: AiToolsService,
    private readonly provider: AiProviderService,
    private readonly auditLogs: AuditLogsService,
    private readonly config: ConfigService
  ) {}

  async chat(dto: AiChatDto, actor: CurrentUser, context: RequestContext) {
    const conversation = await this.resolveConversation(dto, actor);
    await this.prisma.aiMessage.create({
      data: {
        conversationId: conversation.id,
        role: AiMessageRole.user,
        content: dto.message
      }
    });

    const providerName = this.config.get<string>('ai.provider') || 'mock';
    const runtimeModel = this.config.get<string>('ai.model') || 'gpt-5.4-mini';
    const [modelConfig, promptVersion] = await Promise.all([
      this.prisma.aiModelConfig.findFirst({ where: { provider: providerName, isActive: true }, orderBy: { createdAt: 'desc' } }),
      this.prisma.aiPromptVersion.findFirst({ where: { promptKey: 'boss_chat', isActive: true }, orderBy: { versionNo: 'desc' } })
    ]);
    const model = providerName === 'mock' ? modelConfig?.modelName ?? 'mock-structured-v1' : runtimeModel || modelConfig?.modelName || 'gpt-5.4-mini';
    const instructions = promptVersion?.systemPrompt || DEFAULT_SYSTEM_PROMPT;
    const startedAt = Date.now();
    let contexts: Awaited<ReturnType<AiToolsService['buildContext']>> = [];
    let reply = '';
    let inputTokens = 0;
    let outputTokens = 0;
    let raw: unknown = null;
    let errorMessage: string | null = null;

    try {
      contexts = await this.tools.buildContext(dto.message, dto.workOrderId, actor);
      const result = await this.provider.generate({
        provider: providerName,
        model,
        baseUrl: modelConfig?.baseUrl ?? this.config.get<string>('ai.baseUrl'),
        instructions,
        question: dto.message,
        contexts
      });
      reply = result.text;
      inputTokens = result.inputTokens;
      outputTokens = result.outputTokens;
      raw = result.raw;
    } catch (error) {
      errorMessage = error instanceof Error ? error.message.slice(0, 2000) : '未知AI调用错误';
      reply = 'AI 服务暂不可用，需要人工确认。';
    }

    const latencyMs = Date.now() - startedAt;
    const assistantMessage = await this.prisma.$transaction(async (tx) => {
      const message = await tx.aiMessage.create({
        data: {
          conversationId: conversation.id,
          role: AiMessageRole.assistant,
          content: reply,
          toolContext: this.json(contexts)
        }
      });
      await tx.aiConversation.update({ where: { id: conversation.id }, data: { updatedAt: new Date() } });
      await tx.aiCallLog.create({
        data: {
          conversationId: conversation.id,
          modelConfigId: modelConfig?.id,
          promptVersionId: promptVersion?.id,
          provider: providerName,
          modelName: model,
          requestPayload: this.json({ message: dto.message, workOrderId: dto.workOrderId ?? null, contexts }),
          responsePayload: raw === null ? undefined : this.json(raw),
          inputTokens,
          outputTokens,
          latencyMs,
          success: errorMessage === null,
          errorMessage,
          createdBy: actor.id
        }
      });
      await this.auditLogs.write(
        tx,
        actor,
        'ai.chat',
        'ai_conversation',
        conversation.id,
        { provider: providerName, model, tools: contexts.map((item) => item.name), success: errorMessage === null },
        context
      );
      return message;
    });

    return {
      conversationId: conversation.id,
      reply,
      content: reply,
      message: {
        id: assistantMessage.id,
        role: assistantMessage.role,
        content: assistantMessage.content,
        createdAt: assistantMessage.createdAt.toISOString()
      },
      toolsUsed: contexts.map((item) => item.name),
      provider: providerName,
      model,
      fallback: errorMessage !== null
    };
  }

  async callLogs(query: QueryAiCallLogsDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where: Prisma.AiCallLogWhereInput = { provider: query.provider, success: query.success };
    const [items, total] = await Promise.all([
      this.prisma.aiCallLog.findMany({
        where,
        include: { promptVersion: true, modelConfig: true },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize
      }),
      this.prisma.aiCallLog.count({ where })
    ]);
    return {
      items: items.map((item) => ({
        id: item.id,
        conversationId: item.conversationId ?? undefined,
        provider: item.provider,
        model: item.modelName,
        promptVersion: item.promptVersion
          ? `${item.promptVersion.promptKey}:v${item.promptVersion.versionNo}`
          : undefined,
        input: item.requestPayload,
        output: item.responsePayload ?? undefined,
        tokenUsage: { input: item.inputTokens, output: item.outputTokens, total: item.inputTokens + item.outputTokens },
        latency: item.latencyMs,
        success: item.success,
        error: item.errorMessage ?? undefined,
        createdAt: item.createdAt.toISOString()
      })),
      page,
      pageSize,
      total
    };
  }

  private async resolveConversation(dto: AiChatDto, actor: CurrentUser) {
    if (!dto.conversationId) {
      return this.prisma.aiConversation.create({
        data: {
          ownerUserId: actor.id,
          title: dto.message.trim().slice(0, 60) || '经营问答'
        }
      });
    }
    const conversation = await this.prisma.aiConversation.findUnique({ where: { id: dto.conversationId } });
    if (!conversation || conversation.ownerUserId !== actor.id) throw new ForbiddenException('无权访问该AI会话');
    return conversation;
  }

  private json(value: unknown): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }
}
