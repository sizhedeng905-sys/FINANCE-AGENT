import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const repositoryRoot = resolve(__dirname, '../..');
const read = (...parts: string[]) => readFileSync(join(repositoryRoot, ...parts), 'utf8');

describe('R8 CI gate contracts', () => {
  it('uses the deployed Node runtime for CI and local tool selection', () => {
    const workflow = read('.github', 'workflows', 'ci.yml');
    const rootPackage = JSON.parse(read('package.json'));
    const backendPackage = JSON.parse(read('backend', 'package.json'));

    expect(workflow).toContain('node-version: 24.18.0');
    expect(read('.node-version').trim()).toBe('24.18.0');
    expect(rootPackage.engines.node).toBe('>=24.18.0 <25');
    expect(backendPackage.engines.node).toBe('>=24.18.0 <25');
    expect(read('Dockerfile.frontend')).toContain('node:24.18.0-bookworm-slim@sha256:');
    expect(read('backend', 'Dockerfile')).toContain('node:24.18.0-bookworm-slim@sha256:');
  });

  it('builds and inspects the real application images on every CI run', () => {
    const workflow = read('.github', 'workflows', 'ci.yml');
    const dockerIgnore = read('.dockerignore');

    expect(workflow).toContain('container-images:');
    expect(workflow).toContain('docker build --file backend/Dockerfile');
    expect(workflow).toContain('docker build --file Dockerfile.frontend');
    expect(workflow).toContain('BUILD_GIT_SHA=${GITHUB_SHA}');
    expect(workflow).toContain('VITE_APP_DATA_MODE=api');
    expect(workflow).toContain("test \"$backend_user\" = '10001:10001'");
    expect(workflow).toContain("test \"$frontend_user\" = '101:101'");
    expect(workflow).toContain("test \"$backend_entrypoint\" = '[\"backend-entrypoint\"]'");
    expect(workflow).toContain('test ! -e /usr/local/lib/node_modules/npm');
    expect(workflow).toContain('! command -v npm');
    expect(workflow).toContain('! command -v npx');
    expect(workflow).toContain('! command -v corepack');
    expect(workflow).toContain('./node_modules/.bin/prisma validate --schema prisma/schema.prisma');
    expect(workflow).toContain('node --check dist/main.js');
    expect(workflow).toContain('node --check dist/worker.js');
    expect(workflow).toContain("if grep -qi 'failed to detect'");
    const backendDockerfile = read('backend', 'Dockerfile');
    expect(backendDockerfile).toContain('rm -rf /usr/local/lib/node_modules/npm');
    expect(backendDockerfile).toContain('/usr/local/lib/node_modules/corepack');
    expect(backendDockerfile).toContain('/usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack');
    expect(backendDockerfile).toContain('ARG OPENSSL_PACKAGE_VERSION=3.0.20-1~deb12u2');
    expect(backendDockerfile).toContain('"ca-certificates=${CA_CERTIFICATES_PACKAGE_VERSION}"');
    expect(backendDockerfile).toContain('"libssl3=${LIBSSL_PACKAGE_VERSION}"');
    expect(backendDockerfile).toContain('"openssl=${OPENSSL_PACKAGE_VERSION}"');
    for (const generatedPath of [
      'deploy/staging/.evidence',
      'deploy/staging/.release',
      'deploy/staging/.runtime',
      'deploy/staging/.secrets',
    ]) {
      expect(dockerIgnore).toContain(generatedPath);
    }
  });

  it('produces SBOMs and gates fixable critical CVEs for both application images', () => {
    const workflow = read('.github', 'workflows', 'ci.yml');
    const generator = read('deploy', 'staging', 'scripts', 'generate-sbom.mjs');

    expect(workflow.match(/SYFT_VERSION: 1\.44\.0/g)).toHaveLength(1);
    expect(workflow.match(/0e91737aee2b5baf1d255b959630194a302335d848ff97bb07921eb6205b5f5a/g)).toHaveLength(1);
    expect(workflow).not.toContain('docker/scout-action');
    expect(workflow).toContain('sha256sum --check --strict');
    expect(workflow).toContain('npm run staging:sbom:test');
    expect(workflow.indexOf('Build real backend and frontend images')).toBeLessThan(
      workflow.indexOf('Install checksum-pinned Syft')
    );
    expect(workflow.lastIndexOf('Run browser E2E')).toBeLessThan(
      workflow.lastIndexOf('Install checksum-pinned Syft')
    );
    expect(workflow.lastIndexOf('Install checksum-pinned Syft')).toBeLessThan(
      workflow.lastIndexOf('Generate R5 fixture image SBOM')
    );
    expect(generator).toContain("PINNED_SYFT_VERSION = '1.44.0'");
    expect(generator).toContain('Syft version mismatch');
    expect(generator).toContain('Syft output is not a valid SPDX JSON document');
    expect(workflow).toContain('backend.spdx.json');
    expect(workflow).toContain('frontend.spdx.json');
    expect(workflow).toContain('backend.grype.sarif.json');
    expect(workflow).toContain('frontend.grype.sarif.json');
    expect(workflow).toContain('application-container-evidence');
  });

  it('provides a scheduled and manual full staging release acceptance path', () => {
    const workflow = read('.github', 'workflows', 'staging-acceptance.yml');

    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).toContain('schedule:');
    expect(workflow).toContain('node-version: 24.18.0');
    expect(workflow).toContain('npm run staging:release');
    expect(workflow).toContain('npm run staging:logs:check');
    expect(workflow).toContain('Install and exercise checksum-pinned Syft');
    expect(workflow).toContain('sha256sum --check --strict');
    expect(workflow).toContain('--source dir:deploy/staging/scripts');
    expect(workflow).toContain('syft-bootstrap.spdx.json');
    expect(workflow).not.toContain('docker/scout-action');
    expect(workflow).toContain('npm run staging:rollback --');
    expect(workflow).toContain('npm run staging:smoke');
    expect(workflow).toContain("down -v --remove-orphans");
    expect(workflow).toContain('staging-release-acceptance-evidence');
    expect(workflow).not.toMatch(/path:[^\n]*(?:\.secrets|\.runtime\/tls)/);
  });

  it('keeps real model inference on an explicit GPU L0 workflow', () => {
    const workflow = read('.github', 'workflows', 'model-runtime-acceptance.yml');

    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).not.toContain('schedule:');
    expect(workflow).toContain('finance-agent-gpu');
    expect(workflow).toContain('clean: false');
    expect(workflow).toContain('model_root:');
    expect(workflow).toContain('npm run model:resident');
    expect(workflow).toContain('npm run model:ocr:acceptance --prefix backend');
    expect(workflow).toContain('npm run model:switch:acceptance --prefix backend');
    expect(workflow).toContain('npm run model:restore');
    expect(workflow).toContain('L0 engineering evidence only');
  });

  it('runs the Python adapter dependency contract without claiming model accuracy', () => {
    const workflow = read('.github', 'workflows', 'staging-acceptance.yml');

    expect(workflow).toContain('python-ocr-adapter-contract:');
    expect(workflow).toContain('actions/setup-python@ece7cb06caefa5fff74198d8649806c4678c61a1');
    expect(workflow).toContain('python -m pip check');
    expect(workflow).toContain('python -m unittest discover -s tests -p "test_*.py"');
    expect(workflow).toContain('No model inference or accuracy claim');
  });

  it('runs the runtime log leak policy in regular CI', () => {
    const workflow = read('.github', 'workflows', 'ci.yml');

    expect(workflow).toContain('npm run staging:config:test');
    expect(workflow).toContain('npm run staging:logs:test');
  });
});
