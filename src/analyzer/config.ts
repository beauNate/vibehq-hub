import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const GLOBAL_CONFIG_DIR = join(homedir(), '.vibehq', 'analytics');
const GLOBAL_CONFIG_FILE = join(GLOBAL_CONFIG_DIR, 'config.json');
const PROJECT_CONFIG_FILE = 'vibehq.config.json';

export interface AnalyticsConfig {
  llm: {
    provider: 'anthropic' | 'openai';
    apiKey?: string;
    model: string;
    baseUrl?: string;
  };
}

const DEFAULTS: AnalyticsConfig = {
  llm: {
    provider: 'anthropic',
    model: 'claude-sonnet-4-20250514',
  },
};

/**
 * Load analytics config with priority:
 * CLI flags > env vars > project vibehq.config.json > ~/.vibehq/analytics/config.json > defaults
 */
export function loadConfig(cliOverrides?: Partial<AnalyticsConfig['llm']>): AnalyticsConfig {
  // Start with defaults
  let config: AnalyticsConfig = structuredClone(DEFAULTS);

  // Layer 1: Global config (~/.vibehq/analytics/config.json)
  const globalConfig = readJsonSafe(GLOBAL_CONFIG_FILE);
  if (globalConfig?.llm) {
    config.llm = { ...config.llm, ...globalConfig.llm };
  }

  // Layer 2: Project config (vibehq.config.json → analytics.llm)
  // SECURITY: Never read apiKey from project config — it's tracked by git.
  // API keys should only come from: global config, env vars, or CLI flags.
  const projectConfig = readJsonSafe(PROJECT_CONFIG_FILE);
  if (projectConfig?.analytics?.llm) {
    const { apiKey: _ignored, ...safeProjectLlm } = projectConfig.analytics.llm;
    config.llm = { ...config.llm, ...safeProjectLlm };
  }

  // Layer 3: Environment variables
  if (process.env.ANTHROPIC_API_KEY && !config.llm.apiKey) {
    config.llm.apiKey = process.env.ANTHROPIC_API_KEY;
    config.llm.provider = 'anthropic';
  }
  if (process.env.OPENAI_API_KEY && !config.llm.apiKey) {
    config.llm.apiKey = process.env.OPENAI_API_KEY;
    config.llm.provider = 'openai';
  }
  if (process.env.VIBEHQ_LLM_MODEL) {
    config.llm.model = process.env.VIBEHQ_LLM_MODEL;
  }

  // Layer 4: CLI overrides (highest priority)
  if (cliOverrides) {
    if (cliOverrides.apiKey) config.llm.apiKey = cliOverrides.apiKey;
    if (cliOverrides.model) config.llm.model = cliOverrides.model;
    if (cliOverrides.baseUrl) config.llm.baseUrl = cliOverrides.baseUrl;
    if (cliOverrides.provider) config.llm.provider = cliOverrides.provider;
  }

  return config;
}

/**
 * Save LLM config to global config file (~/.vibehq/analytics/config.json)
 */
export function saveGlobalConfig(config: Partial<AnalyticsConfig>): string {
  mkdirSync(GLOBAL_CONFIG_DIR, { recursive: true });

  // Merge with existing
  const existing = readJsonSafe(GLOBAL_CONFIG_FILE) || {};
  const merged = {
    ...existing,
    ...config,
    llm: { ...(existing.llm || {}), ...(config.llm || {}) },
  };

  writeFileSync(GLOBAL_CONFIG_FILE, JSON.stringify(merged, null, 2));
  return GLOBAL_CONFIG_FILE;
}

/**
 * Interactive config setup — returns the config that was saved
 */
export function getConfigStatus(): {
  globalPath: string;
  projectPath: string;
  globalExists: boolean;
  projectHasAnalytics: boolean;
  resolvedConfig: AnalyticsConfig;
} {
  const projectConfig = readJsonSafe(PROJECT_CONFIG_FILE);
  return {
    globalPath: GLOBAL_CONFIG_FILE,
    projectPath: PROJECT_CONFIG_FILE,
    globalExists: existsSync(GLOBAL_CONFIG_FILE),
    projectHasAnalytics: !!projectConfig?.analytics,
    resolvedConfig: loadConfig(),
  };
}

function readJsonSafe(path: string): Record<string, any> | null {
  try {
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return null;
  }
}
