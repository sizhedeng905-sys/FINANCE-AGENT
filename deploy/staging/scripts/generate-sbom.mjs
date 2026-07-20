import { chmod, lstat, mkdir, readFile, realpath, rename, rm, stat } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const PINNED_SYFT_VERSION = '1.44.0';
const MAX_SBOM_BYTES = 512 * 1024 * 1024;
const scriptRoot = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptRoot, '../../..');

export function normalizeSource(rawSource, root = repositoryRoot) {
  if (typeof rawSource !== 'string' || rawSource.length === 0 || rawSource.length > 512) {
    throw new Error('SBOM source must be a non-empty value no longer than 512 characters');
  }
  if (/\p{C}|\s/u.test(rawSource)) throw new Error('SBOM source must not contain whitespace or control characters');

  if (rawSource.startsWith('docker:')) {
    const reference = rawSource.slice('docker:'.length);
    if (!reference || !/^[a-zA-Z0-9][a-zA-Z0-9._/@:+-]*$/.test(reference)) {
      throw new Error('Docker SBOM source contains an invalid image reference');
    }
    return `docker:${reference}`;
  }

  if (rawSource.startsWith('dir:')) {
    const requestedPath = rawSource.slice('dir:'.length);
    if (!requestedPath) throw new Error('Directory SBOM source requires a path');
    const sourcePath = resolve(root, requestedPath);
    assertInside(root, sourcePath, 'Directory SBOM source');
    return `dir:${sourcePath}`;
  }

  throw new Error('SBOM source must use the docker: or dir: scheme');
}

export function resolveOutputPath(rawPath, root = repositoryRoot) {
  if (typeof rawPath !== 'string' || !rawPath.endsWith('.spdx.json')) {
    throw new Error('SBOM output must end with .spdx.json');
  }
  const outputPath = resolve(root, rawPath);
  assertInside(root, outputPath, 'SBOM output');
  return outputPath;
}

export function parseSyftVersion(output) {
  const match = String(output).match(/(?:^|\r?\n)\s*Version:\s*v?([0-9]+\.[0-9]+\.[0-9]+)\s*(?:\r?\n|$)/i);
  if (!match) throw new Error('Unable to parse the Syft version output');
  return match[1];
}

export function resolveExpectedSyftVersion(configuredVersion) {
  if (configuredVersion !== undefined && configuredVersion !== PINNED_SYFT_VERSION) {
    throw new Error(`SYFT_EXPECTED_VERSION must remain pinned to ${PINNED_SYFT_VERSION}`);
  }
  return PINNED_SYFT_VERSION;
}

export function validateSpdxDocument(document) {
  if (!isPlainObject(document)
    || !/^SPDX-2\.[0-9]+$/.test(String(document.spdxVersion ?? ''))
    || document.SPDXID !== 'SPDXRef-DOCUMENT'
    || typeof document.documentNamespace !== 'string'
    || document.documentNamespace.length === 0
    || !isPlainObject(document.creationInfo)
    || !Array.isArray(document.creationInfo.creators)
    || document.creationInfo.creators.length === 0
    || !Array.isArray(document.packages)) {
    throw new Error('Syft output is not a valid SPDX JSON document');
  }
  return document;
}

export async function canonicalizeDirectorySource(source, root = repositoryRoot) {
  if (!source.startsWith('dir:')) return source;
  const canonicalRoot = await realpath(root);
  const canonicalSource = await realpath(source.slice('dir:'.length));
  assertInside(canonicalRoot, canonicalSource, 'Directory SBOM source');
  if (!(await stat(canonicalSource)).isDirectory()) {
    throw new Error('Directory SBOM source must resolve to a directory');
  }
  return `dir:${canonicalSource}`;
}

export async function ensureOutputDirectory(outputPath, root = repositoryRoot) {
  const resolvedRoot = resolve(root);
  const outputDirectory = dirname(outputPath);
  assertAtOrInside(resolvedRoot, outputDirectory, 'SBOM output directory');
  const pathFromRoot = relative(resolvedRoot, outputDirectory);
  let current = resolvedRoot;
  for (const part of pathFromRoot ? pathFromRoot.split(sep) : []) {
    current = join(current, part);
    try {
      const information = await lstat(current);
      if (information.isSymbolicLink()) throw new Error('SBOM output directory must not contain symbolic links');
      if (!information.isDirectory()) throw new Error('SBOM output parent must be a directory');
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      await mkdir(current, { mode: 0o700 });
    }
  }
  const canonicalRoot = await realpath(resolvedRoot);
  const canonicalOutputDirectory = await realpath(outputDirectory);
  assertAtOrInside(canonicalRoot, canonicalOutputDirectory, 'SBOM output directory');
}

async function main() {
  const arguments_ = process.argv.slice(2);
  const source = await canonicalizeDirectorySource(normalizeSource(requiredOption(arguments_, '--source')));
  const outputPath = resolveOutputPath(requiredOption(arguments_, '--output'));
  const syftBinary = process.env.SYFT_BIN || 'syft';
  if (!syftBinary || /[\0\r\n]/.test(syftBinary)) throw new Error('SYFT_BIN is invalid');

  const expectedVersion = resolveExpectedSyftVersion(process.env.SYFT_EXPECTED_VERSION);
  const versionOutput = capture(syftBinary, ['version']);
  const actualVersion = parseSyftVersion(versionOutput);
  if (actualVersion !== expectedVersion) {
    throw new Error(`Syft version mismatch: expected ${expectedVersion}, received ${actualVersion}`);
  }

  await ensureOutputDirectory(outputPath);
  const partialPath = resolve(dirname(outputPath), `.${basename(outputPath)}.partial-${process.pid}`);
  await rm(partialPath, { force: true });
  try {
    run(syftBinary, ['scan', source, '--output', `spdx-json=${partialPath}`]);
    const information = await stat(partialPath);
    if (information.size <= 0 || information.size > MAX_SBOM_BYTES) {
      throw new Error(`Syft output size is outside the accepted range: ${information.size} bytes`);
    }
    const document = JSON.parse(await readFile(partialPath, 'utf8'));
    validateSpdxDocument(document);
    await chmod(partialPath, 0o600);
    await rm(outputPath, { force: true });
    await rename(partialPath, outputPath);
    process.stdout.write(JSON.stringify({
      status: 'passed',
      scanner: 'syft',
      scannerVersion: actualVersion,
      source,
      outputPath,
      bytes: information.size,
      packageCount: document.packages.length
    }, null, 2) + '\n');
  } finally {
    await rm(partialPath, { force: true });
  }
}

function requiredOption(arguments_, name) {
  const index = arguments_.indexOf(name);
  const value = index >= 0 ? arguments_[index + 1] : null;
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`);
  return value;
}

function assertInside(root, target, label) {
  const pathFromRoot = relative(resolve(root), resolve(target));
  if (!pathFromRoot || pathFromRoot === '..' || pathFromRoot.startsWith(`..${sep}`) || isAbsolute(pathFromRoot)) {
    throw new Error(`${label} must resolve to a file or directory inside the repository`);
  }
}

function assertAtOrInside(root, target, label) {
  const pathFromRoot = relative(resolve(root), resolve(target));
  if (pathFromRoot === '..' || pathFromRoot.startsWith(`..${sep}`) || isAbsolute(pathFromRoot)) {
    throw new Error(`${label} must remain inside the repository`);
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function run(command, args) {
  const result = spawnSync(command, args, {
    env: { ...process.env, SYFT_CHECK_FOR_APP_UPDATE: 'false' },
    encoding: 'utf8',
    stdio: 'inherit',
    windowsHide: true,
    timeout: 1_800_000
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Syft SBOM generation failed with exit ${result.status}`);
}

function capture(command, args) {
  const result = spawnSync(command, args, {
    env: { ...process.env, SYFT_CHECK_FOR_APP_UPDATE: 'false' },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    timeout: 60_000
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Syft version check failed: ${String(result.stderr).trim()}`);
  return result.stdout;
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
