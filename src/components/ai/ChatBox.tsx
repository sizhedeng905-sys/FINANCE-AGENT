import { useEffect, useRef, useState } from 'react';
import { SendOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { Alert, Avatar, Button, Input, Space, Tag, Typography } from 'antd';
import { postAIChatApi } from '@/api/aiApi';
import type { AiToolName, ChatMessage } from '@/types/ai';

interface ChatBoxProps {
  compact?: boolean;
  quickQuestions?: string[];
  contextId?: string;
}

const defaultQuickQuestions = [
  '今天经营情况怎么样？',
  '本月总收入、总支出、总利润是多少？',
  '有哪些待老板审批工单？',
  '今天有哪些异常？',
];

const toolLabels: Record<AiToolName, string> = {
  get_today_report: '经营报表',
  get_finance_report: '财务报表',
  get_project_summary: '项目汇总',
  get_pending_approvals: '待审批',
  get_anomalies: '异常记录',
  get_work_order_detail: '工单详情',
};

function greeting(compact?: boolean): ChatMessage {
  return {
    id: 'hello',
    role: 'assistant',
    content: compact ? '我可以依据这张工单和结构化经营数据解释风险。' : '周总，我会依据系统中的结构化数据回答收入、成本、利润和异常问题。',
    createdAt: '刚刚',
  };
}

function displayTime(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? value
    : parsed.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

export default function ChatBox({ compact, quickQuestions = defaultQuickQuestions, contextId }: ChatBoxProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([greeting(compact)]);
  const [conversationId, setConversationId] = useState<string>();
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failedQuestion, setFailedQuestion] = useState<string>();
  const listRef = useRef<HTMLDivElement>(null);
  const requestVersion = useRef(0);

  useEffect(() => {
    requestVersion.current += 1;
    setMessages([greeting(compact)]);
    setConversationId(undefined);
    setInput('');
    setLoading(false);
    setError(null);
    setFailedQuestion(undefined);
  }, [compact, contextId]);

  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [loading, messages]);

  const send = async (value = input) => {
    const content = value.trim();
    if (!content || loading) return;
    const version = ++requestVersion.current;
    const userMessage: ChatMessage = {
      id: `user-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      role: 'user',
      content,
      createdAt: new Date().toISOString(),
    };
    const history = [...messages.filter((item) => item.id !== 'hello'), userMessage].map(
      ({ id, role, content: historyContent, createdAt }) => ({ id, role, content: historyContent, createdAt }),
    );
    setMessages((current) => [...current, userMessage]);
    setInput('');
    setLoading(true);
    setError(null);
    setFailedQuestion(undefined);
    try {
      const response = await postAIChatApi({
        message: content,
        conversationId,
        history,
        workOrderId: contextId,
      });
      if (version !== requestVersion.current) return;
      setConversationId(response.conversationId);
      setMessages((current) => [
        ...current,
        {
          ...response.message,
          toolsUsed: response.toolsUsed,
          fallback: response.fallback,
        },
      ]);
    } catch (reason) {
      if (version !== requestVersion.current) return;
      setError(reason instanceof Error ? reason.message : 'AI 请求失败');
      setFailedQuestion(content);
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  };

  return (
    <div className={compact ? 'chat-box compact' : 'chat-box'}>
      {!compact ? (
        <div className="quick-question-bar">
          {quickQuestions.map((item) => (
            <Button key={item} icon={<ThunderboltOutlined />} disabled={loading} onClick={() => void send(item)}>
              {item}
            </Button>
          ))}
        </div>
      ) : null}
      <div className="chat-list" ref={listRef}>
        {messages.map((item) => (
          <div key={item.id} className={`chat-message ${item.role}`}>
            <Avatar className="chat-avatar">{item.role === 'assistant' ? 'AI' : '我'}</Avatar>
            <div className="chat-bubble">
              <Typography.Paragraph>{item.content}</Typography.Paragraph>
              {item.toolsUsed?.length || item.fallback ? (
                <Space size={[4, 4]} wrap className="chat-message-meta">
                  {item.toolsUsed?.map((tool) => <Tag key={tool}>{toolLabels[tool]}</Tag>)}
                  {item.fallback ? <Tag color="warning">需要人工确认</Tag> : null}
                </Space>
              ) : null}
              <Typography.Text type="secondary">{displayTime(item.createdAt)}</Typography.Text>
            </div>
          </div>
        ))}
        {loading ? <Typography.Text type="secondary">AI 正在整理经营数据...</Typography.Text> : null}
        {error ? (
          <Alert
            className="chat-error"
            type="error"
            showIcon
            message="AI 请求失败"
            description={error}
            action={failedQuestion ? <Button size="small" onClick={() => void send(failedQuestion)}>重试</Button> : undefined}
          />
        ) : null}
      </div>
      <div className="chat-input">
        <Input.TextArea
          value={input}
          maxLength={2000}
          showCount
          disabled={loading}
          onChange={(event) => setInput(event.target.value)}
          autoSize={{ minRows: 1, maxRows: 4 }}
          placeholder="输入你想问的问题"
          onPressEnter={(event) => {
            if (!event.shiftKey) {
              event.preventDefault();
              void send();
            }
          }}
        />
        <Button type="primary" icon={<SendOutlined />} loading={loading} onClick={() => void send()}>
          发送
        </Button>
      </div>
    </div>
  );
}
