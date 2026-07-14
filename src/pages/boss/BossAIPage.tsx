import { Card } from 'antd';
import PageHeader from '@/components/PageHeader';
import ChatBox from '@/components/ai/ChatBox';
import { getBossQuickQuestions } from '@/api/aiApi';

const quickQuestions = getBossQuickQuestions();

export default function BossAIPage() {
  return (
    <div>
      <PageHeader title="AI经营助手" description="基于结构化经营数据回答问题，无法确认时明确转人工" />
      <Card className="boss-ai-card" bodyStyle={{ padding: 0 }}>
        <ChatBox quickQuestions={quickQuestions} />
      </Card>
    </div>
  );
}
