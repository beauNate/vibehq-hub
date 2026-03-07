import { readFileSync } from 'fs';
import type { NormalizedEvent } from '../types.js';

interface CodexLine {
  timestamp: string;
  type: string;
  payload?: Record<string, unknown>;
}

export function parseCodexLog(filePath: string): NormalizedEvent[] {
  const raw = readFileSync(filePath, 'utf-8');
  const lines = raw.split('\n').filter(Boolean);
  const events: NormalizedEvent[] = [];

  let agentId = '';
  let model = '';
  let cwd = '';
  let sessionId = '';

  // Parse all lines
  for (const line of lines) {
    try {
      const d: CodexLine = JSON.parse(line);
      if (!d.type) continue;

      // session_meta: extract session info
      if (d.type === 'session_meta' && d.payload) {
        sessionId = (d.payload.id as string) || '';
        cwd = (d.payload.cwd as string) || '';
      }

      // turn_context: extract model and cwd
      if (d.type === 'turn_context' && d.payload) {
        if (!model) model = (d.payload.model as string) || '';
        if (!cwd) cwd = (d.payload.cwd as string) || '';
      }

      // Detect agent name from MCP tool calls
      if (d.type === 'response_item' && d.payload) {
        const p = d.payload;
        if (p.type === 'function_call' && typeof p.name === 'string') {
          const match = p.name.match(/^mcp__vibehq_(\w+)__/);
          if (match && !agentId) {
            agentId = match[1];
          }
        }
      }
    } catch { /* skip */ }
  }

  if (!agentId) agentId = sessionId.substring(0, 8);

  // Determine role - if the agent uses create_task/assign_task, it's the orchestrator
  const isOrchestrator = lines.some(l => {
    try {
      const d = JSON.parse(l);
      return d.type === 'response_item'
        && d.payload?.type === 'function_call'
        && typeof d.payload.name === 'string'
        && (d.payload.name.includes('create_task') || d.payload.name.includes('assign_task'));
    } catch { return false; }
  });
  const agentRole = isOrchestrator ? 'orchestrator' as const : 'worker' as const;

  // Emit meta
  events.push({
    timestamp: '',
    type: 'meta',
    agentId,
    agentRole,
    sourceFormat: 'codex',
    payload: { model, sessionId, cwd },
  });

  // Second pass: build events
  for (const line of lines) {
    try {
      const d: CodexLine = JSON.parse(line);
      if (!d.timestamp) continue;

      if (d.type === 'event_msg' && d.payload) {
        const evType = d.payload.type as string;

        if (evType === 'user_message') {
          events.push({
            timestamp: d.timestamp,
            type: 'user_message',
            agentId,
            agentRole,
            sourceFormat: 'codex',
            payload: { message: d.payload.message as string },
          });
        }

        if (evType === 'agent_message') {
          events.push({
            timestamp: d.timestamp,
            type: 'assistant_message',
            agentId,
            agentRole,
            sourceFormat: 'codex',
            payload: { message: d.payload.message as string },
          });
        }

        if (evType === 'agent_reasoning') {
          events.push({
            timestamp: d.timestamp,
            type: 'thinking',
            agentId,
            agentRole,
            sourceFormat: 'codex',
            payload: { message: d.payload.text as string },
          });
        }
      }

      // Function calls
      if (d.type === 'response_item' && d.payload) {
        const p = d.payload;
        if (p.type === 'function_call') {
          let input: Record<string, unknown> = {};
          if (typeof p.arguments === 'string') {
            try { input = JSON.parse(p.arguments as string); } catch { /* ignore */ }
          } else if (typeof p.arguments === 'object' && p.arguments) {
            input = p.arguments as Record<string, unknown>;
          }
          events.push({
            timestamp: d.timestamp,
            type: 'tool_call',
            agentId,
            agentRole,
            sourceFormat: 'codex',
            payload: {
              toolName: p.name as string,
              toolInput: input,
              toolUseId: p.call_id as string,
            },
          });
        }

        if (p.type === 'function_call_output') {
          const output = typeof p.output === 'string' ? p.output : JSON.stringify(p.output);
          events.push({
            timestamp: d.timestamp,
            type: 'tool_result',
            agentId,
            agentRole,
            sourceFormat: 'codex',
            payload: {
              toolUseId: p.call_id as string,
              toolOutput: output.substring(0, 2000),
            },
          });
        }
      }
    } catch { /* skip */ }
  }

  // Set meta timestamp
  const firstReal = events.find(e => e.type !== 'meta' && e.timestamp);
  if (firstReal) events[0].timestamp = firstReal.timestamp;

  return events;
}
