import { useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Alert, App, Button, Card, Space, Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import PageHeader from '@/components/PageHeader';
import { useDataCenterStore } from '@/store/dataCenterStore';
import type { ImportRow, RecordValue } from '@/types/dataCenter';

interface PreviewRow {
  id: string;
  rowNumber: number;
  recordDate: string;
  amount?: number;
  category: string;
  subCategory: string;
  values: RecordValue[];
  unmappedColumns: string[];
  errors: string[];
  warnings: string[];
}

export default function DataImportConfirmPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { message } = App.useApp();
  const importRows = useDataCenterStore((state) => state.importRows);
  const importTasks = useDataCenterStore((state) => state.importTasks);
  const mappingRules = useDataCenterStore((state) => state.mappingRules);
  const fields = useDataCenterStore((state) => state.fields);
  const confirmImportTask = useDataCenterStore((state) => state.confirmImportTask);
  const task = importTasks.find((item) => item.id === id);

  const rows = useMemo(() => importRows.filter((item) => item.importTaskId === id), [id, importRows]);
  const dataRows: ImportRow[] = useMemo(
    () => (rows.length ? rows : importRows.slice(0, 2).map((item) => ({ ...item, importTaskId: id ?? '' }))),
    [id, importRows, rows],
  );

  const previewRows = useMemo<PreviewRow[]>(() => {
    if (!task) return [];
    const taskRules = mappingRules.filter((item) => item.importTaskId === task.id || item.templateId === task.templateId);
    const fieldById = new Map(fields.map((field) => [field.id, field]));
    const findRule = (sourceColumnName: string) =>
      taskRules.find((item) => item.importTaskId === task.id && item.sourceColumnName === sourceColumnName) ??
      taskRules.find((item) => item.templateId === task.templateId && item.sourceColumnName === sourceColumnName);

    return dataRows.map((row) => {
      const values: RecordValue[] = [];
      const unmappedColumns: string[] = [];
      let amount: number | undefined;
      let recordDate = '';

      Object.entries(row.rawData).forEach(([sourceColumnName, rawValue], index) => {
        const rule = findRule(sourceColumnName);
        if (!rule) {
          unmappedColumns.push(sourceColumnName);
          return;
        }
        const field = fieldById.get(rule.targetFieldId);
        if (!field) {
          unmappedColumns.push(sourceColumnName);
          return;
        }
        values.push({
          id: `preview-${row.id}-${index}`,
          recordId: '',
          fieldId: field.id,
          fieldName: field.fieldName,
          value: rawValue,
        });
        if ((field.semanticType === 'amount' || field.fieldType === 'money') && amount === undefined) {
          const parsed = Number(rawValue);
          amount = Number.isFinite(parsed) ? parsed : undefined;
        }
        if ((field.semanticType === 'date' || field.fieldType === 'date') && !recordDate) {
          recordDate = String(rawValue);
        }
      });

      const errors = amount === undefined ? ['未识别金额字段，不能确认'] : [];
      const warnings = recordDate ? [] : ['未识别日期，将使用上传日期'];

      return {
        id: row.id,
        rowNumber: row.rowNumber,
        recordDate: recordDate || task.createdAt.slice(0, 10),
        amount,
        category: task.importType === 'revenue' ? '收入' : '成本',
        subCategory: task.templateName,
        values,
        unmappedColumns,
        errors,
        warnings,
      };
    });
  }, [dataRows, fields, mappingRules, task]);

  const hasErrors = previewRows.some((item) => item.errors.length > 0);

  const columns: ColumnsType<PreviewRow> = [
    { title: '行号', dataIndex: 'rowNumber' },
    { title: 'recordDate', dataIndex: 'recordDate' },
    { title: 'amount', dataIndex: 'amount', render: (value) => value ?? <Tag color="error">缺失</Tag> },
    { title: 'category', dataIndex: 'category' },
    { title: 'subCategory', dataIndex: 'subCategory' },
    {
      title: 'values',
      render: (_, record) => (
        <Space wrap>
          {record.values.map((item) => (
            <Tag key={item.id} color="green">
              {item.fieldName}:{String(item.value)}
            </Tag>
          ))}
        </Space>
      ),
    },
    {
      title: '未入库字段',
      render: (_, record) => record.unmappedColumns.length ? record.unmappedColumns.map((item) => <Tag key={item} color="warning">{item}</Tag>) : '-',
    },
    {
      title: '校验',
      render: (_, record) => (
        <Space direction="vertical" size={2}>
          {record.errors.map((item) => <Tag key={item} color="error">{item}</Tag>)}
          {record.warnings.map((item) => <Tag key={item} color="warning">{item}</Tag>)}
          {!record.errors.length && !record.warnings.length ? <Tag color="success">可入库</Tag> : null}
        </Space>
      ),
    },
  ];

  if (!task) return <Card>导入任务不存在</Card>;

  return (
    <div>
      <PageHeader title="导入确认" description="确认解析出来的记录，确认后进入 BusinessRecord" />
      <Alert
        className="section-row"
        type="info"
        showIcon
        message="未映射字段不会入库；正式 RecordValue 只使用 MappingRule 指向的真实 FieldDefinition.id。"
      />
      <Card>
        <Table rowKey="id" columns={columns} dataSource={previewRows} scroll={{ x: 1200 }} />
        <Space className="form-actions">
          <Button onClick={() => navigate(`/data/import/${id}/mapping`)}>返回修改映射</Button>
          <Button
            type="primary"
            disabled={hasErrors}
            onClick={() => {
              const records = confirmImportTask(task.id);
              if (!records.length) {
                message.error('未生成可入库记录，请检查金额字段映射');
                return;
              }
              message.success('导入完成，项目结构已更新。');
              navigate(`/data/projects/${task.projectId}/structure`);
            }}
          >
            全部确认
          </Button>
        </Space>
      </Card>
    </div>
  );
}
