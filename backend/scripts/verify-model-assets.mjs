import { access, readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..', '..');

const definitions = {
  text: {
    directory: 'Qwen3-14B-AWQ',
    modelTypes: ['qwen3'],
    required: ['config.json', 'tokenizer.json']
  },
  ocr: {
    directory: 'PaddleOCR-VL',
    modelTypes: ['paddleocr_vl'],
    required: [
      'config.json',
      'tokenizer.json',
      'model.safetensors',
      'PP-DocLayoutV2/config.json',
      'PP-DocLayoutV2/inference.pdmodel',
      'PP-DocLayoutV2/inference.pdiparams',
      'PP-DocLayoutV2/inference.yml'
    ]
  },
  vl: {
    directory: 'Qwen3-VL-8B-Instruct',
    modelTypes: ['qwen3_vl'],
    required: ['config.json', 'tokenizer.json', 'preprocessor_config.json']
  },
  embedding: {
    directory: 'Qwen3-Embedding-8B',
    modelTypes: ['qwen3'],
    required: ['config.json', 'tokenizer.json']
  }
};

const scopeMap = {
  resident: ['text', 'ocr'],
  text: ['text'],
  ocr: ['ocr'],
  vl: ['vl'],
  embedding: ['embedding'],
  all: ['text', 'ocr', 'vl', 'embedding']
};

export async function verifyModelAssets(options = {}) {
  const scope = options.scope ?? 'resident';
  const modelRoot = path.resolve(options.modelRoot ?? process.env.MODEL_ROOT ?? path.join(repositoryRoot, 'model'));
  const selected = scopeMap[scope];
  if (!selected) {
    throw new Error(`Unknown model scope "${scope}". Use one of: ${Object.keys(scopeMap).join(', ')}.`);
  }

  const results = [];
  for (const key of selected) {
    results.push(await verifyModel(modelRoot, key, definitions[key]));
  }
  return { modelRoot, scope, ok: results.every((result) => result.ok), models: results };
}

async function verifyModel(modelRoot, key, definition) {
  const directory = path.join(modelRoot, definition.directory);
  const errors = [];
  const warnings = [];

  if (!(await isDirectory(directory))) {
    return { key, directory, ok: false, errors: [`Missing model directory: ${directory}`], warnings };
  }

  for (const relativePath of definition.required) {
    const filePath = path.join(directory, relativePath);
    if (!(await isNonEmptyFile(filePath))) errors.push(`Missing or empty required file: ${relativePath}`);
  }

  const incompleteFiles = await findFiles(directory, (name) => name.endsWith('.incomplete'));
  if (incompleteFiles.length > 0) {
    errors.push(`Incomplete downloads found: ${incompleteFiles.map((file) => path.relative(directory, file)).join(', ')}`);
  }

  const config = await readJson(path.join(directory, 'config.json'), errors, 'config.json');
  if (config?.model_type && !definition.modelTypes.includes(config.model_type)) {
    warnings.push(`Unexpected model_type "${config.model_type}"; expected ${definition.modelTypes.join(' or ')}.`);
  }

  const indexPath = path.join(directory, 'model.safetensors.index.json');
  if (await isNonEmptyFile(indexPath)) {
    const index = await readJson(indexPath, errors, 'model.safetensors.index.json');
    const shards = [...new Set(Object.values(index?.weight_map ?? {}).filter((item) => typeof item === 'string'))];
    if (shards.length === 0) {
      errors.push('model.safetensors.index.json does not reference any weight shards.');
    }
    for (const shard of shards) {
      if (!(await isNonEmptyFile(path.join(directory, shard)))) errors.push(`Missing or empty indexed shard: ${shard}`);
    }
  } else if (!(await isNonEmptyFile(path.join(directory, 'model.safetensors')))) {
    errors.push('No model.safetensors or model.safetensors.index.json was found.');
  }

  const files = await findFiles(directory, () => true);
  let bytes = 0;
  for (const file of files) bytes += (await stat(file)).size;

  return {
    key,
    directory,
    ok: errors.length === 0,
    fileCount: files.length,
    sizeGiB: Number((bytes / 1024 ** 3).toFixed(2)),
    errors,
    warnings
  };
}

async function readJson(filePath, errors, label) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    errors.push(`Cannot parse ${label}: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
}

async function isDirectory(target) {
  try {
    return (await stat(target)).isDirectory();
  } catch {
    return false;
  }
}

async function isNonEmptyFile(target) {
  try {
    const details = await stat(target);
    return details.isFile() && details.size > 0;
  } catch {
    return false;
  }
}

async function findFiles(directory, predicate) {
  const files = [];
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === '.cache') continue;
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await findFiles(target, predicate));
    if (entry.isFile() && predicate(entry.name)) files.push(target);
  }
  return files;
}

function printReport(report, json) {
  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log(`Model root: ${report.modelRoot}`);
  console.log(`Scope: ${report.scope}`);
  for (const model of report.models) {
    console.log(`${model.ok ? 'OK' : 'FAIL'} ${model.key}: ${model.directory}`);
    if (model.fileCount !== undefined) console.log(`  ${model.fileCount} files, ${model.sizeGiB} GiB`);
    for (const warning of model.warnings) console.log(`  warning: ${warning}`);
    for (const error of model.errors) console.error(`  error: ${error}`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const filtered = args.filter((arg) => arg !== '--json');
  const scope = filtered[0] ?? 'resident';
  const modelRoot = filtered[1];
  await access(modelRoot ?? process.env.MODEL_ROOT ?? path.join(repositoryRoot, 'model'));
  const report = await verifyModelAssets({ scope, modelRoot });
  printReport(report, json);
  if (!report.ok) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
