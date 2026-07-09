import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  App,
  Button,
  Card,
  Descriptions,
  Drawer,
  Empty,
  Row,
  Col,
  Statistic,
  Space,
  Typography,
  Modal,
  Input,
} from 'antd';
import PageHeader from '@/components/PageHeader';
import AttachmentPreview from '@/components/workOrder/AttachmentPreview';
import AISummaryCard from '@/components/workOrder/AISummaryCard';
import AuditActionBar, { type AuditActionPayload } from '@/components/workOrder/AuditActionBar';
import AuditTimeline from '@/components/workOrder/AuditTimeline';
import RiskTag from '@/components/workOrder/RiskTag';
import StatusTag from '@/components/workOrder/StatusTag';
import WorkOrderStatusSteps from '@/components/workOrder/WorkOrderStatusSteps';
import ChatBox from '@/components/ai/ChatBox';
import { useAuthStore } from '@/store/authStore';
import { useWorkOrderStore } from '@/store/workOrderStore';
import { useNotificationStore } from '@/store/notificationStore';
import type { Role } from '@/types/auth';
import { currentTime, formatMoney } from '@/utils/format';
import { roleLabelMap, workOrderTypeMap } from '@/utils/statusMap';
import { generateRecordFromWorkOrder } from '@/api/workOrderApi';

export default function WorkOrderDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { message } = App.useApp();
  const [aiOpen, setAiOpen] = useState(false);
  const [urgeOpen, setUrgeOpen] = useState(false);
  const [urgeReason, setUrgeReason] = useState('');
  const user = useAuthStore((state) => state.user);
  const workOrder = useWorkOrderStore((state) => state.workOrders.find((item) => item.id === id));
  const updateStatus = useWorkOrderStore((state) => state.updateStatus);
  const urgeWorkOrder = useWorkOrderStore((state) => state.urgeWorkOrder);
  const addNotification = useNotificationStore((state) => state.addNotification);

  if (!user) return null;

  if (!workOrder) {
    return (
      <Card>
        <Empty description="工单不存在" />
      </Card>
    );
  }

  const handleAction = async (payload: AuditActionPayload) => {
    const patch =
      user.role === 'finance'
        ? { financeOpinion: payload.comment }
        : user.role === 'reviewer'
          ? { reviewerOpinion: payload.comment }
          : user.role === 'boss'
            ? { bossOpinion: payload.comment }
            : {};
    updateStatus({
      id: workOrder.id,
      operator: user.name,
      role: user.role,
      action: payload.action,
      comment: payload.comment,
      status: payload.status,
      patch,
    });
    if (user.role === 'boss' && payload.status === 'completed') {
      await generateRecordFromWorkOrder({ ...workOrder, status: 'completed', bossOpinion: payload.comment });
      message.success('审批完成，已生成项目数据记录，可在数据中心查看。');
      return;
    }
    message.success('操作成功');
  };

  const simulateAI = () => {
    const flagged = workOrder.riskLevel !== 'low';
    updateStatus({
      id: workOrder.id,
      operator: 'AI自动复核',
      role: 'ai',
      action: flagged ? 'AI发现异常' : 'AI复核通过',
      comment: flagged ? 'AI 标记该工单存在异常，进入老板待审批。' : 'AI 未发现明显异常，进入老板待审批。',
      status: 'boss_pending',
      patch: {
        aiSummary: flagged
          ? 'AI复核结果：发现费用或附件存在异常，请老板重点关注。'
          : 'AI复核结果：资料完整，风险较低，可进入老板审批。',
      },
    });
    message.success('AI复核已完成');
  };

  const getUrgentTargetRole = (): Role | null => {
    if (['submitted', 'finance_reviewing'].includes(workOrder.status)) return 'finance';
    if (['finance_approved', 'reviewer_reviewing'].includes(workOrder.status)) return 'reviewer';
    if (workOrder.status === 'boss_pending') return 'boss';
    return null;
  };

  const submitUrgent = () => {
    const reason = urgeReason.trim();
    const targetRole = getUrgentTargetRole();
    if (!reason) {
      message.warning('请输入申请加急原因');
      return;
    }
    if (!targetRole) {
      message.warning('当前状态暂不支持催办');
      return;
    }

    urgeWorkOrder({
      id: workOrder.id,
      operator: user.name,
      role: user.role,
      reason,
    });
    addNotification({
      id: `n-${Date.now()}`,
      title: '员工催办通知',
      content: `${user.name}申请加急处理工单 ${workOrder.orderNo}`,
      type: 'urgent',
      sender: user.name,
      targetRole,
      read: false,
      createdAt: '刚刚',
      relatedWorkOrderId: workOrder.id,
    });
    message.success(`催办已发送给${roleLabelMap[targetRole]}`);
    setUrgeOpen(false);
    setUrgeReason('');
  };

  return (
    <div>
      <PageHeader
        title="工单详情"
        description={`${workOrder.orderNo} · ${workOrder.projectName}`}
        extra={<Button onClick={() => navigate(-1)}>返回</Button>}
      />

      <Card className="section-row">
        <WorkOrderStatusSteps status={workOrder.status} />
      </Card>

      <Row gutter={[16, 16]} className="section-row">
        <Col xs={24} xl={16}>
          <Card title="工单信息">
            <Descriptions bordered column={2} size="small">
              <Descriptions.Item label="工单编号">{workOrder.orderNo}</Descriptions.Item>
              <Descriptions.Item label="类型">{workOrderTypeMap[workOrder.type]}</Descriptions.Item>
              <Descriptions.Item label="项目">{workOrder.projectName}</Descriptions.Item>
              <Descriptions.Item label="客户">{workOrder.customerName}</Descriptions.Item>
              <Descriptions.Item label="提交人">{workOrder.creatorName}</Descriptions.Item>
              <Descriptions.Item label="创建时间">{workOrder.createdAt}</Descriptions.Item>
              <Descriptions.Item label="状态">
                <StatusTag status={workOrder.status} urgent={workOrder.urgent} />
              </Descriptions.Item>
              <Descriptions.Item label="风险">
                <RiskTag risk={workOrder.riskLevel} />
              </Descriptions.Item>
              <Descriptions.Item label="说明" span={2}>
                {workOrder.description}
              </Descriptions.Item>
              <Descriptions.Item label="财务意见" span={2}>
                {workOrder.financeOpinion || '-'}
              </Descriptions.Item>
              <Descriptions.Item label="复核意见" span={2}>
                {workOrder.reviewerOpinion || '-'}
              </Descriptions.Item>
              <Descriptions.Item label="老板意见" span={2}>
                {workOrder.bossOpinion || '-'}
              </Descriptions.Item>
              {workOrder.urgent ? (
                <Descriptions.Item label="加急原因" span={2}>
                  {workOrder.urgentReason}（{workOrder.urgentTime}）
                </Descriptions.Item>
              ) : null}
            </Descriptions>
          </Card>
        </Col>
        <Col xs={24} xl={8}>
          <Card title="收入/成本/利润">
            <Row gutter={[12, 12]}>
              <Col span={24}>
                <Statistic title="收入" value={workOrder.income} formatter={(value) => formatMoney(Number(value))} />
              </Col>
              <Col span={12}>
                <Statistic title="成本" value={workOrder.cost} formatter={(value) => formatMoney(Number(value))} />
              </Col>
              <Col span={12}>
                <Statistic title="利润" value={workOrder.profit} formatter={(value) => formatMoney(Number(value))} />
              </Col>
            </Row>
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]} className="section-row">
        <Col xs={24} xl={12}>
          <Card title="附件预览">
            <AttachmentPreview attachments={workOrder.attachments} />
          </Card>
        </Col>
        <Col xs={24} xl={12}>
          <AISummaryCard summary={workOrder.aiSummary} riskLevel={workOrder.riskLevel} />
        </Col>
      </Row>

      <Card title="审核时间线" className="section-row">
        <AuditTimeline timeline={workOrder.timeline} />
      </Card>

      <Card title="操作" className="section-row">
        <Space direction="vertical" size={12} className="full-width">
          {user.role === 'employee' ? (
            <Typography.Text type="secondary">员工只能查看进度、补充材料，不能执行审核操作。</Typography.Text>
          ) : null}
          {user.role === 'employee' && workOrder.status !== 'completed' ? (
            <Button danger onClick={() => setUrgeOpen(true)}>
              催办
            </Button>
          ) : null}
          <AuditActionBar
            role={user.role}
            workOrder={workOrder}
            onAction={handleAction}
            onAskAI={user.role === 'boss' ? () => setAiOpen(true) : undefined}
            onSimulateAI={simulateAI}
          />
        </Space>
      </Card>

      <Drawer title="询问AI" width={420} open={aiOpen} onClose={() => setAiOpen(false)}>
        <ChatBox compact contextId={workOrder.id} />
      </Drawer>

      <Modal
        title="申请加急处理"
        open={urgeOpen}
        onCancel={() => setUrgeOpen(false)}
        onOk={submitUrgent}
        okText="提交催办"
        cancelText="取消"
      >
        <Typography.Paragraph type="secondary">
          当前工单将通知对应审核角色，请填写明确原因。
        </Typography.Paragraph>
        <Input.TextArea
          rows={4}
          value={urgeReason}
          onChange={(event) => setUrgeReason(event.target.value)}
          placeholder="例如：客户急需付款，请优先处理。"
        />
      </Modal>
    </div>
  );
}
