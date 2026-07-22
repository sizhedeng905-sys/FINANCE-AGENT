import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..', '..');

function listTrackedMarkdownFiles() {
  const output = execFileSync(
    'git',
    ['-c', 'core.quotePath=false', 'ls-files', '--cached', '*.md'],
    { cwd: repositoryRoot, encoding: 'utf8' },
  );

  return output
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function extractDestination(rawDestination) {
  const trimmed = rawDestination.trim();
  if (trimmed.startsWith('<')) {
    const closeIndex = trimmed.indexOf('>');
    return closeIndex > 0 ? trimmed.slice(1, closeIndex) : null;
  }

  return trimmed.match(/^(\S+)/)?.[1] ?? null;
}

function stripQueryAndFragment(destination) {
  const queryIndex = destination.indexOf('?');
  const fragmentIndex = destination.indexOf('#');
  const suffixIndex = queryIndex < 0
    ? fragmentIndex
    : fragmentIndex < 0
      ? queryIndex
      : Math.min(queryIndex, fragmentIndex);

  return suffixIndex < 0 ? destination : destination.slice(0, suffixIndex);
}

function isExternalDestination(destination) {
  return /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(destination)
    || /^[A-Za-z]:[\\/]/.test(destination);
}

function resolveLocalDestination(sourceFile, destination) {
  const pathOnly = stripQueryAndFragment(destination);
  if (!pathOnly) return null;

  let decodedPath;
  try {
    decodedPath = decodeURI(pathOnly);
  } catch {
    return { error: 'invalid URI encoding' };
  }

  const resolved = decodedPath.startsWith('/')
    ? path.resolve(repositoryRoot, decodedPath.slice(1))
    : path.resolve(repositoryRoot, path.dirname(sourceFile), decodedPath);
  const relative = path.relative(repositoryRoot, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return { error: 'target escapes repository root' };
  }

  return { resolved, relative: relative.replaceAll('\\', '/') };
}

function collectMarkdownDestinations(content) {
  const destinations = [];
  const lines = content.split(/\r?\n/);
  let fenceMarker = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const fenceMatch = line.match(/^\s*(```|~~~)/);
    if (fenceMatch) {
      fenceMarker = fenceMarker === null ? fenceMatch[1] : null;
      continue;
    }
    if (fenceMarker !== null) continue;

    const inlinePattern = /!?\[[^\]\n]*\]\(([^)\n]+)\)/g;
    for (const match of line.matchAll(inlinePattern)) {
      destinations.push({ raw: match[1], line: index + 1 });
    }

    const referenceMatch = line.match(/^\s*\[[^\]\n]+\]:\s*(<[^>]+>|\S+)/);
    if (referenceMatch) {
      destinations.push({ raw: referenceMatch[1], line: index + 1 });
    }
  }

  return destinations;
}

const failures = [];
let checkedLinks = 0;
const markdownFiles = listTrackedMarkdownFiles();

for (const sourceFile of markdownFiles) {
  const absoluteSource = path.resolve(repositoryRoot, sourceFile);
  const content = readFileSync(absoluteSource, 'utf8');

  for (const candidate of collectMarkdownDestinations(content)) {
    const destination = extractDestination(candidate.raw);
    if (!destination || destination.startsWith('#') || isExternalDestination(destination)) {
      continue;
    }

    checkedLinks += 1;
    const target = resolveLocalDestination(sourceFile, destination);
    if (target?.error) {
      failures.push(`${sourceFile}:${candidate.line}: ${target.error}: ${destination}`);
      continue;
    }
    if (!target || !existsSync(target.resolved)) {
      failures.push(
        `${sourceFile}:${candidate.line}: missing local target: ${destination}`
          + (target?.relative ? ` -> ${target.relative}` : ''),
      );
    }
  }
}

if (failures.length > 0) {
  console.error(`Markdown link check failed with ${failures.length} error(s):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(
    `Markdown link check passed: ${markdownFiles.length} files, ${checkedLinks} local links.`,
  );
}
