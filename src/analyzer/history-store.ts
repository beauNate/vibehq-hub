import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { RunMetrics, DetectedFlags } from './types.js';

const ANALYTICS_DIR = join(homedir(), '.vibehq', 'analytics');
const RUNS_DIR = join(ANALYTICS_DIR, 'runs');
const HISTORY_FILE = join(ANALYTICS_DIR, 'run_history.jsonl');

export interface RunHistoryEntry {
  run_id: string;
  timestamp: string;
  duration_sec: number;
  agents: number;
  total_turns: number;
  total_output_tokens: number;
  total_cache_read_tokens: number;
  coordination_overhead_ratio: number;
  parallel_efficiency: number;
  flags_critical: number;
  flags_high: number;
  flags_medium: number;
  flags_total: number;
  task_description: string;
}

function ensureDirs(runId: string): string {
  const runDir = join(RUNS_DIR, runId);
  mkdirSync(runDir, { recursive: true });
  return runDir;
}

export function saveRun(
  metrics: RunMetrics,
  flags: DetectedFlags,
  rawLogPaths?: string[],
): string {
  const runDir = ensureDirs(metrics.runId);

  // Save metrics and flags
  writeFileSync(join(runDir, 'run_metrics.json'), JSON.stringify(metrics, null, 2));
  writeFileSync(join(runDir, 'detected_flags.json'), JSON.stringify(flags, null, 2));

  // Copy raw logs if provided
  if (rawLogPaths) {
    for (const logPath of rawLogPaths) {
      const basename = logPath.split(/[\\/]/).pop() || 'raw_log.jsonl';
      try {
        copyFileSync(logPath, join(runDir, basename));
      } catch { /* skip if can't copy */ }
    }
  }

  // Append to history
  const entry = buildHistoryEntry(metrics, flags);
  mkdirSync(ANALYTICS_DIR, { recursive: true });

  // Check if this run_id already exists in history — if so, replace it
  let existingLines: string[] = [];
  if (existsSync(HISTORY_FILE)) {
    existingLines = readFileSync(HISTORY_FILE, 'utf-8')
      .split('\n')
      .filter(Boolean)
      .filter(line => {
        try {
          const e = JSON.parse(line);
          return e.run_id !== metrics.runId;
        } catch { return true; }
      });
  }
  existingLines.push(JSON.stringify(entry));
  writeFileSync(HISTORY_FILE, existingLines.join('\n') + '\n');

  return runDir;
}

export function saveReportCard(
  runId: string,
  reportCard: Record<string, unknown>,
): void {
  const runDir = join(RUNS_DIR, runId);
  if (!existsSync(runDir)) {
    mkdirSync(runDir, { recursive: true });
  }
  writeFileSync(join(runDir, 'report_card.json'), JSON.stringify(reportCard, null, 2));
}

export function loadHistory(limit?: number): RunHistoryEntry[] {
  if (!existsSync(HISTORY_FILE)) return [];

  const lines = readFileSync(HISTORY_FILE, 'utf-8').split('\n').filter(Boolean);
  const entries: RunHistoryEntry[] = [];
  for (const line of lines) {
    try {
      entries.push(JSON.parse(line));
    } catch { /* skip */ }
  }

  // Sort by timestamp descending (most recent first)
  entries.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  if (limit && limit > 0) return entries.slice(0, limit);
  return entries;
}

export function loadRun(runId: string): { metrics: RunMetrics; flags: DetectedFlags } | null {
  const runDir = join(RUNS_DIR, runId);
  if (!existsSync(runDir)) return null;

  try {
    const metrics = JSON.parse(readFileSync(join(runDir, 'run_metrics.json'), 'utf-8'));
    const flags = JSON.parse(readFileSync(join(runDir, 'detected_flags.json'), 'utf-8'));
    return { metrics, flags };
  } catch {
    return null;
  }
}

export function listRunIds(): string[] {
  if (!existsSync(RUNS_DIR)) return [];
  return readdirSync(RUNS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)
    .sort()
    .reverse();
}

export function compareRuns(
  run1: { metrics: RunMetrics; flags: DetectedFlags },
  run2: { metrics: RunMetrics; flags: DetectedFlags },
): ComparisonResult {
  const m1 = run1.metrics;
  const m2 = run2.metrics;
  const f1 = run1.flags;
  const f2 = run2.flags;

  const delta = (a: number, b: number) => b === 0 ? 0 : Math.round(((a - b) / b) * 100);

  return {
    run1Id: m1.runId,
    run2Id: m2.runId,
    deltas: {
      duration: { from: m2.totalDurationSec, to: m1.totalDurationSec, changePct: delta(m1.totalDurationSec, m2.totalDurationSec) },
      turns: { from: m2.totalTurns, to: m1.totalTurns, changePct: delta(m1.totalTurns, m2.totalTurns) },
      outputTokens: { from: m2.tokenSummary.totalOutputTokens, to: m1.tokenSummary.totalOutputTokens, changePct: delta(m1.tokenSummary.totalOutputTokens, m2.tokenSummary.totalOutputTokens) },
      coordOverhead: { from: m2.coordinationOverhead.turnBasedRatio, to: m1.coordinationOverhead.turnBasedRatio, changePct: delta(m1.coordinationOverhead.turnBasedRatio, m2.coordinationOverhead.turnBasedRatio) },
      parallelEfficiency: { from: m2.taskSummary.parallelEfficiency, to: m1.taskSummary.parallelEfficiency, changePct: delta(m1.taskSummary.parallelEfficiency, m2.taskSummary.parallelEfficiency) },
      flagsCritical: { from: f2.summary.critical, to: f1.summary.critical, changePct: delta(f1.summary.critical, f2.summary.critical) },
      flagsHigh: { from: f2.summary.high, to: f1.summary.high, changePct: delta(f1.summary.high, f2.summary.high) },
      flagsTotal: { from: f2.summary.total, to: f1.summary.total, changePct: delta(f1.summary.total, f2.summary.total) },
    },
  };
}

export interface ComparisonResult {
  run1Id: string;
  run2Id: string;
  deltas: Record<string, { from: number; to: number; changePct: number }>;
}

function buildHistoryEntry(metrics: RunMetrics, flags: DetectedFlags): RunHistoryEntry {
  return {
    run_id: metrics.runId,
    timestamp: metrics.endTime,
    duration_sec: metrics.totalDurationSec,
    agents: metrics.totalAgents,
    total_turns: metrics.totalTurns,
    total_output_tokens: metrics.tokenSummary.totalOutputTokens,
    total_cache_read_tokens: metrics.tokenSummary.totalCacheReadTokens,
    coordination_overhead_ratio: metrics.coordinationOverhead.turnBasedRatio,
    parallel_efficiency: metrics.taskSummary.parallelEfficiency,
    flags_critical: flags.summary.critical,
    flags_high: flags.summary.high,
    flags_medium: flags.summary.medium,
    flags_total: flags.summary.total,
    task_description: metrics.taskDescription.substring(0, 200),
  };
}

export function formatHistory(entries: RunHistoryEntry[]): string {
  if (entries.length === 0) return 'No runs recorded yet.';

  const lines: string[] = [];
  const w = 80;
  lines.push('─'.repeat(w));
  lines.push(
    padR('Run ID', 20) + padR('Duration', 10) + padR('Agents', 8)
    + padR('Turns', 8) + padR('Coord%', 8) + padR('Flags', 12) + 'Task'
  );
  lines.push('─'.repeat(w));

  for (const e of entries) {
    const dur = e.duration_sec >= 3600
      ? `${Math.floor(e.duration_sec / 3600)}h${Math.floor((e.duration_sec % 3600) / 60)}m`
      : `${Math.floor(e.duration_sec / 60)}m`;
    const coordPct = Math.round(e.coordination_overhead_ratio * 100) + '%';
    const flags = `C${e.flags_critical} H${e.flags_high} M${e.flags_medium}`;
    const task = e.task_description.substring(0, 20);

    lines.push(
      padR(e.run_id, 20) + padR(dur, 10) + padR(String(e.agents), 8)
      + padR(String(e.total_turns), 8) + padR(coordPct, 8) + padR(flags, 12) + task
    );
  }

  lines.push('─'.repeat(w));
  lines.push(`${entries.length} run(s) total`);
  return lines.join('\n');
}

export function formatComparison(cmp: ComparisonResult): string {
  const lines: string[] = [];
  const w = 60;
  lines.push('─'.repeat(w));
  lines.push(`Comparison: ${cmp.run2Id} → ${cmp.run1Id}`);
  lines.push('─'.repeat(w));

  for (const [key, d] of Object.entries(cmp.deltas)) {
    const label = key.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase());
    const arrow = d.changePct > 0 ? '↑' : d.changePct < 0 ? '↓' : '=';
    const sign = d.changePct > 0 ? '+' : '';
    // For flags/overhead, decrease is good; for efficiency, increase is good
    const isGoodDecrease = key.includes('flag') || key.includes('coord') || key === 'duration';
    const indicator = d.changePct === 0 ? '' :
      (isGoodDecrease ? (d.changePct < 0 ? ' ✓' : ' ⚠') : (d.changePct > 0 ? ' ✓' : ' ⚠'));

    lines.push(`  ${padR(label, 25)} ${padR(String(d.from), 8)} → ${padR(String(d.to), 8)} ${arrow} ${sign}${d.changePct}%${indicator}`);
  }

  lines.push('─'.repeat(w));
  return lines.join('\n');
}

function padR(s: string, n: number): string {
  return s.length >= n ? s.substring(0, n) : s + ' '.repeat(n - s.length);
}
