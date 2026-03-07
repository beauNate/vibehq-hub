import type { NormalizedEvent, RunMetrics, DetectedFlags } from './types.js';
import { loadConfig } from './config.js';

const ANALYST_SYSTEM_PROMPT = `You are VibHQ's post-run analyst. You receive structured metrics and detected flags from a multi-agent team session.

Output a Run Report Card in JSON format with the following sections.
Be specific — cite agent names, task IDs, and exact numbers.
Do not give generic advice. Every suggestion must reference specific data from this run.`;

function buildUserPrompt(
  metrics: RunMetrics,
  flags: DetectedFlags,
  sampledMessages: SampledMessage[],
): string {
  return `## Run Metrics
${JSON.stringify(metrics, null, 2)}

## Detected Flags
${JSON.stringify(flags, null, 2)}

## Sampled Messages (${sampledMessages.length} most relevant)
${JSON.stringify(sampledMessages, null, 2)}

## Output Format
Return ONLY valid JSON (no markdown fences, no explanation before/after):
{
  "overall_grade": "A|B|C|D|F",
  "grade_reasoning": "string",

  "coordination_assessment": {
    "orchestrator_efficiency": "string",
    "task_routing_quality": "string",
    "issues": ["string"]
  },

  "token_assessment": {
    "coordination_overhead_pct": number,
    "context_bloat_worst_agent": "string",
    "wasted_token_categories": [
      { "category": "string", "estimated_tokens": number, "suggestion": "string" }
    ]
  },

  "per_agent_scores": [
    {
      "agent_id": "string",
      "score": number,
      "strengths": ["string"],
      "issues": ["string"]
    }
  ],

  "failure_recovery_assessment": {
    "flags_resolved": number,
    "flags_unresolved": number,
    "details": ["string"]
  },

  "improvement_suggestions": [
    {
      "priority": "P0|P1|P2",
      "target": "framework|orchestrator_prompt|task_contract|agent_prompt",
      "suggestion": "string",
      "expected_impact": "string"
    }
  ]
}`;
}

interface SampledMessage {
  timestamp: string;
  agent: string;
  role: string;
  type: string;
  message: string;
}

export function sampleMessages(events: NormalizedEvent[], maxSamples: number = 15): SampledMessage[] {
  const sampled: NormalizedEvent[] = [];
  const seen = new Set<string>();

  const add = (e: NormalizedEvent) => {
    const key = `${e.timestamp}_${e.agentId}_${e.type}`;
    if (!seen.has(key)) {
      seen.add(key);
      sampled.push(e);
    }
  };

  // 1. Orchestrator messages about task state changes
  for (const e of events) {
    if (e.type === 'assistant_message' && e.agentRole === 'orchestrator' && e.payload.message) {
      const msg = e.payload.message.toLowerCase();
      if (['assigned', 'done', 'blocked', 'reassign', 'complete', 'fallback', 'unresponsive'].some(kw => msg.includes(kw))) {
        add(e);
      }
    }
  }

  // 2. Problem-related messages
  for (const e of events) {
    if ((e.type === 'assistant_message' || e.type === 'user_message') && e.payload.message) {
      const msg = e.payload.message.toLowerCase();
      if (['stub', 'placeholder', 'suspiciously', 'unresponsive', 'mismatch', 'failed', 'error', 'short-circuit', 'bytes'].some(kw => msg.includes(kw))) {
        add(e);
      }
    }
  }

  // 3. First and last message per agent
  const agentIds = [...new Set(events.map(e => e.agentId))];
  for (const agentId of agentIds) {
    const agentMsgs = events.filter(
      e => e.agentId === agentId && e.type === 'assistant_message' && e.payload.message
    );
    if (agentMsgs.length > 0) {
      add(agentMsgs[0]);
      add(agentMsgs[agentMsgs.length - 1]);
    }
  }

  // 4. QA-related messages
  for (const e of events) {
    if (e.type === 'assistant_message' && e.payload.message) {
      const msg = e.payload.message.toLowerCase();
      if (['qa complete', 'validated', 'flags', 'corrected', 'verified'].some(kw => msg.includes(kw))) {
        add(e);
      }
    }
  }

  // Sort by timestamp, truncate
  sampled.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const limited = sampled.slice(0, maxSamples);

  return limited.map(e => ({
    timestamp: e.timestamp,
    agent: e.agentId,
    role: e.agentRole,
    type: e.type,
    message: (e.payload.message || '').substring(0, 500),
  }));
}

export interface LlmAnalystOptions {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  provider?: 'anthropic' | 'openai';
}

export async function runLlmAnalysis(
  metrics: RunMetrics,
  flags: DetectedFlags,
  events: NormalizedEvent[],
  cliOptions?: LlmAnalystOptions,
): Promise<Record<string, unknown>> {
  // Load config with priority: CLI > env > project config > global config > defaults
  const config = loadConfig(cliOptions);
  const { provider, apiKey, model, baseUrl } = config.llm;

  if (!apiKey) {
    throw new Error(
      'No API key configured. Set it via one of:\n'
      + '  1. CLI flag:    --api-key <key>\n'
      + '  2. Env var:     ANTHROPIC_API_KEY or OPENAI_API_KEY\n'
      + '  3. Config:      vibehq-analyze config --set-key <key>\n'
      + '  4. Config file: ~/.vibehq/analytics/config.json'
    );
  }

  const sampled = sampleMessages(events);
  const userPrompt = buildUserPrompt(metrics, flags, sampled);

  const response = provider === 'openai'
    ? await callOpenAI(apiKey, model, baseUrl || 'https://api.openai.com', userPrompt)
    : await callAnthropic(apiKey, model, baseUrl || 'https://api.anthropic.com', userPrompt);

  return parseJsonResponse(response);
}

async function callAnthropic(apiKey: string, model: string, baseUrl: string, userPrompt: string) {
  return fetch(`${baseUrl}/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      system: ANALYST_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  }).then(async (res) => {
    if (!res.ok) throw new Error(`Anthropic API error ${res.status}: ${await res.text()}`);
    const data = await res.json() as { content: { type: string; text?: string }[] };
    const text = data.content.find(c => c.type === 'text')?.text;
    if (!text) throw new Error('No text in Anthropic response');
    return text;
  });
}

async function callOpenAI(apiKey: string, model: string, baseUrl: string, userPrompt: string) {
  return fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      messages: [
        { role: 'system', content: ANALYST_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
    }),
  }).then(async (res) => {
    if (!res.ok) throw new Error(`OpenAI API error ${res.status}: ${await res.text()}`);
    const data = await res.json() as { choices: { message: { content: string } }[] };
    const text = data.choices?.[0]?.message?.content;
    if (!text) throw new Error('No text in OpenAI response');
    return text;
  });
}

async function parseJsonResponse(textPromise: Promise<string>): Promise<Record<string, unknown>> {
  const raw = await textPromise;
  let jsonText = raw.trim();
  if (jsonText.startsWith('```')) {
    jsonText = jsonText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }
  try {
    return JSON.parse(jsonText);
  } catch (e) {
    throw new Error(`Failed to parse LLM response as JSON: ${(e as Error).message}\nRaw: ${jsonText.substring(0, 500)}`);
  }
}

export function shouldTriggerLlm(flags: DetectedFlags): boolean {
  return flags.summary.critical > 0
    || flags.summary.high > 2;
}

export function formatReportCard(card: Record<string, unknown>): string {
  const lines: string[] = [];
  const w = 70;
  const border = '═'.repeat(w);

  lines.push(`╔${border}╗`);
  lines.push(`║ ${'LLM Report Card' + ' '.repeat(w - 15)}║`);
  lines.push(`║ Grade: ${(card.overall_grade as string) || '?'}${' '.repeat(Math.max(0, w - 8 - String(card.overall_grade || '?').length))}║`);
  lines.push(`╠${border}╣`);

  // Grade reasoning
  if (card.grade_reasoning) {
    const reason = String(card.grade_reasoning);
    for (const chunk of wrapText(reason, w - 2)) {
      lines.push(`║ ${chunk}${' '.repeat(Math.max(0, w - chunk.length))}║`);
    }
    lines.push(`╠${border}╣`);
  }

  // Per-agent scores
  const agentScores = card.per_agent_scores as { agent_id: string; score: number; strengths: string[]; issues: string[] }[] | undefined;
  if (agentScores && Array.isArray(agentScores)) {
    lines.push(`║ ${'Per-Agent Scores' + ' '.repeat(w - 16)}║`);
    for (const a of agentScores) {
      lines.push(`║   ${a.agent_id}: ${a.score}/10${' '.repeat(Math.max(0, w - 8 - a.agent_id.length - String(a.score).length))}║`);
      for (const s of (a.strengths || []).slice(0, 2)) {
        const txt = `    + ${s}`.substring(0, w);
        lines.push(`║ ${txt}${' '.repeat(Math.max(0, w - txt.length))}║`);
      }
      for (const i of (a.issues || []).slice(0, 2)) {
        const txt = `    - ${i}`.substring(0, w);
        lines.push(`║ ${txt}${' '.repeat(Math.max(0, w - txt.length))}║`);
      }
    }
    lines.push(`╠${border}╣`);
  }

  // Improvement suggestions
  const suggestions = card.improvement_suggestions as { priority: string; target: string; suggestion: string }[] | undefined;
  if (suggestions && Array.isArray(suggestions)) {
    lines.push(`║ ${'Improvement Suggestions' + ' '.repeat(w - 23)}║`);
    for (const s of suggestions) {
      const header = `  [${s.priority}] ${s.target}`;
      lines.push(`║ ${header}${' '.repeat(Math.max(0, w - header.length))}║`);
      for (const chunk of wrapText(`    ${s.suggestion}`, w - 2)) {
        lines.push(`║ ${chunk}${' '.repeat(Math.max(0, w - chunk.length))}║`);
      }
    }
  }

  lines.push(`╚${border}╝`);
  return lines.join('\n');
}

function wrapText(text: string, maxWidth: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if (current.length + word.length + 1 > maxWidth) {
      lines.push(current);
      current = word;
    } else {
      current = current ? current + ' ' + word : word;
    }
  }
  if (current) lines.push(current);
  return lines;
}
