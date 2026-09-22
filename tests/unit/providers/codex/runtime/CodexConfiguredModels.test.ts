import * as path from 'node:path';

import type { CodexDiscoveredModel } from '@/providers/codex/models';
import {
  isOfficialCodexProviderBaseUrl,
  mergeCodexConfiguredModels,
  parseCodexConfiguredProviderModels,
  readCodexConfiguredProviderModels,
  resolveCodexConfigHome,
} from '@/providers/codex/runtime/CodexConfiguredModels';

const THIRD_PARTY_CONFIG = `
model_provider = "custom"
model = "step-5-preview"

[model_providers.custom]
name = "StepFun"
base_url = "https://api.stepfun.com/step_plan/v1"
wire_api = "responses"
`;

function makeDiscoveredModel(model: string, isDefault = false): CodexDiscoveredModel {
  return {
    model,
    displayName: model,
    description: `${model} description`,
    supportedReasoningEfforts: [{ value: 'medium', description: 'Balanced' }],
    defaultReasoningEffort: 'medium',
    serviceTiers: [],
    defaultServiceTier: null,
    inputModalities: ['text', 'image'],
    isDefault,
  };
}

describe('isOfficialCodexProviderBaseUrl', () => {
  it('recognizes official OpenAI hosts', () => {
    expect(isOfficialCodexProviderBaseUrl('https://api.openai.com/v1')).toBe(true);
    expect(isOfficialCodexProviderBaseUrl('https://chatgpt.com/backend-api/codex')).toBe(true);
    expect(isOfficialCodexProviderBaseUrl('https://API.OPENAI.COM/v1')).toBe(true);
  });

  it('treats third-party and local endpoints as non-official', () => {
    expect(isOfficialCodexProviderBaseUrl('https://api.stepfun.com/step_plan/v1')).toBe(false);
    expect(isOfficialCodexProviderBaseUrl('http://127.0.0.1:15721/v1')).toBe(false);
    expect(isOfficialCodexProviderBaseUrl('http://localhost:8080/v1')).toBe(false);
  });

  it('treats unparseable URLs as official so discovery keeps its current behavior', () => {
    expect(isOfficialCodexProviderBaseUrl('not-a-url')).toBe(true);
    expect(isOfficialCodexProviderBaseUrl('')).toBe(true);
  });
});

describe('parseCodexConfiguredProviderModels', () => {
  it('returns null when no config text is available', () => {
    expect(parseCodexConfiguredProviderModels(null)).toBeNull();
    expect(parseCodexConfiguredProviderModels('   ')).toBeNull();
  });

  it('returns null when the config cannot be parsed', () => {
    expect(parseCodexConfiguredProviderModels('model = ')).toBeNull();
  });

  it('returns null when no model provider is configured', () => {
    expect(parseCodexConfiguredProviderModels('model = "gpt-5.6-sol"')).toBeNull();
  });

  it('returns null when the configured provider has no base URL', () => {
    const config = `
model_provider = "custom"
model = "step-5-preview"

[model_providers.custom]
name = "StepFun"
`;
    expect(parseCodexConfiguredProviderModels(config)).toBeNull();
  });

  it('returns null when the provider uses the official OpenAI endpoint', () => {
    const config = `
model_provider = "custom"
model = "gpt-5.6-sol"

[model_providers.custom]
base_url = "https://api.openai.com/v1"
`;
    expect(parseCodexConfiguredProviderModels(config)).toBeNull();
  });

  it('returns null when the provider exists but no model is configured', () => {
    const config = `
model_provider = "custom"

[model_providers.custom]
base_url = "https://api.stepfun.com/step_plan/v1"
`;
    expect(parseCodexConfiguredProviderModels(config)).toBeNull();
  });

  it('returns the configured model for a third-party provider', () => {
    const result = parseCodexConfiguredProviderModels(THIRD_PARTY_CONFIG);

    expect(result).not.toBeNull();
    expect(result?.providerId).toBe('custom');
    expect(result?.baseUrl).toBe('https://api.stepfun.com/step_plan/v1');
    expect(result?.models).toHaveLength(1);

    const [model] = result?.models ?? [];
    expect(model.model).toBe('step-5-preview');
    expect(model.isDefault).toBe(true);
    expect(model.supportedReasoningEfforts.map(option => option.value)).toEqual([
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
    ]);
    expect(model.defaultReasoningEffort).toBe('high');
  });

  it('treats local proxy endpoints as third-party providers', () => {
    const config = `
model_provider = "custom"
model = "step-5-preview"

[model_providers.custom]
base_url = "http://127.0.0.1:15721/v1"
`;
    const result = parseCodexConfiguredProviderModels(config);

    expect(result?.providerId).toBe('custom');
    expect(result?.baseUrl).toBe('http://127.0.0.1:15721/v1');
    expect(result?.models.map(model => model.model)).toEqual(['step-5-preview']);
  });
});

describe('resolveCodexConfigHome', () => {
  it('prefers CODEX_HOME', () => {
    expect(resolveCodexConfigHome({ CODEX_HOME: '/srv/codex' }, '/home/user')).toBe('/srv/codex');
  });

  it('trims CODEX_HOME', () => {
    expect(resolveCodexConfigHome({ CODEX_HOME: '  /srv/codex  ' }, '/home/user')).toBe('/srv/codex');
  });

  it('falls back to HOME/.codex', () => {
    expect(resolveCodexConfigHome({ HOME: '/home/user' }, '/home/other')).toBe(
      path.join('/home/user', '.codex'),
    );
  });

  it('falls back to USERPROFILE/.codex', () => {
    expect(resolveCodexConfigHome({ USERPROFILE: 'C:\\Users\\me' }, 'C:\\Users\\me')).toBe(
      path.join('C:\\Users\\me', '.codex'),
    );
  });

  it('falls back to the provided home directory', () => {
    expect(resolveCodexConfigHome({}, '/home/user')).toBe(path.join('/home/user', '.codex'));
  });
});

describe('readCodexConfiguredProviderModels', () => {
  it('reads config.toml from the provided Codex home', async () => {
    const readFile = jest.fn().mockResolvedValue(THIRD_PARTY_CONFIG);

    const result = await readCodexConfiguredProviderModels({
      codexHome: '/home/user/.codex',
      readFile,
    });

    expect(readFile).toHaveBeenCalledWith(path.join('/home/user/.codex', 'config.toml'));
    expect(result?.models.map(model => model.model)).toEqual(['step-5-preview']);
  });

  it('returns null when the config file cannot be read', async () => {
    const readFile = jest.fn().mockRejectedValue(new Error('ENOENT'));

    await expect(
      readCodexConfiguredProviderModels({ codexHome: '/home/user/.codex', readFile }),
    ).resolves.toBeNull();
  });

  it('returns null when no Codex home is provided', async () => {
    const readFile = jest.fn();

    await expect(
      readCodexConfiguredProviderModels({ codexHome: null, readFile }),
    ).resolves.toBeNull();
    expect(readFile).not.toHaveBeenCalled();
  });
});

describe('mergeCodexConfiguredModels', () => {
  const configured = {
    providerId: 'custom',
    baseUrl: 'https://api.stepfun.com/step_plan/v1',
    models: [makeDiscoveredModel('step-5-preview', true)],
  };

  it('places configured models first and keeps them as the only default', () => {
    const merged = mergeCodexConfiguredModels(configured, [
      makeDiscoveredModel('gpt-6-astra', true),
      makeDiscoveredModel('gpt-5.6-sol'),
    ]);

    expect(merged.map(model => model.model)).toEqual([
      'step-5-preview',
      'gpt-6-astra',
      'gpt-5.6-sol',
    ]);
    expect(merged.filter(model => model.isDefault).map(model => model.model)).toEqual([
      'step-5-preview',
    ]);
  });

  it('drops app-server models the configured provider already lists', () => {
    const merged = mergeCodexConfiguredModels(
      {
        providerId: 'custom',
        baseUrl: 'https://api.stepfun.com/step_plan/v1',
        models: [makeDiscoveredModel('gpt-5.6-sol', true)],
      },
      [makeDiscoveredModel('gpt-5.6-sol', true), makeDiscoveredModel('gpt-5.6-luna')],
    );

    expect(merged.map(model => model.model)).toEqual(['gpt-5.6-sol', 'gpt-5.6-luna']);
    expect(merged.filter(model => model.isDefault).map(model => model.model)).toEqual([
      'gpt-5.6-sol',
    ]);
  });

  it('keeps configured models when the app-server catalog is empty', () => {
    const merged = mergeCodexConfiguredModels(configured, []);

    expect(merged.map(model => model.model)).toEqual(['step-5-preview']);
  });
});
