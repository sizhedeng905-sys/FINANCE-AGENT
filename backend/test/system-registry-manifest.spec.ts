import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  resolveSystemRegistryConfiguration,
  SYSTEM_REGISTRY_SCHEMA_VERSION
} from '../src/model-runtime/system-registry-manifest';

function customManifest(overrides: Record<string, unknown> = {}): any {
  return {
    schemaVersion: SYSTEM_REGISTRY_SCHEMA_VERSION,
    deployments: [
      {
        deploymentKey: 'custom-text-v1',
        provider: 'openai_compatible',
        modelName: 'Qwen/Custom',
        modelVersion: '2026-07-21',
        endpoint: 'http://model-api:8000/v1',
        secretRef: 'CUSTOM_MODEL_API_KEY',
        taskTypes: ['excel_column_mapping', 'boss_chat'],
        maxConcurrency: 1,
        timeoutMs: 30000,
        isLocal: true,
        initialEnabled: true
      }
    ],
    routes: [
      {
        taskType: 'excel_column_mapping',
        deploymentKey: 'custom-text-v1',
        priority: 10,
        initialEnabled: true,
        fallbackPolicy: 'manual'
      },
      {
        taskType: 'boss_chat',
        deploymentKey: 'custom-text-v1',
        priority: 10,
        initialEnabled: true,
        fallbackPolicy: 'manual'
      }
    ],
    ...overrides
  };
}

function customEnvironment(manifest: unknown) {
  return {
    NODE_ENV: 'test',
    AI_SYSTEM_REGISTRY_PROFILE: 'custom',
    AI_SYSTEM_REGISTRY_MANIFEST_JSON: JSON.stringify(manifest)
  };
}

describe('system registry manifest', () => {
  it('keeps ephemeral acceptance credentials out of failed-command labels', () => {
    const source = readFileSync(
      resolve(__dirname, '../scripts/verify-system-bootstrap.mjs'),
      'utf8'
    );

    expect(source).not.toContain("${args.join(' ')}");
    expect(source).toContain("label: 'temporary Redis startup'");
    expect(source).toContain("label: 'temporary Redis cleanup'");
  });

  it('uses the complete local-development profile outside production and keeps only secret references', () => {
    const resolved = resolveSystemRegistryConfiguration({ NODE_ENV: 'test' });

    expect(resolved.startupMode).toBe('disabled');
    expect(resolved.manifest.profile).toBe('development-local-v1');
    expect(resolved.manifest.deployments).toHaveLength(5);
    expect(resolved.manifest.routes).toHaveLength(17);
    expect(resolved.manifest.manifestSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(resolved.manifest.deployments.map((item) => item.secretRef)).toEqual([
      null,
      'OCR_API_KEY',
      'AI_API_KEY',
      'EMBEDDING_API_KEY',
      'VL_API_KEY'
    ]);
    expect(JSON.stringify(resolved)).not.toContain('Bearer ');
  });

  it('requires an explicit production profile and always verifies at startup', () => {
    expect(() => resolveSystemRegistryConfiguration({ NODE_ENV: 'production' }))
      .toThrow('AI_SYSTEM_REGISTRY_PROFILE');
    expect(() => resolveSystemRegistryConfiguration({
      NODE_ENV: 'production',
      AI_SYSTEM_REGISTRY_PROFILE: 'mock-safe-v1',
      AI_SYSTEM_REGISTRY_STARTUP_MODE: 'disabled'
    })).toThrow('must be verify in production');

    const resolved = resolveSystemRegistryConfiguration({
      NODE_ENV: 'production',
      AI_SYSTEM_REGISTRY_PROFILE: 'mock-safe-v1'
    });
    expect(resolved.startupMode).toBe('verify');
    expect(resolved.manifest.deployments).toHaveLength(1);
    expect(resolved.manifest.routes).toHaveLength(7);
    expect(resolved.manifest.deployments[0]).toMatchObject({
      deploymentKey: 'mock-text',
      endpoint: null,
      secretRef: null,
      initialEnabled: true
    });
  });

  it('normalizes custom manifest ordering before hashing', () => {
    const first = resolveSystemRegistryConfiguration(customEnvironment(customManifest()));
    const secondSource = customManifest();
    const deployment = (secondSource.deployments as Array<Record<string, unknown>>)[0];
    deployment.taskTypes = [...(deployment.taskTypes as string[])].reverse();
    secondSource.routes = [...secondSource.routes].reverse();
    const second = resolveSystemRegistryConfiguration(customEnvironment(secondSource));

    expect(second.manifest.deployments[0].taskTypes).toEqual(['boss_chat', 'excel_column_mapping']);
    expect(second.manifest.routes.map((item) => item.taskType)).toEqual([
      'boss_chat',
      'excel_column_mapping'
    ]);
    expect(second.manifest.manifestSha256).toBe(first.manifest.manifestSha256);
  });

  it.each([
    [
      '{"schemaVersion":"ai-system-registry/1.0","deployments":[],"deployments":[],"routes":[]}',
      'DUPLICATE_KEY'
    ],
    [JSON.stringify({ ...customManifest(), apiKey: 'must-not-be-here' }), 'unknown properties'],
    [JSON.stringify(customManifest({ schemaVersion: 'v2' })), 'schemaVersion'],
    [JSON.stringify(customManifest({ routes: [] })), 'at least one route'],
    [JSON.stringify(customManifest({ deployments: [] })), 'at least one deployment']
  ])('rejects an unsafe custom JSON envelope', (manifestJson, expectedMessage) => {
    expect(() => resolveSystemRegistryConfiguration({
      NODE_ENV: 'test',
      AI_SYSTEM_REGISTRY_PROFILE: 'custom',
      AI_SYSTEM_REGISTRY_MANIFEST_JSON: manifestJson
    })).toThrow(expectedMessage);
  });

  it.each([
    [
      { secretRef: 'actual-secret-value' },
      'secretRef'
    ],
    [
      { endpoint: 'http://user:password@model-api:8000/v1' },
      'embedded credentials'
    ],
    [
      { endpoint: 'http://model-api:8000/v1?token=secret' },
      'query or fragment'
    ],
    [
      { provider: 'mock', endpoint: 'http://model-api:8000/v1', secretRef: null },
      'mock deployment'
    ],
    [
      { provider: 'openai_compatible', endpoint: null },
      'requires an endpoint'
    ],
    [
      { isLocal: false },
      'must use HTTPS'
    ],
    [
      { isLocal: false, endpoint: 'https://127.0.0.1:8000/v1' },
      'local or private address'
    ],
    [
      { isLocal: false, endpoint: 'https://169.254.169.254/v1' },
      'local or private address'
    ],
    [
      { isLocal: false, endpoint: 'https://[::1]/v1' },
      'local or private address'
    ],
    [
      { isLocal: false, endpoint: 'https://[::ffff:127.0.0.1]/v1' },
      'local or private address'
    ]
  ])('rejects unsafe deployment configuration %#', (deploymentPatch, expectedMessage) => {
    const manifest = customManifest();
    manifest.deployments = [{ ...manifest.deployments[0], ...deploymentPatch }];
    expect(() => resolveSystemRegistryConfiguration(customEnvironment(manifest))).toThrow(expectedMessage);
  });

  it('allows an explicitly external OpenAI deployment only through a public HTTPS endpoint', () => {
    const manifest = customManifest();
    manifest.deployments = [{
      ...manifest.deployments[0],
      provider: 'openai',
      endpoint: 'https://api.openai.com/v1',
      isLocal: false
    }];
    expect(resolveSystemRegistryConfiguration(customEnvironment(manifest)).manifest.deployments[0])
      .toMatchObject({ provider: 'openai', endpoint: 'https://api.openai.com/v1', isLocal: false });
  });

  it('rejects routes outside the deployment task allowlist or initial enable state', () => {
    const unknownTask = customManifest({
      routes: [{
        taskType: 'report_narrative',
        deploymentKey: 'custom-text-v1',
        priority: 10,
        initialEnabled: true,
        fallbackPolicy: 'manual'
      }]
    });
    expect(() => resolveSystemRegistryConfiguration(customEnvironment(unknownTask)))
      .toThrow('task allowlist');

    const disabledDeployment = customManifest();
    disabledDeployment.deployments = [{ ...disabledDeployment.deployments[0], initialEnabled: false }];
    expect(() => resolveSystemRegistryConfiguration(customEnvironment(disabledDeployment)))
      .toThrow('disabled deployment');
  });

  it('rejects ignored custom JSON and invalid startup modes', () => {
    expect(() => resolveSystemRegistryConfiguration({
      NODE_ENV: 'test',
      AI_SYSTEM_REGISTRY_PROFILE: 'mock-safe-v1',
      AI_SYSTEM_REGISTRY_MANIFEST_JSON: JSON.stringify(customManifest())
    })).toThrow('only allowed with custom');
    expect(() => resolveSystemRegistryConfiguration({
      NODE_ENV: 'test',
      AI_SYSTEM_REGISTRY_STARTUP_MODE: 'warn'
    })).toThrow('AI_SYSTEM_REGISTRY_STARTUP_MODE');
  });
});
