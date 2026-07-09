import { Space, Tag } from 'antd';
import type { WorkOrderStatus } from '@/types/workOrder';
import { statusColorMap, statusTextMap } from '@/utils/statusMap';

export default function StatusTag({ status, urgent }: { status: WorkOrderStatus; urgent?: boolean }) {
  const text = statusTextMap[status] ?? '未知状态';
  const color = statusColorMap[status] ?? 'default';

  return (
    <Space size={4} wrap>
      <Tag color={color}>{text}</Tag>
      {urgent ? <Tag color="red">紧急</Tag> : null}
    </Space>
  );
}
