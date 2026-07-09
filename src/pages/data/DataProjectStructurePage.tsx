import { useMemo, useState } from 'react';
import type { Key } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Alert,
  App,
  Button,
  Card,
  Col,
  Collapse,
  Descriptions,
  Drawer,
  Empty,
  Form,
  Input,
  Modal,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  Tabs,
  Tag,
  Tree,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import PageHeader from '@/components/PageHeader';
import MoneyText from '@/components/MoneyText';
import { useDataCenterStore } from '@/store/dataCenterStore';
import type { BusinessRecord, FieldDefinition, ProjectTemplate, TemplateField } from '@/types/dataCenter';
import { fieldTypeMap, importStatusMap, projectStatusMap, recordStatusMap, recordTypeMap, semanticTypeMap, sourceTypeMap } from '@/utils/dataCenterMaps';
import { getProjectStructure, type FieldUsageStat, type LogicalTableSummary } from '@/utils/projectStructure';

interface StructureNode {
  type: 'project' | 'template' | 'field' | 'records' | 'source';
  key: string;
  templateId?: string;
  fieldId?: string;
  sourceType?: BusinessRecord['sourceType'];
}

const sourceTagColor: Record<BusinessRecord['sourceType'], string> = {
  manual: 'blue',
  excel: 'green',
  ocr: 'purple',
  work_order: 'orange',
};

export default function DataProjectStructurePage({ readOnly = false }: { readOnly?: boolean }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const { message } = App.useApp();
  const [selectedNode, setSelectedNode] = useState<StructureNode | null>(null);
  const [recordDetail, setRecordDetail] = useState<BusinessRecord | null>(null);
  const [enableOpen, setEnableOpen] = useState(false);
  const [addTemplateId, setAddTemplateId] = useState<string>();
  const [newTemplateId, setNewTemplateId] = useState<string>();
  const [renameTemplate, setRenameTemplate] = useState<ProjectTemplate | null>(null);
  const [enableForm] = Form.useForm<{ templateId: string; customName: string }>();
  const [renameForm] = Form.useForm<{ customName: string }>();
  const [fieldForm] = Form.useForm<Omit<FieldDefinition, 'id' | 'createdAt' | 'updatedAt' | 'isActive'>>();
  const [fieldId, setFieldId] = useState<string>();

  const projects = useDataCenterStore((state) => state.projects);
  const templates = useDataCenterStore((state) => state.templates);
  const fields = useDataCenterStore((state) => state.fields);
  const templateFields = useDataCenterStore((state) => state.templateFields);
  const projectTemplates = useDataCenterStore((state) => state.projectTemplates);
  const records = useDataCenterStore((state) => state.records);
  const rawFiles = useDataCenterStore((state) => state.rawFiles);
  const importTasks = useDataCenterStore((state) => state.importTasks);
  const importRows = useDataCenterStore((state) => state.importRows);
  const mappingRules = useDataCenterStore((state) => state.mappingRules);
  const fieldSuggestions = useDataCenterStore((state) => state.fieldSuggestions);
  const enableTemplateForProject = useDataCenterStore((state) => state.enableTemplateForProject);
  const disableTemplateForProject = useDataCenterStore((state) => state.disableTemplateForProject);
  const updateProjectTemplate = useDataCenterStore((state) => state.updateProjectTemplate);
  const addExistingFieldToTemplate = useDataCenterStore((state) => state.addExistingFieldToTemplate);
  const removeTemplateField = useDataCenterStore((state) => state.removeTemplateField);
  const createField = useDataCenterStore((state) => state.createField);

  const structure = useMemo(
    () =>
      getProjectStructure(id ?? '', {
        projects,
        templates,
        fields,
        templateFields,
        projectTemplates,
        records,
        rawFiles,
        importTasks,
        importRows,
        mappingRules,
        fieldSuggestions,
      }),
    [fields, fieldSuggestions, id, importRows, importTasks, mappingRules, projectTemplates, projects, rawFiles, records, templateFields, templates],
  );

  const sourceCounts = useMemo(() => {
    return structure.records.reduce<Record<BusinessRecord['sourceType'], number>>(
      (acc, record) => {
        acc[record.sourceType] += 1;
        return acc;
      },
      { manual: 0, excel: 0, ocr: 0, work_order: 0 },
    );
  }, [structure.records]);

  const treeData = useMemo(
    () => [
      {
        title: `项目：${structure.project?.name ?? '-'}`,
        key: `project:${id}`,
        children: [
          ...structure.enabledTemplates.map((templateInfo) => ({
            title: `模板：${templateInfo.projectTemplate.customName || templateInfo.template.name}`,
            key: `template:${templateInfo.template.id}`,
            children: [
              ...templateInfo.fields.map((item) => ({
                title: `字段：${item.field.fieldName}（${fieldTypeMap[item.field.fieldType]}）`,
                key: `field:${templateInfo.template.id}:${item.fieldId}`,
              })),
              {
                title: `数据记录：${templateInfo.records.length}条`,
                key: `records:${templateInfo.template.id}`,
              },
            ],
          })),
          {
            title: '数据来源',
            key: 'source:root',
            children: [
              { title: `Excel导入：${sourceCounts.excel}条`, key: 'source:excel' },
              { title: `手工补录：${sourceCounts.manual}条`, key: 'source:manual' },
              { title: `工单生成：${sourceCounts.work_order}条`, key: 'source:work_order' },
              { title: `OCR识别：${sourceCounts.ocr}条`, key: 'source:ocr' },
            ],
          },
        ],
      },
    ],
    [id, sourceCounts, structure.enabledTemplates, structure.project?.name],
  );

  const selectedDetail = useMemo(() => {
    if (!selectedNode) return null;
    if (selectedNode.type === 'template') {
      const templateInfo = structure.enabledTemplates.find((item) => item.template.id === selectedNode.templateId);
      return { type: 'template' as const, templateInfo };
    }
    if (selectedNode.type === 'field') {
      const templateInfo = structure.enabledTemplates.find((item) => item.template.id === selectedNode.templateId);
      const field = templateInfo?.fields.find((item) => item.fieldId === selectedNode.fieldId);
      const usage = structure.fieldUsageStats.find((item) => item.fieldId === selectedNode.fieldId);
      return { type: 'field' as const, templateInfo, field, usage };
    }
    if (selectedNode.type === 'records') {
      const templateInfo = structure.enabledTemplates.find((item) => item.template.id === selectedNode.templateId);
      return { type: 'records' as const, templateInfo };
    }
    if (selectedNode.type === 'source') {
      return {
        type: 'source' as const,
        sourceType: selectedNode.sourceType,
        records: structure.records.filter((item) => item.sourceType === selectedNode.sourceType),
      };
    }
    return { type: 'project' as const };
  }, [selectedNode, structure.enabledTemplates, structure.fieldUsageStats, structure.records]);

  const onSelectTree = (keys: Key[]) => {
    const key = String(keys[0] ?? '');
    if (!key) return;
    const [type, first, second] = key.split(':');
    setSelectedNode({
      type: type as StructureNode['type'],
      key,
      templateId: type === 'template' || type === 'records' ? first : type === 'field' ? first : undefined,
      fieldId: type === 'field' ? second : undefined,
      sourceType: type === 'source' && first !== 'root' ? (first as BusinessRecord['sourceType']) : undefined,
    });
  };

  const submitEnableTemplate = () => {
    if (!id) return;
    enableForm.validateFields().then((values) => {
      const template = templates.find((item) => item.id === values.templateId);
      enableTemplateForProject(id, values.templateId, values.customName || template?.name);
      message.success('模板已启用');
      setEnableOpen(false);
      enableForm.resetFields();
    });
  };

  const submitRenameTemplate = () => {
    if (!renameTemplate) return;
    renameForm.validateFields().then((values) => {
      updateProjectTemplate(renameTemplate.id, values);
      message.success('项目模板名称已更新');
      setRenameTemplate(null);
      renameForm.resetFields();
    });
  };

  const submitAddField = () => {
    if (!addTemplateId || !fieldId) return;
    addExistingFieldToTemplate(addTemplateId, fieldId);
    message.success('字段已加入模板，项目结构已更新');
    setAddTemplateId(undefined);
    setFieldId(undefined);
  };

  const submitNewField = () => {
    if (!newTemplateId) return;
    fieldForm.validateFields().then((values) => {
      const field = createField({ ...values, aliases: values.aliases ?? [] });
      addExistingFieldToTemplate(newTemplateId, field.id);
      message.success('新字段已加入字段字典和模板，项目结构已更新');
      setNewTemplateId(undefined);
      fieldForm.resetFields();
    });
  };

  if (!structure.project) {
    return <Card><Empty description="项目不存在" /></Card>;
  }

  const recordColumns: ColumnsType<BusinessRecord> = [
    { title: '日期', dataIndex: 'recordDate' },
    { title: '模板', dataIndex: 'templateName' },
    { title: '类型', dataIndex: 'recordType', render: (value) => recordTypeMap[value as BusinessRecord['recordType']] },
    { title: '金额', dataIndex: 'amount', render: (value) => <MoneyText value={Number(value)} /> },
    { title: '分类', dataIndex: 'category' },
    { title: '来源', dataIndex: 'sourceType', render: (value) => <Tag color={sourceTagColor[value as BusinessRecord['sourceType']]}>{sourceTypeMap[value as BusinessRecord['sourceType']]}</Tag> },
    { title: '状态', dataIndex: 'status', render: (value) => <Tag>{recordStatusMap[value as BusinessRecord['status']]}</Tag> },
    { title: '创建人', dataIndex: 'createdBy' },
    { title: '操作', render: (_, record) => <Button type="link" onClick={() => setRecordDetail(record)}>查看详情</Button> },
  ];

  const fieldColumns = (templateId: string): ColumnsType<TemplateField> => [
    { title: '字段名称', render: (_, record) => record.field.fieldName },
    { title: '字段key', render: (_, record) => record.field.fieldKey },
    { title: '字段类型', render: (_, record) => fieldTypeMap[record.field.fieldType] },
    { title: '语义类型', render: (_, record) => semanticTypeMap[record.field.semanticType] },
    { title: '是否必填', dataIndex: 'isRequired', render: (value) => <Tag color={value ? 'red' : 'default'}>{value ? '必填' : '选填'}</Tag> },
    { title: '是否显示', dataIndex: 'isVisible', render: (value) => <Tag color={value ? 'green' : 'default'}>{value ? '显示' : '隐藏'}</Tag> },
    {
      title: '使用次数',
      render: (_, record) => structure.fieldUsageStats.find((item) => item.fieldId === record.fieldId)?.usageCount ?? 0,
    },
    {
      title: '最近使用',
      render: (_, record) => structure.fieldUsageStats.find((item) => item.fieldId === record.fieldId)?.latestUsedAt ?? '-',
    },
    {
      title: '操作',
      render: (_, record) =>
        readOnly ? null : (
          <Button size="small" danger onClick={() => removeTemplateField(record.id)}>
            移除字段
          </Button>
        ),
    },
  ];

  const sourceColumns: ColumnsType<RawFileRow> = [
    { title: '文件名', dataIndex: 'fileName' },
    { title: '文件类型', dataIndex: 'fileType' },
    { title: '关联项目', render: () => structure.project?.name },
    { title: '导入任务', render: (_, record) => record.task?.id ?? '-' },
    { title: '模板', render: (_, record) => record.task?.templateName ?? '-' },
    {
      title: '状态',
      render: (_, record) => {
        if (!record.task) return <Tag>无任务</Tag>;
        if (record.task.status === 'confirmed') return <Tag color="success">已入库</Tag>;
        if (record.task.status === 'mapping' || record.task.status === 'uploaded') return <Tag color="warning">待映射</Tag>;
        return <Tag>{importStatusMap[record.task.status]}</Tag>;
      },
    },
    { title: '上传人', dataIndex: 'uploadedBy' },
    { title: '上传时间', dataIndex: 'uploadedAt' },
    {
      title: '操作',
      render: (_, record) => (
        <Space>
          {record.task ? <Button type="link" onClick={() => navigate(`/data/import/${record.task?.id}/confirm`)}>查看导入任务</Button> : null}
          {record.task && !readOnly ? <Button type="link" onClick={() => navigate(`/data/import/${record.task?.id}/mapping`)}>查看映射</Button> : null}
          <Button type="link" onClick={() => navigate(readOnly ? '/boss/data/records' : '/data/records')}>查看生成记录</Button>
        </Space>
      ),
    },
  ];

  const sourceRows: RawFileRow[] = structure.rawFiles.map((file) => ({
    ...file,
    task: structure.importTasks.find((item) => item.id === file.relatedImportTaskId || item.rawFileId === file.id),
  }));

  const usageColumns: ColumnsType<FieldUsageStat> = [
    { title: '字段名称', dataIndex: 'fieldName' },
    { title: '字段类型', dataIndex: 'fieldType', render: (value) => fieldTypeMap[value as FieldDefinition['fieldType']] },
    { title: '所属模板', dataIndex: 'templateNames', render: (value: string[]) => value.join('、') },
    { title: '使用记录数', dataIndex: 'usageCount' },
    { title: '来源类型', dataIndex: 'sourceTypes', render: (value: BusinessRecord['sourceType'][]) => value.length ? value.map((item) => <Tag key={item} color={sourceTagColor[item]}>{sourceTypeMap[item]}</Tag>) : '-' },
    { title: '最近使用时间', dataIndex: 'latestUsedAt', render: (value) => value || '-' },
    { title: '是否新增字段', render: (_, record) => <Tag color={record.isSuggestedField ? 'purple' : 'default'}>{record.isSuggestedField ? '是' : '否'}</Tag> },
    { title: '是否来自字段建议', dataIndex: 'isSuggestedField', render: (value) => <Tag color={value ? 'purple' : 'default'}>{value ? '是' : '否'}</Tag> },
  ];

  const logicalColumns: ColumnsType<LogicalTableSummary> = [
    { title: '表名', dataIndex: 'tableName' },
    { title: '中文说明', dataIndex: 'description' },
    { title: '当前项目相关记录数', dataIndex: 'relatedCount', render: (value) => `${value}条` },
    { title: '关键字段', dataIndex: 'keyFields', render: (value: string[]) => value.join(', ') },
  ];

  const availableTemplates = templates.filter(
    (template) => !projectTemplates.some((item) => item.projectId === id && item.templateId === template.id && item.isActive),
  );
  const usedFieldIds = addTemplateId
    ? templateFields.filter((item) => item.templateId === addTemplateId).map((item) => item.fieldId)
    : [];

  return (
    <div>
      <PageHeader
        title={`项目数据库结构：${structure.project.name}`}
        description="展示该项目当前启用的模板、字段、数据来源和记录数量。新增字段后会自动反映在这里。"
        extra={
          <Space>
            {!readOnly ? <Button onClick={() => setEnableOpen(true)}>启用模板</Button> : null}
            <Button onClick={() => navigate(readOnly ? '/boss/data/projects' : '/data/projects')}>返回项目列表</Button>
          </Space>
        }
      />

      <Alert
        className="section-row"
        type="info"
        showIcon
        message="新增字段不会修改数据库表结构，而是新增字段定义 FieldDefinition，并通过 RecordValue 保存字段值。"
      />

      <Row gutter={[16, 16]} className="section-row">
        <Col xs={12} md={6} xl={3}><Card><Statistic title="项目名称" value={structure.project.name} /></Card></Col>
        <Col xs={12} md={6} xl={3}><Card><Statistic title="客户" value={structure.project.customerName} /></Card></Col>
        <Col xs={12} md={6} xl={3}><Card><Statistic title="负责人" value={structure.project.ownerName} /></Card></Col>
        <Col xs={12} md={6} xl={3}><Card><Statistic title="状态" value={projectStatusMap[structure.project.status]} /></Card></Col>
        <Col xs={12} md={6} xl={3}><Card><Statistic title="启用模板" value={structure.enabledTemplates.length} suffix="个" /></Card></Col>
        <Col xs={12} md={6} xl={3}><Card><Statistic title="字段总数" value={structure.fieldUsageStats.length} suffix="个" /></Card></Col>
        <Col xs={12} md={6} xl={3}><Card><Statistic title="数据记录" value={structure.records.length} suffix="条" /></Card></Col>
        <Col xs={12} md={6} xl={3}><Card><Statistic title="待确认" value={structure.records.filter((item) => item.status === 'pending_confirm').length} suffix="条" /></Card></Col>
      </Row>

      <Card className="section-row">
        <Tabs
          items={[
            {
              key: 'overview',
              label: '结构总览',
              children: (
                <Row gutter={[16, 16]}>
                  <Col xs={24} xl={13}>
                    <Tree defaultExpandAll treeData={treeData} onSelect={onSelectTree} />
                  </Col>
                  <Col xs={24} xl={11}>
                    <Typography.Title level={5}>数据来源</Typography.Title>
                    <Space wrap>
                      {Object.entries(sourceCounts).map(([source, count]) => (
                        <Tag key={source} color={sourceTagColor[source as BusinessRecord['sourceType']]}>
                          {sourceTypeMap[source as BusinessRecord['sourceType']]}：{count}条
                        </Tag>
                      ))}
                    </Space>
                  </Col>
                </Row>
              ),
            },
            {
              key: 'templates',
              label: '模板与字段',
              children: structure.enabledTemplates.length ? (
                <Collapse
                  items={structure.enabledTemplates.map((templateInfo) => ({
                    key: templateInfo.projectTemplate.id,
                    label: `${templateInfo.projectTemplate.customName || templateInfo.template.name} · ${recordTypeMap[templateInfo.template.recordType]}`,
                    extra: readOnly ? null : (
                      <Space onClick={(event) => event.stopPropagation()}>
                        <Button size="small" onClick={() => navigate(`/data/templates/${templateInfo.template.id}`)}>编辑模板</Button>
                        <Button size="small" onClick={() => setAddTemplateId(templateInfo.template.id)}>添加字段</Button>
                        <Button size="small" onClick={() => setNewTemplateId(templateInfo.template.id)}>新建字段并加入</Button>
                        <Button size="small" onClick={() => { setRenameTemplate(templateInfo.projectTemplate); renameForm.setFieldsValue({ customName: templateInfo.projectTemplate.customName }); }}>改名</Button>
                        <Button size="small" danger onClick={() => disableTemplateForProject(templateInfo.projectTemplate.id)}>停用模板</Button>
                      </Space>
                    ),
                    children: (
                      <Table
                        rowKey="id"
                        columns={fieldColumns(templateInfo.template.id)}
                        dataSource={templateInfo.fields}
                        pagination={false}
                        scroll={{ x: 900 }}
                      />
                    ),
                  }))}
                />
              ) : (
                <Empty description="当前项目暂无启用模板" />
              ),
            },
            {
              key: 'records',
              label: '数据记录',
              children: <Table rowKey="id" columns={recordColumns} dataSource={structure.records} scroll={{ x: 1100 }} />,
            },
            {
              key: 'files',
              label: '来源文件',
              children: <Table rowKey="id" columns={sourceColumns} dataSource={sourceRows} scroll={{ x: 1100 }} />,
            },
            {
              key: 'usage',
              label: '字段使用情况',
              children: <Table rowKey="fieldId" columns={usageColumns} dataSource={structure.fieldUsageStats} scroll={{ x: 1100 }} />,
            },
            {
              key: 'tables',
              label: '逻辑数据库表',
              children: <Table rowKey="tableName" columns={logicalColumns} dataSource={structure.logicalTablesSummary} pagination={false} scroll={{ x: 1000 }} />,
            },
          ]}
        />
      </Card>

      <Drawer title="结构详情" open={Boolean(selectedDetail)} onClose={() => setSelectedNode(null)} width={520}>
        {selectedDetail?.type === 'template' && selectedDetail.templateInfo ? (
          <Descriptions bordered column={1}>
            <Descriptions.Item label="模板名称">{selectedDetail.templateInfo.template.name}</Descriptions.Item>
            <Descriptions.Item label="类型">{recordTypeMap[selectedDetail.templateInfo.template.recordType]}</Descriptions.Item>
            <Descriptions.Item label="字段数量">{selectedDetail.templateInfo.fields.length}</Descriptions.Item>
            <Descriptions.Item label="使用记录数">{selectedDetail.templateInfo.records.length}</Descriptions.Item>
            <Descriptions.Item label="系统内置">{selectedDetail.templateInfo.template.isSystem ? '是' : '否'}</Descriptions.Item>
          </Descriptions>
        ) : null}
        {selectedDetail?.type === 'field' && selectedDetail.field ? (
          <Descriptions bordered column={1}>
            <Descriptions.Item label="字段名称">{selectedDetail.field.field.fieldName}</Descriptions.Item>
            <Descriptions.Item label="fieldKey">{selectedDetail.field.field.fieldKey}</Descriptions.Item>
            <Descriptions.Item label="字段类型">{fieldTypeMap[selectedDetail.field.field.fieldType]}</Descriptions.Item>
            <Descriptions.Item label="语义类型">{semanticTypeMap[selectedDetail.field.field.semanticType]}</Descriptions.Item>
            <Descriptions.Item label="单位">{selectedDetail.field.field.unit || '-'}</Descriptions.Item>
            <Descriptions.Item label="别名">{selectedDetail.field.field.aliases.join('、') || '-'}</Descriptions.Item>
            <Descriptions.Item label="所属模板">{selectedDetail.templateInfo?.projectTemplate.customName}</Descriptions.Item>
            <Descriptions.Item label="使用记录数">{selectedDetail.usage?.usageCount ?? 0}</Descriptions.Item>
          </Descriptions>
        ) : null}
        {selectedDetail?.type === 'records' && selectedDetail.templateInfo ? (
          <Space direction="vertical" className="full-width">
            {selectedDetail.templateInfo.records.map((record) => (
              <Card key={record.id} size="small">
                <Descriptions column={1} size="small">
                  <Descriptions.Item label="日期">{record.recordDate}</Descriptions.Item>
                  <Descriptions.Item label="金额"><MoneyText value={record.amount} /></Descriptions.Item>
                  <Descriptions.Item label="来源">{sourceTypeMap[record.sourceType]}</Descriptions.Item>
                  <Descriptions.Item label="状态">{recordStatusMap[record.status]}</Descriptions.Item>
                </Descriptions>
              </Card>
            ))}
          </Space>
        ) : null}
        {selectedDetail?.type === 'source' ? (
          <Table
            size="small"
            rowKey="id"
            columns={recordColumns}
            dataSource={selectedDetail.records}
            pagination={false}
            scroll={{ x: 900 }}
          />
        ) : null}
      </Drawer>

      <Drawer title="BusinessRecord 详情" open={Boolean(recordDetail)} onClose={() => setRecordDetail(null)} width={640}>
        {recordDetail ? (
          <Space direction="vertical" size={16} className="full-width">
            <Descriptions bordered column={1}>
              <Descriptions.Item label="记录ID">{recordDetail.id}</Descriptions.Item>
              <Descriptions.Item label="模板">{recordDetail.templateName}</Descriptions.Item>
              <Descriptions.Item label="来源">{sourceTypeMap[recordDetail.sourceType]} · {recordDetail.sourceId}</Descriptions.Item>
              <Descriptions.Item label="金额"><MoneyText value={recordDetail.amount} /></Descriptions.Item>
              <Descriptions.Item label="状态">{recordStatusMap[recordDetail.status]}</Descriptions.Item>
              <Descriptions.Item label="创建时间">{recordDetail.createdAt}</Descriptions.Item>
              <Descriptions.Item label="确认时间">{recordDetail.confirmedAt || '-'}</Descriptions.Item>
              <Descriptions.Item label="附件">{recordDetail.attachments.join('、') || '-'}</Descriptions.Item>
            </Descriptions>
            <Table
              size="small"
              rowKey="id"
              pagination={false}
              dataSource={recordDetail.values}
              columns={[
                { title: 'fieldId', dataIndex: 'fieldId' },
                { title: '字段', dataIndex: 'fieldName' },
                { title: '值', dataIndex: 'value', render: (value) => Array.isArray(value) ? value.join('、') : String(value ?? '-') },
              ]}
            />
          </Space>
        ) : null}
      </Drawer>

      <Modal title="启用模板" open={enableOpen} onCancel={() => setEnableOpen(false)} onOk={submitEnableTemplate}>
        <Form form={enableForm} layout="vertical">
          <Form.Item label="模板" name="templateId" rules={[{ required: true }]}>
            <Select options={availableTemplates.map((item) => ({ label: item.name, value: item.id }))} />
          </Form.Item>
          <Form.Item label="项目内显示名称" name="customName">
            <Input placeholder="默认使用模板名称" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal title="修改项目模板名称" open={Boolean(renameTemplate)} onCancel={() => setRenameTemplate(null)} onOk={submitRenameTemplate}>
        <Form form={renameForm} layout="vertical">
          <Form.Item label="显示名称" name="customName" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
        </Form>
      </Modal>

      <Modal title="添加已有字段" open={Boolean(addTemplateId)} onCancel={() => setAddTemplateId(undefined)} onOk={submitAddField}>
        <Select
          className="full-width"
          placeholder="选择字段"
          value={fieldId}
          onChange={setFieldId}
          options={fields
            .filter((item) => item.isActive && !usedFieldIds.includes(item.id))
            .map((item) => ({ label: `${item.fieldName}（${fieldTypeMap[item.fieldType]}）`, value: item.id }))}
        />
      </Modal>

      <Modal title="新建字段并加入模板" open={Boolean(newTemplateId)} onCancel={() => setNewTemplateId(undefined)} onOk={submitNewField}>
        <Form form={fieldForm} layout="vertical">
          <Form.Item label="字段名" name="fieldName" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item label="字段key" name="fieldKey" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item label="字段类型" name="fieldType" rules={[{ required: true }]}>
            <Select options={Object.entries(fieldTypeMap).map(([value, label]) => ({ value, label }))} />
          </Form.Item>
          <Form.Item label="语义类型" name="semanticType" rules={[{ required: true }]}>
            <Select options={Object.entries(semanticTypeMap).map(([value, label]) => ({ value, label }))} />
          </Form.Item>
          <Form.Item label="单位" name="unit"><Input /></Form.Item>
          <Form.Item label="别名，逗号分隔" name="aliases" getValueFromEvent={(event) => String(event.target.value).split(',').map((item) => item.trim()).filter(Boolean)}>
            <Input />
          </Form.Item>
          <Form.Item label="说明" name="description"><Input.TextArea rows={3} /></Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

type RawFileRow = ReturnType<typeof useDataCenterStore.getState>['rawFiles'][number] & {
  task?: ReturnType<typeof useDataCenterStore.getState>['importTasks'][number];
};
