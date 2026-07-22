import { CheckOutlined, ReloadOutlined, StopOutlined } from '@ant-design/icons';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Alert, App, Button, Card, Checkbox, Col, Empty, Input, Modal, Progress, Row, Space, Spin, Statistic, Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import ExcelAiReviewEvidence from '@/components/data/ExcelAiReviewEvidence';
import ExcelApprovalEvidence from '@/components/data/ExcelApprovalEvidence';
import PageHeader from '@/components/PageHeader';
import { getImportAiReviewDecisions } from '@/api/importApi';
import { useAuthStore } from '@/store/authStore';
import { useImportStore } from '@/store/importStore';
import type { ImportPreviewRow, PaginatedImportAiReviewDecisions } from '@/types/dataCenter';
import { formatMoney } from '@/utils/format';

interface AiReviewLoadState {
  requestKey: string;
  loading: boolean;
  data?: PaginatedImportAiReviewDecisions;
  error?: string;
}

const requestErrorMessage = (error: unknown) => error instanceof Error ? error.message : '请求失败';

export default function DataImportConfirmPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { message } = App.useApp();
  const preview = useImportStore((state) => state.preview?.task.id === id ? state.preview : undefined);
  const currentTask = useImportStore((state) => state.currentTask?.id === id ? state.currentTask : undefined);
  const loading = useImportStore((state) => state.loading);
  const error = useImportStore((state) => state.error);
  const fetchPreview = useImportStore((state) => state.fetchPreview);
  const fetchTask = useImportStore((state) => state.fetchTask);
  const confirmTask = useImportStore((state) => state.confirmTask);
  const reviewRow = useImportStore((state) => state.reviewRow);
  const revalidateTask = useImportStore((state) => state.revalidateTask);
  const currentUser = useAuthStore((state) => state.user);
  const task = currentTask ?? preview?.task;
  const importedRecordsPath = id
    ? `/data/records?importTaskId=${encodeURIComponent(id)}`
    : '/data/records';
  const followConfirmation = useRef(false);
  const aiReviewRequestEpoch = useRef(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [aiReviewPage, setAiReviewPage] = useState(1);
  const [aiReviewPageSize, setAiReviewPageSize] = useState(20);
  const [aiReviewState, setAiReviewState] = useState<AiReviewLoadState>();
  const [acknowledged, setAcknowledged] = useState(false);
  const [reviewTarget, setReviewTarget] = useState<{ row: ImportPreviewRow; decision: 'include' | 'exclude' }>();
  const [reviewReason, setReviewReason] = useState('');

  useEffect(() => {
    if (id) void fetchPreview(id, { page, pageSize }).catch(() => undefined);
  }, [fetchPreview, id, page, pageSize]);

  useEffect(() => {
    setAcknowledged(false);
  }, [id, task?.reviewRevision]);

  useEffect(() => {
    setAiReviewPage(1);
  }, [id, currentUser?.id]);

  const aiReviewRequestKey = id && currentUser?.id
    ? `${id}:${currentUser.id}:${task?.reviewRevision ?? 'unknown'}:${task?.validation?.snapshotHash ?? 'unvalidated'}:${aiReviewPage}:${aiReviewPageSize}`
    : undefined;

  useEffect(() => {
    const epoch = ++aiReviewRequestEpoch.current;
    if (!id || !currentUser?.id || !aiReviewRequestKey) return;
    setAiReviewState({ requestKey: aiReviewRequestKey, loading: true });
    void getImportAiReviewDecisions(id, { page: aiReviewPage, pageSize: aiReviewPageSize })
      .then((data) => {
        if (aiReviewRequestEpoch.current !== epoch) return;
        setAiReviewState({ requestKey: aiReviewRequestKey, loading: false, data });
      })
      .catch((nextError) => {
        if (aiReviewRequestEpoch.current !== epoch) return;
        setAiReviewState({
          requestKey: aiReviewRequestKey,
          loading: false,
          error: requestErrorMessage(nextError),
        });
      });
    return () => {
      if (aiReviewRequestEpoch.current === epoch) aiReviewRequestEpoch.current += 1;
    };
  }, [aiReviewPage, aiReviewPageSize, aiReviewRequestKey, currentUser?.id, id]);

  useEffect(() => {
    if (!id || task?.status !== 'confirming') return;
    followConfirmation.current = true;
    let stopped = false;
    let polling = false;
    const refresh = async () => {
      if (polling || stopped) return;
      polling = true;
      try {
        await fetchTask(id);
      } catch {
        // Store exposes the request error; the next poll can recover from a short disconnect.
      } finally {
        polling = false;
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 1500);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [fetchTask, id, task?.status]);

  useEffect(() => {
    if (!followConfirmation.current) return;
    if (task?.status === 'confirmed') {
      followConfirmation.current = false;
      message.success(`导入完成，共生成 ${task.counts.imported} 条经营记录`);
      navigate(importedRecordsPath);
    } else if (task?.status === 'confirmation_failed') {
      followConfirmation.current = false;
      message.error(task.errorMessage || '后台确认失败，已保存进度，可重试');
    }
  }, [importedRecordsPath, message, navigate, task]);

  const currentValidation = task && task.validation?.reviewRevision === task.reviewRevision ? task.validation : null;
  const warnings = currentValidation?.snapshot.warnings ?? [];
  const isSelfApproval = Boolean(task?.uploadedById && task.uploadedById === currentUser?.id);
  const currentAiReviewState = aiReviewState?.requestKey === aiReviewRequestKey ? aiReviewState : undefined;
  const aiReviewEvidenceReady = Boolean(
    aiReviewRequestKey
    && currentAiReviewState?.data
    && !currentAiReviewState.loading
    && !currentAiReviewState.error,
  );
  const aiReviewDigestMatches = Boolean(
    currentValidation
    && currentAiReviewState?.data
    && currentAiReviewState.data.digest.taskReviewRevision === task?.reviewRevision
    && currentAiReviewState.data.digest.decisionCount === currentAiReviewState.data.total
    && currentAiReviewState.data.digest.summary.pending === 0
    && currentAiReviewState.data.digest.digestHash === currentValidation.snapshot.aiReview.digestHash,
  );
  const canApproveStatus = task?.status === 'pending_confirm' || task?.status === 'confirmation_failed';
  const canConfirm = canApproveStatus
    && Boolean(currentValidation?.snapshot.valid)
    && !isSelfApproval
    && aiReviewEvidenceReady
    && aiReviewDigestMatches
    && (warnings.length === 0 || acknowledged);
  const recordCount = currentValidation?.snapshot.counts.recordCount ?? preview?.summary.valid ?? 0;

  const columns: ColumnsType<ImportPreviewRow> = useMemo(() => [
    { title: '行号', dataIndex: 'rowNumber', width: 80 },
    { title: '日期', dataIndex: 'recordDate', render: (value) => value || '-' },
    { title: '金额', dataIndex: 'amount', render: (value) => value === undefined ? '-' : formatMoney(value) },
    { title: '分类', dataIndex: 'category' },
    {
      title: '动态字段',
      render: (_, row) => (
        <Space wrap>{row.values.map((value) => <Tag key={value.fieldId}>{value.fieldName}：{String(value.value)}</Tag>)}</Space>
      ),
    },
    {
      title: '校验结果',
      render: (_, row) => (
        <Space direction="vertical" size={2}>
          {row.errors.map((item) => <Tag color="error" key={item}>{item}</Tag>)}
          {row.warnings.map((item) => <Tag color="warning" key={item}>{item}</Tag>)}
          {!row.errors.length && row.status === 'mapped' ? <Tag color="success">可入库</Tag> : null}
          {row.status === 'duplicate' ? <Tag>重复行</Tag> : null}
          {row.status === 'ignored' ? <Tag>已忽略</Tag> : null}
          {row.status === 'confirmed' ? <Tag color="success">已入库</Tag> : null}
          {row.summaryCandidate ? <Tag color="warning">疑似汇总行</Tag> : null}
          {row.review.decision ? <Tag color="processing">财务已{row.review.decision === 'include' ? '纳入' : '排除'}</Tag> : null}
        </Space>
      ),
    },
    {
      title: '行级复核',
      width: 180,
      render: (_, row) => row.summaryCandidate ? (
        <Space>
          <Button
            size="small"
            icon={<CheckOutlined />}
            disabled={task?.status !== 'pending_confirm'}
            onClick={() => { setReviewTarget({ row, decision: 'include' }); setReviewReason(''); }}
          >
            纳入
          </Button>
          <Button
            size="small"
            danger
            icon={<StopOutlined />}
            disabled={task?.status !== 'pending_confirm'}
            onClick={() => { setReviewTarget({ row, decision: 'exclude' }); setReviewReason(''); }}
          >
            排除
          </Button>
        </Space>
      ) : '-',
    },
  ], [task?.status]);

  const revalidate = async () => {
    if (!id || !task) return;
    const next = await revalidateTask(id, {
      expectedVersion: task.version,
      expectedReviewRevision: task.reviewRevision,
    });
    await fetchPreview(id, { page, pageSize });
    setAcknowledged(false);
    if (next.validation?.snapshot.valid) message.success('整批确定性校验通过');
    else message.warning(`校验完成，仍有 ${next.validation?.snapshot.counts.blockingErrorCount ?? 0} 个阻断问题`);
  };

  const submitRowReview = async () => {
    if (!id || !task || !reviewTarget || reviewReason.trim().length < 2) return;
    await reviewRow(id, reviewTarget.row.id, {
      expectedVersion: task.version,
      expectedReviewRevision: task.reviewRevision,
      decision: reviewTarget.decision,
      reason: reviewReason.trim(),
    });
    setReviewTarget(undefined);
    setReviewReason('');
    setAcknowledged(false);
    await fetchPreview(id, { page, pageSize });
    message.success('行级复核已保存，旧校验快照已失效');
  };

  const confirm = async () => {
    if (!id) return;
    if (!task || !currentValidation || !canConfirm) {
      message.warning('请先通过当前审核修订的整批校验并处理所有警告');
      return;
    }
    const result = await confirmTask(id, {
      expectedVersion: task.version,
      expectedReviewRevision: task.reviewRevision,
      expectedValidationSnapshotHash: currentValidation.snapshotHash,
      expectedPayloadHash: currentValidation.snapshot.normalizedOutputHash,
      acknowledgedWarningIds: acknowledged ? warnings.map((warning) => warning.issueId) : [],
    });
    if (result.task.status === 'confirmed') {
      message.success('该任务已确认，本次未重复生成记录');
      navigate(importedRecordsPath);
      return;
    }
    message.info('任务已进入后台确认，完成后将自动打开数据记录');
  };

  return (
    <div>
      <PageHeader title="导入确认" description="整批校验与财务批准" />
      {error ? <Alert type="error" showIcon message="导入预览失败" description={error} /> : null}
      <Spin spinning={loading && !preview}>
        {!preview && !loading ? <Card><Empty description="暂无导入预览" /></Card> : null}
        {preview ? (
          <>
            {preview.unresolvedColumns.length ? (
              <Alert
                type="warning"
                showIcon
                message="仍有未处理列"
                description={preview.unresolvedColumns.map((item) => item.sourceName).join('、')}
              />
            ) : null}
            {isSelfApproval ? (
              <Alert
                type="warning"
                showIcon
                message="上传者不能审批同一导入任务"
                description="请由另一名财务人员复核并执行批准。"
              />
            ) : null}
            {currentValidation && !currentValidation.snapshot.valid ? (
              <Alert
                type="error"
                showIcon
                message="整批校验未通过"
                description={`${currentValidation.snapshot.counts.blockingErrorCount} 个阻断问题；正式记录尚未发布。`}
              />
            ) : null}
            {currentValidation && aiReviewEvidenceReady && !aiReviewDigestMatches ? (
              <Alert
                type="error"
                showIcon
                message="AI 审核证据与当前校验快照不一致"
                description="请刷新证据并重新校验；最终批准已暂停。"
              />
            ) : null}
            {task?.status === 'confirming' ? (
              <Alert
                type="info"
                showIcon
                message="正在后台确认入库"
                description={(
                  <Progress
                    percent={task.confirmationProgress?.percent ?? 0}
                    format={() => `${task.confirmationProgress?.processed ?? 0} / ${task.confirmationProgress?.total ?? preview.summary.total}`}
                  />
                )}
              />
            ) : null}
            {task?.status === 'confirmation_failed' ? (
              <Alert
                type="error"
                showIcon
                message="后台确认未完成"
                description={task.errorMessage || '已保存已处理批次，可从当前进度安全重试'}
              />
            ) : null}
            {task?.approval ? (
              <ExcelApprovalEvidence
                approval={task.approval}
                onOpenRecords={() => navigate(importedRecordsPath)}
              />
            ) : null}
            <ExcelAiReviewEvidence
              data={currentAiReviewState?.data}
              loading={Boolean(aiReviewRequestKey) && (!currentAiReviewState || currentAiReviewState.loading)}
              error={currentAiReviewState?.error}
              importColumns={task?.columns ?? []}
              onPageChange={(nextPage, nextPageSize) => {
                setAiReviewPage(nextPage);
                setAiReviewPageSize(nextPageSize);
              }}
            />
            <Row gutter={[16, 16]} className="section-row">
              <Col xs={12} md={4}><Card><Statistic title="总行数" value={preview.summary.total} /></Card></Col>
              <Col xs={12} md={4}><Card><Statistic title="可入库" value={preview.summary.valid} valueStyle={{ color: '#16a34a' }} /></Card></Col>
              <Col xs={12} md={4}><Card><Statistic title="错误行" value={preview.summary.errors} valueStyle={{ color: '#dc2626' }} /></Card></Col>
              <Col xs={12} md={4}><Card><Statistic title="重复行" value={preview.summary.duplicates} /></Card></Col>
              <Col xs={12} md={4}><Card><Statistic title="空/忽略行" value={preview.summary.ignored} /></Card></Col>
            </Row>
            <Card>
              <Table
                rowKey="id"
                columns={columns}
                dataSource={preview.rows}
                loading={loading}
                pagination={{
                  current: preview.pagination.page,
                  pageSize: preview.pagination.pageSize,
                  total: preview.pagination.total,
                  showSizeChanger: true,
                  pageSizeOptions: [10, 20, 50, 100],
                  showTotal: (total) => `共 ${total} 条`,
                }}
                onChange={(pagination) => {
                  setPage(pagination.current ?? 1);
                  setPageSize(pagination.pageSize ?? 20);
                }}
                scroll={{ x: 1100 }}
              />
              <Space className="form-actions" wrap>
                <Button
                  disabled={task?.status === 'confirming' || task?.status === 'confirmed' || task?.status === 'confirmation_failed'}
                  onClick={() => navigate(`/data/import/${id}/mapping`)}
                >
                  返回修改映射
                </Button>
                <Button
                  icon={<ReloadOutlined />}
                  loading={loading && task?.status !== 'confirming'}
                  disabled={task?.status !== 'pending_confirm' || preview.unresolvedColumns.length > 0}
                  onClick={() => void revalidate().catch((nextError) => message.error(nextError instanceof Error ? nextError.message : '重新校验失败'))}
                >
                  重新校验
                </Button>
                {warnings.length > 0 ? (
                  <Checkbox checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)}>
                    已复核当前 {warnings.length} 项警告
                  </Checkbox>
                ) : null}
                <Button
                  type="primary"
                  loading={loading && task?.status !== 'confirming'}
                  disabled={!canConfirm || preview.unresolvedColumns.length > 0 || preview.summary.errors > 0}
                  onClick={() => void confirm().catch((nextError) => message.error(nextError instanceof Error ? nextError.message : '确认失败'))}
                >
                  {task?.status === 'confirmation_failed' ? `重试批准 ${recordCount} 条` : `批准并入库 ${recordCount} 条`}
                </Button>
                {task?.status === 'confirmed' ? <Button onClick={() => navigate(importedRecordsPath)}>查看数据记录</Button> : null}
              </Space>
            </Card>
          </>
        ) : null}
      </Spin>
      <Modal
        title={reviewTarget?.decision === 'exclude' ? '排除该行' : '按业务明细纳入'}
        open={Boolean(reviewTarget)}
        okText="保存复核"
        okButtonProps={{ disabled: reviewReason.trim().length < 2 }}
        confirmLoading={loading}
        onCancel={() => { setReviewTarget(undefined); setReviewReason(''); }}
        onOk={() => void submitRowReview().catch((nextError) => message.error(nextError instanceof Error ? nextError.message : '行级复核失败'))}
      >
        <Input.TextArea
          value={reviewReason}
          maxLength={500}
          showCount
          rows={4}
          placeholder="填写财务判断依据"
          onChange={(event) => setReviewReason(event.target.value)}
        />
      </Modal>
    </div>
  );
}
