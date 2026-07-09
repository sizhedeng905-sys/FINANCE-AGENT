import { useState } from 'react';
import { Card, Descriptions, Drawer, Table, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import PageHeader from '@/components/PageHeader';
import { mockProjects } from '@/mock/mockProjects';
import type { Project } from '@/types/workOrder';
import { formatMoney, formatPercent } from '@/utils/format';

export default function BossProjectsPage() {
  const [selected, setSelected] = useState<Project | null>(null);
  const columns: ColumnsType<Project> = [
    {
      title: '客户/项目',
      render: (_, record) => (
        <>
          <Typography.Text strong>{record.customerName}</Typography.Text>
          <br />
          <Typography.Text type="secondary">{record.projectName}</Typography.Text>
        </>
      ),
    },
    { title: '本月收入', dataIndex: 'monthIncome', render: (value) => formatMoney(value) },
    { title: '本月成本', dataIndex: 'monthCost', render: (value) => formatMoney(value) },
    { title: '本月利润', render: (_, record) => formatMoney(record.monthIncome - record.monthCost) },
    {
      title: '利润率',
      render: (_, record) => formatPercent(((record.monthIncome - record.monthCost) / record.monthIncome) * 100),
    },
    { title: '异常数量', dataIndex: 'anomalyCount' },
    { title: '状态', dataIndex: 'status', render: (value) => ({ normal: '正常', watch: '关注', risk: '风险' }[value as Project['status']]) },
  ];

  return (
    <div>
      <PageHeader title="项目概览" description="项目即客户，重点展示核心数字和 AI 摘要" />
      <Card>
        <Table
          rowKey="id"
          columns={columns}
          dataSource={mockProjects}
          onRow={(record) => ({ onClick: () => setSelected(record) })}
          scroll={{ x: 920 }}
        />
      </Card>
      <Drawer title="项目摘要" width={520} open={Boolean(selected)} onClose={() => setSelected(null)}>
        {selected ? (
          <Descriptions bordered column={1}>
            <Descriptions.Item label="客户">{selected.customerName}</Descriptions.Item>
            <Descriptions.Item label="项目">{selected.projectName}</Descriptions.Item>
            <Descriptions.Item label="本月收入">{formatMoney(selected.monthIncome)}</Descriptions.Item>
            <Descriptions.Item label="本月成本">{formatMoney(selected.monthCost)}</Descriptions.Item>
            <Descriptions.Item label="本月利润">{formatMoney(selected.monthIncome - selected.monthCost)}</Descriptions.Item>
            <Descriptions.Item label="异常数量">{selected.anomalyCount}</Descriptions.Item>
            <Descriptions.Item label="AI摘要">{selected.aiSummary}</Descriptions.Item>
          </Descriptions>
        ) : null}
      </Drawer>
    </div>
  );
}
