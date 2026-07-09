import { useMemo } from 'react';
import { Alert, Card, Col, List, Row, Tabs, Typography } from 'antd';
import PageHeader from '@/components/PageHeader';
import MetricCard from '@/components/MetricCard';
import RiskTag from '@/components/workOrder/RiskTag';
import { useReportStore } from '@/store/reportStore';
import { useWorkOrderStore } from '@/store/workOrderStore';
import { formatMoney } from '@/utils/format';

const tabConfigs = [
  { key: 'today', label: '今日', ratio: 1 },
  { key: 'week', label: '本周', ratio: 5 },
  { key: 'month', label: '本月', ratio: 22 },
];

export default function FinanceReportsPage() {
  const report = useReportStore((state) => state.financeReport);
  const workOrders = useWorkOrderStore((state) => state.workOrders);
  const anomalies = useMemo(
    () => workOrders.filter((item) => item.riskLevel !== 'low'),
    [workOrders],
  );
  const approved = useMemo(
    () => workOrders.filter((item) => ['reviewer_reviewing', 'boss_pending', 'completed'].includes(item.status)),
    [workOrders],
  );
  const rejected = useMemo(
    () => workOrders.filter((item) => item.status.includes('rejected')),
    [workOrders],
  );

  return (
    <div>
      <PageHeader title="财务日报" description="财务审核、收入支出、异常与费用分类汇总" />
      <Tabs
        items={tabConfigs.map((tab) => {
          const totalExpense = report.totalExpense * tab.ratio;
          const totalIncome = report.totalIncome * tab.ratio;
          const profit = totalIncome - totalExpense;
          return {
            key: tab.key,
            label: tab.label,
            children: (
              <>
                <Row gutter={[16, 16]}>
                  <Col xs={24} md={8} xl={4}><MetricCard title="审核数量" value={report.newWorkOrders * tab.ratio} /></Col>
                  <Col xs={24} md={8} xl={4}><MetricCard title="通过数量" value={approved.length * tab.ratio} color="#16a34a" /></Col>
                  <Col xs={24} md={8} xl={4}><MetricCard title="驳回数量" value={rejected.length * tab.ratio} color="#dc2626" /></Col>
                  <Col xs={24} md={8} xl={4}><MetricCard title="异常数量" value={anomalies.length * tab.ratio} color="#fa8c16" /></Col>
                  <Col xs={24} md={8} xl={4}><MetricCard title="总支出" value={totalExpense} /></Col>
                  <Col xs={24} md={8} xl={4}><MetricCard title="利润" value={profit} color="#16a34a" /></Col>
                </Row>

                <Row gutter={[16, 16]} className="section-row">
                  <Col xs={24} xl={8}>
                    <Card title="收入 / 支出 / 利润">
                      <List
                        dataSource={[
                          ['收入', totalIncome],
                          ['支出', totalExpense],
                          ['利润', profit],
                        ]}
                        renderItem={([label, value]) => (
                          <List.Item>
                            <Typography.Text>{label}</Typography.Text>
                            <Typography.Text strong>{formatMoney(Number(value))}</Typography.Text>
                          </List.Item>
                        )}
                      />
                    </Card>
                  </Col>
                  <Col xs={24} xl={8}>
                    <Card title="审核情况">
                      <List
                        dataSource={[
                          `已通过 ${approved.length * tab.ratio} 笔`,
                          `已驳回 ${rejected.length * tab.ratio} 笔`,
                          `待补充 ${Math.max(1, Math.round(tab.ratio / 2))} 笔`,
                        ]}
                        renderItem={(item) => <List.Item>{item}</List.Item>}
                      />
                    </Card>
                  </Col>
                  <Col xs={24} xl={8}>
                    <Card title="费用分类">
                      <List
                        dataSource={[
                          ['油费', totalExpense * 0.32],
                          ['过路费', totalExpense * 0.18],
                          ['司机费用', totalExpense * 0.28],
                          ['装卸/维修', totalExpense * 0.22],
                        ]}
                        renderItem={([label, value]) => (
                          <List.Item>
                            <Typography.Text>{label}</Typography.Text>
                            <Typography.Text>{formatMoney(Number(value))}</Typography.Text>
                          </List.Item>
                        )}
                      />
                    </Card>
                  </Col>
                </Row>

                <Card title="AI财务摘要" className="section-row">
                  <Alert type="warning" showIcon message={report.aiSummary} />
                </Card>

                <Card title="异常工单列表" className="section-row">
                  <List
                    dataSource={anomalies}
                    renderItem={(item) => (
                      <List.Item>
                        <List.Item.Meta
                          title={`${item.orderNo} · ${item.projectName}`}
                          description={item.aiSummary}
                        />
                        <Typography.Text>{formatMoney(item.amount)}</Typography.Text>
                        <RiskTag risk={item.riskLevel} />
                      </List.Item>
                    )}
                  />
                </Card>
              </>
            ),
          };
        })}
      />
    </div>
  );
}
