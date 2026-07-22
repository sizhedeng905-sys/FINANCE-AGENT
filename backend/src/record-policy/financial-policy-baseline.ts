export const FINANCIAL_POLICY_BASELINE = {
  schemaVersion: 'financial-policy-baseline/1.0',
  decisions: {
    H01: {
      status: 'pending_human_decision',
      automaticGranularitySelection: false,
      summaryDetailMutualExclusion: 'not_configured'
    },
    H02: {
      status: 'pending_human_decision',
      formalAmountSign: 'positive_only',
      automaticReversal: false,
      correctionRelation: 'not_configured',
      periodClose: 'not_configured',
      voidBehavior: 'soft_status_only'
    },
    H07: {
      status: 'pending_human_decision',
      attachmentRole: 'controlled_evidence_only',
      attachmentAsMasterData: false,
      ocrAutomaticCommit: false
    }
  }
} as const;

export const H02_POSITIVE_AMOUNT_MESSAGE =
  '金额必须大于 0；负数、冲销、更正和关账规则尚未获得 H02 批准';

export const H02_NON_NEGATIVE_DECIMAL_MESSAGE =
  'amount 必须是最多两位小数的非负十进制字符串；H02 尚未批准负数或冲销输入';

export const H02_POLICY_PENDING_REASON = 'FINANCIAL_POLICY_H02_PENDING';

export function financialPolicySnapshot() {
  return {
    schemaVersion: FINANCIAL_POLICY_BASELINE.schemaVersion,
    decisions: {
      H01: FINANCIAL_POLICY_BASELINE.decisions.H01.status,
      H02: FINANCIAL_POLICY_BASELINE.decisions.H02.status,
      H07: FINANCIAL_POLICY_BASELINE.decisions.H07.status
    }
  } as const;
}
