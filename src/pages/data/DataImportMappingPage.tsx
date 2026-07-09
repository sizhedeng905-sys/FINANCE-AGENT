import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Alert, App, Button, Card, Descriptions, Select, Space, Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import PageHeader from '@/components/PageHeader';
import { useAuthStore } from '@/store/authStore';
import { useDataCenterStore } from '@/store/dataCenterStore';
import type { MappingRule } from '@/types/dataCenter';
import { fieldTypeMap, importStatusMap } from '@/utils/dataCenterMaps';

interface ColumnRow {
  name: string;
  sample: string | number;
}

export default function DataImportMappingPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { message } = App.useApp();
  const user = useAuthStore((state) => state.user);
  const [selectedFields, setSelectedFields] = useState<Record<string, string>>({});
  const importTasks = useDataCenterStore((state) => state.importTasks);
  const fields = useDataCenterStore((state) => state.fields);
  const templateFields = useDataCenterStore((state) => state.templateFields);
  const mappingRules = useDataCenterStore((state) => state.mappingRules);
  const excelColumns = useDataCenterStore((state) => state.excelColumns);
  const saveMappingRules = useDataCenterStore((state) => state.saveMappingRules);
  const autoMatchColumns = useDataCenterStore((state) => state.autoMatchColumns);
  const generateFieldSuggestionsFromTask = useDataCenterStore((state) => state.generateFieldSuggestionsFromTask);
  const updateImportTask = useDataCenterStore((state) => state.updateImportTask);
  const task = importTasks.find((item) => item.id === id);
  const taskTemplateFieldIds = useMemo(
    () => templateFields.filter((item) => item.templateId === task?.templateId).map((item) => item.fieldId),
    [task?.templateId, templateFields],
  );
  const candidateFields = useMemo(
    () => fields.filter((item) => item.isActive && taskTemplateFieldIds.includes(item.id)),
    [fields, taskTemplateFieldIds],
  );
  const ruleByColumn = useMemo(() => {
    const map = new Map<string, MappingRule>();
    if (!task) return map;
    mappingRules
      .filter((item) => item.importTaskId === task.id || item.templateId === task.templateId)
      .forEach((rule) => {
        const current = map.get(rule.sourceColumnName);
        if (!current || rule.importTaskId === task.id) {
          map.set(rule.sourceColumnName, rule);
        }
      });
    return map;
  }, [mappingRules, task]);

  const getSelectedField = (columnName: string) => selectedFields[columnName] ?? ruleByColumn.get(columnName)?.targetFieldId;

  const columns: ColumnsType<ColumnRow> = [
    { title: 'Excel列名', dataIndex: 'name' },
    { title: '样例值', dataIndex: 'sample' },
    {
      title: '系统字段',
      render: (_, record) => (
        <Select
          className="full-width"
          allowClear
          placeholder="选择字段"
          value={getSelectedField(record.name)}
          onChange={(value) => setSelectedFields((state) => ({ ...state, [record.name]: value }))}
          options={candidateFields.map((item) => ({ label: `${item.fieldName}（${fieldTypeMap[item.fieldType]}）`, value: item.id }))}
        />
      ),
    },
    {
      title: '匹配方式',
      render: (_, record) => {
        const selected = getSelectedField(record.name);
        const rule = ruleByColumn.get(record.name);
        if (selected === '') return <Tag color="default">忽略字段</Tag>;
        if (selected || rule) return <Tag color="green">已映射：{rule?.targetFieldName ?? candidateFields.find((item) => item.id === selected)?.fieldName}</Tag>;
        return <Tag color="orange">未知字段</Tag>;
      },
    },
    { title: '置信度', render: (_, record) => ruleByColumn.get(record.name) ? `${Math.round((ruleByColumn.get(record.name)?.confidence ?? 0) * 100)}%` : '42%' },
    {
      title: '操作',
      render: (_, record) => (
        <Space>
          {!ruleByColumn.get(record.name) && getSelectedField(record.name) !== '' ? <Tag color="warning">建议人工确认</Tag> : null}
          <Button size="small" onClick={() => setSelectedFields((state) => ({ ...state, [record.name]: '' }))}>忽略</Button>
        </Space>
      ),
    },
  ];

  if (!task) return <Card>导入任务不存在</Card>;

  const save = () => {
    const rules: MappingRule[] = excelColumns
      .map((column) => {
        const field = candidateFields.find((item) => item.id === selectedFields[column.name] || item.fieldName === column.name || item.aliases.includes(column.name));
        if (selectedFields[column.name] === '') return null;
        if (!field) return null;
        return {
          id: `mr-${Date.now()}-${column.name}`,
          importTaskId: task.id,
          templateId: task.templateId,
          sourceColumnName: column.name,
          targetFieldId: field.id,
          targetFieldName: field.fieldName,
          mappingType: selectedFields[column.name] ? 'manual' : 'auto',
          confidence: selectedFields[column.name] ? 0.9 : 0.98,
          createdBy: user?.name ?? '财务',
          createdAt: new Date().toLocaleString('zh-CN'),
        } as MappingRule;
      })
      .filter(Boolean) as MappingRule[];
    saveMappingRules(task.id, rules);
    message.success('映射已保存');
  };

  return (
    <div>
      <PageHeader title="导入字段映射" description="已知列映射到字段字典，未知列生成字段建议" />
      <Card>
        <Descriptions bordered size="small" column={4}>
          <Descriptions.Item label="文件名">{task.fileName}</Descriptions.Item>
          <Descriptions.Item label="项目">{task.projectName}</Descriptions.Item>
          <Descriptions.Item label="模板">{task.templateName}</Descriptions.Item>
          <Descriptions.Item label="状态">{importStatusMap[task.status]}</Descriptions.Item>
        </Descriptions>
      </Card>
      <Alert className="section-row" type="warning" showIcon message="发现未知字段，建议人工确认。" />
      <Card className="section-row" title="字段映射表">
        <Table rowKey="name" columns={columns} dataSource={excelColumns} pagination={false} scroll={{ x: 900 }} />
        <Space className="form-actions">
          <Button onClick={save}>保存映射</Button>
          <Button
            onClick={() => {
              autoMatchColumns(task.id);
              message.success('已重新自动匹配');
            }}
          >
            重新自动匹配
          </Button>
          <Button onClick={() => { generateFieldSuggestionsFromTask(task.id); message.success('字段建议已生成'); }}>生成字段建议</Button>
          <Button
            type="primary"
            onClick={() => {
              updateImportTask(task.id, { status: 'pending_confirm' });
              navigate(`/data/import/${task.id}/confirm`);
            }}
          >
            下一步确认
          </Button>
        </Space>
      </Card>
    </div>
  );
}
