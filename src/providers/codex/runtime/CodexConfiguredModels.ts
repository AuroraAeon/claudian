/**
 * Reads the Codex model configuration for third-party model providers.
 *
 * The Codex app-server reports its built-in OpenAI catalog through the
 * `model/list` RPC even when `config.toml` routes requests to an alternative
 * endpoint, for example a provider switched by CC Switch. This module reads the
 * local Codex configuration so discovery can offer the model the user actually
 * configured for the active provider.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { parse as parseToml } from 'smol-toml';

import { DEFAULT_REASONING_VALUE } from '../../../core/providers/reasoning';
import type { CodexDiscoveredModel } from '../models';
import { CODEX_FALLBACK_REASONING_EFFORT_VALUES } from '../models';
import { formatCodexModelLabel } from '../types/models';

const OFFICIAL_CODEX_PROVIDER_HOSTS = new Set(['api.openai.com', 'chatgpt.com']);
const CODEX_CONFIG_FILE_NAME = 'config.toml';

export interface CodexConfiguredProviderModels {
  providerId: string;
  baseUrl: string;
  models: CodexDiscoveredModel[];
}

export interface CodexConfiguredModelsReadOptions {
  codexHome: string | null;
  readFile?: (path: string) => Promise<string | null>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  return normalized || null;
}

export function isOfficialCodexProviderBaseUrl(baseUrl: string): boolean {
  let hostname: string;
  try {
    hostname = new URL(baseUrl).hostname.toLowerCase();
  } catch {
    return true;
  }

  return OFFICIAL_CODEX_PROVIDER_HOSTS.has(hostname);
}

function createConfiguredModel(
  model: string,
  providerId: string,
  baseUrl: string,
): CodexDiscoveredModel {
  return {
    model,
    displayName: formatCodexModelLabel(model),
    description: `Configured model for Codex provider "${providerId}" (${baseUrl})`,
    supportedReasoningEfforts: CODEX_FALLBACK_REASONING_EFFORT_VALUES.map(value => ({
      value,
      description: '',
    })),
    defaultReasoningEffort: DEFAULT_REASONING_VALUE,
    serviceTiers: [],
    defaultServiceTier: null,
    inputModalities: ['text', 'image'],
    isDefault: true,
  };
}

export function parseCodexConfiguredProviderModels(
  configText: string | null,
): CodexConfiguredProviderModels | null {
  const trimmedConfigText = configText?.trim();
  if (!trimmedConfigText) {
    return null;
  }

  let config: unknown;
  try {
    config = parseToml(trimmedConfigText);
  } catch {
    return null;
  }
  if (!isRecord(config)) {
    return null;
  }

  const providerId = normalizeNonEmptyString(config.model_provider);
  if (!providerId || !isRecord(config.model_providers)) {
    return null;
  }

  const providerConfig = config.model_providers[providerId];
  if (!isRecord(providerConfig)) {
    return null;
  }

  const baseUrl = normalizeNonEmptyString(providerConfig.base_url);
  if (!baseUrl || isOfficialCodexProviderBaseUrl(baseUrl)) {
    return null;
  }

  const model = normalizeNonEmptyString(config.model);
  if (!model) {
    return null;
  }

  return {
    providerId,
    baseUrl,
    models: [createConfiguredModel(model, providerId, baseUrl)],
  };
}

export function resolveCodexConfigHome(
  env: Record<string, string | undefined>,
  homeDirectory: string,
): string {
  const codexHome = env.CODEX_HOME?.trim();
  if (codexHome) {
    return codexHome;
  }

  const home = env.HOME?.trim() || env.USERPROFILE?.trim() || homeDirectory;
  return path.join(home, '.codex');
}

async function readConfigFile(filePath: string): Promise<string | null> {
  return await fs.readFile(filePath, 'utf-8');
}

export async function readCodexConfiguredProviderModels(
  options: CodexConfiguredModelsReadOptions,
): Promise<CodexConfiguredProviderModels | null> {
  const codexHome = options.codexHome?.trim();
  if (!codexHome) {
    return null;
  }

  const readFile = options.readFile ?? readConfigFile;
  let configText: string | null;
  try {
    configText = await readFile(path.join(codexHome, CODEX_CONFIG_FILE_NAME));
  } catch {
    return null;
  }

  return parseCodexConfiguredProviderModels(configText);
}

export function mergeCodexConfiguredModels(
  configured: CodexConfiguredProviderModels,
  appServerModels: CodexDiscoveredModel[],
): CodexDiscoveredModel[] {
  const configuredModelIds = new Set(configured.models.map(model => model.model));
  const remainingModels = appServerModels
    .filter(model => !configuredModelIds.has(model.model))
    .map(model => (model.isDefault ? { ...model, isDefault: false } : model));

  return [...configured.models, ...remainingModels];
}
