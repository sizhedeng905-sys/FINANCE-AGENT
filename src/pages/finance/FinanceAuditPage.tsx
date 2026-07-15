import { useMemo, useState } from 'react';
import { Alert, App, Card, Descriptions, Empty, List, Space, Tabs, Typography } from 'antd';
import PageHeader from '@/components/PageHeader';
import AttachmentPreview from '@/components/workOrder/AttachmentPreview';
import AISummaryCard from '@/components/workOrder/AISummaryCard';
import AuditActionBar, { type AuditActionPayload } from '@/components/workOrder/AuditActionBar';
import AuditTimeline from '@/components/workOrder/AuditTimeline';
import RiskTag from '@/components/workOrder/RiskTag';
import StatusTag from '@/components/workOrder/StatusTag';
import { useWorkOrderStore } from '@/store/workOrderStore';
import { formatMoney } from '@/utils/format';
import { workOrderTypeMap } from '@/utils/statusMap';

type TabKey = 'pending' | 'anomaly' | 'reviewed' | 'rejected';

export default function FinanceAuditPage() {
  const { message } = App.useApp();
  const [tab, setTab] = useState<TabKey>('pending');
  const [selectedId, setSelectedId] = useState<string>();
  const workOrders = useWorkOrderStore((state) => state.workOrders);
  const financeReview = useWorkOrderStore((state) => state.financeReview);
  const runAiReview = useWorkOrderStore((state) => state.runAiReview);
  const loading = useWorkOrderStore((state) => state.loading);
  const error = useWorkOrderStore((state) => state.error);

  const list = useMemo(() => {
    if (tab === 'pending') return workOrders.filter((item) => ['finance_reviewing', 'reviewer_rejected'].includes(item.status));
    if (tab === 'anomaly') return workOrders.filter((item) => item.riskLevel !== 'low' && ['finance_reviewing', 'reviewer_rejected'].includes(item.status));
    if (tab === 'reviewed') return workOrders.filter((item) => ['reviewer_reviewing', 'ai_reviewing', 'boss_pending', 'completed'].includes(item.status));
    return workOrders.filter((item) => item.status === 'finance_rejected');
  }, [tab, workOrders]);

  const selected = list.find((item) => item.id === selectedId) ?? list[0];

  const handleAction = async (payload: AuditActionPayload) => {
    if (!selected) return;
    await financeReview(selected.id, { action: payload.action, comment: payload.comment || undefined });
    message.success('财务审核操作成功');
  };

  return (
    <div>
      <PageHeader title="财务审核中心" description="左侧选择工单，右侧完成审核操作" />
      {error ? <Alert type="error" showIcon message="工单加载或操作失败" description={error} /> : null}
      <div className="audit-layout">
        <Card className="audit-list-card">
          <Tabs
            activeKey={tab}
            onChange={(value) => {
              setTab(value as TabKey);
              setSelectedId(undefined);
            }}
            items={[
              { key: 'pending', label: '待审核' },
              { key: 'anomaly', label: '异常优先' },
              { key: 'reviewed', label: '已审核' },
              { key: 'rejected', label: '已驳回' },
            ]}
          />
          <List
            loading={loading}
            dataSource={list}
            locale={{ emptyText: '暂无工单' }}
            renderItem={(item) => (
              <List.Item
                className={item.id === selected?.id ? 'audit-list-item active' : 'audit-list-item'}
                onClick={() => setSelectedId(item.id)}
              >
                <List.Item.Meta
                  title={<Typography.Text strong>{item.orderNo}</Typography.Text>}
                  description={
                    <Space direction="vertical" size={2}>
                      <span>{item.projectName}</span>
                      <span>{formatMoney(item.amount)} · <RiskTag risk={item.riskLevel} /></span>
                    </Space>
                  }
                />
              </List.Item>
            )}
          />
        </Card>

        <div className="audit-detail">
          {selected ? (
            <>
              <Card title="工单基础信息">
                <Descriptions bordered size="small" column={2}>
                  <Descriptions.Item label="编号">{selected.orderNo}</Descriptions.Item>
                  <Descriptions.Item label="类型">{workOrderTypeMap[selected.type]}</Descriptions.Item>
                  <Descriptions.Item label="项目">{selected.projectName}</Descriptions.Item>
                  <Descriptions.Item label="客户">{selected.customerName}</Descriptions.Item>
                  <Descriptions.Item label="金额">{formatMoney(selected.amount)}</Descriptions.Item>
                  <Descriptions.Item label="状态"><StatusTag status={selected.status} /></Descriptions.Item>
                  <Descriptions.Item label="员工填写内容" span={2}>{selected.description}</Descriptions.Item>
                </Descriptions>
              </Card>
              <div className="audit-subgrid">
                <Card title="附件预览"><AttachmentPreview attachments={selected.attachments} /></Card>
                <AISummaryCard summary={selected.aiSummary} riskLevel={selected.riskLevel} />
              </div>
              <Card title="审核时间线"><AuditTimeline timeline={selected.timeline} /></Card>
              <Card title="财务操作">
                <AuditActionBar
                  role="finance"
                  workOrder={selected}
                  onAction={handleAction}
                  onSimulateAI={async () => {
                    await runAiReview(selected.id);
                    message.success('规则复核已完成');
                  }}
                />
              </Card>
            </>
          ) : (
            <Card><Empty description="请选择工单" /></Card>
          )}
        </div>
      </div>
    </div>
  );
}
