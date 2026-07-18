export const STAGING_MANAGED_DEFAULT_KEYS = Object.freeze([
  'BACKEND_IMAGE',
  'FRONTEND_IMAGE',
  'BACKUP_IMAGE',
  'POSTGRES_IMAGE',
  'DEBIAN_IMAGE',
  'POSTGRES_PACKAGE_VERSION',
  'POSTGRES_COMMON_VERSION',
  'LIBPQ_PACKAGE_VERSION',
  'POSTGRES_ENTRYPOINT_SHA256',
  'NODE_IMAGE',
  'NGINX_IMAGE',
  'REDIS_IMAGE',
  'CLAMAV_IMAGE',
  'MINIO_IMAGE',
  'PROMETHEUS_IMAGE',
  'ALERTMANAGER_IMAGE',
  'NODE_EXPORTER_IMAGE',
  'GRAFANA_IMAGE',
  'LOKI_IMAGE',
  'ALLOY_IMAGE',
  'TEMPO_IMAGE',
]);

export function synchronizeManagedEnvironment(existingSource, templateSource, managedKeys = STAGING_MANAGED_DEFAULT_KEYS) {
  const existing = parseEnvironment(existingSource, 'existing environment');
  const template = parseEnvironment(templateSource, 'environment template');
  const managed = new Set(managedKeys);
  const updatedKeys = [];

  for (const key of managed) {
    if (!template.values.has(key)) throw new Error(`Managed environment key is missing from the template: ${key}`);
  }

  const lines = existing.lines.map((line) => {
    const key = environmentKey(line);
    if (!key || !managed.has(key)) return line;
    const replacement = `${key}=${template.values.get(key)}`;
    if (line !== replacement) updatedKeys.push(key);
    return replacement;
  });

  const missingKeys = [...managed].filter((key) => !existing.values.has(key));
  if (missingKeys.length > 0 && lines.at(-1) !== '') lines.push('');
  for (const key of missingKeys) {
    lines.push(`${key}=${template.values.get(key)}`);
    updatedKeys.push(key);
  }

  while (lines.length > 1 && lines.at(-1) === '' && lines.at(-2) === '') lines.pop();
  return {
    content: `${lines.join('\n').replace(/\n+$/, '')}\n`,
    updatedKeys: [...new Set(updatedKeys)].sort(),
  };
}

function parseEnvironment(source, label) {
  if (typeof source !== 'string') throw new TypeError(`${label} must be a string`);
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const values = new Map();
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const key = environmentKey(line);
    if (!key) throw new Error(`Invalid ${label} line`);
    if (values.has(key)) throw new Error(`Duplicate ${label} key: ${key}`);
    values.set(key, line.slice(line.indexOf('=') + 1));
  }
  return { lines, values };
}

function environmentKey(line) {
  const separator = line.indexOf('=');
  if (separator < 1) return null;
  const key = line.slice(0, separator).trim();
  return /^[A-Z][A-Z0-9_]*$/.test(key) ? key : null;
}
