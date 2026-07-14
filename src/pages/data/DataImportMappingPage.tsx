import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { PlayCircleOutlined } from '@ant-design/icons';
import { Alert, App, Button, Card, Checkbox, Descriptions, Empty, InputNumber, Select, Space, Spin, Table, Tag } from 'antd';
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
  const [sheetIndex, setSheetIndex] = useState<number>();
  const [headerRange, setHeaderRange] = useState<string>();
  const [allowHiddenSheet, setAllowHiddenSheet] = useState(false);
  const [allowCachedFormulaResults, setAllowCachedFormulaResults] = useState(false);
  const task = useImportStore((state) => state.currentTask?.id === id ? state.currentTask : undefined);
  const inspection = useImportStore((state) => state.inspectionTaskId === id ? state.inspection : undefined);
  const loading = useImportStore((state) => state.loading);
  const error = useImportStore((state) => state.error);
  const fetchTask = useImportStore((state) => state.fetchTask);
  const inspectTask = useImportStore((state) => state.inspectTask);
  const parseTask = useImportStore((state) => state.parseTask);
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

  useEffect(() => {
    if (id && task?.status === 'uploaded' && !inspection) void inspectTask(id).catch(() => undefined);
  }, [id, inspectTask, inspection, task?.status]);

  useEffect(() => {
    if (!inspection) return;
    const recommended = inspection.recommendedSelection;
    const initialSheet = recommended?.sheetIndex
      ?? inspection.sheets.find((item) => item.nonEmpty && item.state === 'visible')?.sheetIndex
      ?? inspection.sheets.find((item) => item.nonEmpty)?.sheetIndex;
    const sheet = inspection.sheets.find((item) => item.sheetIndex === initialSheet);
    const candidate = sheet?.headerCandidates.find((item) => (
      item.startRowIndex === recommended?.headerStartRowIndex && item.endRowIndex === recommended?.headerRowIndex
    )) ?? sheet?.headerCandidates[0];
    setSheetIndex(initialSheet);
    setHeaderRange(candidate ? `${candidate.startRowIndex}:${candidate.endRowIndex}` : undefined);
    setAllowHiddenSheet(false);
    setAllowCachedFormulaResults(false);
  }, [inspection]);

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
  const selectedSheet = inspection?.sheets.find((item) => item.sheetIndex === sheetIndex);
  const [headerStartRowIndex, headerRowIndex] = (headerRange ?? '')
    .split(':')
    .map((value) => Number(value));
  const headerRangeValid = Number.isInteger(headerStartRowIndex)
    && Number.isInteger(headerRowIndex)
    && headerStartRowIndex >= 1
    && headerRowIndex >= headerStartRowIndex
    && headerRowIndex - headerStartRowIndex <= 2
    && headerRowIndex < (selectedSheet?.rowCount ?? 1);

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

  const parseSelection = async () => {
    if (!task || sheetIndex === undefined || !headerRangeValid) {
      message.warning('请选择有效的工作表和表头');
      return;
    }
    if (selectedSheet?.state !== 'visible' && !allowHiddenSheet) {
      message.warning('隐藏工作表必须显式确认');
      return;
    }
    await parseTask(task.id, {
      sheetIndex,
      headerStartRowIndex,
      headerRowIndex,
      allowHiddenSheet,
      allowCachedFormulaResults,
    });
    message.success('工作表已解析，请确认字段映射');
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
            {task.status === 'uploaded' ? (
              <Card className="section-row" title="选择导入区域">
                <Space direction="vertical" size="middle" className="full-width">
                  {inspection?.requiresSheetSelection ? (
                    <Alert type="warning" showIcon message="工作簿包含多个非空工作表，必须明确选择" />
                  ) : null}
                  {inspection && inspection.mediaCount > 0 ? (
                    <Alert
                      type="info"
                      showIcon
                      message={`已从表格解析路径分离 ${inspection.mediaCount} 个内嵌媒体对象`}
                      description="本次只流式读取工作表数据，内嵌图片不作为单元格值导入。"
                    />
                  ) : null}
                  <Select
                    className="full-width"
                    placeholder="选择工作表"
                    loading={loading && !inspection}
                    value={sheetIndex}
                    onChange={(value) => {
                      const sheet = inspection?.sheets.find((item) => item.sheetIndex === value);
                      const candidate = sheet?.headerCandidates[0];
                      setSheetIndex(value);
                      setHeaderRange(candidate ? `${candidate.startRowIndex}:${candidate.endRowIndex}` : undefined);
                      setAllowHiddenSheet(false);
                      setAllowCachedFormulaResults(false);
                    }}
                    options={(inspection?.sheets ?? []).map((sheet) => ({
                      value: sheet.sheetIndex,
                      disabled: !sheet.nonEmpty,
                      label: `${sheet.sheetName} · ${sheet.rowCount} 行 × ${sheet.columnCount} 列${sheet.state === 'visible' ? '' : ' · 隐藏'}`,
                    }))}
                  />
                  <Space wrap>
                    <InputNumber
                      addonBefore="表头起始行"
                      min={1}
                      max={Math.min(1000, Math.max(1, (selectedSheet?.rowCount ?? 2) - 1))}
                      precision={0}
                      value={Number.isInteger(headerStartRowIndex) ? headerStartRowIndex : undefined}
                      onChange={(value) => setHeaderRange(`${value ?? ''}:${Number.isInteger(headerRowIndex) ? headerRowIndex : ''}`)}
                    />
                    <InputNumber
                      addonBefore="表头结束行"
                      min={1}
                      max={Math.min(1000, Math.max(1, (selectedSheet?.rowCount ?? 2) - 1))}
                      precision={0}
                      value={Number.isInteger(headerRowIndex) ? headerRowIndex : undefined}
                      onChange={(value) => setHeaderRange(`${Number.isInteger(headerStartRowIndex) ? headerStartRowIndex : ''}:${value ?? ''}`)}
                    />
                  </Space>
                  <Select
                    className="full-width"
                    placeholder="选择表头范围"
                    value={headerRange}
                    disabled={!selectedSheet}
                    onChange={setHeaderRange}
                    options={(selectedSheet?.headerCandidates ?? []).map((candidate) => ({
                      value: `${candidate.startRowIndex}:${candidate.endRowIndex}`,
                      label: `第 ${candidate.startRowIndex === candidate.endRowIndex ? candidate.endRowIndex : `${candidate.startRowIndex}-${candidate.endRowIndex}`} 行 · ${candidate.labels.slice(0, 4).join(' | ')}`,
                    }))}
                  />
                  {selectedSheet && selectedSheet.state !== 'visible' ? (
                    <>
                      <Alert type="warning" showIcon message="当前选择的是隐藏工作表" />
                      <Checkbox checked={allowHiddenSheet} onChange={(event) => setAllowHiddenSheet(event.target.checked)}>
                        确认导入隐藏工作表
                      </Checkbox>
                    </>
                  ) : null}
                  {selectedSheet && selectedSheet.formulaCellCount > 0 ? (
                    <>
                      <Alert
                        type="warning"
                        showIcon
                        message={`当前工作表包含 ${selectedSheet.formulaCellCount} 个公式单元格`}
                        description="系统不会执行公式；开启后仅使用文件中已缓存的结果，确认入账前必须人工复核。"
                      />
                      <Checkbox
                        checked={allowCachedFormulaResults}
                        onChange={(event) => setAllowCachedFormulaResults(event.target.checked)}
                      >
                        允许使用公式缓存结果
                      </Checkbox>
                    </>
                  ) : null}
                  {selectedSheet && selectedSheet.headerCandidates.length === 0 ? (
                    <Alert type="error" showIcon message="未检测到可用表头，请先整理工作簿" />
                  ) : null}
                  <Button
                    type="primary"
                    icon={<PlayCircleOutlined />}
                    loading={loading}
                    disabled={!headerRangeValid || Boolean(selectedSheet && selectedSheet.state !== 'visible' && !allowHiddenSheet)}
                    onClick={() => void parseSelection().catch((nextError) => message.error(nextError instanceof Error ? nextError.message : '解析失败'))}
                  >
                    解析所选区域
                  </Button>
                </Space>
              </Card>
            ) : null}
            {task.columns.length > 0 && unresolved.length ? (
              <Alert className="section-row" type="warning" showIcon message={`还有 ${unresolved.length} 列需要人工处理`} />
            ) : task.columns.length > 0 ? (
              <Alert className="section-row" type="success" showIcon message="所有列均已有明确处理决定" />
            ) : null}
            {task.columns.length > 0 ? <Card className="section-row" title="字段映射表">
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
            </Card> : null}
          </>
        ) : null}
      </Spin>
    </div>
  );
}
