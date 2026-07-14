import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Button, Card, Col, Row, Space, Spin, Statistic, Typography } from 'antd';
import PageHeader from '@/components/PageHeader';
import MetricCard from '@/components/MetricCard';
import { useReportStore } from '@/store/reportStore';
import { formatMoney } from '@/utils/format';

export default function BossHome() {
  const navigate = useNavigate();
  const reports = useReportStore((state) => state.bossReports);
  const loading = useReportStore((state) => state.bossLoading);
  const error = useReportStore((state) => state.bossError);
  const fetchReports = useReportStore((state) => state.fetchBossReports);
  const daily = reports.find((item) => item.period === 'daily');
  const monthly = reports.find((item) => item.period === 'monthly');

  useEffect(() => {
    void fetchReports().catch(() => undefined);
  }, [fetchReports]);

  return (
    <div>
      <PageHeader title="老板首页" description="最终审批和已确认经营数据摘要" />
      {error ? <Alert type="error" showIcon message="经营数据加载失败" description={error} style={{ marginBottom: 16 }} /> : null}
      <Spin spinning={loading}>
        <Row gutter={[16, 16]}>
          <Col xs={24} md={6}><MetricCard title="待最终审批" value={daily?.pendingApprovals ?? 0} /></Col>
          <Col xs={24} md={6}><MetricCard title="高风险待批" value={daily?.highRiskPending ?? 0} color="#dc2626" /></Col>
          <Col xs={24} md={6}><MetricCard title="今日确认记录" value={daily?.recordCount ?? 0} color="#16a34a" /></Col>
          <Col xs={24} md={6}><MetricCard title="本月确认利润" value={monthly?.profit ?? 0} color="#16a34a" /></Col>
        </Row>

        <Card className="section-row">
          <Space wrap>
            <Button type="primary" onClick={() => navigate('/boss/approval')}>进入最终审批</Button>
            <Button onClick={() => navigate('/boss/ai')}>打开AI助手</Button>
            <Button onClick={() => navigate('/boss/reports')}>查看经营日报</Button>
          </Space>
        </Card>

        <Card title="今日经营摘要" className="section-row">
          <Row gutter={[16, 16]}>
            <Col xs={24} md={8}><Statistic title="确认收入" value={daily?.income ?? 0} formatter={(value) => formatMoney(Number(value))} /></Col>
            <Col xs={24} md={8}><Statistic title="确认支出" value={daily?.expense ?? 0} formatter={(value) => formatMoney(Number(value))} /></Col>
            <Col xs={24} md={8}><Statistic title="确认利润" value={daily?.profit ?? 0} formatter={(value) => formatMoney(Number(value))} /></Col>
            <Col xs={24} md={8}><Statistic title="规则异常" value={daily?.anomalyCount ?? 0} /></Col>
            <Col xs={24} md={8}><Statistic title="老板已通过" value={daily?.approvedCount ?? 0} /></Col>
            <Col xs={24} md={8}>
              <Typography.Text type="secondary">规则摘要</Typography.Text>
              <Typography.Paragraph>{daily?.aiSummary ?? '暂无日报数据'}</Typography.Paragraph>
            </Col>
          </Row>
        </Card>
      </Spin>
    </div>
  );
}
