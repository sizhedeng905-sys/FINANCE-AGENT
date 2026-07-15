export const bossQuickQuestions = [
  '今天有哪些异常？',
  '本月哪个客户利润最高？',
  '最近油费有没有异常？',
  '有哪些工单需要我重点关注？',
  '客户A这个月赚钱吗？',
  '本月总收入、总支出、总利润是多少？',
];

export function getMockAIReply(question: string) {
  if (question.includes('不存在项目')) {
    return '项目不存在或问题中未提供可识别的项目名称，需要人工确认。';
  }
  if (question.includes('今天经营情况')) {
    return '今日确认收入 12.68 万元，确认支出 8.42 万元，利润 4.26 万元；当前有 3 项待老板审批。';
  }
  if (question.includes('太和中转项目')) {
    return '太和中转项目的收入、成本和利润应以项目汇总中的已确认经营记录为准；当前 Mock 演示数据没有可确认的本月收入。';
  }
  if (question.includes('待老板审批')) {
    return '当前有 3 张待老板审批工单，建议先处理高风险和已催办项目。';
  }
  if (question.includes('异常')) {
    return '今天最需要关注两类异常：一是高额报销附件不完整，二是项目暂停后仍有维修支出。建议先看高风险报销，再看电商仓配项目。';
  }
  if (question.includes('利润最高')) {
    return '本月利润表现最好的是冷链医药配送项目，收入稳定、成本控制较好，预计利润率在 30% 以上。';
  }
  if (question.includes('油费')) {
    return '最近油费整体没有失控，但新能源干线和跨省线路有几笔油费偏高，建议让财务对照公里数和加油票据复核。';
  }
  if (question.includes('重点关注')) {
    return '建议重点关注三张工单：高额装卸费报销、跨省电商暂停后的维修支出、缺少温控附件的冷链运输单。';
  }
  if (question.includes('客户A')) {
    return '按当前 mock 数据看，客户A本月仍然赚钱，但利润空间不大。建议优先确认外包费用是否还能压降。';
  }
  if (question.includes('总收入')) {
    return '本月预计总收入 332.9 万，总支出 253.49 万，总利润约 79.41 万。利润为正，但异常费用会影响最终表现。';
  }
  return '我建议先看高风险、金额大、附件不完整的工单。低风险运输单可以提高审批效率，高风险报销要让负责人讲清楚原因。';
}
