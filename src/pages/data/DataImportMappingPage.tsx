import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Alert, App, Button, Card, Descriptions, Empty, Select, Space, Spin, Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import PageHeader from '@/components/PageHeader';
import { useDataCenterStore } from '@/store/dataCenterStore';
import { useImportStore } from '@/store/importStore';
import type { ImportColumn, ImportMappingType } from '@/types/dataCenter';
import { fieldTypeMap, importStatusMap } from '@/utils/dataCenterMaps';

const IGNORE_VALUE = '__ignore__';

const mappingTypeLabels: Record<ImportMappingType, string> = {
  profile: '历史人工规则',
  field_key: '系统识别名',
  exact_name: '字段名精确匹配',
  alias: '字段别名',
  normalized: '规范化名称',
  fuzzy: '确定性模糊匹配',
  manual: '人工确认',
  ignored: '明确忽略',
};

export default function DataImportMappingPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { message } = App.useApp();
  const [selected, setSelected] = useState<Record<string, string>>({});
  const task = useImportStore((state) => state.currentTask?.id === id ? state.currentTask : undefined);
  const loading = useImportStore((state) => state.loading);
  const error = useImportStore((state) => state.error);
  const fetchTask = useImportStore((state) => state.fetchTask);
  const saveMappings = useImportStore((state) => state.saveMappings);
  const autoMatch = useImportStore((state) => state.autoMatch);
  const generateSuggestions = useImportStore((state) => state.generateSuggestions);
  const fields = useDataCenterStore((state) => state.fields);
  const templateFields = useDataCenterStore((state) => state.templateFields);
  const fetchFields = useDataCenterStore((state) => state.fetchFields);
  const fetchTemplateFields = useDataCenterStore((state) => state.fetchTemplateFields);

  useEffect(() => {
    if (id) void fetchTask(id).catch(() => undefined);
    void fetchFields({ page: 1, pageSize: 100, isActive: true }).catch(() => undefined);
  }, [fetchFields, fetchTask, id]);

  useEffect(() => {
    if (task?.templateId) void fetchTemplateFields(task.templateId).catch(() => undefined);
  }, [fetchTemplateFields, task?.templateId]);

  const taskFieldIds = useMemo(
    () => new Set(templateFields.filter((item) => item.templateId === task?.templateId).map((item) => item.fieldId)),
    [task?.templateId, templateFields],
  );
  const candidateFields = useMemo(
    () => fields.filter((item) => item.isActive && taskFieldIds.has(item.id)),
    [fields, taskFieldIds],
  );

  const valueFor = (column: ImportColumn) => {
    if (Object.prototype.hasOwnProperty.call(selected, column.id)) return selected[column.id];
    if (column.decision?.ignored) return IGNORE_VALUE;
    return column.decision?.targetFieldId;
  };
  const unresolved = task?.columns.filter((column) => !valueFor(column)) ?? [];

  const columns: ColumnsType<ImportColumn> = [
    {
      title: 'Excel 列',
      render: (_, column) => (
        <Space>
          <span>{column.sourceName}</span>
          {column.duplicateName ? <Tag color="error">重复列名</Tag> : null}
        </Space>
      ),
    },
    { title: '样例值', render: (_, column) => column.sampleValues.slice(0, 3).join('、') || '-' },
    { title: '推断类型', dataIndex: 'inferredType' },
    {
      title: '系统字段',
      width: 300,
      render: (_, column) => (
        <Select
          className="full-width"
          placeholder="请选择字段或忽略"
          value={valueFor(column)}
          onChange={(value) => setSelected((state) => ({ ...state, [column.id]: value }))}
          options={[
            { label: '明确忽略此列', value: IGNORE_VALUE },
            ...candidateFields.map((field) => ({ label: `${field.fieldName}（${fieldTypeMap[field.fieldType]}）`, value: field.id })),
          ]}
        />
      ),
    },
    {
      title: '当前决定',
      render: (_, column) => column.decision ? (
        <Space direction="vertical" size={2}>
          <Tag color={column.decision.ignored ? 'default' : 'green'}>{mappingTypeLabels[column.decision.mappingType]}</Tag>
          {!column.decision.ignored ? <span>{column.decision.targetFieldName}</span> : null}
        </Space>
      ) : <Tag color="warning">等待人工处理</Tag>,
    },
    { title: '置信度', render: (_, column) => column.decision ? `${Math.round(column.decision.confidence * 100)}%` : '-' },
  ];

  const save = async () => {
    if (!task) return;
    const mappings = task.columns.flatMap((column) => {
      const value = valueFor(column);
      if (!value) return [];
      return [{ columnId: column.id, ...(value === IGNORE_VALUE ? { ignore: true } : { targetFieldId: value }) }];
    });
    if (mappings.length !== task.columns.length) {
      message.warning('每一列都必须映射或明确忽略');
      return;
    }
    await saveMappings(task.id, { mappings, saveToProfile: true });
    setSelected({});
    message.success('映射已保存并可供后续同模板复用');
  };

  if (!id) return <Card><Empty description="导入任务不存在" /></Card>;

  return (
    <div>
      <PageHeader title="导入字段映射" description="确认本次任务的字段映射" />
      {error ? <Alert type="error" showIcon message="导入任务请求失败" description={error} /> : null}
      <Spin spinning={loading && !task}>
        {!task && !loading ? <Card><Empty description="导入任务不存在" /></Card> : null}
        {task ? (
          <>
            <Card>
              <Descriptions bordered size="small" column={{ xs: 1, sm: 2, lg: 4 }}>
                <Descriptions.Item label="文件名">{task.fileName}</Descriptions.Item>
                <Descriptions.Item label="项目">{task.projectName}</Descriptions.Item>
                <Descriptions.Item label="模板">{task.templateName}</Descriptions.Item>
                <Descriptions.Item label="状态">{importStatusMap[task.status]}</Descriptions.Item>
              </Descriptions>
            </Card>
            {unresolved.length ? (
              <Alert className="section-row" type="warning" showIcon message={`还有 ${unresolved.length} 列需要人工处理`} />
            ) : (
              <Alert className="section-row" type="success" showIcon message="所有列均已有明确处理决定" />
            )}
            <Card className="section-row" title="字段映射表">
              <Table rowKey="id" columns={columns} dataSource={task.columns} pagination={false} scroll={{ x: 1050 }} />
              <Space className="form-actions" wrap>
                <Button loading={loading} onClick={() => void save().catch((nextError) => message.error(nextError instanceof Error ? nextError.message : '保存失败'))}>保存映射</Button>
                <Button loading={loading} onClick={() => void autoMatch(task.id).then(() => message.success('自动匹配已重新执行')).catch((nextError) => message.error(nextError instanceof Error ? nextError.message : '匹配失败'))}>重新自动匹配</Button>
                <Button loading={loading} onClick={() => void generateSuggestions(task.id).then((items) => message.success(`已保留 ${items.length} 条字段建议`)).catch((nextError) => message.error(nextError instanceof Error ? nextError.message : '生成失败'))}>生成字段建议</Button>
                <Button onClick={() => navigate('/data/field-suggestions')}>查看字段建议</Button>
                <Button
                  type="primary"
                  disabled={unresolved.length > 0}
                  loading={loading}
                  onClick={() => void save()
                    .then(() => navigate(`/data/import/${task.id}/confirm`))
                    .catch((nextError) => message.error(nextError instanceof Error ? nextError.message : '保存失败'))}
                >
                  下一步确认
                </Button>
              </Space>
            </Card>
          </>
        ) : null}
      </Spin>
    </div>
  );
}
