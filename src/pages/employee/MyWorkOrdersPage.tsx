import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, Segmented, Space, Table, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import PageHeader from '@/components/PageHeader';
import StatusTag from '@/components/workOrder/StatusTag';
import RiskTag from '@/components/workOrder/RiskTag';
import { useAuthStore } from '@/store/authStore';
import { useWorkOrderStore } from '@/store/workOrderStore';
import type { WorkOrder } from '@/types/workOrder';
import { formatMoney } from '@/utils/format';
import { workOrderTypeMap } from '@/utils/statusMap';

type FilterKey = 'all' | 'reviewing' | 'supplement' | 'completed' | 'rejected';

export default function MyWorkOrdersPage() {
  const [filter, setFilter] = useState<FilterKey>('all');
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const workOrders = useWorkOrderStore((state) => state.workOrders);

  const data = useMemo(() => {
    const mine = workOrders.filter((item) => item.creatorId === user?.id);
    return mine.filter((item) => {
      if (filter === 'all') return true;
      if (filter === 'reviewing') return !['completed', 'returned_for_supplement'].includes(item.status) && !item.status.includes('rejected');
      if (filter === 'supplement') return item.status === 'returned_for_supplement';
      if (filter === 'completed') return item.status === 'completed';
      return item.status.includes('rejected');
    });
  }, [filter, user?.id, workOrders]);

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
    { title: '状态', dataIndex: 'status', render: (value) => <StatusTag status={value} /> },
    { title: '创建时间', dataIndex: 'createdAt' },
    {
      title: '操作',
      render: (_, record) => <Button type="link" onClick={() => navigate(`/work-orders/${record.id}`)}>查看详情</Button>,
    },
  ];

  return (
    <div>
      <PageHeader title="我的工单" description="只显示当前员工提交的工单" />
      <Card>
        <Segmented
          value={filter}
          onChange={(value) => setFilter(value as FilterKey)}
          options={[
            { label: '全部', value: 'all' },
            { label: '审核中', value: 'reviewing' },
            { label: '待补充', value: 'supplement' },
            { label: '已完成', value: 'completed' },
            { label: '已驳回', value: 'rejected' },
          ]}
          className="table-filter"
        />
        <Table rowKey="id" columns={columns} dataSource={data} scroll={{ x: 980 }} />
      </Card>
    </div>
  );
}
