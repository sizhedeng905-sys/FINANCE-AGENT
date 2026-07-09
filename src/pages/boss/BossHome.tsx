import { useNavigate } from 'react-router-dom';
import { Button, Card, Col, Row, Space, Statistic, Typography } from 'antd';
import PageHeader from '@/components/PageHeader';
import MetricCard from '@/components/MetricCard';
import { useReportStore } from '@/store/reportStore';
import { useWorkOrderStore } from '@/store/workOrderStore';
import { formatMoney } from '@/utils/format';

export default function BossHome() {
  const navigate = useNavigate();
  const workOrders = useWorkOrderStore((state) => state.workOrders);
  const daily = useReportStore((state) => state.bossReports.find((item) => item.period === 'daily'));
  const pending = workOrders.filter((item) => item.status === 'boss_pending').length;
  const highRisk = workOrders.filter((item) => item.status === 'boss_pending' && item.riskLevel === 'high').length;
  const monthProfit = useReportStore((state) => state.bossReports.find((item) => item.period === 'monthly')?.profit ?? 0);

  return (
    <div>
      <PageHeader title="老板首页" description="最终审批和经营摘要" />
      <Row gutter={[16, 16]}>
        <Col xs={24} md={6}><MetricCard title="待最终审批" value={pending} /></Col>
        <Col xs={24} md={6}><MetricCard title="AI标记高风险" value={highRisk} color="#dc2626" /></Col>
        <Col xs={24} md={6}><MetricCard title="今日日报状态" value="已生成" color="#16a34a" /></Col>
        <Col xs={24} md={6}><MetricCard title="本月预计利润" value={monthProfit} color="#16a34a" /></Col>
      </Row>

      <Card className="section-row">
        <Space wrap>
          <Button type="primary" onClick={() => navigate('/boss/approval')}>进入最终审批</Button>
          <Button onClick={() => navigate('/boss/ai')}>打开AI助手</Button>
          <Button onClick={() => navigate('/boss/reports')}>查看经营日报</Button>
        </Space>
      </Card>

      <Card title="AI日报摘要" className="section-row">
        <Row gutter={[16, 16]}>
          <Col xs={24} md={8}><Statistic title="今日新增运输订单" value={4} /></Col>
          <Col xs={24} md={8}><Statistic title="今日新增报销" value={3} /></Col>
          <Col xs={24} md={8}><Statistic title="今日收入" value={daily?.income ?? 0} formatter={(value) => formatMoney(Number(value))} /></Col>
          <Col xs={24} md={8}><Statistic title="今日支出" value={daily?.expense ?? 0} formatter={(value) => formatMoney(Number(value))} /></Col>
          <Col xs={24} md={8}><Statistic title="今日预计利润" value={daily?.profit ?? 0} formatter={(value) => formatMoney(Number(value))} /></Col>
          <Col xs={24} md={8}>
            <Typography.Text type="secondary">主要异常</Typography.Text>
            <Typography.Paragraph>{daily?.anomalies.join('、')}</Typography.Paragraph>
          </Col>
        </Row>
      </Card>
    </div>
  );
}
