import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { dirname, basename, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptRoot = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptRoot, '../../..');
const arguments_ = process.argv.slice(2);
const sbomPath = resolve(requiredOption(arguments_, '--sbom'));
const outputPath = resolve(requiredOption(arguments_, '--output'));
const gatePath = resolve(requiredOption(arguments_, '--gate-output'));
if (!existsSync(sbomPath)) throw new Error(`SBOM does not exist: ${sbomPath}`);
if (dirname(sbomPath) !== dirname(outputPath) || dirname(sbomPath) !== dirname(gatePath)) {
  throw new Error('SBOM, scan output, and gate output must share one evidence directory');
}

const grypeImage = 'anchore/grype@sha256:decd87500a90c1e4faa1706f77b0b2cbc1d2f9364e976f1898ce9037de09cc3a';
const expectedDatabaseSha256 = '7c732b44c2b6ebdba03640355d182d5984bafa51978729d9241fbb5e45102940';
const defaultArchive = resolve(repositoryRoot, 'deploy/model-services/.model-security/grype-v6.1.8.tar.zst');
const databaseArchive = resolve(process.env.GRYPE_DB_ARCHIVE || defaultArchive);
const databaseVolume = process.env.GRYPE_DB_VOLUME || 'finance-agent-grype-db';
const allowNetwork = process.env.GRYPE_ALLOW_NETWORK_UPDATE === 'true';
let databaseSource;

if (existsSync(databaseArchive)) {
  const actual = await sha256File(databaseArchive);
  if (actual !== expectedDatabaseSha256) {
    throw new Error(`Pinned Grype database checksum mismatch: expected ${expectedDatabaseSha256}, received ${actual}`);
  }
  run('docker', [
    'run', '--rm', '-v', `${databaseVolume}:/.cache/grype`,
    '--mount', `type=bind,source=${databaseArchive},target=/tmp/grype-db.tar.zst,readonly`,
    grypeImage, 'db', 'import', '/tmp/grype-db.tar.zst'
  ]);
  databaseSource = { mode: 'pinned_archive', sha256: actual };
} else if (allowNetwork) {
  databaseSource = { mode: 'network_update', sha256: null };
} else {
  throw new Error('Pinned Grype database is missing and GRYPE_ALLOW_NETWORK_UPDATE is not true');
}

const evidenceDirectory = dirname(sbomPath);
const common = [
  'run', '--rm', '-e', `GRYPE_DB_AUTO_UPDATE=${allowNetwork && databaseSource.mode === 'network_update' ? 'true' : 'false'}`,
  '-v', `${databaseVolume}:/.cache/grype`,
  '--mount', `type=bind,source=${evidenceDirectory},target=/reports`,
  grypeImage,
  `sbom:/reports/${basename(sbomPath)}`
];
run('docker', [...common, '--output', 'sarif', '--file', `/reports/${basename(outputPath)}`, '--quiet']);
const gate = spawnSync('docker', [
  ...common, '--only-fixed', '--fail-on', 'critical', '--output', 'table',
  '--file', `/reports/${basename(gatePath)}`, '--quiet'
], { encoding: 'utf8', stdio: 'inherit', windowsHide: true, timeout: 600_000 });
if (gate.error) throw gate.error;
if (gate.status === 2) throw new Error('Fixable critical vulnerabilities were found by Grype');
if (gate.status !== 0) throw new Error(`Grype critical gate failed with exit ${gate.status}`);
process.stdout.write(JSON.stringify({
  status: 'passed',
  scannerImage: grypeImage,
  databaseSource,
  sbomPath,
  outputPath,
  gatePath
}, null, 2) + '\n');

function requiredOption(arguments_, name) {
  const index = arguments_.indexOf(name);
  const value = index >= 0 ? arguments_[index + 1] : null;
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`);
  return value;
}

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', stdio: 'inherit', windowsHide: true, timeout: 600_000 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.slice(0, 2).join(' ')} failed with exit ${result.status}`);
}

async function sha256File(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}
