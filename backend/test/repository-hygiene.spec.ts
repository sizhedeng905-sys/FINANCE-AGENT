import { mkdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(__dirname, '../..');
const fixtureDirectory = resolve(root, '.hygiene-fixtures');
const script = resolve(root, 'backend/scripts/check-repository-hygiene.mjs');

function check(path: string, environment: NodeJS.ProcessEnv = process.env) {
  return spawnSync(process.execPath, [script, '--path', path], {
    cwd: root,
    env: environment,
    encoding: 'utf8'
  });
}

describe('repository real-data gate', () => {
  beforeEach(async () => mkdir(fixtureDirectory, { recursive: true }));
  afterEach(async () => {
    await rm(fixtureDirectory, { recursive: true, force: true });
    await rm(resolve(root, '.dlp-internal-terms.local.txt'), { force: true });
  });

  it('allows only the explicit generated synthetic business fixture path', async () => {
    const synthetic = '.hygiene-fixtures/synthetic.csv';
    await writeFile(resolve(root, synthetic), 'date,amount\n2026-07-16,10.00\n');
    expect(check(synthetic).status).toBe(0);

    const candidate = '.hygiene-fixtures/real-ledger.csv';
    await writeFile(resolve(root, candidate), 'date,amount\n2026-07-16,10.00\n');
    const rejected = check(candidate);
    expect(rejected.status).toBe(1);
    expect(rejected.stderr).toContain('business-data file extension is blocked');
  });

  it.each([
    ['phone.txt', `Contact ${['186', '1234', '5678'].join('')}`, 'mainland-phone-number'],
    ['key.txt', `${['-----BEGIN ', 'PRIVATE KEY-----'].join('')}\nnot-a-real-key`, 'private-key-material'],
    [
      'secret.txt',
      ['api_', 'key="', ['Y7v9Q2mK4xR8pT6n', 'C3dF5hJ1sL0wZ8uB'].join(''), '"'].join(''),
      'high-entropy-secret-assignment'
    ]
  ])('rejects %s using the DLP detector', async (name, content, detector) => {
    const relative = `.hygiene-fixtures/${name}`;
    await writeFile(resolve(root, relative), content);
    const result = check(relative);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(detector);
  });

  it('loads the ignored company customer dictionary without committing its terms', async () => {
    const dictionary = '.dlp-internal-terms.local.txt';
    await writeFile(resolve(root, dictionary), 'INTERNAL_CUSTOMER_SENTINEL\n');
    const relative = '.hygiene-fixtures/customer.txt';
    await writeFile(resolve(root, relative), 'Account: INTERNAL_CUSTOMER_SENTINEL');
    const result = check(relative, { ...process.env, DLP_INTERNAL_TERMS_FILE: dictionary });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('internal-customer-dictionary-match');
  });
});
