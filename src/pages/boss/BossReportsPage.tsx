import { useEffect, useState } from 'react';
import { Alert, Button, Card, Col, Empty, List, Row, Spin, Table, Tabs, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import PageHeader from '@/components/PageHeader';
import MetricCard from '@/components/MetricCard';
import { useReportStore } from '@/store/reportStore';
import type { BossReportPeriod, ProjectRankingItem } from '@/types/report';
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

export default function BossReportsPage() {
  const [period, setPeriod] = useState<BossReportPeriod>('daily');
  const report = useReportStore((state) => state.bossReports.find((item) => item.period === period));
  const loading = useReportStore((state) => state.bossLoading);
  const error = useReportStore((state) => state.bossError);
  const fetchReport = useReportStore((state) => state.fetchBossReport);

  useEffect(() => {
    void fetchReport(period).catch(() => undefined);
  }, [fetchReport, period]);

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
