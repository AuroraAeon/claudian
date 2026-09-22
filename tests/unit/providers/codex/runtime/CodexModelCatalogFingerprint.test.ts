import { getRuntimeEnvironmentText } from '@/core/providers/providerEnvironment';
import type { ProviderHost } from '@/core/providers/ProviderHost';
import { computeCodexEnvHash } from '@/providers/codex/env/CodexSettingsReconciler';
import type { CodexDiscoveredModel } from '@/providers/codex/models';
import {
  buildCodexCatalogFingerprint,
  computeCodexCatalogFingerprint,
} from '@/providers/codex/runtime/CodexModelCatalogFingerprint';
import { DEFAULT_CODEX_PROVIDER_SETTINGS } from '@/providers/codex/settings';

const mockResolveExecutionTarget = jest.fn();
const mockReadConfiguredModels = jest.fn();

jest.mock('@/providers/codex/runtime/CodexExecutionTargetResolver', () => ({
  resolveCodexExecutionTargetAsync: (...args: unknown[]) => mockResolveExecutionTarget(...args),
}));

jest.mock('@/providers/codex/runtime/CodexConfiguredModels', () => ({
  ...jest.requireActual('@/providers/codex/runtime/CodexConfiguredModels'),
  readCodexConfiguredProviderModels: (...args: unknown[]) => mockReadConfiguredModels(...args),
}));

const PLUGIN_SETTINGS = { providerConfigs: { codex: { ...DEFAULT_CODEX_PROVIDER_SETTINGS } } };
const ENV_HASH = computeCodexEnvHash(getRuntimeEnvironmentText(PLUGIN_SETTINGS, 'codex'));

const PLATFORM_OS = process.platform === 'win32'
  ? 'windows'
  : process.platform === 'darwin' ? 'macos' : 'linux';
const EXECUTION_TARGET_KEY = `host-native:unix:${PLATFORM_OS}:`;

function createPlugin(): ProviderHost {
  return {
    settings: PLUGIN_SETTINGS,
    app: { vault: { adapter: {} } },
    getResolvedProviderCliPath: jest.fn().mockResolvedValue('/usr/bin/codex'),
  } as unknown as ProviderHost;
}

function makeConfiguredModel(model: string): CodexDiscoveredModel {
  return {
    model,
    displayName: model,
    description: '',
    supportedReasoningEfforts: [{ value: 'medium', description: '' }],
    defaultReasoningEffort: 'medium',
    serviceTiers: [],
    defaultServiceTier: null,
    inputModalities: ['text', 'image'],
    isDefault: true,
  };
}

describe('buildCodexCatalogFingerprint', () => {
  const baseInputs = {
    resolvedCliCommand: '/usr/bin/codex',
    executionTargetKey: EXECUTION_TARGET_KEY,
    envHash: 'env-hash',
  };

  it('changes when the configured provider signature changes', () => {
    const stepfun = buildCodexCatalogFingerprint({
      ...baseInputs,
      providerSignature: 'custom:https://api.stepfun.com/step_plan/v1:step-5-preview',
    });
    const otherModel = buildCodexCatalogFingerprint({
      ...baseInputs,
      providerSignature: 'custom:https://api.stepfun.com/step_plan/v1:step-3.7-flash',
    });

    expect(stepfun).not.toBe(otherModel);
  });

  it('treats a missing provider signature like an empty one', () => {
    expect(buildCodexCatalogFingerprint(baseInputs)).toBe(
      buildCodexCatalogFingerprint({ ...baseInputs, providerSignature: '' }),
    );
  });
});

describe('computeCodexCatalogFingerprint', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockResolveExecutionTarget.mockResolvedValue({
      method: 'host-native',
      platformFamily: 'unix',
      platformOs: PLATFORM_OS,
    });
    mockReadConfiguredModels.mockResolvedValue(null);
  });

  it('includes the configured third-party provider in the fingerprint', async () => {
    mockReadConfiguredModels.mockResolvedValue({
      providerId: 'custom',
      baseUrl: 'https://api.stepfun.com/step_plan/v1',
      models: [makeConfiguredModel('step-5-preview')],
    });

    const fingerprint = await computeCodexCatalogFingerprint(createPlugin());

    expect(fingerprint).toBe(buildCodexCatalogFingerprint({
      resolvedCliCommand: '/usr/bin/codex',
      executionTargetKey: EXECUTION_TARGET_KEY,
      envHash: ENV_HASH,
      providerSignature: 'custom:https://api.stepfun.com/step_plan/v1:step-5-preview',
    }));
    expect(mockReadConfiguredModels).toHaveBeenCalledWith({ codexHome: expect.any(String) });
  });

  it('matches the empty-signature fingerprint when no third-party provider is configured', async () => {
    const fingerprint = await computeCodexCatalogFingerprint(createPlugin());

    expect(fingerprint).toBe(buildCodexCatalogFingerprint({
      resolvedCliCommand: '/usr/bin/codex',
      executionTargetKey: EXECUTION_TARGET_KEY,
      envHash: ENV_HASH,
    }));
  });
});
