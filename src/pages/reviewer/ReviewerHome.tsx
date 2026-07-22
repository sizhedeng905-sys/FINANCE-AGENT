import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, Col, Row, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import PageHeader from '@/components/PageHeader';
import MetricCard from '@/components/MetricCard';
import RiskTag from '@/components/workOrder/RiskTag';
import StatusTag from '@/components/workOrder/StatusTag';
import { useWorkOrderStore } from '@/store/workOrderStore';
import type { WorkOrder } from '@/types/workOrder';
import { formatMoney } from '@/utils/format';
import { workOrderTypeMap } from '@/utils/statusMap';

export default function ReviewerHome() {
  const navigate = useNavigate();
  const workOrders = useWorkOrderStore((state) => state.workOrders);
  const summary = useWorkOrderStore((state) => state.summary);
  const fetchSummary = useWorkOrderStore((state) => state.fetchSummary);
  const pending = workOrders.filter((item) => item.status === 'reviewer_reviewing');
  const reviewed = summary
    ? ['ai_reviewing', 'ai_passed', 'ai_flagged', 'boss_pending', 'boss_rejected', 'completed']
      .reduce((total, status) => total + summary.byStatus[status as WorkOrder['status']], 0)
    : '-';
  const pendingCount = summary?.byStatus.reviewer_reviewing ?? '-';
  const highRisk = summary?.byStatusAndRisk.reviewer_reviewing.high ?? '-';
  const returned = summary?.byStatus.reviewer_rejected ?? '-';

  useEffect(() => {
    void fetchSummary().catch(() => undefined);
  }, [fetchSummary]);

  const columns: ColumnsType<WorkOrder> = [
    { title: '工单编号', dataIndex: 'orderNo' },
    { title: '类型', dataIndex: 'type', render: (value) => workOrderTypeMap[value as WorkOrder['type']] },
    { title: '项目', dataIndex: 'projectName' },
    { title: '金额', dataIndex: 'amount', render: (value) => formatMoney(value) },
    { title: '风险', dataIndex: 'riskLevel', render: (value) => <RiskTag risk={value} /> },
    { title: '状态', dataIndex: 'status', render: (value) => <StatusTag status={value} /> },
    { title: '操作', render: (_, record) => <Button type="link" onClick={() => navigate(`/reviewer/tasks/${record.id}`)}>复核</Button> },
  ];

  return (
    <div>
      <PageHeader title="复核员首页" description="二次确认财务审核后的工单" />
      <Row gutter={[16, 16]}>
        <Col xs={24} md={6}><MetricCard title="待复核数量" value={pendingCount} /></Col>
        <Col xs={24} md={6}><MetricCard title="已进入后续流程" value={reviewed} color="#16a34a" /></Col>
        <Col xs={24} md={6}><MetricCard title="高风险待复核" value={highRisk} color="#dc2626" /></Col>
        <Col xs={24} md={6}><MetricCard title="被退回数量" value={returned} color="#fa8c16" /></Col>
      </Row>
      <Card title="待复核工单" className="section-row">
        <Table rowKey="id" columns={columns} dataSource={pending} scroll={{ x: 920 }} />
      </Card>
    </div>
  );
}
