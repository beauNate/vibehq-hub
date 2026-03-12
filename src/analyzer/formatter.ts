import type { RunMetrics, DetectedFlags } from './types.js';

const SEVERITY_ICONS: Record<string, string> = {
  critical: '\x1b[31m■ CRITICAL\x1b[0m',
  high: '\x1b[33m■ HIGH\x1b[0m',
  medium: '\x1b[33m■ MEDIUM\x1b[0m',
  low: '\x1b[36m■ LOW\x1b[0m',
  info: '\x1b[37m■ INFO\x1b[0m',
};

export function formatReport(metrics: RunMetrics, flags: DetectedFlags): string {
  const lines: string[] = [];
  const w = 60;
  const border = '─'.repeat(w);

  lines.push(`┌${border}┐`);
  lines.push(`│ ${'Run Report: ' + metrics.runId}${' '.repeat(Math.max(0, w - 13 - metrics.runId.length))}│`);
  lines.push(`│ Duration: ${fmtDuration(metrics.totalDurationSec)} | Agents: ${metrics.totalAgents} | Turns: ${metrics.totalTurns}${pad(w, `Duration: ${fmtDuration(metrics.totalDurationSec)} | Agents: ${metrics.totalAgents} | Turns: ${metrics.totalTurns}`)}│`);
  lines.push(`├${border}┤`);

  // Token Summary
  lines.push(`│ ${'Token Summary' + ' '.repeat(w - 13)}│`);
  const ts = metrics.tokenSummary;
  const pct = (n: number) => ts.totalTokens > 0 ? ` (${(n / ts.totalTokens * 100).toFixed(1)}%)` : '';
  lines.push(fmtRow(w, `  Cache Read:`, `${fmtNum(ts.totalCacheReadTokens)}${pct(ts.totalCacheReadTokens)}`));
  lines.push(fmtRow(w, `  Cache Write:`, `${fmtNum(ts.totalCacheWriteTokens)}${pct(ts.totalCacheWriteTokens)}`));
  lines.push(fmtRow(w, `  Output:`, `${fmtNum(ts.totalOutputTokens)}${pct(ts.totalOutputTokens)}`));
  lines.push(fmtRow(w, `  Input:`, `${fmtNum(ts.totalInputTokens)}${pct(ts.totalInputTokens)}`));
  lines.push(fmtRow(w, `  Total:`, fmtNum(ts.totalTokens)));

  // Cost estimate
  const ce = metrics.costEstimate;
  lines.push(fmtRow(w, `  Est. Cost:`, `$${ce.totalCostUsd.toFixed(2)} (${ce.model})`));

  // Coordination overhead — turn-based (primary) + token-based
  const co = metrics.coordinationOverhead;
  const turnPct = Math.round(co.turnBasedRatio * 100);
  const turnIndicator = turnPct > 30 ? ' ⚠' : ' ✓';
  lines.push(fmtRow(w, `  Coordination (turns):`, `${turnPct}%${turnIndicator}`));
  if (co.tokenBasedRatio > 0) {
    const tokenPct = Math.round(co.tokenBasedRatio * 100);
    lines.push(fmtRow(w, `  Coordination (tokens):`, `${tokenPct}%`));
  }

  lines.push(`├${border}┤`);

  // Per-Agent
  lines.push(`│ ${'Per-Agent Breakdown' + ' '.repeat(w - 19)}│`);
  for (const a of metrics.agents) {
    const role = a.agentRole === 'orchestrator' ? '[ORCH]' : '[WORK]';
    lines.push(fmtRow(w, `  ${a.agentId} ${role}`, `${a.turns} turns, ${fmtNum(a.tokens.outputTokens)} out`));
    lines.push(fmtRow(w, `    Model:`, a.model || 'unknown'));
    lines.push(fmtRow(w, `    Context bloat:`, `${a.contextGrowth.bloatRatio}x`));
    const util = a.utilization;
    if (util && util.totalRunTimeSec > 0) {
      lines.push(fmtRow(w, `    Utilization:`, `${Math.round(util.ratio * 100)}% (${fmtDuration(util.activeTimeSec)} active / ${fmtDuration(util.totalRunTimeSec)})`));
    }

    const topMcp = Object.entries(a.mcpToolCalls)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([n, c]) => `${n}(${c})`)
      .join(', ');
    if (topMcp) lines.push(fmtRow(w, `    MCP tools:`, topMcp));

    const topNative = Object.entries(a.nativeToolCalls)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([n, c]) => `${n}(${c})`)
      .join(', ');
    if (topNative) lines.push(fmtRow(w, `    Native tools:`, topNative));
  }

  lines.push(`├${border}┤`);

  // Tasks
  const tSum = metrics.taskSummary;
  const taskHeader = `Tasks (${metrics.tasks.length})`;
  const taskStats = `Total: ${fmtDuration(tSum.totalTaskTimeSec)}`;
  lines.push(fmtRow(w, ` ${taskHeader}`, taskStats));
  const effPct = Math.round(tSum.parallelEfficiency * 100);
  lines.push(fmtRow(w, `  Parallel efficiency:`, `${effPct}% avg agent utilization`));
  for (const t of metrics.tasks) {
    const status = t.stateTransitions[t.stateTransitions.length - 1]?.to || '?';
    const statusIcon = status === 'done' ? '✓' : status === 'rejected' ? '✗' : '…';
    lines.push(fmtRow(w, `  ${statusIcon} ${t.taskId.substring(0, 8)}`, `${t.description.substring(0, 30)}`));
    lines.push(fmtRow(w, `    → ${t.assignee || '?'}`, `${fmtDuration(t.totalDurationSec)}`));
  }

  lines.push(`├${border}┤`);

  // Flags
  const activeFlags = flags.flags.filter(f => f.count > 0);
  lines.push(`│ ${'Detected Flags (' + activeFlags.length + ')' + ' '.repeat(Math.max(0, w - 19 - String(activeFlags.length).length))}│`);

  if (activeFlags.length === 0) {
    lines.push(fmtRow(w, `  No issues detected`, '✓'));
  } else {
    for (const f of activeFlags) {
      lines.push(fmtRow(w, `  ${SEVERITY_ICONS[f.severity]} ${f.ruleId}`, `×${f.count}`));
      // Show first detail
      if (f.details.length > 0) {
        const d = f.details[0];
        const detail = Object.entries(d).map(([k, v]) => {
          if (Array.isArray(v)) return `${k}=${JSON.stringify(v)}`;
          return `${k}=${v}`;
        }).join(', ');
        lines.push(fmtRow(w, `    `, detail.substring(0, w - 6)));
      }
    }
  }

  lines.push(`│ ${'Summary: '
    + `C:${flags.summary.critical} `
    + `H:${flags.summary.high} `
    + `M:${flags.summary.medium} `
    + `L:${flags.summary.low}`
    + ' '.repeat(Math.max(0, w - 35))}│`);

  lines.push(`└${border}┘`);

  // Artifacts
  if (metrics.artifacts.length > 0) {
    lines.push('');
    lines.push('Artifacts:');
    for (const a of metrics.artifacts) {
      const stubNote = a.publishAttempts > 1
        ? ` (${a.publishAttempts} attempts, first: ${a.firstAttemptSize}B)`
        : '';
      lines.push(`  ${a.producer} → ${a.filename} (${fmtBytes(a.finalSize)})${stubNote}`);
    }
  }

  // Cost breakdown
  if (metrics.costEstimate.perAgentCost.length > 0) {
    lines.push('');
    lines.push(`Cost: $${metrics.costEstimate.totalCostUsd.toFixed(2)} (input: $${metrics.costEstimate.breakdown.inputCost.toFixed(2)}, output: $${metrics.costEstimate.breakdown.outputCost.toFixed(2)}, cache-r: $${metrics.costEstimate.breakdown.cacheReadCost.toFixed(2)}, cache-w: $${metrics.costEstimate.breakdown.cacheWriteCost.toFixed(2)})`);
    for (const ac of metrics.costEstimate.perAgentCost) {
      lines.push(`  ${ac.agentId}: $${ac.costUsd.toFixed(2)}`);
    }
  }

  // Phases
  if (metrics.phases.length > 0) {
    lines.push('');
    lines.push('Phases:');
    for (const p of metrics.phases) {
      const startShort = p.start.substring(11, 19);
      const endShort = p.end.substring(11, 19);
      lines.push(`  ${p.name}: ${startShort} → ${endShort} (${fmtDuration(p.durationSec)})`);
    }
  }

  return lines.join('\n');
}

function fmtRow(w: number, left: string, right: string): string {
  // Strip ANSI for length calc
  const leftClean = left.replace(/\x1b\[[0-9;]*m/g, '');
  const rightClean = right.replace(/\x1b\[[0-9;]*m/g, '');
  const gap = Math.max(1, w - leftClean.length - rightClean.length);
  return `│ ${left}${' '.repeat(gap)}${right} │`;
}

function pad(w: number, text: string): string {
  const clean = text.replace(/\x1b\[[0-9;]*m/g, '');
  return ' '.repeat(Math.max(1, w - clean.length - 1));
}

function fmtNum(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}

function fmtBytes(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'MB';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'KB';
  return n + 'B';
}

function fmtDuration(sec: number): string {
  if (sec >= 3600) return `${Math.floor(sec / 3600)}h${Math.floor((sec % 3600) / 60)}m`;
  if (sec >= 60) return `${Math.floor(sec / 60)}m${sec % 60}s`;
  return `${sec}s`;
}
