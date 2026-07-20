import { useEffect, useState } from 'react';
import { FileProtectOutlined, RobotOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Col, Descriptions, Empty, List, Row, Space, Spin, Table, Tabs, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import PageHeader from '@/components/PageHeader';
import MetricCard from '@/components/MetricCard';
import { useReportStore } from '@/store/reportStore';
import { createReportSnapshotApi, generateReportNarrativeApi } from '@/api/reportApi';
import type {
  BossReportPeriod,
  ProjectRankingItem,
  ReportNarrativeClaim,
  ReportNarrativeGenerationResult,
  ReportSnapshotResult,
} from '@/types/report';
import { formatMoney, formatPercent } from '@/utils/format';

const periods: Array<{ key: BossReportPeriod; label: string }> = [
  { key: 'daily', label: '经营日报' },
  { key: 'weekly', label: '经营周报' },
  { key: 'monthly', label: '经营月报' },
];

const rankingColumns: ColumnsType<ProjectRankingItem> = [
  { title: '项目', dataIndex: 'projectName' },
  { title: '收入', dataIndex: 'income', render: (value: number) => formatMoney(value) },
  { title: '成本', dataIndex: 'cost', render: (value: number) => formatMoney(value) },
  { title: '利润', dataIndex: 'profit', render: (value: number) => formatMoney(value) },
  { title: '利润率', dataIndex: 'profitRate', render: (value: number) => formatPercent(value * 100) },
  { title: '异常', dataIndex: 'riskCount' },
];

const claimColumns: ColumnsType<ReportNarrativeClaim> = [
  { title: '叙述', dataIndex: 'text' },
  { title: '快照值', dataIndex: 'value', width: 150 },
  {
    title: '数据路径',
    dataIndex: 'sourcePath',
    width: 240,
    render: (value: string) => <Typography.Text code copyable>{value}</Typography.Text>,
  },
];

export default function BossReportsPage() {
  const [period, setPeriod] = useState<BossReportPeriod>('daily');
  const report = useReportStore((state) => state.bossReports.find((item) => item.period === period));
  const loading = useReportStore((state) => state.bossLoading);
  const error = useReportStore((state) => state.bossError);
  const fetchReport = useReportStore((state) => state.fetchBossReport);
  const [snapshotResult, setSnapshotResult] = useState<ReportSnapshotResult | null>(null);
  const [narrativeResult, setNarrativeResult] = useState<ReportNarrativeGenerationResult | null>(null);
  const [snapshotLoading, setSnapshotLoading] = useState(false);
  const [narrativeLoading, setNarrativeLoading] = useState(false);
  const [evidenceError, setEvidenceError] = useState<string | null>(null);

  useEffect(() => {
    void fetchReport(period).catch(() => undefined);
  }, [fetchReport, period]);

  useEffect(() => {
    setSnapshotResult(null);
    setNarrativeResult(null);
    setEvidenceError(null);
  }, [period]);

  const createSnapshot = async () => {
    setSnapshotLoading(true);
    setEvidenceError(null);
    setNarrativeResult(null);
    try {
      setSnapshotResult(await createReportSnapshotApi(period));
    } catch (requestError) {
      setEvidenceError(requestError instanceof Error ? requestError.message : '报告快照生成失败');
    } finally {
      setSnapshotLoading(false);
    }
  };

  const generateNarrative = async () => {
    if (!snapshotResult) return;
    setNarrativeLoading(true);
    setEvidenceError(null);
    try {
      setNarrativeResult(await generateReportNarrativeApi(snapshotResult.snapshot.snapshotId));
    } catch (requestError) {
      setEvidenceError(requestError instanceof Error ? requestError.message : 'AI 叙述生成失败');
    } finally {
      setNarrativeLoading(false);
    }
  };

  return (
    <div>
      <PageHeader title="经营日报" description="收入、成本和利润仅来自已确认经营记录" />
      <Tabs
        activeKey={period}
        onChange={(key) => setPeriod(key as BossReportPeriod)}
        items={periods.map((item) => ({ key: item.key, label: item.label }))}
      />
      {error ? (
        <Alert
          type="error"
          showIcon
          message="经营日报加载失败"
          description={error}
          action={<Button size="small" onClick={() => void fetchReport(period).catch(() => undefined)}>重试</Button>}
          style={{ marginBottom: 16 }}
        />
      ) : null}
      <Spin spinning={loading}>
        {!report && !loading ? <Empty description="暂无经营报表" /> : null}
        {report ? (
          <>
            <Typography.Paragraph type="secondary">
              统计区间：{report.range.startDate} 至 {report.range.endDate} · 生成时间：{new Date(report.generatedAt).toLocaleString('zh-CN')}
            </Typography.Paragraph>
            <Row gutter={[16, 16]}>
              <Col xs={24} sm={12} xl={4}><MetricCard title="确认收入" value={report.income} /></Col>
              <Col xs={24} sm={12} xl={4}><MetricCard title="确认支出" value={report.expense} /></Col>
              <Col xs={24} sm={12} xl={4}><MetricCard title="利润" value={report.profit} color="#16a34a" /></Col>
              <Col xs={24} sm={12} xl={4}><MetricCard title="待老板审批" value={report.pendingApprovals} /></Col>
              <Col xs={24} sm={12} xl={4}><MetricCard title="高风险待批" value={report.highRiskPending} color="#dc2626" /></Col>
              <Col xs={24} sm={12} xl={4}><MetricCard title="规则异常" value={report.anomalyCount} color="#fa8c16" /></Col>
            </Row>

            <Card title="经营摘要" className="section-row">
              <Alert type={report.anomalyCount ? 'warning' : 'success'} showIcon message={report.aiSummary} description={report.aiSuggestion} />
            </Card>

            <Card
              title="报告快照与数据依据"
              className="section-row"
              extra={(
                <Space wrap>
                  <Button
                    icon={<FileProtectOutlined />}
                    loading={snapshotLoading}
                    onClick={() => void createSnapshot()}
                  >
                    生成审计快照
                  </Button>
                  <Button
                    type="primary"
                    icon={<RobotOutlined />}
                    disabled={!snapshotResult}
                    loading={narrativeLoading}
                    onClick={() => void generateNarrative()}
                  >
                    生成 AI 叙述
                  </Button>
                </Space>
              )}
            >
              {evidenceError ? <Alert type="error" showIcon message={evidenceError} style={{ marginBottom: 16 }} /> : null}
              {!snapshotResult ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="尚未生成审计快照" /> : null}
              {snapshotResult ? (
                <>
                  <Descriptions bordered size="small" column={{ xs: 1, sm: 1, md: 2 }}>
                    <Descriptions.Item label="状态">
                      <Tag color={snapshotResult.reused ? 'blue' : 'green'}>
                        {snapshotResult.reused ? '已复用相同事实快照' : '新快照'}
                      </Tag>
                    </Descriptions.Item>
                    <Descriptions.Item label="来源记录">{snapshotResult.sourceCount} 条</Descriptions.Item>
                    <Descriptions.Item label="统计口径">
                      {snapshotResult.snapshot.dataPolicy.recordStatus} · {snapshotResult.snapshot.dataPolicy.dataLayer}
                    </Descriptions.Item>
                    <Descriptions.Item label="币种">
                      {snapshotResult.snapshot.dataPolicy.currencies.join('、') || '无数据'}
                    </Descriptions.Item>
                    <Descriptions.Item label="快照哈希" span={2}>
                      <Typography.Text code copyable>{snapshotResult.snapshot.snapshotHash}</Typography.Text>
                    </Descriptions.Item>
                    <Descriptions.Item label="来源摘要" span={2}>
                      <Typography.Text code copyable>{snapshotResult.snapshot.sourceDigest}</Typography.Text>
                    </Descriptions.Item>
                  </Descriptions>
                  <List
                    size="small"
                    header="快照警告"
                    dataSource={snapshotResult.snapshot.warnings}
                    renderItem={(item) => (
                      <List.Item>
                        <Space align="start"><Tag color="warning">{item.code}</Tag><span>{item.message}</span></Space>
                      </List.Item>
                    )}
                  />
                </>
              ) : null}
              {narrativeResult && !narrativeResult.narrative ? (
                <Alert
                  type="info"
                  showIcon
                  message={narrativeResult.status === 'disabled' ? '报告 AI 当前未启用' : '报告 AI 叙述不可用'}
                  description={narrativeResult.message}
                  style={{ marginTop: 16 }}
                />
              ) : null}
              {narrativeResult?.narrative ? (
                <div style={{ marginTop: 16 }}>
                  <Alert
                    type="warning"
                    showIcon
                    message={narrativeResult.narrative.summary}
                    description={(
                      <Space wrap>
                        <Tag color="gold">需财务复核</Tag>
                        <Tag>{narrativeResult.narrative.provider}</Tag>
                        <Typography.Text type="secondary">{narrativeResult.narrative.promptVersion}</Typography.Text>
                      </Space>
                    )}
                    style={{ marginBottom: 16 }}
                  />
                  <Table
                    rowKey="claimId"
                    size="small"
                    columns={claimColumns}
                    dataSource={narrativeResult.narrative.claims}
                    pagination={false}
                    scroll={{ x: 760 }}
                  />
                </div>
              ) : null}
            </Card>

            <Card title="项目利润排行" className="section-row">
              <Table
                rowKey="projectId"
                columns={rankingColumns}
                dataSource={report.projectRanking}
                pagination={false}
                locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="本周期无确认项目记录" /> }}
                scroll={{ x: 760 }}
              />
            </Card>

            <Row gutter={[16, 16]} className="section-row">
              <Col xs={24} xl={12}>
                <Card title="审批情况">
                  <List
                    dataSource={[
                      `老板已通过 ${report.approvedCount} 笔`,
                      `老板已驳回 ${report.rejectedCount} 笔`,
                      `当前待审批 ${report.pendingApprovals} 笔`,
                      `本周期确认记录 ${report.recordCount} 笔`,
                    ]}
                    renderItem={(item) => <List.Item>{item}</List.Item>}
                  />
                </Card>
              </Col>
              <Col xs={24} xl={12}>
                <Card title="异常事项">
                  {report.anomalies.length ? (
                    <List dataSource={report.anomalies} renderItem={(item) => <List.Item>{item}</List.Item>} />
                  ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="本周期无未处理异常" />}
                </Card>
              </Col>
            </Row>
          </>
        ) : null}
      </Spin>
    </div>
  );
}
