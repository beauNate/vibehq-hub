// ─── Normalized Event (Stage 0 output) ───

export interface NormalizedEvent {
  timestamp: string; // ISO 8601
  type: 'user_message' | 'assistant_message' | 'tool_call' | 'tool_result' | 'thinking' | 'meta';
  agentId: string;
  agentRole: 'orchestrator' | 'worker';
  sourceFormat: 'claude' | 'codex';
  payload: EventPayload;
}

export interface EventPayload {
  message?: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolUseId?: string;
  toolOutput?: string;
  tokenUsage?: TokenUsage;
  model?: string;
  sessionId?: string;
  cwd?: string;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
}

// ─── Run Metrics (Stage 1 output) ───

export interface RunMetrics {
  runId: string;
  taskDescription: string;
  startTime: string;
  endTime: string;
  totalDurationSec: number;
  totalAgents: number;
  totalTurns: number;
  totalToolCalls: number;

  tokenSummary: {
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCacheWriteTokens: number;
    totalCacheReadTokens: number;
    totalTokens: number;
  };

  coordinationOverhead: {
    turnBasedRatio: number;  // orchestrator_turns / total_turns
    tokenBasedRatio: number; // orchestrator_output_tokens / total_output_tokens
  };

  taskSummary: {
    totalTaskTimeSec: number;     // sum of all task durations
    parallelEfficiency: number;   // avg concurrent active agents / total agents
  };

  costEstimate: {
    totalCostUsd: number;
    breakdown: {
      inputCost: number;
      outputCost: number;
      cacheReadCost: number;
      cacheWriteCost: number;
    };
    perAgentCost: { agentId: string; costUsd: number }[];
    model: string;  // model used for pricing
  };

  agents: AgentMetrics[];
  tasks: TaskMetrics[];
  artifacts: ArtifactMetrics[];
  phases: PhaseMetrics[];

  /** Shared files on disk (from hub team state directory) — used to cross-reference artifact sizes */
  sharedFiles?: { filename: string; sizeBytes: number; producer?: string }[];
}

export interface AgentMetrics {
  agentId: string;
  agentRole: 'orchestrator' | 'worker';
  model: string;
  turns: number;
  toolCalls: Record<string, number>;
  tokens: {
    inputTokens: number;
    outputTokens: number;
    cacheWriteTokens: number;
    cacheReadTokens: number;
  };
  contextGrowth: {
    firstTurnContextSize: number;
    lastTurnContextSize: number;
    bloatRatio: number;
  };
  mcpToolCalls: Record<string, number>;   // only vibehq MCP tools
  nativeToolCalls: Record<string, number>; // Write, Edit, Bash, etc.
  implementationToolUsed: boolean;

  /** Agent utilization: fraction of total run time the agent was actively working */
  utilization: {
    activeTimeSec: number;      // seconds with events (within activity windows)
    totalRunTimeSec: number;    // wall clock from agent's first to last event
    ratio: number;              // activeTimeSec / totalRunTimeSec
  };
}

export interface TaskMetrics {
  taskId: string;
  description: string;
  assignee: string;
  stateTransitions: {
    from: string;
    to: string;
    durationSec: number;
    trigger: string;
    timestamp: string;
  }[];
  totalDurationSec: number;
  outputArtifacts: { filename: string; sizeBytes: number }[];
}

export interface ArtifactMetrics {
  filename: string;
  producer: string;
  sizeBytes: number;
  publishAttempts: number;
  firstAttemptSize: number;
  finalSize: number;
}

export interface PhaseMetrics {
  name: string;
  start: string;
  end: string;
  durationSec: number;
}

// ─── Detected Flags (Stage 2 output) ───

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export interface DetectedFlag {
  ruleId: string;
  severity: Severity;
  description: string;
  count: number;
  details: Record<string, unknown>[];
}

export interface DetectedFlags {
  flags: DetectedFlag[];
  summary: Record<Severity, number> & { total: number };
}

// ─── Fix Actions (Stage 3 LLM output for auto-optimization) ───

export interface FixAction {
  priority: 'P0' | 'P1' | 'P2';
  target_file: string;
  target_param?: string;
  action: 'modify' | 'add' | 'remove';
  current_value?: string;
  suggested_value?: string;
  rationale: string;
  detection_rule: string;
}

// ─── Analysis Result (full pipeline output) ───

export interface AnalysisResult {
  metrics: RunMetrics;
  flags: DetectedFlags;
}
