import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..', '..');
const deploymentDirectory = path.join(repositoryRoot, 'deploy', 'model-services');
const digest = 'sha256:659eb236d509966380c0ac938049cbb3494f1e84c5d5c53fcac3572c05463487';
const vllmDigest = 'sha256:6d8429e38e3747723ca07ee1b17972e09bb9c51c4032b266f24fb1cc3b22ed8f';

const [compose, dockerfile, vllmDockerfile, adapter, contract, switcher] = await Promise.all([
  readFile(path.join(deploymentDirectory, 'compose.yaml'), 'utf8'),
  readFile(path.join(deploymentDirectory, 'paddle-ocr-adapter', 'Dockerfile'), 'utf8'),
  readFile(path.join(deploymentDirectory, 'vllm-runtime', 'Dockerfile'), 'utf8'),
  readFile(path.join(deploymentDirectory, 'paddle-ocr-adapter', 'app', 'main.py'), 'utf8'),
  readFile(path.join(deploymentDirectory, 'ocr-provider-contract.openapi.yaml'), 'utf8'),
  readFile(path.join(scriptDirectory, 'model-services.mjs'), 'utf8')
]);

assert(!/\blatest\b/i.test(`${compose}\n${dockerfile}`), 'Model images must not use mutable latest tags.');
assert(compose.includes(`@${digest}`) && dockerfile.includes(`@${digest}`), 'Paddle base image digest is not pinned consistently.');
assert(compose.includes(`@${vllmDigest}`) && vllmDockerfile.includes(`@${vllmDigest}`), 'vLLM base image digest is not pinned consistently.');
assert(!compose.includes('ipc: host'), 'Model containers must not share host IPC.');
assert(!compose.includes('--api-key'), 'Model secrets must not be passed through command-line arguments or logs.');
assert(!compose.includes('--task'), 'Removed vLLM --task arguments must not be used.');
assert(compose.includes('--runner') && compose.includes('pooling'), 'Embedding must use the pinned vLLM pooling runner.');
assert(compose.includes('VLLM_API_KEY: ${LOCAL_MODEL_API_KEY}'), 'vLLM environment authentication is missing.');
assert(compose.includes('--limit-mm-per-prompt') && compose.includes('"width":768'), 'VL image profiling must be bounded.');
assert(compose.includes('--mm-processor-cache-gb'), 'VL processor cache limit is missing.');
assert(compose.includes('--mm-processor-kwargs') && compose.includes('"max_pixels":589824'), 'VL processor pixel limit is missing.');
for (const token of [
  'user:', 'ipc: private', 'read_only: true', 'cap_drop:', '"ALL"',
  'no-new-privileges:true', 'pids_limit:', 'mem_limit:', 'cpus:'
]) assert(compose.includes(token), `Compose hardening token is missing: ${token}`);
assert(/\nUSER \$\{RUNTIME_UID\}:\$\{RUNTIME_GID\}/.test(dockerfile), 'Paddle adapter must run as a non-root user.');
assert(/\nUSER \$\{RUNTIME_UID\}:\$\{RUNTIME_GID\}/.test(vllmDockerfile), 'vLLM runtime must have a real non-root passwd identity.');
assert(adapter.includes('@app.get("/live")') && adapter.includes('@app.get("/ready")'), 'Paddle live/ready split is missing.');
assert(contract.includes('/live:') && contract.includes('/ready:') && contract.includes('bearerAuth'), 'OCR contract readiness auth is missing.');
for (const token of ['withModelSwitchLock', 'stopAndVerify(gpuServices)', 'restoring_text', 'waitForOpenAiModel']) {
  assert(switcher.includes(token), `Model transition safeguard is missing: ${token}`);
}

const composeValidation = spawnSync('docker', [
  'compose', '--env-file', '.env.example', '-f', 'compose.yaml', '--profile', 'vl', '--profile', 'embedding', 'config', '--quiet'
], { cwd: deploymentDirectory, encoding: 'utf8', windowsHide: true });
if (composeValidation.error?.code !== 'ENOENT' && composeValidation.status !== 0) {
  throw new Error(`Docker Compose configuration is invalid: ${composeValidation.stderr}`);
}

console.log('Model deployment configuration passed digest, auth, isolation, resource, and transition checks.');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
