import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..', '..');
const outputDirectory = path.join(repositoryRoot, 'deploy', 'model-services', '.model-security');
const arguments_ = process.argv.slice(2);
const sbomOnly = arguments_.includes('--sbom-only');
const cveOnly = arguments_.includes('--cve-only');
if (sbomOnly && cveOnly) throw new Error('--sbom-only and --cve-only are mutually exclusive.');
const requestedImages = arguments_.filter((argument) => !argument.startsWith('--'));
const images = requestedImages.length > 0
  ? requestedImages
  : ['finance-agent/paddle-ocr-adapter:1.0.0', 'finance-agent/vllm-runtime:0.23.0'];

await mkdir(outputDirectory, { recursive: true });
for (const image of images) assertLocalImage(image);

if (!cveOnly) {
  for (const image of images) {
    run('docker', [
      'scout', 'sbom', '--format', 'spdx', '--output',
      path.join(outputDirectory, `${reportStem(image)}.spdx.json`), `local://${image}`
    ]);
  }
}

if (sbomOnly) {
  console.log(`SBOM reports generated for ${images.length} model image(s) in ${outputDirectory}.`);
} else {
  for (const image of images) await scanVulnerabilities(image);
  console.log(`SBOM and CVE reports generated for ${images.length} model image(s); no fixable critical CVEs were found.`);
}

function assertLocalImage(image) {
  const inspect = spawnSync('docker', ['image', 'inspect', image], { stdio: 'ignore', windowsHide: true });
  if (inspect.error) throw inspect.error;
  if (inspect.status !== 0) throw new Error(`Model image is not available locally: ${image}`);
}

async function scanVulnerabilities(image) {
  const stem = reportStem(image);
  run('docker', [
    'scout', 'cves', '--only-severity', 'critical,high', '--format', 'sarif',
    '--output', path.join(outputDirectory, `${stem}.cves.sarif.json`), `local://${image}`
  ]);
  const criticalGate = spawnSync('docker', [
    'scout', 'cves', '--only-severity', 'critical', '--only-fixed', '--exit-code', `local://${image}`
  ], { encoding: 'utf8', windowsHide: true });
  const evidencePath = path.join(outputDirectory, `${stem}.critical-fixed.txt`);
  await writeFile(evidencePath, `${criticalGate.stdout || ''}${criticalGate.stderr || ''}`, 'utf8');
  if (![0, 2].includes(criticalGate.status ?? -1)) {
    throw new Error(`Docker Scout critical gate failed to run for ${image} (exit ${criticalGate.status}).`);
  }
  if (criticalGate.status === 2) {
    throw new Error(`Fixable critical vulnerabilities were found in ${image}. Review ${evidencePath}.`);
  }
}

function reportStem(image) {
  return image.toLowerCase().replace(/[^a-z0-9.-]+/g, '-').replace(/^-+|-+$/g, '');
}

function run(command, arguments_) {
  const result = spawnSync(command, arguments_, { stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${arguments_.slice(0, 2).join(' ')} exited with ${result.status}.`);
}
