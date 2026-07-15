import { useEffect, useState } from 'react';
import { Alert, App, Button, Card, Modal, Select, Space, Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import PageHeader from '@/components/PageHeader';
import { useDataCenterStore } from '@/store/dataCenterStore';
import { useImportStore } from '@/store/importStore';
import type { FieldSuggestion } from '@/types/dataCenter';
import { fieldTypeMap, suggestionStatusMap } from '@/utils/dataCenterMaps';

export default function DataFieldSuggestionsPage() {
  const { message } = App.useApp();
  const [mapping, setMapping] = useState<FieldSuggestion | null>(null);
  const [fieldId, setFieldId] = useState<string>();
  const suggestions = useImportStore((state) => state.suggestions);
  const loading = useImportStore((state) => state.loading);
  const error = useImportStore((state) => state.error);
  const fetchSuggestions = useImportStore((state) => state.fetchSuggestions);
  const approveSuggestion = useImportStore((state) => state.approveSuggestion);
  const mapSuggestion = useImportStore((state) => state.mapSuggestion);
  const rejectSuggestion = useImportStore((state) => state.rejectSuggestion);
  const fields = useDataCenterStore((state) => state.fields);
  const fetchFields = useDataCenterStore((state) => state.fetchFields);

  useEffect(() => {
    void fetchSuggestions().catch(() => undefined);
    void fetchFields({ page: 1, pageSize: 100, isActive: true }).catch(() => undefined);
  }, [fetchFields, fetchSuggestions]);

  const columns: ColumnsType<FieldSuggestion> = [
    { title: '建议字段名', dataIndex: 'suggestedFieldName' },
    { title: '来源', dataIndex: 'sourceName' },
    { title: '样例值', dataIndex: 'sampleValues', render: (value: string[]) => value.join('、') },
    { title: '推荐类型', dataIndex: 'suggestedFieldType', render: (value) => fieldTypeMap[value as FieldSuggestion['suggestedFieldType']] },
    { title: '原因', dataIndex: 'reason' },
    { title: '映射目标', render: (_, record) => record.mappedFieldName || '-' },
    { title: '状态', dataIndex: 'status', render: (value) => <Tag>{suggestionStatusMap[value as FieldSuggestion['status']]}</Tag> },
    {
      title: '操作',
      width: 320,
      render: (_, record) => record.status === 'pending' ? (
        <Space wrap>
          <Button type="link" loading={loading} onClick={() => void approveSuggestion(record.id).then(async () => {
            await fetchFields({ page: 1, pageSize: 100, isActive: true });
            message.success('字段已创建并加入当前模板');
          }).catch((nextError) => message.error(nextError instanceof Error ? nextError.message : '批准失败'))}>批准为新字段</Button>
          <Button type="link" onClick={() => setMapping(record)}>映射到已有字段</Button>
          <Button type="link" danger loading={loading} onClick={() => void rejectSuggestion(record.id).then(() => message.success('该列已明确忽略')).catch((nextError) => message.error(nextError instanceof Error ? nextError.message : '拒绝失败'))}>拒绝并忽略</Button>
        </Space>
      ) : null,
    },
  ];

  return (
    <div>
      <PageHeader title="字段建议" description="导入未知列的人工处理" />
      {error ? <Alert type="error" showIcon message="字段建议请求失败" description={error} /> : null}
      <Card>
        <Table rowKey="id" columns={columns} dataSource={suggestions} loading={loading} scroll={{ x: 1100 }} />
      </Card>
      <Modal
        title="映射到已有字段"
        open={Boolean(mapping)}
        confirmLoading={loading}
        onCancel={() => { setMapping(null); setFieldId(undefined); }}
        onOk={() => {
          if (!mapping || !fieldId) {
            message.warning('请选择字段');
            return;
          }
          void mapSuggestion(mapping.id, fieldId)
            .then(() => {
              message.success('未知列已映射到已有字段');
              setMapping(null);
              setFieldId(undefined);
            })
            .catch((nextError) => message.error(nextError instanceof Error ? nextError.message : '映射失败'));
        }}
      >
        <Select
          className="full-width"
          placeholder="选择字段"
          value={fieldId}
          onChange={setFieldId}
          options={fields.filter((item) => item.isActive).map((item) => ({ label: `${item.fieldName}（${fieldTypeMap[item.fieldType]}）`, value: item.id }))}
        />
      </Modal>
    </div>
  );
}
