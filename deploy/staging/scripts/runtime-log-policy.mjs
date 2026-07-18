import { createHash } from 'node:crypto';

const LOG_BUDGET_BYTES = 32 * 1024 * 1024;
const leakPatterns = [
  ['bearer_token', /\bbearer\s+[a-z0-9._~+/-]{16,}={0,2}\b/i],
  ['jwt', /\beyJ[a-z0-9_-]{8,}\.[a-z0-9_-]{8,}\.[a-z0-9_-]{8,}\b/i],
  ['credential_url', /\b(?:postgres(?:ql)?|redis):\/\/[^\s/:@]+:[^\s/@]+@/i],
  ['sensitive_query', /[?&](?:x-amz-(?:signature|credential|security-token)|access_token|api_key|password|secret|token)=[^\s&]{8,}/i],
  ['authorization_header', /\bauthorization["':=\s]+bearer\s+[a-z0-9._~+/-]{16,}={0,2}/i],
  ['cookie_header', /\b(?:cookie|set-cookie)["':=\s]+[^\r\n]{16,}/i],
];

export function analyzeRuntimeLogs(logText, secretValues = []) {
  if (typeof logText !== 'string') throw new TypeError('logText must be a string');
  const bytes = Buffer.byteLength(logText);
  const findings = [];
  if (bytes > LOG_BUDGET_BYTES) findings.push('log_budget_exceeded');

  const secrets = [...new Set(secretValues.filter(
    (value) => typeof value === 'string' && value.length >= 8,
  ))];
  if (secrets.some((secret) => logText.includes(secret))) findings.push('exact_secret_value');
  for (const [category, pattern] of leakPatterns) {
    if (pattern.test(logText)) findings.push(category);
  }

  return {
    bytes,
    lineCount: logText ? logText.split(/\r?\n/).length : 0,
    checkedSecretCount: secrets.length,
    findingCategories: [...new Set(findings)].sort(),
  };
}

export function createRuntimeLogEvidence(logText, secretValues = []) {
  const analysis = analyzeRuntimeLogs(logText, secretValues);
  return {
    schemaVersion: 'runtime-log-verification/1.0',
    status: analysis.findingCategories.length === 0 ? 'passed' : 'failed',
    logSha256: createHash('sha256').update(logText).digest('hex'),
    ...analysis,
  };
}
