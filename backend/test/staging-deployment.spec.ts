import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const repositoryRoot = resolve(__dirname, '../..');
const stagingRoot = join(repositoryRoot, 'deploy', 'staging');
const read = (...parts: string[]) => readFileSync(join(...parts), 'utf8');

describe('B8-09 staging deployment', () => {
  it('keeps stateful dependencies private and exposes only the TLS gateway', () => {
    const compose = read(stagingRoot, 'compose.yaml');
    const gateway = read(stagingRoot, 'gateway', 'nginx.conf');
    expect(compose).toContain('FILE_STORAGE_DRIVER: s3');
    expect(compose).toContain('S3_ENDPOINT: https://objects.finance-agent.local:9443');
    expect(compose).not.toContain('S3_ENDPOINT: https://objects.finance-agent.local:${STAGING_OBJECT_PORT');
    expect(compose).toContain('REQUEST_RATE_LIMIT_STORE: redis');
    expect(compose).toContain('FILE_SCAN_MODE: clamav');
    expect(compose).toContain('ssl=on');
    expect(compose).toContain('internal: true');
    expect(compose).toContain('http://127.0.0.1:9000/minio/health/live');
    expect(compose).not.toContain('["CMD", "mc", "ready", "local"]');
    expect(compose).toContain('user: "999:1000"');
    expect(compose).toContain('--collector.textfile.directory=/backup-metrics');
    expect(compose).toContain('--collector.textfile.directory=/tls-metrics');
    expect(compose).not.toContain(':/metrics/finance_agent_tls.prom:ro');
    expect(compose).toContain('127.0.0.1:${STAGING_WEB_PORT:-8443}:8443');
    expect(compose).toMatch(/gateway:\s[\s\S]*?user: "101:101"[\s\S]*?cap_drop: \[ALL\]/);
    expect(gateway).toContain('client_max_body_size 52m');
    for (const port of ['5432:5432', '6379:6379', '9000:9000', '3310:3310']) {
      expect(compose).not.toContain(port);
    }
    expect(compose).not.toMatch(/image:\s+[^\n]*:latest(?:\s|$)/i);
  });

  it('uses split non-root API and worker containers with secret-file injection', () => {
    const compose = read(stagingRoot, 'compose.yaml');
    const dockerfile = read(repositoryRoot, 'backend', 'Dockerfile');
    expect(compose).toContain('PROCESS_ROLE: api');
    expect(compose).toContain('PROCESS_ROLE: worker');
    expect(compose).toContain('DATABASE_URL_FILE: /run/secrets/runtime_database_url');
    expect(compose).toContain('cap_drop: [ALL]');
    expect(compose).toContain('read_only: true');
    expect(dockerfile).toContain('USER 10001:10001');
    expect(dockerfile).not.toMatch(/(?:JWT_SECRET|DATABASE_URL)=/);
  });

  it('builds the staging frontend in explicit API mode with CSP and browser smoke', () => {
    const compose = read(stagingRoot, 'compose.yaml');
    const dockerfile = read(repositoryRoot, 'Dockerfile.frontend');
    const frontendNginx = read(stagingRoot, 'frontend-nginx.conf');
    const browserSmoke = read(stagingRoot, 'scripts', 'browser-smoke.mjs');
    expect(compose).toContain('VITE_APP_DATA_MODE: api');
    expect(dockerfile).toContain('ARG VITE_APP_DATA_MODE');
    expect(dockerfile).toContain('test "$VITE_APP_DATA_MODE" = "api"');
    expect(dockerfile).toContain('npm ci --ignore-scripts');
    expect(frontendNginx).toContain('Content-Security-Policy');
    for (const directive of ['default-src', 'script-src', 'connect-src', 'img-src', 'object-src', 'base-uri', 'frame-ancestors']) {
      expect(frontendNginx).toContain(directive);
    }
    expect(browserSmoke).toContain("dataMode === 'api'");
    expect(browserSmoke).toContain("page.on('pageerror'");
    expect(browserSmoke).toContain("response.url().includes('/api/')");
  });

  it('keeps gateway access logs free of query strings and credentials', () => {
    const gateway = read(stagingRoot, 'gateway', 'nginx.conf');
    const accessFormat = gateway.match(/log_format\s+json_combined\s+escape=json\s+'\{'[\s\S]*?'\}';/)?.[0];
    expect(accessFormat).toBeDefined();
    expect(accessFormat).toContain('"method":"$request_method"');
    expect(accessFormat).toContain('"path":"$uri"');
    expect(accessFormat).toContain('"upstream_status":"$upstream_status"');
    expect(accessFormat).not.toMatch(/\$(?:request|request_uri|args)\b/);
    expect(accessFormat).not.toMatch(/\$(?:http_authorization|http_cookie)\b/);
    expect(gateway.match(/error_log \/dev\/null;/g)).toHaveLength(2);
  });

  it('makes audit and ledger mutation unavailable to the runtime database role', () => {
    const grants = read(repositoryRoot, 'backend', 'prisma', 'runtime-grants.sql');
    expect(grants).toContain('REVOKE UPDATE, DELETE, TRUNCATE ON TABLE audit_logs FROM finance_runtime');
    expect(grants).toContain('REVOKE UPDATE, DELETE, TRUNCATE ON TABLE ledger_events FROM finance_runtime');
    expect(grants).toContain('GRANT SELECT, INSERT ON TABLE audit_logs TO finance_runtime');
    expect(grants).toContain('GRANT SELECT, INSERT ON TABLE ledger_events TO finance_runtime');
  });

  it('requires explicit confirmation before destructive data restore', () => {
    const restore = read(stagingRoot, 'backup', 'restore-backup.sh');
    expect(restore).toContain('CONFIRM_DATABASE_RESTORE');
    expect(restore).toContain('ALLOW_STAGING_RESTORE');
    expect(restore).toContain('Backup checksum verification failed');
    expect(restore).toContain('--single-transaction');
    expect(restore).toContain('--exit-on-error');
    expect(restore).toContain('mc mirror --overwrite --remove');
    expect(restore.indexOf('CONFIRM_DATABASE_RESTORE')).toBeLessThan(restore.indexOf('pg_restore'));
  });

  it('rejects empty backups and keeps destructive restore drills in a test database', () => {
    const backup = read(stagingRoot, 'backup', 'run-backup.sh');
    const drill = read(stagingRoot, 'backup', 'restore-drill.sh');
    expect(backup).toContain('[[ ! -s "$logical_dir/database.dump" ]]');
    expect(backup).toContain('pg_restore --list');
    expect(drill).toContain('finance_agent_restore_drill_test');
    expect(drill).not.toMatch(/\bfinance_agent_restore_drill\b(?!_test)/);
    expect(drill).toContain('finance_agent_restore.prom');
  });

  it('associates rollback with the target release model route snapshot', () => {
    const release = read(stagingRoot, 'scripts', 'release.mjs');
    const rollback = read(stagingRoot, 'scripts', 'rollback.mjs');
    const postDeployExport = release.lastIndexOf('exportModelRoutes(runtimeEnv)');
    expect(release).toContain('previousModelRouteSnapshot');
    expect(postDeployExport).toBeGreaterThan(release.indexOf("run('node', ['scripts/smoke-test.mjs']"));
    expect(release.indexOf('modelRouteSnapshot: releaseRelativePath(modelRouteSnapshot)')).toBeGreaterThan(postDeployExport);
    expect(rollback).toContain('await restoreModelRoutes(manifest.modelRouteSnapshot');
    expect(rollback).toContain('assertInsideReleases');
  });

  it('provides central metrics, logs, traces, and backup freshness alerts', () => {
    const compose = read(stagingRoot, 'compose.yaml');
    const alerts = read(stagingRoot, 'monitoring', 'alerts.yml');
    for (const service of ['prometheus:', 'alertmanager:', 'loki:', 'promtail:', 'tempo:', 'grafana:']) {
      expect(compose).toContain(service);
    }
    expect(alerts).toContain('FinanceAgentWorkerHeartbeatMissing');
    expect(alerts).toContain('FinanceAgentTraceDrops');
    expect(alerts).toContain('FinanceAgentBackupStale');
    expect(alerts).toContain('FinanceAgentRestoreDrillStale');
    expect(alerts).toContain('FinanceAgentTlsCertificateExpiring');
    expect(alerts).toContain('absent(finance_agent_backup_last_success_timestamp_seconds)');
  });
});
