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
    expect(compose).toContain('REQUEST_RATE_LIMIT_STORE: redis');
    expect(compose).toContain('FILE_SCAN_MODE: clamav');
    expect(compose).toContain('ssl=on');
    expect(compose).toContain('internal: true');
    expect(compose).toContain('http://127.0.0.1:9000/minio/health/live');
    expect(compose).not.toContain('["CMD", "mc", "ready", "local"]');
    expect(compose).toContain('127.0.0.1:${STAGING_WEB_PORT:-8443}:8443');
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
