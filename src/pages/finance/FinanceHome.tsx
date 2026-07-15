import { useNavigate } from 'react-router-dom';
import { Button, Card, Col, Row, Table, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import PageHeader from '@/components/PageHeader';
import MetricCard from '@/components/MetricCard';
import StatusTag from '@/components/workOrder/StatusTag';
import RiskTag from '@/components/workOrder/RiskTag';
import { useWorkOrderStore } from '@/store/workOrderStore';
import type { WorkOrder } from '@/types/workOrder';
import { formatMoney } from '@/utils/format';
import { workOrderTypeMap } from '@/utils/statusMap';

export default function FinanceHome() {
  const navigate = useNavigate();
  const workOrders = useWorkOrderStore((state) => state.workOrders);
  const pending = workOrders.filter((item) => ['finance_reviewing', 'reviewer_rejected'].includes(item.status));
  const todayReviewed = workOrders.filter((item) => ['reviewer_reviewing', 'finance_rejected'].includes(item.status)).length;
  const aiAnomalies = workOrders.filter((item) => item.riskLevel !== 'low').length;
  const supplement = workOrders.filter((item) => item.status === 'returned_for_supplement').length;

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
        <Col xs={24} md={6}><MetricCard title="待财务审核" value={pending.length} /></Col>
        <Col xs={24} md={6}><MetricCard title="今日已审核" value={todayReviewed} color="#16a34a" /></Col>
        <Col xs={24} md={6}><MetricCard title="AI提示异常" value={aiAnomalies} color="#fa8c16" /></Col>
        <Col xs={24} md={6}><MetricCard title="待补充材料" value={supplement} color="#dc2626" /></Col>
      </Row>
      <Card title="待审核工单" className="section-row">
        <Table rowKey="id" columns={columns} dataSource={pending} scroll={{ x: 900 }} />
      </Card>
    </div>
  );
}
