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
    expect(compose).toContain('S3_LOGICAL_QUOTA_BYTES: "1099511627776"');
    expect(compose).not.toContain('S3_CAPACITY_BYTES:');
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
    expect(gateway).toContain('location ^~ /minio/metrics/');
    expect(gateway).toContain('location ^~ /minio/v2/metrics/');
  });

  it('makes audit and ledger mutation unavailable to the runtime database role', () => {
    const grants = read(repositoryRoot, 'backend', 'prisma', 'runtime-grants.sql');
    expect(grants).toContain('REVOKE UPDATE, DELETE, TRUNCATE ON TABLE audit_logs FROM finance_runtime');
    expect(grants).toContain('REVOKE UPDATE, DELETE, TRUNCATE ON TABLE ledger_events FROM finance_runtime');
    expect(grants).toContain('GRANT SELECT, INSERT ON TABLE audit_logs TO finance_runtime');
    expect(grants).toContain('GRANT SELECT, INSERT ON TABLE ledger_events TO finance_runtime');
  });

  it('requires isolated verification and one-time H13/H14 authorization before data restore', () => {
    const restore = read(stagingRoot, 'backup', 'restore-backup.sh');
    const rollback = read(stagingRoot, 'scripts', 'rollback.mjs');
    expect(restore).toContain('CONFIRM_DATABASE_RESTORE');
    expect(restore).toContain('ALLOW_STAGING_RESTORE');
    expect(restore).toContain('RESTORE_AUTHORIZATION_FILE');
    expect(restore).toContain('h13Approved');
    expect(restore).toContain('h14Approved');
    expect(restore).toContain('CONFIRM_APPLICATION_QUIESCED');
    expect(restore).toContain('assert_authorization_unused');
    expect(restore).toContain('verify_backup_bundle');
    expect(restore).toContain('restore_stage_database');
    expect(restore).toContain('restore_stage_bucket');
    expect(restore).toContain('create_compensation_snapshot');
    expect(restore).toContain('--single-transaction');
    expect(restore).toContain('--exit-on-error');
    expect(restore).toContain('mc mirror --overwrite --remove');
    expect(restore.lastIndexOf('verify_backup_bundle "$backup_dir" "staging/$stage_bucket"')).toBeLessThan(
      restore.lastIndexOf('\nrestore_live_database\n')
    );
    expect(rollback).toContain('RESTORE_AUTHORIZATION_FILE');
  });

  it('uses a versioned strong-hash manifest and isolated database/object restore drill', () => {
    const backup = read(stagingRoot, 'backup', 'run-backup.sh');
    const drill = read(stagingRoot, 'backup', 'restore-drill.sh');
    const integrity = read(stagingRoot, 'backup', 'integrity-lib.sh');
    const dockerfile = read(stagingRoot, 'backup', 'Dockerfile');
    const roleProvisioning = read(stagingRoot, 'postgres', 'provision-restore-role.sh');
    const authorizationExample = JSON.parse(read(stagingRoot, 'backup', 'restore-authorization.example.json'));
    expect(backup).toContain('[[ ! -s "$logical_dir/database.dump" ]]');
    expect(backup).toContain('pg_restore --list');
    expect(integrity).toContain('backup-manifest/1.0');
    expect(backup).toContain('object-manifest.jsonl');
    expect(backup).toContain('database-object-refs.jsonl');
    expect(backup).toContain('manifest.sha256');
    expect(backup).not.toContain('mc find');
    expect(integrity).toContain('generate_object_manifest');
    expect(integrity).toContain('mc cat');
    expect(integrity).toContain('verify_object_manifest');
    expect(integrity).toContain('verify_database_object_refs');
    expect(integrity).toContain('legacy_manifest_unverified_content');
    expect(dockerfile).toContain('jq');
    expect(roleProvisioning).toContain('finance_restore');
    expect(roleProvisioning).toContain('NOSUPERUSER CREATEDB NOCREATEROLE NOINHERIT');
    expect(roleProvisioning).not.toMatch(/\sSUPERUSER\s/);
    expect(authorizationExample).toMatchObject({
      schemaVersion: 'restore-authorization/1.0',
      h13Approved: false,
      h14Approved: false
    });
    expect(read(repositoryRoot, 'package.json')).toContain('staging:backup-integrity:test');
    expect(drill).toContain('finance_agent_restore_drill_');
    expect(drill).toContain('finance-agent-restore-drill-');
    expect(drill).toContain('verify_backup_bundle');
    expect(drill).toContain('applicationReadSmoke');
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
    const prometheus = read(stagingRoot, 'monitoring', 'prometheus.yml');
    for (const service of ['prometheus:', 'alertmanager:', 'loki:', 'promtail:', 'tempo:', 'grafana:']) {
      expect(compose).toContain(service);
    }
    expect(alerts).toContain('FinanceAgentWorkerHeartbeatMissing');
    expect(alerts).toContain('FinanceAgentTraceDrops');
    expect(alerts).toContain('FinanceAgentBackupStale');
    expect(alerts).toContain('FinanceAgentRestoreDrillStale');
    expect(alerts).toContain('FinanceAgentTlsCertificateExpiring');
    expect(alerts).toContain('FinanceAgentLogicalStorageHigh');
    expect(alerts).toContain('FinanceAgentMinioCapacityMetricsMissing');
    expect(alerts).toContain('FinanceAgentMinioPhysicalStorageLow');
    expect(alerts).toContain('FinanceAgentBackupStrongHashCoverageMissing');
    expect(alerts).toContain('FinanceAgentRestoreDrillStrongHashCoverageMissing');
    expect(prometheus).toContain('/minio/metrics/v3/cluster/health');
    expect(alerts).toContain('absent(finance_agent_backup_last_success_timestamp_seconds)');
  });

  it('provisions an evidence-based storage capacity dashboard', () => {
    const dashboard = JSON.parse(read(
      stagingRoot,
      'monitoring',
      'grafana',
      'provisioning',
      'dashboards',
      'json',
      'storage-capacity.json'
    ));
    const serialized = JSON.stringify(dashboard);
    expect(dashboard.uid).toBe('finance-agent-storage-capacity');
    expect(serialized).toContain('finance_agent_storage_capacity_bytes');
    expect(serialized).toContain('minio_cluster_health_capacity_usable_free_bytes');
    expect(serialized).toContain('finance_agent_storage_probe_healthy');
  });
});
