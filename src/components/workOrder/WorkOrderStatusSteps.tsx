import { Steps } from 'antd';
import type { WorkOrderStatus } from '@/types/workOrder';
import { getStepByStatus } from '@/utils/statusMap';

const items = [
  { title: '提交工单' },
  { title: '财务审核' },
  { title: '复核员复核' },
  { title: 'AI复核' },
  { title: '老板终审' },
  { title: '完成归档' },
];

export default function WorkOrderStatusSteps({ status }: { status: WorkOrderStatus }) {
  return (
    <Steps
      size="small"
      current={getStepByStatus(status)}
      status={status.includes('rejected') ? 'error' : 'process'}
      items={items}
    />
  );
}
