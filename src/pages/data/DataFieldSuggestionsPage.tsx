import { useState } from 'react';
import { App, Button, Card, Modal, Select, Space, Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import PageHeader from '@/components/PageHeader';
import { useAuthStore } from '@/store/authStore';
import { useDataCenterStore } from '@/store/dataCenterStore';
import type { FieldSuggestion } from '@/types/dataCenter';
import { fieldTypeMap, suggestionStatusMap } from '@/utils/dataCenterMaps';

export default function DataFieldSuggestionsPage() {
  const { message } = App.useApp();
  const user = useAuthStore((state) => state.user);
  const [mapping, setMapping] = useState<FieldSuggestion | null>(null);
  const [fieldId, setFieldId] = useState<string>();
  const suggestions = useDataCenterStore((state) => state.fieldSuggestions);
  const fields = useDataCenterStore((state) => state.fields);
  const approveSuggestion = useDataCenterStore((state) => state.approveSuggestion);
  const mapSuggestion = useDataCenterStore((state) => state.mapSuggestion);
  const rejectSuggestion = useDataCenterStore((state) => state.rejectSuggestion);

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
      render: (_, record) =>
        record.status === 'pending' ? (
          <Space>
            <Button type="link" onClick={() => { approveSuggestion(record.id, user?.name ?? '财务'); message.success('字段已加入字段字典和模板，可在项目结构中查看。'); }}>批准为新字段</Button>
            <Button type="link" onClick={() => setMapping(record)}>映射到已有字段</Button>
            <Button type="link" danger onClick={() => { rejectSuggestion(record.id); message.success('已拒绝，该字段不会参与入库'); }}>拒绝</Button>
          </Space>
        ) : null,
    },
  ];

  return (
    <div>
      <PageHeader title="字段建议" description="未知字段经人工确认后进入字段字典和模板" />
      <Card>
        <Table rowKey="id" columns={columns} dataSource={suggestions} scroll={{ x: 1100 }} />
      </Card>
      <Modal
        title="映射到已有字段"
        open={Boolean(mapping)}
        onCancel={() => setMapping(null)}
        onOk={() => {
          if (mapping && fieldId) {
            mapSuggestion(mapping.id, fieldId);
            message.success('未知字段已映射到已有字段。');
            setMapping(null);
            setFieldId(undefined);
          }
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
