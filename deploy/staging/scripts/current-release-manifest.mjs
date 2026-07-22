import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { canonicalJson, readSealedJson, RELEASE_MANIFEST_SCHEMA } from './image-integrity-lib.mjs';

const stagingRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const currentPath = join(stagingRoot, '.release', 'current.json');
const { document: current } = await readSealedJson(currentPath, RELEASE_MANIFEST_SCHEMA);
if (!/^\d{8}T\d{6}Z-[a-f0-9]{12}$/.test(current.releaseId ?? '')) {
  throw new Error('Current release ID is invalid');
}
const manifestPath = join(stagingRoot, '.release', 'releases', `${current.releaseId}.json`);
const { document: manifest } = await readSealedJson(manifestPath, RELEASE_MANIFEST_SCHEMA);
if (canonicalJson(current) !== canonicalJson(manifest)) {
  throw new Error('Current release pointer does not match its sealed manifest');
}
process.stdout.write(`${relative(stagingRoot, manifestPath).replace(/\\/g, '/')}\n`);
