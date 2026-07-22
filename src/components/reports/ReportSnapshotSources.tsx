import { ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import { Alert, Button, Descriptions, Divider, Empty, Select, Space, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchReportSnapshotSourcesApi } from '@/api/reportApi';
import type {
  PaginatedReportSnapshotSources,
  ReportAccountingDirection,
  ReportSnapshot,
  ReportSnapshotSource,
  ReportSnapshotSourceQuery,
} from '@/types/report';
import { formatMoney } from '@/utils/format';

interface ReportSnapshotSourcesProps {
  snapshot: ReportSnapshot;
}

interface SourceFilters {
  projectId?: string;
  currency?: string;
  accountingDirection?: ReportAccountingDirection;
}

const directionLabels: Record<ReportAccountingDirection, { color: string; text: string }> = {
  income: { color: 'success', text: '收入' },
  expense: { color: 'error', text: '支出' },
};

function HashValue({ value }: { value: string }) {
  const compact = value.length > 22 ? `${value.slice(0, 12)}...${value.slice(-6)}` : value;
  return <Typography.Text code copyable={{ text: value }}>{compact}</Typography.Text>;
}

export default function ReportSnapshotSources({ snapshot }: ReportSnapshotSourcesProps) {
  const requestEpoch = useRef(0);
  const [data, setData] = useState<PaginatedReportSnapshotSources | null>(null);
  const [draftFilters, setDraftFilters] = useState<SourceFilters>({});
  const [activeFilters, setActiveFilters] = useState<SourceFilters>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (query: ReportSnapshotSourceQuery) => {
    const epoch = ++requestEpoch.current;
    setLoading(true);
    setError(null);
    try {
      const result = await fetchReportSnapshotSourcesApi(snapshot.snapshotId, query);
      if (epoch !== requestEpoch.current) return;
      if (
        result.snapshot.snapshotId !== snapshot.snapshotId
        || result.snapshot.snapshotHash !== snapshot.snapshotHash
        || result.snapshot.sourceDigest !== snapshot.sourceDigest
      ) {
        throw new Error('来源明细与当前报告快照不一致');
      }
      setData(result);
    } catch (requestError) {
      if (epoch !== requestEpoch.current) return;
      setError(requestError instanceof Error ? requestError.message : '来源明细加载失败');
    } finally {
      if (epoch === requestEpoch.current) setLoading(false);
    }
  }, [snapshot.snapshotHash, snapshot.snapshotId, snapshot.sourceDigest]);

  useEffect(() => {
    setData(null);
    setDraftFilters({});
    setActiveFilters({});
    void load({ page: 1, pageSize: 10 });
    return () => {
      requestEpoch.current += 1;
    };
  }, [load]);

  const projectOptions = useMemo(() => {
    const projects = new Map<string, string>();
    snapshot.breakdowns.forEach((item) => projects.set(item.projectId, item.projectName));
    data?.items.forEach((item) => projects.set(item.projectId, item.projectName));
    return [...projects.entries()].map(([value, label]) => ({ value, label }));
  }, [data?.items, snapshot.breakdowns]);

  const columns: ColumnsType<ReportSnapshotSource> = [
    {
      title: '项目',
      dataIndex: 'projectName',
      render: (value: string, item) => (
        <Space direction="vertical" size={0}>
          <span>{value}</span>
          <Typography.Text type="secondary" code>{item.projectId}</Typography.Text>
        </Space>
      ),
    },
    {
      title: '业务日期',
      dataIndex: 'recordDate',
      width: 130,
      render: (value: string) => value.slice(0, 10),
    },
    {
      title: '方向',
      dataIndex: 'accountingDirection',
      width: 90,
      render: (value: ReportAccountingDirection) => {
        const label = directionLabels[value];
        return <Tag color={label.color}>{label.text}</Tag>;
      },
    },
    {
      title: '金额 / 币种',
      dataIndex: 'amount',
      width: 170,
      render: (value: string, item) => `${formatMoney(value)} ${item.currency}`,
    },
    {
      title: '记录版本',
      dataIndex: 'recordVersion',
      width: 100,
      render: (value: number) => `v${value}`,
    },
    {
      title: 'Record hash',
      dataIndex: 'recordHash',
      width: 230,
      render: (value: string) => <HashValue value={value} />,
    },
  ];

  const applyFilters = () => {
    setActiveFilters(draftFilters);
    void load({ ...draftFilters, page: 1, pageSize: data?.pageSize ?? 10 });
  };

  const resetFilters = () => {
    setDraftFilters({});
    setActiveFilters({});
    void load({ page: 1, pageSize: data?.pageSize ?? 10 });
  };

  return (
    <section className="report-snapshot-sources" aria-label="报告快照来源明细">
      <Divider orientation="left">来源明细（只读）</Divider>
      {data ? (
        <Descriptions bordered size="small" column={{ xs: 1, md: 2 }}>
          <Descriptions.Item label="快照来源总数">{data.snapshot.sourceCount}</Descriptions.Item>
          <Descriptions.Item label="当前筛选结果">{data.total}</Descriptions.Item>
          <Descriptions.Item label="Source digest"><HashValue value={data.snapshot.sourceDigest} /></Descriptions.Item>
          <Descriptions.Item label="一致性水位">
            <Typography.Text code copyable={{ text: data.snapshot.dataWatermark }} ellipsis>
              {data.snapshot.dataWatermark}
            </Typography.Text>
          </Descriptions.Item>
        </Descriptions>
      ) : null}
      <Space wrap className="section-row">
        <Select
          allowClear
          aria-label="来源项目筛选"
          placeholder="全部项目"
          value={draftFilters.projectId}
          options={projectOptions}
          style={{ minWidth: 180 }}
          onChange={(projectId) => setDraftFilters((current) => ({ ...current, projectId }))}
        />
        <Select
          allowClear
          aria-label="来源币种筛选"
          placeholder="全部币种"
          value={draftFilters.currency}
          options={snapshot.dataPolicy.currencies.map((currency) => ({ value: currency, label: currency }))}
          style={{ minWidth: 130 }}
          onChange={(currency) => setDraftFilters((current) => ({ ...current, currency }))}
        />
        <Select
          allowClear
          aria-label="来源方向筛选"
          placeholder="全部方向"
          value={draftFilters.accountingDirection}
          options={Object.entries(directionLabels).map(([value, item]) => ({ value, label: item.text }))}
          style={{ minWidth: 130 }}
          onChange={(accountingDirection) => setDraftFilters((current) => ({
            ...current,
            accountingDirection,
          }))}
        />
        <Button icon={<SearchOutlined />} onClick={applyFilters}>查询</Button>
        <Button icon={<ReloadOutlined />} onClick={resetFilters}>重置</Button>
      </Space>
      {error ? (
        <Alert
          type="error"
          showIcon
          message="来源明细加载失败"
          description={error}
          action={(
            <Button
              size="small"
              onClick={() => void load({
                ...activeFilters,
                page: data?.page ?? 1,
                pageSize: data?.pageSize ?? 10,
              })}
            >
              重试
            </Button>
          )}
          className="section-row"
        />
      ) : null}
      <Table
        rowKey="recordId"
        size="small"
        columns={columns}
        dataSource={data?.items ?? []}
        loading={loading}
        scroll={{ x: 980 }}
        locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前筛选没有快照来源" /> }}
        pagination={data ? {
          current: data.page,
          pageSize: data.pageSize,
          total: data.total,
          showSizeChanger: true,
          pageSizeOptions: [10, 20, 50, 100],
          showTotal: (total) => `共 ${total} 条`,
        } : false}
        onChange={(pagination) => void load({
          ...activeFilters,
          page: pagination.current ?? 1,
          pageSize: pagination.pageSize ?? 10,
        })}
      />
    </section>
  );
}
