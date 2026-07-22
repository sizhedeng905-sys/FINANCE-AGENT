import { ReloadOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Empty, Pagination, Space, Spin, Typography } from 'antd';
import { useCallback, useEffect, useState } from 'react';
import {
  fetchPendingReportNarrativesApi,
  reviewReportNarrativeApi,
} from '@/api/reportApi';
import type { Role } from '@/types/auth';
import type {
  PaginatedReportNarratives,
  ReportNarrative,
  ReportNarrativeReviewCommand,
} from '@/types/report';
import ReportNarrativeReviewPanel from './ReportNarrativeReviewPanel';

interface ReportNarrativeReviewQueueProps {
  role: Extract<Role, 'finance' | 'boss'>;
  title: string;
}

const PAGE_SIZE = 10;

export default function ReportNarrativeReviewQueue({ role, title }: ReportNarrativeReviewQueueProps) {
  const [page, setPage] = useState(1);
  const [queue, setQueue] = useState<PaginatedReportNarratives | null>(null);
  const [loading, setLoading] = useState(false);
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (nextPage: number) => {
    setLoading(true);
    setError(null);
    try {
      setQueue(await fetchPendingReportNarrativesApi(role, nextPage, PAGE_SIZE));
    } catch (requestError) {
      setQueue(null);
      setError(requestError instanceof Error ? requestError.message : '报告叙述复核队列加载失败');
    } finally {
      setLoading(false);
    }
  }, [role]);

  useEffect(() => {
    void load(page);
  }, [load, page]);

  const review = async (
    narrative: ReportNarrative,
    command: ReportNarrativeReviewCommand,
    reason: string,
  ) => {
    setReviewingId(narrative.id);
    setError(null);
    try {
      const updated = await reviewReportNarrativeApi(narrative.id, {
        expectedReviewVersion: narrative.review.version,
        expectedNarrativeHash: narrative.narrativeHash,
        expectedSnapshotHash: narrative.snapshotHash,
        command,
        reason,
      });
      setQueue((current) => current ? {
        ...current,
        items: current.items.map((item) => item.id === updated.id ? updated : item),
      } : current);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '报告叙述复核失败');
      await load(page);
      throw requestError;
    } finally {
      setReviewingId(null);
    }
  };

  return (
    <Card
      title={title}
      className="section-row"
      extra={(
        <Button
          icon={<ReloadOutlined />}
          loading={loading}
          onClick={() => void load(page)}
        >
          刷新文字复核队列
        </Button>
      )}
    >
      {error ? <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} /> : null}
      {queue && !queue.policy.enabled ? (
        <Alert
          type="warning"
          showIcon
          message="文字复核策略当前未启用"
          style={{ marginBottom: 16 }}
        />
      ) : null}
      <Spin spinning={loading}>
        {!queue?.items.length && !loading ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前没有待处理的 AI 文字叙述" />
        ) : null}
        <Space direction="vertical" size="large" className="full-width">
          {queue?.items.map((narrative) => (
            <ReportNarrativeReviewPanel
              key={narrative.id}
              narrative={narrative}
              role={role}
              busy={reviewingId === narrative.id}
              onReview={(command, reason) => review(narrative, command, reason)}
            />
          ))}
          {(queue?.total ?? 0) > PAGE_SIZE ? (
            <Space className="full-width" style={{ justifyContent: 'space-between' }} wrap>
              <Typography.Text type="secondary">共 {queue?.total ?? 0} 条</Typography.Text>
              <Pagination
                current={page}
                pageSize={PAGE_SIZE}
                total={queue?.total ?? 0}
                showSizeChanger={false}
                onChange={setPage}
              />
            </Space>
          ) : null}
        </Space>
      </Spin>
    </Card>
  );
}
