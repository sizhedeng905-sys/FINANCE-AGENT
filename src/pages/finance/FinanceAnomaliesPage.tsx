import { useNavigate } from 'react-router-dom';
import { Button, Card, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import PageHeader from '@/components/PageHeader';
import RiskTag from '@/components/workOrder/RiskTag';
import StatusTag from '@/components/workOrder/StatusTag';
import { useWorkOrderStore } from '@/store/workOrderStore';
import type { WorkOrder } from '@/types/workOrder';
import { formatMoney } from '@/utils/format';
import { workOrderTypeMap } from '@/utils/statusMap';

export default function FinanceAnomaliesPage() {
  const navigate = useNavigate();
  const workOrders = useWorkOrderStore((state) => state.workOrders);
  const data = workOrders.filter((item) => item.riskLevel !== 'low');

  const columns: ColumnsType<WorkOrder> = [
    { title: '工单编号', dataIndex: 'orderNo' },
    { title: '项目', dataIndex: 'projectName' },
    { title: '类型', dataIndex: 'type', render: (value) => workOrderTypeMap[value as WorkOrder['type']] },
    { title: '金额', dataIndex: 'amount', render: (value) => formatMoney(value) },
    { title: '风险等级', dataIndex: 'riskLevel', render: (value) => <RiskTag risk={value} /> },
    { title: '异常原因', dataIndex: 'aiSummary' },
    { title: '当前状态', dataIndex: 'status', render: (value) => <StatusTag status={value} /> },
    { title: '操作', render: (_, record) => <Button type="link" onClick={() => navigate(`/work-orders/${record.id}`)}>查看详情</Button> },
  ];

  return (
    <div>
      <PageHeader title="AI异常提示" description="只展示 AI 从工单中识别的异常，不提供聊天入口" />
      <Card>
        <Table rowKey="id" columns={columns} dataSource={data} scroll={{ x: 1100 }} />
      </Card>
    </div>
  );
}
