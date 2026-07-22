import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  ReloadOutlined,
  RollbackOutlined,
} from '@ant-design/icons';
import { Alert, App, Button, Descriptions, Input, List, Space, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useEffect, useState } from 'react';
import type { Role } from '@/types/auth';
import type {
  ReportNarrative,
  ReportNarrativeClaim,
  ReportNarrativeReviewCommand,
  ReportNarrativeReviewStatus,
} from '@/types/report';

interface ReportNarrativeReviewPanelProps {
  narrative: ReportNarrative;
  role: Extract<Role, 'finance' | 'boss'>;
  busy?: boolean;
  onReview?: (command: ReportNarrativeReviewCommand, reason: string) => Promise<void>;
  onRefresh?: () => Promise<void>;
}

type AlertTone = 'success' | 'info' | 'warning' | 'error';

const statusPresentation: Record<
  ReportNarrativeReviewStatus,
  { label: string; color: string; tone: AlertTone }
> = {
  NEEDS_FINANCE_REVIEW: { label: '草稿 · 待财务复核', color: 'gold', tone: 'warning' },
  NEEDS_BOSS_REVIEW: { label: '草稿 · 待老板复核', color: 'blue', tone: 'info' },
  CHANGES_REQUESTED: { label: '草稿 · 已退回', color: 'orange', tone: 'warning' },
  REJECTED: { label: '已拒绝', color: 'red', tone: 'error' },
  ACCEPTED: { label: '已接受文字建议', color: 'green', tone: 'success' },
};

const stageLabels = { FINANCE: '财务复核', BOSS: '老板终审' } as const;
const commandLabels = {
  ACCEPT: '接受',
  REQUEST_CHANGES: '退回修改',
  REJECT: '拒绝',
} as const;

const claimColumns: ColumnsType<ReportNarrativeClaim> = [
  { title: '叙述', dataIndex: 'text', width: 320 },
  { title: '快照值', dataIndex: 'value', width: 160 },
  {
    title: '数据路径',
    dataIndex: 'sourcePath',
    width: 250,
    render: (value: string) => <Typography.Text code copyable>{value}</Typography.Text>,
  },
];

export default function ReportNarrativeReviewPanel({
  narrative,
  role,
  busy = false,
  onReview,
  onRefresh,
}: ReportNarrativeReviewPanelProps) {
  const { message } = App.useApp();
  const [reason, setReason] = useState('');
  const presentation = statusPresentation[narrative.review.status];
  const canReview = Boolean(onReview) && narrative.review.policy.enabled && (
    (role === 'finance' && narrative.review.status === 'NEEDS_FINANCE_REVIEW')
    || (role === 'boss' && narrative.review.status === 'NEEDS_BOSS_REVIEW')
  );

  useEffect(() => {
    setReason('');
  }, [narrative.id, narrative.review.version]);

  const submit = async (command: ReportNarrativeReviewCommand) => {
    const normalizedReason = reason.trim();
    if (!onReview || normalizedReason.length < 2) {
      message.warning('请填写至少 2 个字符的复核理由');
      return;
    }
    try {
      await onReview(command, normalizedReason);
      message.success(`${commandLabels[command]}决定已写入审计历史`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '报告叙述复核失败');
    }
  };

  return (
    <section
      className="report-narrative-review-panel"
      role="region"
      aria-label={`报告叙述复核 ${narrative.id}`}
    >
      <Space direction="vertical" size="middle" className="full-width">
        <Alert
          type={presentation.tone}
          showIcon
          message={(
            <Space wrap>
              <Tag color={presentation.color}>{presentation.label}</Tag>
              <Typography.Text strong>{narrative.title}</Typography.Text>
            </Space>
          )}
          description={narrative.summary}
          action={onRefresh ? (
            <Button icon={<ReloadOutlined />} loading={busy} onClick={() => void onRefresh()}>
              刷新状态
            </Button>
          ) : undefined}
        />

        <Space wrap>
          {narrative.provider === 'mock'
            ? <Tag color="warning">Mock Provider（仅测试）</Tag>
            : <Tag color="processing">{narrative.provider}</Tag>}
          <Tag>{narrative.model}</Tag>
          <Tag>Prompt {narrative.promptVersion}</Tag>
          <Tag>复核版本 R{narrative.review.version}</Tag>
        </Space>

        <Descriptions bordered size="small" column={{ xs: 1, md: 2 }}>
          <Descriptions.Item label="生成时间">
            {new Date(narrative.createdAt).toLocaleString('zh-CN')}
          </Descriptions.Item>
          <Descriptions.Item label="复核策略">
            {narrative.review.policy.enabled ? '财务复核后老板终审' : '未启用'}
          </Descriptions.Item>
          <Descriptions.Item label="快照哈希" span={2}>
            <Typography.Text code copyable>{narrative.snapshotHash}</Typography.Text>
          </Descriptions.Item>
          <Descriptions.Item label="叙述哈希" span={2}>
            <Typography.Text code copyable>{narrative.narrativeHash}</Typography.Text>
          </Descriptions.Item>
          <Descriptions.Item label="AI Task" span={2}>
            <Typography.Text code copyable>{narrative.aiTaskId}</Typography.Text>
          </Descriptions.Item>
        </Descriptions>

        <Table
          rowKey="claimId"
          size="small"
          columns={claimColumns}
          dataSource={narrative.claims}
          pagination={false}
          scroll={{ x: 760 }}
        />

        {narrative.review.history.length ? (
          <List
            size="small"
            header="复核历史"
            dataSource={narrative.review.history}
            renderItem={(event) => (
              <List.Item>
                <List.Item.Meta
                  title={`${stageLabels[event.stage]} · ${commandLabels[event.command]} · R${event.reviewVersion}`}
                  description={`${event.actor.name}（${event.actor.username}） · ${new Date(event.createdAt).toLocaleString('zh-CN')} · ${event.reason}`}
                />
              </List.Item>
            )}
          />
        ) : null}

        {!narrative.review.policy.enabled ? (
          <Alert type="warning" showIcon message="文字复核策略未启用，当前叙述保持草稿" />
        ) : null}

        {canReview ? (
          <Space direction="vertical" className="full-width">
            <Input.TextArea
              aria-label={`复核理由-${narrative.id}`}
              value={reason}
              rows={3}
              maxLength={500}
              showCount
              placeholder="填写本次复核依据"
              onChange={(event) => setReason(event.target.value)}
            />
            <Space wrap>
              <Button
                type="primary"
                icon={<CheckCircleOutlined />}
                loading={busy}
                disabled={reason.trim().length < 2}
                onClick={() => void submit('ACCEPT')}
              >
                {role === 'finance' ? '财务接受并提交老板' : '老板接受文字建议'}
              </Button>
              <Button
                icon={<RollbackOutlined />}
                loading={busy}
                disabled={reason.trim().length < 2}
                onClick={() => void submit('REQUEST_CHANGES')}
              >
                退回修改
              </Button>
              <Button
                danger
                icon={<CloseCircleOutlined />}
                loading={busy}
                disabled={reason.trim().length < 2}
                onClick={() => void submit('REJECT')}
              >
                拒绝文字建议
              </Button>
            </Space>
          </Space>
        ) : null}
      </Space>
    </section>
  );
}
