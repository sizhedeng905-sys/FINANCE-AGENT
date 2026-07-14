import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Button, Card, Col, Empty, List, Row, Spin, Tabs, Typography } from 'antd';
import PageHeader from '@/components/PageHeader';
import MetricCard from '@/components/MetricCard';
import RiskTag from '@/components/workOrder/RiskTag';
import { useReportStore } from '@/store/reportStore';
import type { FinanceReportPeriod } from '@/types/report';
import { formatMoney } from '@/utils/format';

const periods: Array<{ key: FinanceReportPeriod; label: string }> = [
  { key: 'today', label: '今日' },
  { key: 'week', label: '本周' },
  { key: 'month', label: '本月' },
];

export default function FinanceReportsPage() {
  const navigate = useNavigate();
  const [period, setPeriod] = useState<FinanceReportPeriod>('today');
  const report = useReportStore((state) => state.financeReports[period]);
  const loading = useReportStore((state) => state.financeLoading);
  const error = useReportStore((state) => state.financeError);
  const fetchReport = useReportStore((state) => state.fetchFinanceReport);

  useEffect(() => {
    void fetchReport(period).catch(() => undefined);
  }, [fetchReport, period]);

  return (
    <div>
      <PageHeader title="财务日报" description="仅统计已确认经营记录，统计时区为 Asia/Shanghai" />
      <Tabs
        activeKey={period}
        onChange={(key) => setPeriod(key as FinanceReportPeriod)}
        items={periods.map((item) => ({ key: item.key, label: item.label }))}
      />
      {error ? (
        <Alert
          type="error"
          showIcon
          message="财务日报加载失败"
          description={error}
          action={<Button size="small" onClick={() => void fetchReport(period).catch(() => undefined)}>重试</Button>}
          style={{ marginBottom: 16 }}
        />
      ) : null}
      <Spin spinning={loading}>
        {!report && !loading ? <Empty description="暂无报表数据" /> : null}
        {report ? (
          <>
            <Typography.Paragraph type="secondary">
              统计区间：{report.range.startDate} 至 {report.range.endDate} · 生成时间：{new Date(report.generatedAt).toLocaleString('zh-CN')}
            </Typography.Paragraph>
            <Row gutter={[16, 16]}>
              <Col xs={24} sm={12} xl={4}><MetricCard title="新增工单" value={report.newWorkOrders} /></Col>
              <Col xs={24} sm={12} xl={4}><MetricCard title="财务通过" value={report.approvedCount} color="#16a34a" /></Col>
              <Col xs={24} sm={12} xl={4}><MetricCard title="财务驳回" value={report.rejectedCount} color="#dc2626" /></Col>
              <Col xs={24} sm={12} xl={4}><MetricCard title="规则异常" value={report.anomalyCount} color="#fa8c16" /></Col>
              <Col xs={24} sm={12} xl={4}><MetricCard title="确认支出" value={report.totalExpense} /></Col>
              <Col xs={24} sm={12} xl={4}><MetricCard title="预计利润" value={report.estimatedProfit} color="#16a34a" /></Col>
            </Row>

            <Row gutter={[16, 16]} className="section-row">
              <Col xs={24} xl={8}>
                <Card title="收入 / 支出 / 利润">
                  <List
                    dataSource={[
                      ['确认收入', report.totalIncome],
                      ['确认支出', report.totalExpense],
                      ['预计利润', report.estimatedProfit],
                    ] as const}
                    renderItem={([label, value]) => (
                      <List.Item>
                        <Typography.Text>{label}</Typography.Text>
                        <Typography.Text strong>{formatMoney(value)}</Typography.Text>
                      </List.Item>
                    )}
                  />
                </Card>
              </Col>
              <Col xs={24} xl={8}>
                <Card title="审核情况">
                  <List
                    dataSource={[
                      `已处理 ${report.reviewedCount} 笔`,
                      `要求补充 ${report.supplementCount} 笔`,
                      `当前待财务审核 ${report.pendingFinanceReview} 笔`,
                      `新增确认记录 ${report.confirmedRecords} 笔`,
                    ]}
                    renderItem={(item) => <List.Item>{item}</List.Item>}
                  />
                </Card>
              </Col>
              <Col xs={24} xl={8}>
                <Card title="真实费用分类">
                  {report.expenseCategories.length ? (
                    <List
                      dataSource={report.expenseCategories}
                      renderItem={(item) => (
                        <List.Item>
                          <Typography.Text>{item.name}（{item.recordCount} 笔）</Typography.Text>
                          <Typography.Text>{formatMoney(item.amount)}</Typography.Text>
                        </List.Item>
                      )}
                    />
                  ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="本周期无确认支出" />}
                </Card>
              </Col>
            </Row>

            <Card title="规则摘要" className="section-row">
              <Alert type={report.anomalyCount ? 'warning' : 'success'} showIcon message={report.aiSummary} />
            </Card>

            <Card title="异常工单" className="section-row">
              {report.anomalies.length ? (
                <List
                  dataSource={report.anomalies}
                  renderItem={(item) => (
                    <List.Item
                      actions={[<Button key="detail" type="link" onClick={() => navigate(`/work-orders/${item.workOrderId}`)}>查看工单</Button>]}
                    >
                      <List.Item.Meta title={`${item.orderNo} · ${item.projectName}`} description={item.reason} />
                      <RiskTag risk={item.riskLevel} />
                    </List.Item>
                  )}
                />
              ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="本周期无未处理异常" />}
            </Card>
          </>
        ) : null}
      </Spin>
    </div>
  );
}
