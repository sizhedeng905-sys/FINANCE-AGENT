import { useMemo } from 'react';
import { Card, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import PageHeader from '@/components/PageHeader';
import RiskTag from '@/components/workOrder/RiskTag';
import { useWorkOrderStore } from '@/store/workOrderStore';
import type { WorkOrder } from '@/types/workOrder';
import { formatMoney } from '@/utils/format';
import { statusTextMap } from '@/utils/statusMap';

export default function ReviewerHistoryPage() {
  const workOrders = useWorkOrderStore((state) => state.workOrders);
  const data = useMemo(
    () =>
      workOrders.filter((item) =>
      ['ai_reviewing', 'boss_pending', 'completed', 'reviewer_rejected', 'returned_for_supplement'].includes(item.status),
    ),
    [workOrders],
  );

  const columns: ColumnsType<WorkOrder> = [
    { title: '工单编号', dataIndex: 'orderNo' },
    { title: '项目', dataIndex: 'projectName' },
    { title: '金额', dataIndex: 'amount', render: (value) => formatMoney(value) },
    { title: '财务审核人', render: () => '林雪' },
    { title: '复核结果', dataIndex: 'status', render: (value) => statusTextMap[value as WorkOrder['status']] ?? '未知状态' },
    {
      title: '复核时间',
      render: (_, record) =>
        record.timeline.find((item) => item.role === 'reviewer')?.time || record.updatedAt,
    },
    { title: '风险等级', dataIndex: 'riskLevel', render: (value) => <RiskTag risk={value} /> },
  ];

  return (
    <div>
      <PageHeader title="审核历史" description="展示已经完成复核的记录" />
      <Card>
        <Table rowKey="id" columns={columns} dataSource={data} scroll={{ x: 980 }} />
      </Card>
    </div>
  );
}
