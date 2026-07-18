import {
  FINANCIAL_THRESHOLD_MAX,
  FINANCIAL_THRESHOLD_NUMERIC_DEPRECATION_CODE,
  FinancialThresholdErrorReason,
  FinancialThresholdValidationError,
  parseFinancialThreshold
} from '../src/risk-rules/financial-threshold';

function expectThresholdError(value: unknown, reason: FinancialThresholdErrorReason) {
  try {
    parseFinancialThreshold(value);
    throw new Error('Expected financial threshold validation to fail');
  } catch (error) {
    expect(error).toBeInstanceOf(FinancialThresholdValidationError);
    expect(error).toMatchObject({ reason });
  }
}

describe('financial threshold decimal contract', () => {
  it.each([
    ['0', '0.00'],
    ['0.01', '0.01'],
    ['0.1', '0.10'],
    ['10.00', '10.00'],
    [FINANCIAL_THRESHOLD_MAX, FINANCIAL_THRESHOLD_MAX]
  ])('normalizes decimal string %s to %s without rounding', (input, canonical) => {
    const parsed = parseFinancialThreshold(input);
    expect(parsed).toMatchObject({
      schemaVersion: 'financial-threshold/1.0',
      canonical,
      inputMode: 'decimal_string',
      compatibilityWarnings: []
    });
    expect(parsed.decimal.toFixed(2)).toBe(canonical);
  });

  it.each([
    [-1, 'RISK_RULE_THRESHOLD_RANGE_INVALID'],
    ['-0.01', 'RISK_RULE_THRESHOLD_RANGE_INVALID'],
    ['', 'RISK_RULE_THRESHOLD_FORMAT_INVALID'],
    [' 1.00', 'RISK_RULE_THRESHOLD_FORMAT_INVALID'],
    ['01.00', 'RISK_RULE_THRESHOLD_FORMAT_INVALID'],
    ['1.', 'RISK_RULE_THRESHOLD_FORMAT_INVALID'],
    ['.10', 'RISK_RULE_THRESHOLD_FORMAT_INVALID'],
    ['1e3', 'RISK_RULE_THRESHOLD_FORMAT_INVALID'],
    ['1.234', 'RISK_RULE_THRESHOLD_SCALE_INVALID'],
    ['1000000000000.00', 'RISK_RULE_THRESHOLD_RANGE_INVALID'],
    [null, 'RISK_RULE_THRESHOLD_REQUIRED'],
    [{ value: '1.00' }, 'RISK_RULE_THRESHOLD_TYPE_INVALID']
  ] as Array<[unknown, FinancialThresholdErrorReason]>)('rejects invalid threshold %p with %s', (value, reason) => {
    expectThresholdError(value, reason);
  });

  it('accepts only safe non-negative integer numbers as a deprecated compatibility input', () => {
    const parsed = parseFinancialThreshold(1000);
    expect(parsed).toMatchObject({
      canonical: '1000.00',
      inputMode: 'legacy_safe_integer_number',
      compatibilityWarnings: [{
        code: FINANCIAL_THRESHOLD_NUMERIC_DEPRECATION_CODE,
        field: 'conditionJson.threshold'
      }]
    });
    expectThresholdError(0.1, 'RISK_RULE_THRESHOLD_NUMERIC_UNSAFE');
    expectThresholdError(1000000000000, 'RISK_RULE_THRESHOLD_RANGE_INVALID');
    expectThresholdError(Number.MAX_SAFE_INTEGER + 1, 'RISK_RULE_THRESHOLD_NUMERIC_UNSAFE');
    expectThresholdError(Number.POSITIVE_INFINITY, 'RISK_RULE_THRESHOLD_NUMERIC_UNSAFE');
  });

  it('rejects a JSON number after cent loss but preserves cents through string JSON round-trips', () => {
    const unsafe = JSON.parse('99999999999999.99') as number;
    expect(unsafe.toString()).toBe('99999999999999.98');
    expectThresholdError(unsafe, 'RISK_RULE_THRESHOLD_NUMERIC_UNSAFE');

    const payload = JSON.stringify({ threshold: '0.10' });
    const reparsed = parseFinancialThreshold((JSON.parse(payload) as { threshold: string }).threshold);
    expect(reparsed.canonical).toBe('0.10');
    expect(reparsed.decimal.equals(parseFinancialThreshold('0.1').decimal)).toBe(true);
    expect(reparsed.decimal.equals(parseFinancialThreshold('0.01').decimal)).toBe(false);
  });
});
