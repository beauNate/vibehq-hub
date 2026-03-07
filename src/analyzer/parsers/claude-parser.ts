import { readFileSync } from 'fs';
import type { NormalizedEvent, TokenUsage } from '../types.js';

interface ClaudeMessage {
  role: string;
  content: string | ClaudeContentBlock[];
  usage?: ClaudeUsage;
  model?: string;
}

interface ClaudeContentBlock {
  type: string;
  text?: string;
  thinking?: string;
  name?: string;
  input?: Record<string, unknown>;
  id?: string;
  tool_use_id?: string;
  content?: string | ClaudeContentBlock[];
}

interface ClaudeUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

interface ClaudeLine {
  type: string;
  timestamp: string;
  uuid?: string;
  sessionId?: string;
  cwd?: string;
  message?: ClaudeMessage;
  userType?: string;
}

export function parseClaudeLog(filePath: string): NormalizedEvent[] {
  const raw = readFileSync(filePath, 'utf-8');
  const lines = raw.split('\n').filter(Boolean);
  const events: NormalizedEvent[] = [];

  let agentId = '';
  let sessionId = '';
  let model = '';
  let cwd = '';

  // First pass: detect agent name from MCP tool names
  for (const line of lines) {
    try {
      const d: ClaudeLine = JSON.parse(line);
      if (d.sessionId && !sessionId) sessionId = d.sessionId;
      if (d.cwd && !cwd) cwd = d.cwd;
      if (d.type === 'assistant' && d.message?.content && Array.isArray(d.message.content)) {
        if (d.message.model && !model) model = d.message.model;
        for (const block of d.message.content) {
          if (block.type === 'tool_use' && block.name) {
            const match = block.name.match(/^mcp__vibehq_(\w+)__/);
            if (match && !agentId) {
              agentId = match[1];
            }
          }
        }
      }
    } catch { /* skip malformed lines */ }
  }

  if (!agentId) agentId = sessionId.substring(0, 8);

  // Emit meta event
  events.push({
    timestamp: '',
    type: 'meta',
    agentId,
    agentRole: 'worker', // Claude agents in this dataset are workers
    sourceFormat: 'claude',
    payload: { model, sessionId, cwd },
  });

  // Second pass: parse events
  for (const line of lines) {
    try {
      const d: ClaudeLine = JSON.parse(line);
      if (!d.timestamp || !d.type) continue;

      if (d.type === 'user' && d.message) {
        if (d.userType === 'external' && typeof d.message.content === 'string') {
          events.push({
            timestamp: d.timestamp,
            type: 'user_message',
            agentId,
            agentRole: 'worker',
            sourceFormat: 'claude',
            payload: { message: d.message.content },
          });
        }
        // tool_result blocks
        if (Array.isArray(d.message.content)) {
          for (const block of d.message.content as ClaudeContentBlock[]) {
            if (block.type === 'tool_result') {
              const output = typeof block.content === 'string'
                ? block.content
                : Array.isArray(block.content)
                  ? block.content.map(c => c.text || '').join('')
                  : '';
              events.push({
                timestamp: d.timestamp,
                type: 'tool_result',
                agentId,
                agentRole: 'worker',
                sourceFormat: 'claude',
                payload: {
                  toolUseId: block.tool_use_id,
                  toolOutput: output.substring(0, 2000),
                },
              });
            }
          }
        }
      }

      if (d.type === 'assistant' && d.message) {
        const tokenUsage = d.message.usage ? normalizeTokenUsage(d.message.usage) : undefined;

        if (Array.isArray(d.message.content)) {
          let hasText = false;
          for (const block of d.message.content) {
            if (block.type === 'text' && block.text) {
              hasText = true;
              events.push({
                timestamp: d.timestamp,
                type: 'assistant_message',
                agentId,
                agentRole: 'worker',
                sourceFormat: 'claude',
                payload: { message: block.text, tokenUsage },
              });
            }
            if (block.type === 'thinking' && block.thinking) {
              events.push({
                timestamp: d.timestamp,
                type: 'thinking',
                agentId,
                agentRole: 'worker',
                sourceFormat: 'claude',
                payload: { message: block.thinking.substring(0, 500) },
              });
            }
            if (block.type === 'tool_use') {
              events.push({
                timestamp: d.timestamp,
                type: 'tool_call',
                agentId,
                agentRole: 'worker',
                sourceFormat: 'claude',
                payload: {
                  toolName: block.name,
                  toolInput: block.input as Record<string, unknown>,
                  toolUseId: block.id,
                  tokenUsage,
                },
              });
            }
          }
          // If only thinking + tool_use (no text), still emit assistant_message for turn counting with token usage
          if (!hasText && tokenUsage) {
            events.push({
              timestamp: d.timestamp,
              type: 'assistant_message',
              agentId,
              agentRole: 'worker',
              sourceFormat: 'claude',
              payload: { tokenUsage },
            });
          }
        }
      }
    } catch { /* skip malformed lines */ }
  }

  // Set meta timestamp to first real event
  const firstReal = events.find(e => e.type !== 'meta' && e.timestamp);
  if (firstReal) events[0].timestamp = firstReal.timestamp;

  return events;
}

function normalizeTokenUsage(usage: ClaudeUsage): TokenUsage {
  return {
    inputTokens: usage.input_tokens || 0,
    outputTokens: usage.output_tokens || 0,
    cacheCreationInputTokens: usage.cache_creation_input_tokens || 0,
    cacheReadInputTokens: usage.cache_read_input_tokens || 0,
  };
}
