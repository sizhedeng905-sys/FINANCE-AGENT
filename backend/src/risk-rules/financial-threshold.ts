import { Prisma } from '@prisma/client';

export const FINANCIAL_THRESHOLD_SCHEMA_VERSION = 'financial-threshold/1.0' as const;
export const FINANCIAL_THRESHOLD_MAX = '999999999999.99';
export const FINANCIAL_THRESHOLD_MAX_INTEGER = 999999999999;
export const FINANCIAL_THRESHOLD_MAX_INTEGER_DIGITS = 12;
export const FINANCIAL_THRESHOLD_SCALE = 2;
export const FINANCIAL_THRESHOLD_EXPECTED_FORMAT = '0|[1-9][0-9]{0,11} with optional 1-2 decimal digits';

export const FINANCIAL_THRESHOLD_NUMERIC_DEPRECATION_CODE = 'RISK_RULE_THRESHOLD_NUMERIC_DEPRECATED';

export type FinancialThresholdErrorReason =
  | 'RISK_RULE_THRESHOLD_REQUIRED'
  | 'RISK_RULE_THRESHOLD_TYPE_INVALID'
  | 'RISK_RULE_THRESHOLD_FORMAT_INVALID'
  | 'RISK_RULE_THRESHOLD_SCALE_INVALID'
  | 'RISK_RULE_THRESHOLD_RANGE_INVALID'
  | 'RISK_RULE_THRESHOLD_NUMERIC_UNSAFE';

export interface FinancialThresholdWarning {
  code: typeof FINANCIAL_THRESHOLD_NUMERIC_DEPRECATION_CODE;
  field: 'conditionJson.threshold';
  message: string;
}

export interface ParsedFinancialThreshold {
  schemaVersion: typeof FINANCIAL_THRESHOLD_SCHEMA_VERSION;
  decimal: Prisma.Decimal;
  canonical: string;
  inputMode: 'decimal_string' | 'legacy_safe_integer_number';
  compatibilityWarnings: FinancialThresholdWarning[];
}

export class FinancialThresholdValidationError extends Error {
  constructor(
    readonly reason: FinancialThresholdErrorReason,
    message: string
  ) {
    super(message);
    this.name = 'FinancialThresholdValidationError';
  }
}

export function parseFinancialThreshold(value: unknown): ParsedFinancialThreshold {
  if (value === undefined || value === null) {
    throw new FinancialThresholdValidationError('RISK_RULE_THRESHOLD_REQUIRED', '风险规则参数 threshold 必填');
  }

  if (typeof value === 'number') return parseLegacyNumber(value);
  if (typeof value !== 'string') {
    throw new FinancialThresholdValidationError(
      'RISK_RULE_THRESHOLD_TYPE_INVALID',
      '风险规则参数 threshold 必须是规范十进制字符串'
    );
  }
  if (value.length === 0 || value.trim() !== value) {
    throw new FinancialThresholdValidationError(
      'RISK_RULE_THRESHOLD_FORMAT_INVALID',
      '风险规则参数 threshold 格式不合法'
    );
  }
  if (/^-/.test(value)) {
    throw new FinancialThresholdValidationError(
      'RISK_RULE_THRESHOLD_RANGE_INVALID',
      '风险规则参数 threshold 不能为负数'
    );
  }
  if (/^(?:0|[1-9]\d*)\.\d{3,}$/.test(value)) {
    throw new FinancialThresholdValidationError(
      'RISK_RULE_THRESHOLD_SCALE_INVALID',
      `风险规则参数 threshold 最多允许 ${FINANCIAL_THRESHOLD_SCALE} 位小数`
    );
  }
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(value)) {
    throw new FinancialThresholdValidationError(
      'RISK_RULE_THRESHOLD_FORMAT_INVALID',
      '风险规则参数 threshold 格式不合法'
    );
  }

  const decimal = new Prisma.Decimal(value);
  if (decimal.gt(FINANCIAL_THRESHOLD_MAX)) {
    throw new FinancialThresholdValidationError(
      'RISK_RULE_THRESHOLD_RANGE_INVALID',
      `风险规则参数 threshold 不能超过 ${FINANCIAL_THRESHOLD_MAX}`
    );
  }
  return {
    schemaVersion: FINANCIAL_THRESHOLD_SCHEMA_VERSION,
    decimal,
    canonical: decimal.toFixed(FINANCIAL_THRESHOLD_SCALE),
    inputMode: 'decimal_string',
    compatibilityWarnings: []
  };
}

function parseLegacyNumber(value: number): ParsedFinancialThreshold {
  if (!Number.isFinite(value) || !Number.isSafeInteger(value)) {
    throw new FinancialThresholdValidationError(
      'RISK_RULE_THRESHOLD_NUMERIC_UNSAFE',
      '旧 numeric threshold 仅兼容非负安全整数，请改用十进制字符串'
    );
  }
  if (value < 0 || value > FINANCIAL_THRESHOLD_MAX_INTEGER) {
    throw new FinancialThresholdValidationError(
      'RISK_RULE_THRESHOLD_RANGE_INVALID',
      `风险规则参数 threshold 必须在 0 到 ${FINANCIAL_THRESHOLD_MAX} 之间`
    );
  }
  const decimal = new Prisma.Decimal(value.toString());
  return {
    schemaVersion: FINANCIAL_THRESHOLD_SCHEMA_VERSION,
    decimal,
    canonical: decimal.toFixed(FINANCIAL_THRESHOLD_SCALE),
    inputMode: 'legacy_safe_integer_number',
    compatibilityWarnings: [{
      code: FINANCIAL_THRESHOLD_NUMERIC_DEPRECATION_CODE,
      field: 'conditionJson.threshold',
      message: 'numeric threshold 已弃用，请改用规范十进制字符串'
    }]
  };
}
