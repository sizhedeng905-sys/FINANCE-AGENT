import { useNavigate } from 'react-router-dom';
import { PlusOutlined } from '@ant-design/icons';
import { Button, Card, Col, Row, Space, Table, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import PageHeader from '@/components/PageHeader';
import MetricCard from '@/components/MetricCard';
import StatusTag from '@/components/workOrder/StatusTag';
import RiskTag from '@/components/workOrder/RiskTag';
import { useAuthStore } from '@/store/authStore';
import { useWorkOrderStore } from '@/store/workOrderStore';
import type { WorkOrder } from '@/types/workOrder';
import { formatMoney } from '@/utils/format';
import { statusTextMap, workOrderTypeMap } from '@/utils/statusMap';

export default function EmployeeHome() {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const workOrders = useWorkOrderStore((state) => state.workOrders);
  const mine = workOrders.filter((item) => item.creatorId === user?.id);

  const count = (predicate: (item: WorkOrder) => boolean) => mine.filter(predicate).length;

  const columns: ColumnsType<WorkOrder> = [
    { title: '工单编号', dataIndex: 'orderNo' },
    { title: '类型', dataIndex: 'type', render: (value) => workOrderTypeMap[value as WorkOrder['type']] },
    {
      title: '项目/客户',
      render: (_, record) => (
        <Space direction="vertical" size={0}>
          <Typography.Text strong>{record.projectName}</Typography.Text>
          <Typography.Text type="secondary">{record.customerName}</Typography.Text>
        </Space>
      ),
    },
    { title: '金额', dataIndex: 'amount', render: (value) => formatMoney(value) },
    { title: '风险', dataIndex: 'riskLevel', render: (value) => <RiskTag risk={value} /> },
    { title: '当前状态', dataIndex: 'status', render: (value) => <StatusTag status={value} /> },
    { title: '创建时间', dataIndex: 'createdAt' },
    {
      title: '操作',
      render: (_, record) => <Button type="link" onClick={() => navigate(`/work-orders/${record.id}`)}>查看详情</Button>,
    },
  ];

  return (
    <div>
      <PageHeader
        title="员工首页"
        description="提交工单并查看审核进度"
        extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/work-orders/create')}>新建工单</Button>}
      />
      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} xl={4}>
          <MetricCard title="待财务审核" value={count((item) => ['submitted', 'finance_reviewing'].includes(item.status))} />
        </Col>
        <Col xs={24} sm={12} xl={4}>
          <MetricCard title="待复核" value={count((item) => ['finance_approved', 'reviewer_reviewing'].includes(item.status))} />
        </Col>
        <Col xs={24} sm={12} xl={4}>
          <MetricCard title="AI复核中" value={count((item) => item.status === 'ai_reviewing')} />
        </Col>
        <Col xs={24} sm={12} xl={4}>
          <MetricCard title="老板待审批" value={count((item) => item.status === 'boss_pending')} />
        </Col>
        <Col xs={24} sm={12} xl={4}>
          <MetricCard title="已完成" value={count((item) => item.status === 'completed')} color="#16a34a" />
        </Col>
        <Col xs={24} sm={12} xl={4}>
          <MetricCard
            title="被驳回"
            value={count((item) => (statusTextMap[item.status] ?? '').includes('驳回'))}
            color="#dc2626"
          />
        </Col>
      </Row>

      <Card title="最近工单" className="section-row">
        <Table rowKey="id" columns={columns} dataSource={mine.slice(0, 8)} scroll={{ x: 980 }} />
      </Card>
    </div>
  );
}
