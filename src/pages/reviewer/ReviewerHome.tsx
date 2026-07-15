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
  const pending = workOrders.filter((item) => item.status === 'reviewer_reviewing');
  const reviewed = workOrders.filter((item) => ['ai_reviewing', 'boss_pending', 'completed'].includes(item.status)).length;
  const highRisk = pending.filter((item) => item.riskLevel === 'high').length;
  const returned = workOrders.filter((item) => item.status === 'reviewer_rejected').length;

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
        <Col xs={24} md={6}><MetricCard title="待复核数量" value={pending.length} /></Col>
        <Col xs={24} md={6}><MetricCard title="今日已复核" value={reviewed} color="#16a34a" /></Col>
        <Col xs={24} md={6}><MetricCard title="高风险待复核" value={highRisk} color="#dc2626" /></Col>
        <Col xs={24} md={6}><MetricCard title="被退回数量" value={returned} color="#fa8c16" /></Col>
      </Row>
      <Card title="待复核工单" className="section-row">
        <Table rowKey="id" columns={columns} dataSource={pending} scroll={{ x: 920 }} />
      </Card>
    </div>
  );
}
