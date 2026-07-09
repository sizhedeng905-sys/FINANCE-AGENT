import { useState } from 'react';
import { SendOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { Button, Input, Space, Avatar, Typography } from 'antd';
import { postAIChatApi } from '@/api/aiApi';
import type { ChatMessage } from '@/types/ai';

interface ChatBoxProps {
  compact?: boolean;
  quickQuestions?: string[];
  contextId?: string;
}

const defaultQuickQuestions = [
  '今天有哪些异常？',
  '本月哪个客户利润最高？',
  '最近油费有没有异常？',
  '有哪些工单需要我重点关注？',
];

export default function ChatBox({ compact, quickQuestions = defaultQuickQuestions, contextId }: ChatBoxProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'hello',
      role: 'assistant',
      content: compact ? '我可以帮你解释这张工单的风险。' : '周总，我会用经营语言帮你看收入、成本、利润和异常。',
      createdAt: '刚刚',
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  const send = async (value = input) => {
    const content = value.trim();
    if (!content || loading) return;
    const userMessage: ChatMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      content,
      createdAt: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
    };
    setMessages((current) => [...current, userMessage]);
    setInput('');
    setLoading(true);
    const reply = await postAIChatApi({ message: content, history: messages, workOrderId: contextId });
    setMessages((current) => [
      ...current,
      {
        id: `a-${Date.now()}`,
        role: 'assistant',
        content: reply,
        createdAt: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
      },
    ]);
    setLoading(false);
  };

  return (
    <div className={compact ? 'chat-box compact' : 'chat-box'}>
      {!compact ? (
        <div className="quick-question-bar">
          {quickQuestions.map((item) => (
            <Button key={item} icon={<ThunderboltOutlined />} onClick={() => send(item)}>
              {item}
            </Button>
          ))}
        </div>
      ) : null}
      <div className="chat-list">
        {messages.map((item) => (
          <div key={item.id} className={`chat-message ${item.role}`}>
            <Avatar className="chat-avatar">{item.role === 'assistant' ? 'AI' : '我'}</Avatar>
            <div className="chat-bubble">
              <Typography.Paragraph>{item.content}</Typography.Paragraph>
              <Typography.Text type="secondary">{item.createdAt}</Typography.Text>
            </div>
          </div>
        ))}
        {loading ? <Typography.Text type="secondary">AI 正在整理经营建议...</Typography.Text> : null}
      </div>
      <div className="chat-input">
        <Input.TextArea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          autoSize={{ minRows: 1, maxRows: 4 }}
          placeholder="输入你想问的问题"
          onPressEnter={(event) => {
            if (!event.shiftKey) {
              event.preventDefault();
              send();
            }
          }}
        />
        <Button type="primary" icon={<SendOutlined />} loading={loading} onClick={() => send()}>
          发送
        </Button>
      </div>
    </div>
  );
}
