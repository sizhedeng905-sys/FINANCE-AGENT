import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const deniedPackages = new Set(['@scarf/scarf', 'fsevents']);

export function packageNameFromLockPath(lockPath) {
  const marker = 'node_modules/';
  const markerIndex = lockPath.lastIndexOf(marker);
  if (markerIndex < 0) throw new Error(`Unsupported lockfile package path: ${lockPath}`);

  const remainder = lockPath.slice(markerIndex + marker.length);
  const parts = remainder.split('/');
  if (parts[0].startsWith('@')) {
    if (!parts[1]) throw new Error(`Invalid scoped package path: ${lockPath}`);
    return `${parts[0]}/${parts[1]}`;
  }
  if (!parts[0]) throw new Error(`Invalid package path: ${lockPath}`);
  return parts[0];
}

export function collectInstallScriptPackages(lockfile) {
  if (!lockfile || typeof lockfile !== 'object' || !lockfile.packages || typeof lockfile.packages !== 'object') {
    throw new Error('Lockfile must contain a packages object');
  }

  const packages = new Map();
  for (const [lockPath, metadata] of Object.entries(lockfile.packages)) {
    if (!metadata?.hasInstallScript) continue;
    if (typeof metadata.version !== 'string' || metadata.version.length === 0) {
      throw new Error(`Install-script package has no version: ${lockPath}`);
    }
    const name = packageNameFromLockPath(lockPath);
    const identity = `${name}@${metadata.version}`;
    const current = packages.get(identity);
    packages.set(identity, {
      identity,
      name,
      version: metadata.version,
      optionalOnly: current ? current.optionalOnly && metadata.optional === true : metadata.optional === true
    });
  }
  return [...packages.values()].sort((left, right) => left.identity.localeCompare(right.identity));
}

export function validateInstallScriptPolicy({ packageJson, lockfile, workspaceName = 'workspace' }) {
  const policy = packageJson?.allowScripts;
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) {
    throw new Error(`${workspaceName}: package.json allowScripts policy is required`);
  }

  const installScriptPackages = collectInstallScriptPackages(lockfile);
  const identities = new Set(installScriptPackages.map(({ identity }) => identity));
  const names = new Set(installScriptPackages.map(({ name }) => name));
  const errors = [];

  for (const [key, decision] of Object.entries(policy)) {
    if (typeof decision !== 'boolean') {
      errors.push(`${key}: policy decision must be boolean`);
      continue;
    }
    if (decision) {
      if (!identities.has(key)) errors.push(`${key}: approvals must match an exact current package version`);
      continue;
    }
    if (!names.has(key) && !identities.has(key)) errors.push(`${key}: denied package is not present in the lockfile`);
  }

  for (const installPackage of installScriptPackages) {
    const exactDecision = policy[installPackage.identity];
    const packageDecision = policy[installPackage.name];
    if (packageDecision === false && exactDecision === true) {
      errors.push(`${installPackage.identity}: exact approval conflicts with package-wide denial`);
      continue;
    }
    if (deniedPackages.has(installPackage.name)) {
      if (packageDecision !== false && exactDecision !== false) {
        errors.push(`${installPackage.identity}: package must be explicitly denied`);
      }
      continue;
    }
    if (exactDecision !== true) {
      errors.push(`${installPackage.identity}: package requires an exact-version approval`);
    }
  }

  if (errors.length > 0) {
    throw new Error(`${workspaceName}: install-script policy failed\n${errors.map((error) => `- ${error}`).join('\n')}`);
  }

  return {
    workspaceName,
    installScriptPackageCount: installScriptPackages.length,
    approvedCount: installScriptPackages.filter(({ identity }) => policy[identity] === true).length,
    deniedCount: installScriptPackages.filter(({ identity, name }) => policy[identity] === false || policy[name] === false).length
  };
}

export function checkRepositoryInstallScriptPolicies(root = repositoryRoot) {
  const workspaces = [
    { name: 'frontend', directory: root },
    { name: 'backend', directory: resolve(root, 'backend') }
  ];
  return workspaces.map(({ name, directory }) => validateInstallScriptPolicy({
    packageJson: readJson(resolve(directory, 'package.json')),
    lockfile: readJson(resolve(directory, 'package-lock.json')),
    workspaceName: name
  }));
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function isDirectExecution() {
  return process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isDirectExecution()) {
  try {
    const summaries = checkRepositoryInstallScriptPolicies();
    for (const summary of summaries) {
      console.log(
        `${summary.workspaceName}: ${summary.installScriptPackageCount} install-script packages, `
        + `${summary.approvedCount} approved, ${summary.deniedCount} denied.`
      );
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
