import { useNavigate } from 'react-router-dom';
import { Button, Card, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import PageHeader from '@/components/PageHeader';
import RiskTag from '@/components/workOrder/RiskTag';
import { useWorkOrderStore } from '@/store/workOrderStore';
import type { WorkOrder } from '@/types/workOrder';
import { formatMoney } from '@/utils/format';
import { workOrderTypeMap } from '@/utils/statusMap';

export default function ReviewerTasksPage() {
  const navigate = useNavigate();
  const workOrders = useWorkOrderStore((state) => state.workOrders);
  const data = workOrders.filter((item) => item.status === 'reviewer_reviewing');

  const columns: ColumnsType<WorkOrder> = [
    { title: '工单编号', dataIndex: 'orderNo' },
    { title: '类型', dataIndex: 'type', render: (value) => workOrderTypeMap[value as WorkOrder['type']] },
    { title: '项目', dataIndex: 'projectName' },
    { title: '金额', dataIndex: 'amount', render: (value) => formatMoney(value) },
    {
      title: '财务审核人',
      render: (_, record) =>
        [...record.timeline].reverse().find((item) => item.role === 'finance')?.operator || '-',
    },
    { title: '财务意见', dataIndex: 'financeOpinion', render: (value) => value || '-' },
    { title: '风险等级', dataIndex: 'riskLevel', render: (value) => <RiskTag risk={value} /> },
    { title: '创建时间', dataIndex: 'createdAt' },
    { title: '操作', render: (_, record) => <Button type="link" onClick={() => navigate(`/reviewer/tasks/${record.id}`)}>查看复核</Button> },
  ];

  return (
    <div>
      <PageHeader title="复核任务" description="仅展示待复核或财务已通过的工单" />
      <Card>
        <Table rowKey="id" columns={columns} dataSource={data} scroll={{ x: 1100 }} />
      </Card>
    </div>
  );
}
