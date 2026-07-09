import { Card } from 'antd';
import PageHeader from '@/components/PageHeader';
import ChatBox from '@/components/ai/ChatBox';
import { bossQuickQuestions } from '@/mock/mockAI';

export default function BossAIPage() {
  return (
    <div>
      <PageHeader title="AI经营助手" description="只有老板可以访问的完整 AI 聊天页面，接口预留 POST /api/ai/chat" />
      <Card className="boss-ai-card" bodyStyle={{ padding: 0 }}>
        <ChatBox quickQuestions={bossQuickQuestions} />
      </Card>
    </div>
  );
}
