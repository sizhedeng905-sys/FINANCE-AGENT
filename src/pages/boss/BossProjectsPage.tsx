import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Button, Card, Descriptions, Drawer, Empty, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import PageHeader from '@/components/PageHeader';
import { getProjects } from '@/api/projectApi';
import { fetchProjectMonthlyReportApi } from '@/api/reportApi';
import type { Project } from '@/types/dataCenter';
import type { ProjectReport } from '@/types/report';
import { formatMoney, formatPercent } from '@/utils/format';
import { moneyRatioPercent } from '@/utils/money';

interface ProjectOverview {
  project: Project;
  report: ProjectReport;
}

export default function BossProjectsPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState<ProjectOverview[]>([]);
  const [selected, setSelected] = useState<ProjectOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const projects = await getProjects({ page: 1, pageSize: 100 });
      const reports = await Promise.all(
        projects.items.map(async (project) => ({
          project,
          report: await fetchProjectMonthlyReportApi(project.id),
        })),
      );
      setItems(reports);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '项目经营数据加载失败');
      throw reason;
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load().catch(() => undefined);
  }, []);

  const columns: ColumnsType<ProjectOverview> = [
    {
      title: '客户/项目',
      render: (_, item) => (
        <>
          <Typography.Text strong>{item.project.customerName}</Typography.Text>
          <br />
          <Typography.Text type="secondary">{item.project.name}</Typography.Text>
        </>
      ),
    },
    { title: '本月收入', render: (_, item) => formatMoney(item.report.income) },
    { title: '本月成本', render: (_, item) => formatMoney(item.report.cost) },
    { title: '本月利润', render: (_, item) => formatMoney(item.report.profit) },
    {
      title: '利润率',
      render: (_, item) => formatPercent(moneyRatioPercent(item.report.profit, item.report.income)),
    },
    { title: '异常数量', render: (_, item) => item.report.anomalyCount },
    {
      title: '状态',
      render: (_, item) => <Tag color={item.project.status === 'active' ? 'success' : 'default'}>{item.project.status === 'active' ? '进行中' : '已归档'}</Tag>,
    },
    {
      title: '操作',
      render: (_, item) => (
        <Button type="link" onClick={(event) => { event.stopPropagation(); navigate(`/boss/data/projects/${item.project.id}/structure`); }}>
          查看结构
        </Button>
      ),
    },
  ];

  return (
    <div>
      <PageHeader title="项目概览" description="按本月已确认经营记录汇总收入、成本和利润" />
      {error ? (
        <Alert
          type="error"
          showIcon
          message="项目月报加载失败"
          description={error}
          action={<Button size="small" onClick={() => void load().catch(() => undefined)}>重试</Button>}
          style={{ marginBottom: 16 }}
        />
      ) : null}
      <Card>
        <Table
          rowKey={(item) => item.project.id}
          columns={columns}
          dataSource={items}
          loading={loading}
          locale={{ emptyText: <Empty description="暂无项目经营数据" /> }}
          onRow={(item) => ({ onClick: () => setSelected(item) })}
          scroll={{ x: 920 }}
          pagination={{ pageSize: 20, showSizeChanger: true }}
        />
      </Card>
      <Drawer title="项目月报摘要" width={520} open={Boolean(selected)} onClose={() => setSelected(null)}>
        {selected ? (
          <Descriptions bordered column={1}>
            <Descriptions.Item label="客户">{selected.project.customerName}</Descriptions.Item>
            <Descriptions.Item label="项目">{selected.project.name}</Descriptions.Item>
            <Descriptions.Item label="统计月份">{selected.report.month}</Descriptions.Item>
            <Descriptions.Item label="本月收入">{formatMoney(selected.report.income)}</Descriptions.Item>
            <Descriptions.Item label="本月成本">{formatMoney(selected.report.cost)}</Descriptions.Item>
            <Descriptions.Item label="本月利润">{formatMoney(selected.report.profit)}</Descriptions.Item>
            <Descriptions.Item label="确认记录">{selected.report.recordCount}</Descriptions.Item>
            <Descriptions.Item label="异常数量">{selected.report.anomalyCount}</Descriptions.Item>
          </Descriptions>
        ) : null}
      </Drawer>
    </div>
  );
}
