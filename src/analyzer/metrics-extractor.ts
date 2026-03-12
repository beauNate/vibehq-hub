import type {
  NormalizedEvent, RunMetrics, AgentMetrics,
  TaskMetrics, ArtifactMetrics, PhaseMetrics, TokenUsage,
} from './types.js';

const IMPL_TOOLS = new Set(['Write', 'Edit', 'Bash', 'shell_command']);
const PHASE_KEYWORDS: Record<string, RegExp> = {
  research: /research|analysis|fundamentals|valuation|sentiment/i,
  data_packs: /data.?pack|data.?model|json.?model|positioning/i,
  static_html: /html.?dashboard|static|dashboard/i,
  qa: /qa|validate|verify|review|check/i,
  interactive: /interactive|v2|slider|filter|premium/i,
};

export function extractMetrics(events: NormalizedEvent[], runId?: string): RunMetrics {
  const metaEvents = events.filter(e => e.type === 'meta');
  const realEvents = events.filter(e => e.type !== 'meta');

  // Run metadata
  const timestamps = realEvents.map(e => e.timestamp).filter(Boolean).sort();
  const startTime = timestamps[0] || '';
  const endTime = timestamps[timestamps.length - 1] || '';
  const totalDurationSec = startTime && endTime
    ? Math.round((new Date(endTime).getTime() - new Date(startTime).getTime()) / 1000)
    : 0;

  // Detect task description from first user_message or orchestrator message
  const taskDescription = detectTaskDescription(events);

  // Unique agents
  const agentIds = [...new Set(events.map(e => e.agentId))].filter(id => id && id.trim() !== '');

  // Per-agent metrics
  const agents: AgentMetrics[] = agentIds.map(id => buildAgentMetrics(id, events, metaEvents));

  // Total counts
  const totalTurns = agents.reduce((s, a) => s + a.turns, 0);
  const totalToolCalls = events.filter(e => e.type === 'tool_call').length;

  // Token summary
  const tokenSummary = {
    totalInputTokens: agents.reduce((s, a) => s + a.tokens.inputTokens, 0),
    totalOutputTokens: agents.reduce((s, a) => s + a.tokens.outputTokens, 0),
    totalCacheWriteTokens: agents.reduce((s, a) => s + a.tokens.cacheWriteTokens, 0),
    totalCacheReadTokens: agents.reduce((s, a) => s + a.tokens.cacheReadTokens, 0),
    totalTokens: 0,
  };
  tokenSummary.totalTokens =
    tokenSummary.totalInputTokens + tokenSummary.totalOutputTokens
    + tokenSummary.totalCacheWriteTokens + tokenSummary.totalCacheReadTokens;

  // Tasks
  const tasks = extractTasks(events);

  // Artifacts
  const artifacts = extractArtifacts(events);

  // Phases
  const phases = detectPhases(events, tasks);

  // Coordination overhead
  const orchAgents = agents.filter(a => a.agentRole === 'orchestrator');
  const orchTurns = orchAgents.reduce((s, a) => s + a.turns, 0);
  const orchOutputTokens = orchAgents.reduce((s, a) => s + a.tokens.outputTokens, 0);
  const coordinationOverhead = {
    turnBasedRatio: totalTurns > 0 ? Math.round((orchTurns / totalTurns) * 100) / 100 : 0,
    tokenBasedRatio: tokenSummary.totalOutputTokens > 0
      ? Math.round((orchOutputTokens / tokenSummary.totalOutputTokens) * 100) / 100
      : 0,
  };

  // Task summary — parallel efficiency based on concurrent agent activity
  const totalTaskTimeSec = tasks.reduce((s, t) => s + t.totalDurationSec, 0);
  const parallelEfficiency = computeParallelEfficiency(realEvents, agentIds, totalDurationSec);
  const taskSummary = {
    totalTaskTimeSec,
    parallelEfficiency,
  };

  // Cost estimate
  const costEstimate = computeCostEstimate(agents);

  return {
    runId: runId || deriveRunId(startTime),
    taskDescription,
    startTime,
    endTime,
    totalDurationSec,
    totalAgents: agentIds.length,
    totalTurns,
    totalToolCalls,
    tokenSummary,
    coordinationOverhead,
    taskSummary,
    costEstimate,
    agents,
    tasks,
    artifacts,
    phases,
  };
}

function deriveRunId(startTime: string): string {
  if (!startTime) return 'unknown';
  return startTime.substring(0, 10).replace(/-/g, '');
}

function detectTaskDescription(events: NormalizedEvent[]): string {
  // Look for orchestrator's first user_message or first agent_message
  const orchEvents = events.filter(e => e.agentRole === 'orchestrator');
  const firstUserMsg = orchEvents.find(e => e.type === 'user_message' && e.payload.message);
  if (firstUserMsg?.payload.message) {
    return firstUserMsg.payload.message.substring(0, 200);
  }
  // Fallback: first user_message from any agent
  const anyUserMsg = events.find(e => e.type === 'user_message' && e.payload.message);
  return anyUserMsg?.payload.message?.substring(0, 200) || 'Unknown task';
}

function buildAgentMetrics(
  agentId: string,
  allEvents: NormalizedEvent[],
  metaEvents: NormalizedEvent[],
): AgentMetrics {
  const agentEvents = allEvents.filter(e => e.agentId === agentId);
  const meta = metaEvents.find(e => e.agentId === agentId);
  const role = meta?.agentRole || agentEvents[0]?.agentRole || 'worker';
  const model = meta?.payload.model || '';

  // Count turns: distinct assistant_message events (deduplicated by timestamp)
  const assistantTimestamps = new Set<string>();
  for (const e of agentEvents) {
    if (e.type === 'assistant_message' && e.timestamp) {
      assistantTimestamps.add(e.timestamp);
    }
  }
  const turns = assistantTimestamps.size;

  // Tool calls breakdown
  const toolCallEvents = agentEvents.filter(e => e.type === 'tool_call');
  const toolCalls: Record<string, number> = {};
  const mcpToolCalls: Record<string, number> = {};
  const nativeToolCalls: Record<string, number> = {};

  for (const e of toolCallEvents) {
    const name = e.payload.toolName || 'unknown';
    toolCalls[name] = (toolCalls[name] || 0) + 1;

    // Separate MCP vs native
    const mcpMatch = name.match(/^mcp__vibehq_\w+__(\w+)$/);
    if (mcpMatch) {
      const mcpName = mcpMatch[1];
      mcpToolCalls[mcpName] = (mcpToolCalls[mcpName] || 0) + 1;
    } else {
      nativeToolCalls[name] = (nativeToolCalls[name] || 0) + 1;
    }
  }

  // Token usage: sum from all assistant_message events that have tokenUsage
  const tokenEvents = agentEvents.filter(
    e => (e.type === 'assistant_message' || e.type === 'tool_call') && e.payload.tokenUsage
  );
  // Deduplicate by timestamp (Claude sends tokenUsage on both text and tool_use in same turn)
  const seenTimestamps = new Set<string>();
  let inputTokens = 0, outputTokens = 0, cacheWriteTokens = 0, cacheReadTokens = 0;
  for (const e of tokenEvents) {
    if (seenTimestamps.has(e.timestamp)) continue;
    seenTimestamps.add(e.timestamp);
    const t = e.payload.tokenUsage as TokenUsage;
    inputTokens += t.inputTokens;
    outputTokens += t.outputTokens;
    cacheWriteTokens += t.cacheCreationInputTokens;
    cacheReadTokens += t.cacheReadInputTokens;
  }

  // Context growth — collect unique token events in order
  const orderedTokenEvents: NormalizedEvent[] = [];
  const seen2 = new Set<string>();
  for (const e of agentEvents) {
    if ((e.type === 'assistant_message' || e.type === 'tool_call') && e.payload.tokenUsage) {
      if (!seen2.has(e.timestamp)) {
        seen2.add(e.timestamp);
        orderedTokenEvents.push(e);
      }
    }
  }

  let firstCtx = 0, lastCtx = 0;
  if (orderedTokenEvents.length >= 1) {
    // Has real token data (Claude)
    const first = orderedTokenEvents[0].payload.tokenUsage!;
    firstCtx = first.inputTokens + first.cacheCreationInputTokens + first.cacheReadInputTokens;
    const last = orderedTokenEvents[orderedTokenEvents.length - 1].payload.tokenUsage!;
    lastCtx = last.inputTokens + last.cacheCreationInputTokens + last.cacheReadInputTokens;
  } else if (turns > 0) {
    // No token data (Codex) — estimate context growth from cumulative message lengths
    // We split messages into 10% / 90% to approximate first-turn vs last-turn context
    const msgs = agentEvents.filter(e =>
      e.type === 'user_message' || e.type === 'assistant_message' || e.type === 'tool_call' || e.type === 'tool_result'
    );
    const CHARS_PER_TOKEN = 4;
    const msgLens = msgs.map(e =>
      (e.payload.message || '').length
      + (e.payload.toolOutput || '').length
      + JSON.stringify(e.payload.toolInput || '').length
    );
    const totalChars = msgLens.reduce((s, l) => s + l, 0);

    // First turn context ≈ system prompt + first few messages (first 10% of msgs)
    const firstBatch = Math.max(1, Math.ceil(msgs.length * 0.1));
    const firstChars = msgLens.slice(0, firstBatch).reduce((s, l) => s + l, 0);
    firstCtx = Math.round(firstChars / CHARS_PER_TOKEN);
    lastCtx = Math.round(totalChars / CHARS_PER_TOKEN);

    // Also estimate output tokens from message content
    if (outputTokens === 0) {
      const assistantMsgs = agentEvents.filter(e => e.type === 'assistant_message' || e.type === 'tool_call');
      let outChars = 0;
      for (const e of assistantMsgs) {
        outChars += (e.payload.message || '').length
          + JSON.stringify(e.payload.toolInput || '').length;
      }
      outputTokens = Math.round(outChars / CHARS_PER_TOKEN);
    }
  }

  const implementationToolUsed = toolCallEvents.some(e => {
    const name = e.payload.toolName || '';
    return IMPL_TOOLS.has(name);
  });

  // Agent utilization — measure active time vs total time
  const utilization = computeAgentUtilization(agentEvents);

  return {
    agentId,
    agentRole: role,
    model,
    turns,
    toolCalls,
    tokens: { inputTokens, outputTokens, cacheWriteTokens, cacheReadTokens },
    contextGrowth: {
      firstTurnContextSize: firstCtx,
      lastTurnContextSize: lastCtx,
      bloatRatio: firstCtx > 0 ? Math.round((lastCtx / firstCtx) * 100) / 100 : 0,
    },
    mcpToolCalls,
    nativeToolCalls,
    implementationToolUsed,
    utilization,
  };
}

function extractTasks(events: NormalizedEvent[]): TaskMetrics[] {
  const tasks = new Map<string, TaskMetrics>();

  // Pre-scan user_messages for task assignments (Hub → agent messages like "[TASK abc123]")
  for (const e of events) {
    if (e.type === 'user_message' && e.payload.message) {
      const taskMatch = e.payload.message.match(/\[TASK\s+([a-f0-9]+)\]\s*(.+?)(?:\n|$)/i);
      if (taskMatch) {
        const taskId = taskMatch[1];
        if (!tasks.has(taskId)) {
          // Extract description from the message
          const descMatch = e.payload.message.match(/\[TASK\s+[a-f0-9]+\]\s*(.+?)(?:\n|$)/i);
          const desc = descMatch ? descMatch[1].trim() : '';
          const assigneeFromMsg = e.agentId; // the agent receiving the task
          tasks.set(taskId, {
            taskId,
            description: desc,
            assignee: assigneeFromMsg,
            stateTransitions: [{
              from: 'none',
              to: 'created',
              durationSec: 0,
              trigger: 'orchestrator_create',
              timestamp: e.timestamp,
            }],
            totalDurationSec: 0,
            outputArtifacts: [],
          });
        }
      }
    }
  }

  for (const e of events) {
    if (e.type !== 'tool_call') continue;
    const toolName = e.payload.toolName || '';
    const mcpMatch = toolName.match(/^mcp__vibehq_\w+__(\w+)$/);
    const mcpName = mcpMatch ? mcpMatch[1] : toolName;
    const input = e.payload.toolInput || {};

    if (mcpName === 'create_task' || mcpName === 'assign_task') {
      // Extract task ID: may be in input or in adjacent tool_result
      const taskId = (input.task_id as string) || '';
      const desc = (input.description as string) || (input.title as string) || '';
      const assignee = (input.assignee as string) || '';
      // For create_task, the task_id comes from the tool_result, so we use description as temp key
      const key = taskId || `pending_${desc.substring(0, 50)}_${e.timestamp}`;
      if (!tasks.has(key)) {
        tasks.set(key, {
          taskId: taskId || key,
          description: desc,
          assignee,
          stateTransitions: [{
            from: 'none',
            to: 'created',
            durationSec: 0,
            trigger: 'orchestrator_create',
            timestamp: e.timestamp,
          }],
          totalDurationSec: 0,
          outputArtifacts: [],
        });
      }
    }

    if (mcpName === 'accept_task') {
      const taskId = input.task_id as string;
      const task = findOrCreateTask(tasks, taskId, e.timestamp);
      const lastState = task.stateTransitions[task.stateTransitions.length - 1];
      const dur = calcDuration(lastState.timestamp, e.timestamp);
      task.stateTransitions.push({
        from: lastState.to,
        to: input.accepted ? 'accepted' : 'rejected',
        durationSec: dur,
        trigger: input.accepted ? 'agent_accept' : 'agent_reject',
        timestamp: e.timestamp,
      });
    }

    if (mcpName === 'update_task') {
      const taskId = input.task_id as string;
      const task = findOrCreateTask(tasks, taskId, e.timestamp);
      const lastState = task.stateTransitions[task.stateTransitions.length - 1];
      const dur = calcDuration(lastState.timestamp, e.timestamp);
      const newStatus = (input.status as string) || 'in_progress';
      task.stateTransitions.push({
        from: lastState.to,
        to: newStatus,
        durationSec: dur,
        trigger: 'agent_update',
        timestamp: e.timestamp,
      });
    }

    if (mcpName === 'complete_task') {
      const taskId = input.task_id as string;
      const task = findOrCreateTask(tasks, taskId, e.timestamp);
      const lastState = task.stateTransitions[task.stateTransitions.length - 1];
      const dur = calcDuration(lastState.timestamp, e.timestamp);
      task.stateTransitions.push({
        from: lastState.to,
        to: 'done',
        durationSec: dur,
        trigger: 'agent_complete',
        timestamp: e.timestamp,
      });

      // Calculate total duration
      const firstTs = task.stateTransitions[0].timestamp;
      task.totalDurationSec = calcDuration(firstTs, e.timestamp);

      // Record artifact if mentioned
      const artifact = input.artifact as string;
      if (artifact) {
        task.outputArtifacts.push({ filename: artifact, sizeBytes: 0 });
      }
    }
  }

  // Calculate totalDurationSec for incomplete tasks
  for (const task of tasks.values()) {
    if (task.totalDurationSec === 0 && task.stateTransitions.length > 1) {
      const first = task.stateTransitions[0].timestamp;
      const last = task.stateTransitions[task.stateTransitions.length - 1].timestamp;
      task.totalDurationSec = calcDuration(first, last);
    }
  }

  // Remove pending_ tasks that are phantom duplicates of real tasks.
  // These arise when Codex's create_task MCP call is logged as a raw message (creating a pending_
  // entry) while the hub also tracks the task under a real UUID. We match by:
  //   1. Assignee overlap (any real task covers this agent)
  //   2. Description similarity (pending_ description is a substring of a real task's description or vice versa)
  // Keep pending_ tasks only if the assignee has NO real tasks AND no description match exists.
  const realTasks: Array<{ assignee: string; description: string }> = [];
  for (const [key, task] of tasks) {
    if (!key.startsWith('pending_')) {
      realTasks.push({
        assignee: (task.assignee || '').toLowerCase(),
        description: (task.description || '').toLowerCase().substring(0, 80),
      });
    }
  }
  for (const [key, task] of tasks) {
    if (key.startsWith('pending_')
      && task.stateTransitions.length === 1
      && task.stateTransitions[0].to === 'created') {
      const pendingDesc = (task.description || '').toLowerCase().substring(0, 60);
      const pendingAssignee = (task.assignee || '').toLowerCase();

      // Check if any real task has a matching assignee OR overlapping description
      const hasMatch = realTasks.some(rt =>
        rt.assignee === pendingAssignee ||
        (pendingDesc.length > 15 && (rt.description.includes(pendingDesc.substring(0, 30)) || pendingDesc.includes(rt.description.substring(0, 30))))
      );

      // Also drop if there are real tasks at all and this pending task never progressed
      const hasAnyRealTasks = realTasks.length > 0;

      if (hasMatch || hasAnyRealTasks) {
        tasks.delete(key);
      }
    }
  }

  return [...tasks.values()];
}

function findOrCreateTask(
  tasks: Map<string, TaskMetrics>,
  taskId: string,
  timestamp: string,
): TaskMetrics {
  if (!tasks.has(taskId)) {
    tasks.set(taskId, {
      taskId,
      description: '',
      assignee: '',
      stateTransitions: [{
        from: 'none',
        to: 'created',
        durationSec: 0,
        trigger: 'unknown',
        timestamp,
      }],
      totalDurationSec: 0,
      outputArtifacts: [],
    });
  }
  return tasks.get(taskId)!;
}

function extractArtifacts(events: NormalizedEvent[]): ArtifactMetrics[] {
  const artifactMap = new Map<string, ArtifactMetrics>();

  for (const e of events) {
    if (e.type !== 'tool_call') continue;
    const toolName = e.payload.toolName || '';
    const mcpMatch = toolName.match(/^mcp__vibehq_\w+__(\w+)$/);
    const mcpName = mcpMatch ? mcpMatch[1] : '';

    if (mcpName === 'publish_artifact' || mcpName === 'share_file') {
      const input = e.payload.toolInput || {};
      const filename = (input.filename as string) || (input.name as string) || 'unknown';
      const content = (input.content as string) || '';
      const sizeBytes = Buffer.byteLength(content, 'utf-8');

      const existing = artifactMap.get(filename);
      if (existing) {
        existing.publishAttempts++;
        existing.finalSize = sizeBytes;
        existing.sizeBytes = sizeBytes;
      } else {
        artifactMap.set(filename, {
          filename,
          producer: e.agentId,
          sizeBytes,
          publishAttempts: 1,
          firstAttemptSize: sizeBytes,
          finalSize: sizeBytes,
        });
      }
    }
  }

  return [...artifactMap.values()];
}

function detectPhases(events: NormalizedEvent[], tasks: TaskMetrics[]): PhaseMetrics[] {
  const phases = new Map<string, { start: string; end: string }>();

  // Use task descriptions to assign phases
  for (const task of tasks) {
    for (const [phaseName, regex] of Object.entries(PHASE_KEYWORDS)) {
      if (regex.test(task.description)) {
        const taskStart = task.stateTransitions[0]?.timestamp || '';
        const taskEnd = task.stateTransitions[task.stateTransitions.length - 1]?.timestamp || taskStart;

        const existing = phases.get(phaseName);
        if (existing) {
          if (taskStart < existing.start) existing.start = taskStart;
          if (taskEnd > existing.end) existing.end = taskEnd;
        } else {
          phases.set(phaseName, { start: taskStart, end: taskEnd });
        }
        break; // first match wins
      }
    }
  }

  return [...phases.entries()].map(([name, { start, end }]) => ({
    name,
    start,
    end,
    durationSec: calcDuration(start, end),
  })).sort((a, b) => a.start.localeCompare(b.start));
}

/**
 * Agent utilization: group events into activity windows (gaps > 30s = idle),
 * sum active window durations / total span.
 */
function computeAgentUtilization(agentEvents: NormalizedEvent[]): {
  activeTimeSec: number; totalRunTimeSec: number; ratio: number;
} {
  const timestamps = agentEvents
    .map(e => e.timestamp)
    .filter(Boolean)
    .map(t => new Date(t).getTime())
    .sort((a, b) => a - b);

  if (timestamps.length < 2) {
    return { activeTimeSec: 0, totalRunTimeSec: 0, ratio: 0 };
  }

  const totalRunTimeSec = Math.round((timestamps[timestamps.length - 1] - timestamps[0]) / 1000);
  const IDLE_GAP_MS = 30_000; // 30s gap = idle
  let activeMs = 0;
  let windowStart = timestamps[0];

  for (let i = 1; i < timestamps.length; i++) {
    const gap = timestamps[i] - timestamps[i - 1];
    if (gap > IDLE_GAP_MS) {
      // Close current window
      activeMs += timestamps[i - 1] - windowStart;
      windowStart = timestamps[i];
    }
  }
  // Close final window
  activeMs += timestamps[timestamps.length - 1] - windowStart;

  const activeTimeSec = Math.round(activeMs / 1000);
  return {
    activeTimeSec,
    totalRunTimeSec,
    ratio: totalRunTimeSec > 0 ? Math.round((activeTimeSec / totalRunTimeSec) * 100) / 100 : 0,
  };
}

/**
 * Parallel efficiency: sample the timeline at 1s intervals, count how many
 * agents are active in each slot, then average / total agents.
 * "Active" = agent had an event within ±15s of that time slot.
 */
function computeParallelEfficiency(
  events: NormalizedEvent[],
  agentIds: string[],
  totalDurationSec: number,
): number {
  if (totalDurationSec === 0 || agentIds.length <= 1) return 1;

  // Build per-agent timestamp arrays
  const agentTimestamps = new Map<string, number[]>();
  for (const id of agentIds) agentTimestamps.set(id, []);
  for (const e of events) {
    if (!e.timestamp || !e.agentId) continue;
    agentTimestamps.get(e.agentId)?.push(new Date(e.timestamp).getTime());
  }
  // Sort each
  for (const ts of agentTimestamps.values()) ts.sort((a, b) => a - b);

  const allTs = events.map(e => e.timestamp).filter(Boolean).map(t => new Date(t).getTime());
  const runStart = Math.min(...allTs);
  const runEnd = Math.max(...allTs);

  const WINDOW_MS = 15_000; // agent counts as "active" if event within 15s
  const STEP_MS = 5_000;    // sample every 5s for performance
  let totalSlots = 0;
  let totalActive = 0;

  for (let t = runStart; t <= runEnd; t += STEP_MS) {
    totalSlots++;
    for (const [, ts] of agentTimestamps) {
      // Binary search for nearest event
      let lo = 0, hi = ts.length - 1;
      let minDist = Infinity;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const dist = Math.abs(ts[mid] - t);
        if (dist < minDist) minDist = dist;
        if (ts[mid] < t) lo = mid + 1;
        else hi = mid - 1;
      }
      if (minDist <= WINDOW_MS) totalActive++;
    }
  }

  return totalSlots > 0
    ? Math.round((totalActive / (totalSlots * agentIds.length)) * 100) / 100
    : 0;
}

// ─── Cost estimation ───
// Pricing per 1M tokens (USD) — Claude Opus 4.6 / Sonnet 4.6 / Haiku 4.5
const MODEL_PRICING: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {
  'claude-opus-4-6':    { input: 15,  output: 75,  cacheRead: 1.5,   cacheWrite: 18.75 },
  'claude-sonnet-4-6':  { input: 3,   output: 15,  cacheRead: 0.3,   cacheWrite: 3.75  },
  'claude-haiku-4-5':   { input: 0.8, output: 4,   cacheRead: 0.08,  cacheWrite: 1     },
  // Fallback
  'default':            { input: 15,  output: 75,  cacheRead: 1.5,   cacheWrite: 18.75 },
};

function computeCostEstimate(agents: AgentMetrics[]): RunMetrics['costEstimate'] {
  // Detect model from agents (use most common)
  const modelCounts = new Map<string, number>();
  for (const a of agents) {
    const m = a.model || 'default';
    modelCounts.set(m, (modelCounts.get(m) || 0) + 1);
  }
  const detectedModel = [...modelCounts.entries()]
    .sort((a, b) => b[1] - a[1])[0]?.[0] || 'default';

  // Match pricing — try exact match, then prefix match
  const pricing = MODEL_PRICING[detectedModel]
    || Object.entries(MODEL_PRICING).find(([k]) => detectedModel.startsWith(k.replace(/-\d+$/, '')))?.[1]
    || MODEL_PRICING['default'];

  const perM = 1_000_000;
  let inputCost = 0, outputCost = 0, cacheReadCost = 0, cacheWriteCost = 0;
  const perAgentCost: { agentId: string; costUsd: number }[] = [];

  for (const a of agents) {
    const ic = (a.tokens.inputTokens / perM) * pricing.input;
    const oc = (a.tokens.outputTokens / perM) * pricing.output;
    const crc = (a.tokens.cacheReadTokens / perM) * pricing.cacheRead;
    const cwc = (a.tokens.cacheWriteTokens / perM) * pricing.cacheWrite;
    inputCost += ic;
    outputCost += oc;
    cacheReadCost += crc;
    cacheWriteCost += cwc;
    perAgentCost.push({
      agentId: a.agentId,
      costUsd: Math.round((ic + oc + crc + cwc) * 10000) / 10000,
    });
  }

  const totalCostUsd = Math.round((inputCost + outputCost + cacheReadCost + cacheWriteCost) * 10000) / 10000;

  return {
    totalCostUsd,
    breakdown: {
      inputCost: Math.round(inputCost * 10000) / 10000,
      outputCost: Math.round(outputCost * 10000) / 10000,
      cacheReadCost: Math.round(cacheReadCost * 10000) / 10000,
      cacheWriteCost: Math.round(cacheWriteCost * 10000) / 10000,
    },
    perAgentCost,
    model: detectedModel,
  };
}

function calcDuration(start: string, end: string): number {
  if (!start || !end) return 0;
  return Math.max(0, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 1000));
}
