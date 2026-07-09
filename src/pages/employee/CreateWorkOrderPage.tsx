import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { InboxOutlined, SaveOutlined, SendOutlined } from '@ant-design/icons';
import {
  App,
  Button,
  Card,
  Col,
  DatePicker,
  Divider,
  Form,
  Input,
  InputNumber,
  Row,
  Select,
  Space,
  Statistic,
  Upload,
} from 'antd';
import type { Dayjs } from 'dayjs';
import PageHeader from '@/components/PageHeader';
import { mockProjects } from '@/mock/mockProjects';
import { useAuthStore } from '@/store/authStore';
import { useWorkOrderStore } from '@/store/workOrderStore';
import type { WorkOrder, WorkOrderStatus, WorkOrderType } from '@/types/workOrder';
import { currentTime } from '@/utils/format';
import { getStepByStatus } from '@/utils/statusMap';

interface FormValues {
  type: WorkOrderType;
  projectId: string;
  date?: Dayjs;
  owner?: string;
  vehiclePlate?: string;
  driverName?: string;
  vehicleOwnerType?: 'self' | 'outsourced';
  startLocation?: string;
  endLocation?: string;
  distance?: number;
  transportIncome?: number;
  fuelCost?: number;
  tollCost?: number;
  driverCost?: number;
  otherCost?: number;
  expenseType?: string;
  expenseAmount?: number;
  paymentMethod?: string;
  remark?: string;
  attachments?: { name: string }[];
}

const num = (value?: number) => Number(value ?? 0);

export default function CreateWorkOrderPage() {
  const [form] = Form.useForm<FormValues>();
  const { message } = App.useApp();
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const createWorkOrder = useWorkOrderStore((state) => state.createWorkOrder);
  const type = Form.useWatch('type', form) ?? 'transport';
  const income = Form.useWatch('transportIncome', form);
  const fuel = Form.useWatch('fuelCost', form);
  const toll = Form.useWatch('tollCost', form);
  const driver = Form.useWatch('driverCost', form);
  const other = Form.useWatch('otherCost', form);

  const calc = useMemo(() => {
    const cost = num(fuel) + num(toll) + num(driver) + num(other);
    const profit = num(income) - cost;
    const profitRate = num(income) ? (profit / num(income)) * 100 : 0;
    return { cost, profit, profitRate };
  }, [driver, fuel, income, other, toll]);

  const submit = async (values: FormValues, draft = false) => {
    if (!user) return;
    const project = mockProjects.find((item) => item.id === values.projectId) ?? mockProjects[0];
    const date = values.date?.format('YYYY-MM-DD') ?? '2026-07-08';
    const status: WorkOrderStatus = draft ? 'draft' : 'finance_reviewing';
    const attachments = (values.attachments ?? []).map((item) => item.name);
    const id = `wo-${Date.now()}`;
    const base = {
      id,
      orderNo: `WO${date.replace(/-/g, '')}${String(Date.now()).slice(-4)}`,
      projectName: project.projectName,
      customerName: project.customerName,
      creatorName: user.name,
      creatorId: user.id,
      status,
      riskLevel: 'low' as const,
      createdAt: currentTime(),
      updatedAt: currentTime(),
      currentStep: getStepByStatus(status),
      description: values.remark || '员工新建工单。',
      attachments,
      aiSummary: 'AI 会在复核阶段自动分析该工单。',
      timeline: [
        {
          time: currentTime(),
          operator: user.name,
          role: user.role,
          action: draft ? '保存草稿' : '提交工单',
          comment: draft ? '员工保存草稿。' : '员工提交工单，等待财务审核。',
        },
      ],
    };

    let workOrder: WorkOrder;
    if (values.type === 'transport') {
      const transportIncome = num(values.transportIncome);
      workOrder = {
        ...base,
        type: 'transport',
        amount: transportIncome,
        income: transportIncome,
        cost: calc.cost,
        profit: calc.profit,
        vehiclePlate: values.vehiclePlate ?? '',
        driverName: values.driverName ?? '',
        vehicleOwnerType: values.vehicleOwnerType ?? 'self',
        startLocation: values.startLocation ?? '',
        endLocation: values.endLocation ?? '',
        distance: num(values.distance),
        transportIncome,
        fuelCost: num(values.fuelCost),
        tollCost: num(values.tollCost),
        driverCost: num(values.driverCost),
        otherCost: num(values.otherCost),
        remark: values.remark,
      };
    } else if (values.type === 'expense') {
      const amount = num(values.expenseAmount);
      workOrder = {
        ...base,
        type: 'expense',
        amount,
        income: 0,
        cost: amount,
        profit: -amount,
        riskLevel: amount > 20000 ? 'high' : 'medium',
        expenseType: values.expenseType ?? '',
        expenseAmount: amount,
        expenseDate: date,
        paymentMethod: values.paymentMethod ?? '银行转账',
        remark: values.remark,
      };
    } else {
      const amount = num(values.expenseAmount);
      workOrder = {
        ...base,
        type: 'other',
        amount,
        income: 0,
        cost: amount,
        profit: -amount,
        riskLevel: amount > 20000 ? 'high' : 'medium',
        expenseType: values.expenseType ?? '',
        expenseAmount: amount,
        expenseDate: date,
        paymentMethod: values.paymentMethod ?? '银行转账',
        remark: values.remark,
      };
    }

    await createWorkOrder(workOrder);
    message.success(draft ? '草稿已保存' : '已提交审核');
    navigate('/work-orders/my');
  };

  return (
    <div>
      <PageHeader title="新建工单" description="选择工单类型后填写对应业务字段" />
      <Card>
        <Form form={form} layout="vertical" initialValues={{ type: 'transport', vehicleOwnerType: 'self' }}>
          <Row gutter={16}>
            <Col xs={24} md={8}>
              <Form.Item label="工单类型" name="type" rules={[{ required: true }]}>
                <Select
                  options={[
                    { label: '运输订单', value: 'transport' },
                    { label: '费用报销', value: 'expense' },
                    { label: '其他支出', value: 'other' },
                  ]}
                />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item label={type === 'other' ? '项目' : '客户项目'} name="projectId" rules={[{ required: true }]}>
                <Select options={mockProjects.map((item) => ({ label: item.projectName, value: item.id }))} />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item label="日期" name="date" rules={[{ required: true }]}>
                <DatePicker className="full-width" />
              </Form.Item>
            </Col>
          </Row>

          {type === 'transport' ? (
            <>
              <Divider orientation="left">运输订单</Divider>
              <Row gutter={16}>
                <Col xs={24} md={8}><Form.Item label="负责人" name="owner"><Input /></Form.Item></Col>
                <Col xs={24} md={8}><Form.Item label="车牌号" name="vehiclePlate" rules={[{ required: true }]}><Input /></Form.Item></Col>
                <Col xs={24} md={8}><Form.Item label="司机" name="driverName" rules={[{ required: true }]}><Input /></Form.Item></Col>
                <Col xs={24} md={8}><Form.Item label="车辆类型" name="vehicleOwnerType"><Select options={[{ label: '自有', value: 'self' }, { label: '外包', value: 'outsourced' }]} /></Form.Item></Col>
                <Col xs={24} md={8}><Form.Item label="起点" name="startLocation"><Input /></Form.Item></Col>
                <Col xs={24} md={8}><Form.Item label="终点" name="endLocation"><Input /></Form.Item></Col>
                <Col xs={24} md={8}><Form.Item label="公里数" name="distance"><InputNumber min={0} addonAfter="km" className="full-width" /></Form.Item></Col>
                <Col xs={24} md={8}><Form.Item label="运输收入" name="transportIncome" rules={[{ required: true }]}><InputNumber min={0} addonBefore="¥" className="full-width" /></Form.Item></Col>
                <Col xs={24} md={8}><Form.Item label="油费" name="fuelCost"><InputNumber min={0} addonBefore="¥" className="full-width" /></Form.Item></Col>
                <Col xs={24} md={8}><Form.Item label="过路费" name="tollCost"><InputNumber min={0} addonBefore="¥" className="full-width" /></Form.Item></Col>
                <Col xs={24} md={8}><Form.Item label="司机费用" name="driverCost"><InputNumber min={0} addonBefore="¥" className="full-width" /></Form.Item></Col>
                <Col xs={24} md={8}><Form.Item label="其他费用" name="otherCost"><InputNumber min={0} addonBefore="¥" className="full-width" /></Form.Item></Col>
                <Col xs={24}>
                  <div className="calculation-panel">
                    <Statistic title="总成本" value={calc.cost} prefix="¥" />
                    <Statistic title="利润" value={calc.profit} prefix="¥" />
                    <Statistic title="利润率" value={calc.profitRate} suffix="%" precision={2} />
                  </div>
                </Col>
              </Row>
            </>
          ) : (
            <>
              <Divider orientation="left">{type === 'expense' ? '费用报销' : '其他支出'}</Divider>
              <Row gutter={16}>
                <Col xs={24} md={8}><Form.Item label={type === 'expense' ? '费用类型' : '支出类型'} name="expenseType" rules={[{ required: true }]}><Input /></Form.Item></Col>
                <Col xs={24} md={8}><Form.Item label="金额" name="expenseAmount" rules={[{ required: true }]}><InputNumber min={0} addonBefore="¥" className="full-width" /></Form.Item></Col>
                <Col xs={24} md={8}><Form.Item label="付款方式" name="paymentMethod"><Select options={[{ label: '银行转账', value: '银行转账' }, { label: '现金', value: '现金' }, { label: '备用金', value: '备用金' }]} /></Form.Item></Col>
              </Row>
            </>
          )}

          <Form.Item label="附件上传" name="attachments" valuePropName="fileList" getValueFromEvent={(event) => event?.fileList ?? []}>
            <Upload.Dragger beforeUpload={() => false} multiple>
              <p className="ant-upload-drag-icon"><InboxOutlined /></p>
              <p className="ant-upload-text">上传发票、回单、照片等附件</p>
            </Upload.Dragger>
          </Form.Item>
          <Form.Item label="备注/说明" name="remark">
            <Input.TextArea rows={4} />
          </Form.Item>
          <div className="form-actions">
            <Space>
              <Button icon={<SaveOutlined />} onClick={() => form.validateFields().then((values) => submit(values, true))}>保存草稿</Button>
              <Button type="primary" icon={<SendOutlined />} onClick={() => form.validateFields().then((values) => submit(values, false))}>提交审核</Button>
            </Space>
          </div>
        </Form>
      </Card>
    </div>
  );
}
