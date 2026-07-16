export function inspectSensitiveText(text, options = {}) {
  const findings = new Set();
  const synthetic = options.syntheticDlpValues ?? new Set();
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text)) findings.add('private-key-material');

  for (const match of text.matchAll(/(?<!\d)1[3-9]\d{9}(?!\d)/g)) {
    if (!synthetic.has(match[0])) findings.add('mainland-phone-number');
  }
  for (const match of text.matchAll(/(?<![0-9A-Za-z])\d{17}[0-9Xx](?![0-9A-Za-z])/g)) {
    if (!synthetic.has(match[0]) && isValidMainlandId(match[0])) findings.add('mainland-id-number');
  }
  for (const match of text.matchAll(/(?<!\d)(?:\d[ -]?){16,19}(?!\d)/g)) {
    const digits = match[0].replace(/\D/g, '');
    if (!synthetic.has(digits) && luhnValid(digits)) findings.add('bank-card-or-account-number');
  }
  for (const term of options.internalTerms ?? []) {
    if (term.length >= 3 && text.includes(term)) findings.add('internal-customer-dictionary-match');
  }

  const secretPattern = /(?:api[_-]?key|access[_-]?token|client[_-]?secret|password|jwt[_-]?secret)\s*["']?\s*[:=]\s*["']([A-Za-z0-9+/_=-]{24,})["']/gi;
  for (const match of text.matchAll(secretPattern)) {
    const candidate = match[1];
    if (!isSyntheticSecret(candidate) && shannonEntropy(candidate) >= 3.5) findings.add('high-entropy-secret-assignment');
  }
  return [...findings].sort();
}

function isValidMainlandId(value) {
  const weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
  const checks = ['1', '0', 'X', '9', '8', '7', '6', '5', '4', '3', '2'];
  const year = Number(value.slice(6, 10));
  const month = Number(value.slice(10, 12));
  const day = Number(value.slice(12, 14));
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return false;
  const sum = weights.reduce((total, weight, index) => total + Number(value[index]) * weight, 0);
  return checks[sum % 11] === value[17].toUpperCase();
}

function luhnValid(value) {
  if (value.length < 16 || value.length > 19 || /^(\d)\1+$/.test(value)) return false;
  let sum = 0;
  let double = false;
  for (let index = value.length - 1; index >= 0; index -= 1) {
    let digit = Number(value[index]);
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
}

function shannonEntropy(value) {
  const counts = new Map();
  for (const character of value) counts.set(character, (counts.get(character) ?? 0) + 1);
  return [...counts.values()].reduce((entropy, count) => {
    const probability = count / value.length;
    return entropy - probability * Math.log2(probability);
  }, 0);
}

function isSyntheticSecret(value) {
  return /replace|change|placeholder|example|dummy|mock|synthetic|test|ci-only|development/i.test(value);
}
