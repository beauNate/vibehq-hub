import { readdirSync } from 'fs';
import { join } from 'path';
import { parseClaudeLog } from './parsers/claude-parser.js';
import { parseCodexLog } from './parsers/codex-parser.js';
import type { NormalizedEvent } from './types.js';

export type LogFormat = 'claude' | 'codex';

function detectFormat(filePath: string): LogFormat {
  // Codex rollout logs have "rollout-" prefix
  const basename = filePath.split(/[\\/]/).pop() || '';
  if (basename.startsWith('rollout-')) return 'codex';
  // Default to Claude format (UUID-named files)
  return 'claude';
}

export function parseLogFile(filePath: string, format?: LogFormat): NormalizedEvent[] {
  const fmt = format || detectFormat(filePath);
  return fmt === 'codex' ? parseCodexLog(filePath) : parseClaudeLog(filePath);
}

export function parseLogDirectory(dirPath: string): NormalizedEvent[] {
  const files = readdirSync(dirPath).filter(f => f.endsWith('.jsonl'));
  const allEvents: NormalizedEvent[] = [];

  for (const file of files) {
    const filePath = join(dirPath, file);
    const events = parseLogFile(filePath);
    allEvents.push(...events);
  }

  // Sort by timestamp (meta events keep their position relative to their agent)
  return allEvents.sort((a, b) => {
    if (!a.timestamp) return -1;
    if (!b.timestamp) return 1;
    return a.timestamp.localeCompare(b.timestamp);
  });
}
