import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const repositoryRoot = resolve(__dirname, '../..');
const stagingRoot = join(repositoryRoot, 'deploy', 'staging');
const read = (...parts: string[]) => readFileSync(join(...parts), 'utf8').replace(/\r\n/g, '\n');

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
    expect(compose).toContain('LOGIN_RATE_LIMIT_STORE: redis');
    expect(compose).toContain('UPLOAD_ADMISSION_STORE: redis');
    expect(compose).toContain('FILE_SCAN_MODE: clamav');
    expect(compose).toContain('ssl=on');
    expect(compose).toContain('listen_addresses=*');
    expect(compose).toContain('sslmode=verify-full');
    expect(compose).toContain('/run/secrets/migration_password');
    expect(compose).toContain('user=finance_migrator');
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

    const databaseRoles = read(stagingRoot, 'postgres', '01-init-roles.sh');
    expect(databaseRoles).toContain("sed -i -E '/^[[:space:]]*host[[:space:]]/d'");
    expect(databaseRoles).toContain('hostnossl all all all reject');
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
    expect(dockerfile).toContain('FROM node-base AS runtime');
    expect(dockerfile).toContain('OPENSSL_PACKAGE_VERSION=3.0.20-1~deb12u2');
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

  it('keeps every Nginx consumer on the same patched immutable image', () => {
    const digest = '97d490c12ba55b4946b01546d1c3ed324e8d41ab1c9fcb2a616aa470620e5b46';
    const image = `nginx:1.30.4-alpine3.24@sha256:${digest}`;
    const expectedReferences = [
      [read(repositoryRoot, 'Dockerfile.frontend'), `ARG NGINX_IMAGE=${image}`],
      [read(stagingRoot, '.env.example'), `NGINX_IMAGE=${image}`],
      [read(stagingRoot, 'compose.yaml'), image],
      [read(stagingRoot, 'scripts', 'test-image-integrity.mjs'), `FROM ${image}`],
      [read(repositoryRoot, 'backend', 'scripts', 'test-nginx-upload-boundary.mjs'), `nginx@sha256:${digest}`]
    ];

    for (const [source, expected] of expectedReferences) {
      expect(source).toContain(expected);
    }
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
    expect(rollback).toContain("'--user', '999:999'");
    expect(rollback).toContain("'MC_CONFIG_DIR=/tmp/backup-home/.mc'");
  });

  it('uses a versioned strong-hash manifest and isolated database/object restore drill', () => {
    const compose = read(stagingRoot, 'compose.yaml');
    const backup = read(stagingRoot, 'backup', 'run-backup.sh');
    const drill = read(stagingRoot, 'backup', 'restore-drill.sh');
    const minioInit = read(stagingRoot, 'minio', 'init.sh');
    const integrity = read(stagingRoot, 'backup', 'integrity-lib.sh');
    const dockerfile = read(stagingRoot, 'backup', 'Dockerfile');
    const roleProvisioning = read(stagingRoot, 'postgres', 'provision-restore-role.sh');
    const authorizationExample = JSON.parse(read(stagingRoot, 'backup', 'restore-authorization.example.json'));
    expect(backup).toContain('[[ ! -s "$logical_dir/database.dump" ]]');
    expect(backup).toContain('pg_restore --list');
    expect(integrity).toContain('backup-manifest/1.0');
    expect(backup).toContain('object-manifest.jsonl');
    expect(backup).toContain('database-object-refs.jsonl');
    expect(backup).toContain("backup_must_run_as_postgres_uid_999");
    expect(backup).toContain('flock -w 1200');
    expect(backup).toContain('BACKUP_REQUIRED_AFTER_EPOCH');
    expect(drill).toContain('restore_drill_must_run_as_postgres_uid_999');
    expect(compose).toContain('MC_CONFIG_DIR: /tmp/backup-home/.mc');
    expect(compose).toContain('/tmp:size=32m,mode=1770,uid=999,gid=999');
    expect(read(stagingRoot, 'scripts', 'verify-config.mjs')).toContain(
      'Backup client credentials must use the UID 999 private tmpfs home'
    );
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
    expect(minioInit).toContain('minio_init_policy_attach_failed');
    expect(minioInit).toContain('policy attach staging finance-agent-runtime --user "$runtime_user" >/dev/null 2>&1');
  });

  it('associates rollback with the target release model route snapshot', () => {
    const release = read(stagingRoot, 'scripts', 'release.mjs');
    const rollback = read(stagingRoot, 'scripts', 'rollback.mjs');
    const postDeployExport = release.lastIndexOf('exportModelRoutes(lockedEnv)');
    expect(release).toContain('previousModelRouteSnapshot');
    expect(postDeployExport).toBeGreaterThan(release.indexOf("run('node', ['scripts/smoke-test.mjs']"));
    expect(release.indexOf('modelRouteSnapshot: await fileReference(modelRouteSnapshot)')).toBeGreaterThan(postDeployExport);
    expect(rollback).toContain('await restoreModelRoutes(manifest.modelRouteSnapshot');
    expect(rollback).toContain('resolveInside');
  });

  it('locks release and rollback images to verified immutable identities', () => {
    const release = read(stagingRoot, 'scripts', 'release.mjs');
    const rollback = read(stagingRoot, 'scripts', 'rollback.mjs');
    const lockImages = read(stagingRoot, 'scripts', 'lock-images.mjs');
    const scanImages = read(stagingRoot, 'scripts', 'scan-image-lock.mjs');
    const generateSbom = read(stagingRoot, 'scripts', 'generate-sbom.mjs');
    const integrity = read(stagingRoot, 'scripts', 'image-integrity-lib.mjs');
    const postgresDockerfile = read(stagingRoot, 'postgres', 'Dockerfile');
    const backupDockerfile = read(stagingRoot, 'backup', 'Dockerfile');
    const minioDockerfile = read(stagingRoot, 'minio', 'Dockerfile');
    const prometheusDockerfile = read(stagingRoot, 'prometheus', 'Dockerfile');
    const alertmanagerDockerfile = read(stagingRoot, 'alertmanager', 'Dockerfile');
    const nodeExporterDockerfile = read(stagingRoot, 'node-exporter', 'Dockerfile');
    const alloyDockerfile = read(stagingRoot, 'alloy', 'Dockerfile');
    const tempoDockerfile = read(stagingRoot, 'tempo', 'Dockerfile');
    const alloyConfig = read(stagingRoot, 'monitoring', 'alloy.alloy');
    const compose = read(stagingRoot, 'compose.yaml');
    const environmentExample = read(stagingRoot, '.env.example');
    const workflow = read(repositoryRoot, '.github', 'workflows', 'ci.yml');
    const packageJson = read(repositoryRoot, 'package.json');
    expect(release.indexOf("'scripts/lock-images.mjs'")).toBeLessThan(
      release.indexOf("'up', '-d', '--no-build', '--pull', 'never'")
    );
    expect(release).toContain("'--scope', 'staging'");
    expect(release).toContain("const runtimePullServices = ['redis', 'clamav', 'gateway', 'grafana', 'loki']");
    expect(release).toContain("'--user', '999:999'");
    expect(release).toContain("'MC_CONFIG_DIR=/tmp/backup-home/.mc'");
    expect(release).toContain('BACKUP_REQUIRED_AFTER_EPOCH=');
    expect(release.lastIndexOf("'/opt/staging/run-backup.sh'")).toBeLessThan(
      release.indexOf("'/opt/staging/restore-drill.sh'")
    );
    expect(release).toContain("'pull', '--policy', 'missing', ...runtimePullServices");
    expect(release).not.toContain("'pull', '--ignore-buildable'");
    expect(lockImages).toContain("new Set(['staging', 'all'])");
    expect(release.indexOf('expectedSchema: RELEASE_PLAN_SCHEMA')).toBeLessThan(
      release.indexOf("'up', '-d', '--no-build', '--pull', 'never'")
    );
    expect(release).toContain("'build', '--provenance=mode=max'");
    expect(release).not.toContain("'--sbom=true'");
    expect(release).toContain("POSTGRES_IMAGE: `finance-agent/staging-postgres:${shortSha}`");
    expect(release).toContain("MINIO_IMAGE: `finance-agent/staging-minio:${shortSha}`");
    for (const service of ['minio', 'prometheus', 'alertmanager', 'node-exporter', 'alloy', 'tempo']) {
      expect(release).toContain(`'${service}'`);
    }
    expect(release).toContain('assertMigrationCompatibility');
    expect(release).toContain("run('node', ['scripts/verify-config.mjs'], runtimeEnv)");
    expect(release).toContain('assertConfigurationImageReferences');
    expect(release).toContain('verifyRunningImages');
    expect(rollback).toContain('assertReleaseBundle');
    expect(rollback).toContain('verifyImageLock(imageLock, { verifyRequestedReferences: true })');
    expect(rollback).toContain("'--no-build', '--pull', 'never'");
    expect(rollback).toContain("'--wait', '--wait-timeout', '1200'");
    expect(rollback).toContain('verifyRunningImages(imageLock, environment)');
    expect(rollback).toContain('assertMigrationCompatibility(manifest.migrations');
    expect(rollback).toContain('assertReleasePlanMatchesManifest');
    expect(rollback).toContain('assertCurrentConfiguration');
    expect(rollback).toContain("tempo: 'TEMPO_IMAGE'");
    expect(lockImages).toContain("'model-services'");
    expect(lockImages).toContain("'backup', 'postgres'");
    expect(lockImages).toContain('signed_registry');
    expect(scanImages).toContain('const imageEntries = lock.entries');
    expect(scanImages).toContain("sbomSource: 'syft_spdx_sealed'");
    expect(scanImages).toContain("'generate-sbom.mjs'");
    expect(generateSbom).toContain("PINNED_SYFT_VERSION = '1.44.0'");
    expect(generateSbom).toContain("SYFT_CHECK_FOR_APP_UPDATE: 'false'");
    expect(generateSbom).toContain('validateSpdxDocument(document)');
    expect(integrity).toContain('Mutable image tag drift detected');
    expect(integrity).toContain('Database migration set is not exactly compatible');
    expect(read(stagingRoot, 'scripts', 'verify-config.mjs')).toContain(
      'must use an immutable sha256 image reference'
    );
    expect(read(stagingRoot, 'scripts', 'verify-config.mjs')).toContain(
      'must use the repository-built'
    );
    expect(packageJson).toContain('staging:image-integrity:test');
    expect(workflow).toContain('SYFT_VERSION: 1.44.0');
    expect(workflow).toContain('0e91737aee2b5baf1d255b959630194a302335d848ff97bb07921eb6205b5f5a');
    expect(workflow).toContain('generate-sbom.mjs');
    expect(workflow).not.toContain('docker/scout-action');
    expect(workflow).toContain('r5-image-identity-evidence');
    expect(compose).toContain('image: ${POSTGRES_IMAGE:-finance-agent/staging-postgres:b8-09}');
    expect(compose).toContain('image: ${MINIO_IMAGE:-finance-agent/staging-minio:b8-09}');
    expect(compose).toContain('image: ${PROMETHEUS_IMAGE:-finance-agent/staging-prometheus:b8-09}');
    expect(compose).toContain('image: ${ALERTMANAGER_IMAGE:-finance-agent/staging-alertmanager:b8-09}');
    expect(compose).toContain('image: ${NODE_EXPORTER_IMAGE:-finance-agent/staging-node-exporter:b8-09}');
    expect(compose).toContain('image: ${ALLOY_IMAGE:-finance-agent/staging-alloy:b8-09}');
    expect(compose).toContain('image: ${TEMPO_IMAGE:-finance-agent/staging-tempo:b8-09}');
    expect(compose).not.toContain('grafana/promtail');
    for (const variable of [
      'NODE_IMAGE',
      'NGINX_IMAGE',
      'REDIS_IMAGE',
      'CLAMAV_IMAGE',
      'GRAFANA_IMAGE',
      'LOKI_IMAGE'
    ]) {
      expect(environmentExample).toMatch(new RegExp(`^${variable}=\\S+@sha256:[a-f0-9]{64}$`, 'm'));
    }
    expect(read(repositoryRoot, 'backend', 'Dockerfile')).toMatch(
      /^ARG NODE_IMAGE=\S+@sha256:[a-f0-9]{64}$/m
    );
    expect(read(repositoryRoot, 'Dockerfile.frontend')).toMatch(
      /^ARG NGINX_IMAGE=\S+@sha256:[a-f0-9]{64}$/m
    );
    expect(postgresDockerfile).toContain('FROM ${DEBIAN_IMAGE}');
    expect(postgresDockerfile).not.toContain('FROM ${POSTGRES_SOURCE_IMAGE}');
    expect(postgresDockerfile).toContain('POSTGRES_ENTRYPOINT_COMMIT=62a714f93cc32220de46fd12235c9d509e3b1ad6');
    expect(postgresDockerfile).toContain('ADD --checksum=sha256:${POSTGRES_ENTRYPOINT_SHA256}');
    expect(postgresDockerfile).toContain('exec runuser -u postgres --preserve-environment');
    expect(postgresDockerfile).not.toContain('COPY --from=postgres-package-source /usr/local/bin/gosu');
    expect(backupDockerfile).toContain('github.com/prometheus/prometheus@v0.311.3');
    expect(backupDockerfile).toContain('golang.org/x/net@v0.55.0');
    expect(minioDockerfile).toContain('MINIO_SOURCE_COMMIT=7aac2a2c5b7c882e68c1ce017d8256be2feea27f');
    expect(minioDockerfile).toContain('google.golang.org/grpc@v1.79.3');
    expect(minioDockerfile).toContain('production-approval="pending-h13"');
    expect(prometheusDockerfile).toContain('PROMETHEUS_SOURCE_COMMIT=9f27dffc1f93ca23287972f632025879f2d1c658');
    expect(prometheusDockerfile).toContain('builtinassets');
    expect(alertmanagerDockerfile).toContain('ALERTMANAGER_SOURCE_COMMIT=8768aa6f65f1a888b5aa5fbf877cf20ad45d1f61');
    expect(alertmanagerDockerfile).toContain('ALERTMANAGER_UI_SHA256=fca5b665281e603c055d812ac0359b027772c5e30c9a8cd0ca1367aac698cfa6');
    expect(nodeExporterDockerfile).toContain('NODE_EXPORTER_SOURCE_COMMIT=0dd664dece3f8319f6bec5a221acd2c7ad13a23d');
    expect(alloyDockerfile).toContain('ALLOY_SOURCE_COMMIT=89d82370454dcee7b07d719ba632810e207a6de9');
    expect(alloyDockerfile).toContain('golang.org/x/crypto@v0.52.0');
    expect(alloyDockerfile).toContain('golang.org/x/net@v0.55.0');
    expect(alloyConfig).toContain('/var/lib/docker/containers/*/*-json.log');
    expect(alloyConfig).toContain('stage.structured_metadata');
    expect(tempoDockerfile).toContain('TEMPO_SOURCE_COMMIT=991ce39eb956e9ed771fcffe05eff42d33de27ba');
    expect(compose).toContain('command: ["--config.file=/etc/tempo/tempo.yml"]');
    for (const dockerfile of [
      read(repositoryRoot, 'backend', 'Dockerfile'),
      read(repositoryRoot, 'Dockerfile.frontend'),
      backupDockerfile,
      postgresDockerfile,
      minioDockerfile,
      prometheusDockerfile,
      alertmanagerDockerfile,
      nodeExporterDockerfile,
      alloyDockerfile,
      tempoDockerfile
    ]) {
      expect(dockerfile).toContain('org.opencontainers.image.revision=${BUILD_GIT_SHA}');
    }
  });

  it('provides central metrics, logs, traces, and backup freshness alerts', () => {
    const compose = read(stagingRoot, 'compose.yaml');
    const alerts = read(stagingRoot, 'monitoring', 'alerts.yml');
    const prometheus = read(stagingRoot, 'monitoring', 'prometheus.yml');
    for (const service of ['prometheus:', 'alertmanager:', 'loki:', 'alloy:', 'tempo:', 'grafana:']) {
      expect(compose).toContain(service);
    }
    expect(compose).not.toContain('/var/run/docker.sock');
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
