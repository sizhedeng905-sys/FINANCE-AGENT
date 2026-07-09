import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { App, Button, Card, Col, Drawer, Row, Space, Typography } from 'antd';
import PageHeader from '@/components/PageHeader';
import ChatBox from '@/components/ai/ChatBox';
import RiskTag from '@/components/workOrder/RiskTag';
import StatusTag from '@/components/workOrder/StatusTag';
import { useAuthStore } from '@/store/authStore';
import { useWorkOrderStore } from '@/store/workOrderStore';
import type { WorkOrder } from '@/types/workOrder';
import { formatMoney } from '@/utils/format';
import { workOrderTypeMap } from '@/utils/statusMap';
import { generateRecordFromWorkOrder } from '@/api/workOrderApi';

export default function BossApprovalPage() {
  const navigate = useNavigate();
  const { message } = App.useApp();
  const [askItem, setAskItem] = useState<WorkOrder | null>(null);
  const user = useAuthStore((state) => state.user);
  const workOrders = useWorkOrderStore((state) => state.workOrders);
  const updateStatus = useWorkOrderStore((state) => state.updateStatus);
  const pending = workOrders.filter((item) => item.status === 'boss_pending');

  const approve = async (item: WorkOrder) => {
    if (!user) return;
    updateStatus({
      id: item.id,
      status: 'completed',
      operator: user.name,
      role: user.role,
      action: '老板最终通过',
      comment: '同意通过，归档完成。',
      patch: { bossOpinion: '同意通过，归档完成。' },
    });
    await generateRecordFromWorkOrder({ ...item, status: 'completed', bossOpinion: '同意通过，归档完成。' });
    message.success('审批完成，已生成项目数据记录，可在数据中心查看。');
  };

  const reject = (item: WorkOrder) => {
    if (!user) return;
    updateStatus({
      id: item.id,
      status: 'boss_rejected',
      operator: user.name,
      role: user.role,
      action: '老板最终驳回',
      comment: '暂不通过，请补充说明。',
      patch: { bossOpinion: '暂不通过，请补充说明。' },
    });
    message.success('已驳回');
  };

  return (
    <div>
      <PageHeader title="最终审批" description="以卡片方式查看待老板终审工单" />
      <Row gutter={[16, 16]}>
        {pending.map((item) => (
          <Col xs={24} lg={12} xl={8} key={item.id}>
            <Card
              className="approval-card"
              title={
                <Space direction="vertical" size={2}>
                  <Typography.Text strong>{item.projectName}</Typography.Text>
                  <Typography.Text type="secondary">{item.customerName} · {item.orderNo}</Typography.Text>
                </Space>
              }
              extra={<StatusTag status={item.status} />}
            >
              <Space direction="vertical" size={12} className="full-width">
                <Space wrap>
                  <span>{workOrderTypeMap[item.type]}</span>
                  <RiskTag risk={item.riskLevel} />
                </Space>
                <div className="approval-stats">
                  <div><span>收入</span><strong>{formatMoney(item.income)}</strong></div>
                  <div><span>成本</span><strong>{formatMoney(item.cost)}</strong></div>
                  <div><span>利润</span><strong>{formatMoney(item.profit)}</strong></div>
                </div>
                <Typography.Paragraph>财务：{item.financeOpinion || '-'}</Typography.Paragraph>
                <Typography.Paragraph>复核：{item.reviewerOpinion || '-'}</Typography.Paragraph>
                <Typography.Paragraph>AI：{item.aiSummary}</Typography.Paragraph>
                <Space wrap>
                  <Button onClick={() => navigate(`/boss/approval/${item.id}`)}>查看详情</Button>
                  <Button type="primary" onClick={() => approve(item)}>通过</Button>
                  <Button danger onClick={() => reject(item)}>驳回</Button>
                  <Button onClick={() => setAskItem(item)}>询问AI</Button>
                </Space>
              </Space>
            </Card>
          </Col>
        ))}
      </Row>

      <Drawer title="询问AI" width={420} open={Boolean(askItem)} onClose={() => setAskItem(null)}>
        {askItem ? <ChatBox compact contextId={askItem.id} /> : null}
      </Drawer>
    </div>
  );
}
