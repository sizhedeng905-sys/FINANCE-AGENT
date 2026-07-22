import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, App, Button, Card, Col, Drawer, Empty, Row, Space, Typography } from 'antd';
import PageHeader from '@/components/PageHeader';
import ChatBox from '@/components/ai/ChatBox';
import RiskTag from '@/components/workOrder/RiskTag';
import StatusTag from '@/components/workOrder/StatusTag';
import { useWorkOrderStore } from '@/store/workOrderStore';
import type { WorkOrder } from '@/types/workOrder';
import { formatMoney } from '@/utils/format';
import { workOrderTypeMap } from '@/utils/statusMap';

export default function BossApprovalPage() {
  const navigate = useNavigate();
  const { message } = App.useApp();
  const [askItem, setAskItem] = useState<WorkOrder | null>(null);
  const workOrders = useWorkOrderStore((state) => state.workOrders);
  const bossApprove = useWorkOrderStore((state) => state.bossApprove);
  const loading = useWorkOrderStore((state) => state.loading);
  const error = useWorkOrderStore((state) => state.error);
  const pending = workOrders.filter((item) => item.status === 'boss_pending');

  const approve = async (item: WorkOrder) => {
    await bossApprove(item.id, { action: 'approve', comment: '同意通过，归档完成。' });
    message.success('审批完成，已生成项目数据记录，可在数据中心查看。');
  };

  const reject = async (item: WorkOrder) => {
    await bossApprove(item.id, { action: 'reject', comment: '暂不通过，请补充说明。' });
    message.success('已驳回');
  };

  return (
    <div>
      <PageHeader title="最终审批" description="以卡片方式查看待老板终审工单" />
      {error ? <Alert type="error" showIcon message="工单加载或审批失败" description={error} /> : null}
      {!loading && pending.length === 0 ? <Empty description="暂无待审批工单" /> : null}
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
                  <Button type="primary" loading={loading} onClick={() => void approve(item).catch((error) => message.error(error instanceof Error ? error.message : '审批失败'))}>通过</Button>
                  <Button danger loading={loading} onClick={() => void reject(item).catch((error) => message.error(error instanceof Error ? error.message : '驳回失败'))}>驳回</Button>
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
