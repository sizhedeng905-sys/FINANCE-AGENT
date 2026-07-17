import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, Col, Row, Table, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import PageHeader from '@/components/PageHeader';
import MetricCard from '@/components/MetricCard';
import StatusTag from '@/components/workOrder/StatusTag';
import RiskTag from '@/components/workOrder/RiskTag';
import { useWorkOrderStore } from '@/store/workOrderStore';
import { useReportStore } from '@/store/reportStore';
import type { WorkOrder } from '@/types/workOrder';
import { formatMoney } from '@/utils/format';
import { workOrderTypeMap } from '@/utils/statusMap';

export default function FinanceHome() {
  const navigate = useNavigate();
  const workOrders = useWorkOrderStore((state) => state.workOrders);
  const summary = useWorkOrderStore((state) => state.summary);
  const fetchSummary = useWorkOrderStore((state) => state.fetchSummary);
  const financeReport = useReportStore((state) => state.financeReports.today);
  const fetchFinanceReport = useReportStore((state) => state.fetchFinanceReport);
  const pending = workOrders.filter((item) => ['finance_reviewing', 'reviewer_rejected'].includes(item.status));
  const pendingCount = summary ? summary.byStatus.finance_reviewing + summary.byStatus.reviewer_rejected : '-';
  const supplement = summary?.byStatus.returned_for_supplement ?? '-';

  useEffect(() => {
    void fetchSummary().catch(() => undefined);
    void fetchFinanceReport('today').catch(() => undefined);
  }, [fetchFinanceReport, fetchSummary]);

  const columns: ColumnsType<WorkOrder> = [
    { title: '工单编号', dataIndex: 'orderNo' },
    { title: '类型', dataIndex: 'type', render: (value) => workOrderTypeMap[value as WorkOrder['type']] },
    { title: '项目', dataIndex: 'projectName' },
    { title: '金额', dataIndex: 'amount', render: (value) => formatMoney(value) },
    { title: '风险', dataIndex: 'riskLevel', render: (value) => <RiskTag risk={value} /> },
    { title: '状态', dataIndex: 'status', render: (value) => <StatusTag status={value} /> },
    { title: '操作', render: (_, record) => <Button type="link" onClick={() => navigate('/finance/audit')}>去审核</Button> },
  ];

  return (
    <div>
      <PageHeader title="财务首页" description="待审核工单与异常提示" />
      <Row gutter={[16, 16]}>
        <Col xs={24} md={6}><MetricCard title="待财务审核" value={pendingCount} /></Col>
        <Col xs={24} md={6}><MetricCard title="今日已审核" value={financeReport?.reviewedCount ?? '-'} color="#16a34a" /></Col>
        <Col xs={24} md={6}><MetricCard title="规则提示异常" value={financeReport?.anomalyCount ?? '-'} color="#fa8c16" /></Col>
        <Col xs={24} md={6}><MetricCard title="待补充材料" value={supplement} color="#dc2626" /></Col>
      </Row>
      <Card title="待审核工单" className="section-row">
        <Table rowKey="id" columns={columns} dataSource={pending} scroll={{ x: 900 }} />
      </Card>
    </div>
  );
}
