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

    expect(workflow.match(/docker\/scout-action@2688993af7bafd6ba8c6a74ec652442be91dd82b/g)).toHaveLength(3);
    expect(workflow).toContain('backend.spdx.json');
    expect(workflow).toContain('frontend.spdx.json');
    expect(workflow).toContain('backend.grype.sarif.json');
    expect(workflow).toContain('frontend.grype.sarif.json');
    expect(workflow).toContain('application-container-evidence');
  });
});
