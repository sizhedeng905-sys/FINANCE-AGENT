import { useState } from 'react';
import { Button, Input, Modal, Space } from 'antd';
import type { Role } from '@/types/auth';
import type { WorkOrder, WorkOrderStatus } from '@/types/workOrder';

export interface AuditActionPayload {
  status: WorkOrderStatus;
  action: string;
  comment: string;
}

interface PendingAction {
  label: string;
  status: WorkOrderStatus;
  action: string;
  placeholder: string;
}

interface AuditActionBarProps {
  role: Role;
  workOrder: WorkOrder;
  onAction: (payload: AuditActionPayload) => void;
  onAskAI?: () => void;
  onSimulateAI?: () => void;
}

export default function AuditActionBar({
  role,
  workOrder,
  onAction,
  onAskAI,
  onSimulateAI,
}: AuditActionBarProps) {
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [comment, setComment] = useState('');

  const open = (action: PendingAction) => {
    setPending(action);
    setComment('');
  };

  const submit = () => {
    if (!pending) return;
    onAction({
      status: pending.status,
      action: pending.action,
      comment: comment.trim() || pending.placeholder,
    });
    setPending(null);
    setComment('');
  };

  const buttons: JSX.Element[] = [];

  if (role === 'finance' && ['submitted', 'finance_reviewing'].includes(workOrder.status)) {
    buttons.push(
      <Button
        key="finance-pass"
        type="primary"
        onClick={() =>
          open({
            label: '财务通过',
            status: 'reviewer_reviewing',
            action: '财务通过',
            placeholder: '财务通过，进入复核员复核。',
          })
        }
      >
        通过
      </Button>,
      <Button
        key="finance-reject"
        danger
        onClick={() =>
          open({
            label: '财务驳回',
            status: 'finance_rejected',
            action: '财务驳回',
            placeholder: '请输入驳回原因。',
          })
        }
      >
        驳回
      </Button>,
      <Button
        key="finance-supplement"
        onClick={() =>
          open({
            label: '要求补充材料',
            status: 'returned_for_supplement',
            action: '要求补充材料',
            placeholder: '请补充费用发生原因、发票或回单。',
          })
        }
      >
        要求补充材料
      </Button>,
    );
  }

  if (role === 'reviewer' && ['finance_approved', 'reviewer_reviewing'].includes(workOrder.status)) {
    buttons.push(
      <Button
        key="review-pass"
        type="primary"
        onClick={() =>
          open({
            label: '复核通过',
            status: 'ai_reviewing',
            action: '复核通过',
            placeholder: '复核通过，进入 AI 自动复核。',
          })
        }
      >
        复核通过，进入AI复核
      </Button>,
      <Button
        key="review-reject"
        danger
        onClick={() =>
          open({
            label: '驳回给财务',
            status: 'reviewer_rejected',
            action: '复核驳回',
            placeholder: '请财务重新核对金额或附件。',
          })
        }
      >
        驳回给财务
      </Button>,
      <Button
        key="review-supplement"
        onClick={() =>
          open({
            label: '驳回给员工补充材料',
            status: 'returned_for_supplement',
            action: '要求员工补充材料',
            placeholder: '请员工补充材料后重新提交。',
          })
        }
      >
        驳回给员工补充材料
      </Button>,
    );
  }

  if (role === 'reviewer' && workOrder.status === 'ai_reviewing') {
    buttons.push(
      <Button key="simulate-ai" type="primary" onClick={onSimulateAI}>
        模拟AI复核完成
      </Button>,
    );
  }

  if (role === 'boss' && workOrder.status === 'boss_pending') {
    buttons.push(
      <Button
        key="boss-approve"
        type="primary"
        onClick={() =>
          open({
            label: '最终通过',
            status: 'completed',
            action: '老板最终通过',
            placeholder: '最终通过，归档完成。',
          })
        }
      >
        最终通过
      </Button>,
      <Button
        key="boss-reject"
        danger
        onClick={() =>
          open({
            label: '最终驳回',
            status: 'boss_rejected',
            action: '老板最终驳回',
            placeholder: '请输入老板驳回原因。',
          })
        }
      >
        最终驳回
      </Button>,
    );
  }

  if (role === 'boss' && onAskAI) {
    buttons.push(
      <Button key="ask-ai" onClick={onAskAI}>
        询问AI
      </Button>,
    );
  }

  if (role === 'employee' && workOrder.status === 'returned_for_supplement') {
    buttons.push(
      <Button
        key="employee-supplement"
        type="primary"
        onClick={() =>
          open({
            label: '补充材料',
            status: 'finance_reviewing',
            action: '员工补充材料',
            placeholder: '已补充材料，重新提交财务审核。',
          })
        }
      >
        补充材料并提交
      </Button>,
    );
  }

  return (
    <>
      <Space wrap>{buttons}</Space>
      <Modal
        title={pending?.label}
        open={Boolean(pending)}
        onCancel={() => setPending(null)}
        onOk={submit}
        okText="确认"
        cancelText="取消"
      >
        <Input.TextArea
          rows={4}
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          placeholder={pending?.placeholder}
        />
      </Modal>
    </>
  );
}
