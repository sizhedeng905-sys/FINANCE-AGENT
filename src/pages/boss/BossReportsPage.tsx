import { Alert, Card, Col, Row, Tabs, Typography } from 'antd';
import PageHeader from '@/components/PageHeader';
import MetricCard from '@/components/MetricCard';
import { useReportStore } from '@/store/reportStore';

export default function BossReportsPage() {
  const reports = useReportStore((state) => state.bossReports);

  return (
    <div>
      <PageHeader title="经营日报" description="日报、周报、月报经营摘要" />
      <Card title="AI总结卡片" className="section-row">
        <Alert
          type="info"
          showIcon
          message="今日经营摘要"
          description="今日完成审批 35 笔，新增支出 12 万元。AI发现 2 个异常项目，建议关注客户A运输成本。"
        />
      </Card>
      <Tabs
        items={reports.map((item) => ({
          key: item.period,
          label: item.title,
          children: (
            <>
              <Row gutter={[16, 16]}>
                <Col xs={24} md={8}><MetricCard title="收入" value={item.income} /></Col>
                <Col xs={24} md={8}><MetricCard title="支出" value={item.expense} /></Col>
                <Col xs={24} md={8}><MetricCard title="利润" value={item.profit} color="#16a34a" /></Col>
              </Row>
              <Row gutter={[16, 16]} className="section-row">
                <Col xs={24} xl={8}><Card title="异常情况"><Typography.Paragraph>{item.anomalies.join('、')}</Typography.Paragraph></Card></Col>
                <Col xs={24} xl={8}><Card title="待审批事项"><Typography.Title level={3}>{item.pendingApprovals}</Typography.Title></Card></Col>
                <Col xs={24} xl={8}><Card title="AI总结"><Typography.Paragraph>{item.aiSummary}</Typography.Paragraph></Card></Col>
                <Col xs={24}><Card title="AI建议"><Typography.Paragraph>{item.aiSuggestion}</Typography.Paragraph></Card></Col>
              </Row>
            </>
          ),
        }))}
      />
    </div>
  );
}
