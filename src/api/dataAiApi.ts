import { delay, ok } from './dataApiUtils';

export async function suggestMapping(payload: unknown) {
  await delay();
  return ok({ payload, suggestions: ['金额 -> 金额', '车牌 -> 车牌号'] }, 'AI映射建议已生成');
}

export async function detectRecordRisk(payload: unknown) {
  await delay();
  return ok({ payload, risk: 'medium', reason: '金额高于项目近7日均值' }, '记录风险已检测');
}

export async function analyzeProject(payload: unknown) {
  await delay();
  return ok({ payload, summary: '该项目收入稳定，但运输成本和临时费用需要持续关注。' }, '项目分析完成');
}
