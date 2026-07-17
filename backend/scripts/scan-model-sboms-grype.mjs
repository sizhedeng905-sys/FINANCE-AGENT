import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const grypeImage = 'anchore/grype@sha256:decd87500a90c1e4faa1706f77b0b2cbc1d2f9364e976f1898ce9037de09cc3a';
const databaseSha256 = '7c732b44c2b6ebdba03640355d182d5984bafa51978729d9241fbb5e45102940';
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..', '..');
const reportDirectory = path.join(repositoryRoot, 'deploy', 'model-services', '.model-security');
const databaseArchive = path.resolve(
  process.env.GRYPE_DB_ARCHIVE || path.join(reportDirectory, 'grype-v6.1.8.tar.zst')
);
const volume = process.env.GRYPE_DB_VOLUME || 'finance-agent-grype-db';
const targets = [
  ['paddle', 'finance-agent-paddle-ocr-adapter-1.0.0.spdx.json'],
  ['vllm', 'finance-agent-vllm-runtime-0.23.0.spdx.json']
];

assertFile(databaseArchive, 'Pinned Grype database archive');
const actualHash = await sha256(databaseArchive);
if (actualHash !== databaseSha256) {
  throw new Error(`Grype database checksum mismatch: expected ${databaseSha256}, received ${actualHash}.`);
}
for (const [, sbom] of targets) assertFile(path.join(reportDirectory, sbom), `Model SBOM ${sbom}`);

run('docker', [
  'run', '--rm', '-v', `${volume}:/.cache/grype`,
  '--mount', `type=bind,source=${databaseArchive},target=/tmp/grype-db.tar.zst,readonly`,
  grypeImage, 'db', 'import', '/tmp/grype-db.tar.zst'
]);

for (const [name, sbom] of targets) {
  const result = spawnSync('docker', [
    'run', '--rm', '-e', 'GRYPE_DB_AUTO_UPDATE=false', '-v', `${volume}:/.cache/grype`,
    '--mount', `type=bind,source=${reportDirectory},target=/reports`, grypeImage,
    `sbom:/reports/${sbom}`, '--only-fixed', '--fail-on', 'critical', '--output', 'sarif',
    '--file', `/reports/${name}-grype-fixed.sarif.json`, '--quiet'
  ], { stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status === 2) throw new Error(`Fixable critical vulnerabilities were found in the ${name} model image SBOM.`);
  if (result.status !== 0) throw new Error(`Grype failed to scan the ${name} model image SBOM (exit ${result.status}).`);
}

console.log('Pinned Grype database validated; Paddle and vLLM SBOMs contain no fixable critical vulnerabilities.');

function assertFile(filePath, label) {
  if (!existsSync(filePath)) throw new Error(`${label} is missing: ${filePath}`);
}

async function sha256(filePath) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

function run(command, arguments_) {
  const result = spawnSync(command, arguments_, { stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${arguments_.slice(0, 2).join(' ')} exited with ${result.status}.`);
}
