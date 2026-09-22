/**
 * Cache fingerprint for the Codex model catalog.
 *
 * The fingerprint captures the inputs that affect which models the Codex
 * app-server will report, plus the third-party provider configured in the
 * local Codex config. When any input changes, the cached catalog is
 * considered stale and will be refreshed.
 */

import { createHash } from 'node:crypto';
import * as os from 'node:os';

import { getRuntimeEnvironmentText, getRuntimeEnvironmentVariables } from '../../../core/providers/providerEnvironment';
import type { ProviderHost } from '../../../core/providers/ProviderHost';
import type { ProviderTransitionOwnerContext } from '../../../core/providers/types';
import { getVaultPath } from '../../../utils/path';
import { computeCodexEnvHash } from '../env/CodexSettingsReconciler';
import { getCodexProviderSettings } from '../settings';
import {
  readCodexConfiguredProviderModels,
  resolveCodexConfigHome,
} from './CodexConfiguredModels';
import { resolveCodexExecutionTargetAsync } from './CodexExecutionTargetResolver';

const CATALOG_FINGERPRINT_VERSION = '3';

export interface CodexCatalogFingerprintInputs {
  resolvedCliCommand: string | null;
  executionTargetKey: string;
  envHash: string;
  providerSignature?: string;
}

export function buildCodexCatalogFingerprint(
  inputs: CodexCatalogFingerprintInputs,
): string {
  const parts = [
    CATALOG_FINGERPRINT_VERSION,
    inputs.resolvedCliCommand ?? '',
    inputs.executionTargetKey,
    inputs.envHash,
    inputs.providerSignature ?? '',
  ];
  return `${CATALOG_FINGERPRINT_VERSION}:${createHash('sha256')
    .update(JSON.stringify(parts))
    .digest('hex')}`;
}

export async function computeCodexCatalogFingerprint(
  plugin: ProviderHost,
  context?: ProviderTransitionOwnerContext,
): Promise<string> {
  const settings = plugin.settings;
  const hostVaultPath = getVaultPath(plugin.app) ?? null;
  const executionTarget = await resolveCodexExecutionTargetAsync({
    settings,
    hostVaultPath,
  });
  const resolvedCliCommand = await plugin.getResolvedProviderCliPath('codex', {
    ...context,
    executionTarget,
  });
  const executionTargetKey = [
    executionTarget.method,
    executionTarget.platformFamily,
    executionTarget.platformOs,
    executionTarget.distroName ?? '',
  ].join(':');
  const envText = getRuntimeEnvironmentText(settings, 'codex');
  const envHash = computeCodexEnvHash(envText);
  const providerSignature = await computeCodexProviderSignature(settings);

  return buildCodexCatalogFingerprint({
    resolvedCliCommand,
    executionTargetKey,
    envHash,
    providerSignature,
  });
}

async function computeCodexProviderSignature(
  settings: Record<string, unknown>,
): Promise<string> {
  const env: Record<string, string | undefined> = {
    ...process.env,
    ...getRuntimeEnvironmentVariables(settings, 'codex'),
  };
  const configuredProviderModels = await readCodexConfiguredProviderModels({
    codexHome: resolveCodexConfigHome(env, os.homedir()),
  });
  if (!configuredProviderModels) {
    return '';
  }

  return [
    configuredProviderModels.providerId,
    configuredProviderModels.baseUrl,
    configuredProviderModels.models.map(model => model.model).join(','),
  ].join(':');
}

export function getCodexCatalogFingerprintFromSettings(
  settings: Record<string, unknown>,
): string {
  return getCodexProviderSettings(settings).catalogFingerprint;
}

export function getCodexCatalogTimestampFromSettings(
  settings: Record<string, unknown>,
): number {
  return getCodexProviderSettings(settings).catalogTimestamp;
}
