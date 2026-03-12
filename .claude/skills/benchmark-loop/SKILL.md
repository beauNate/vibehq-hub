---
name: benchmark-loop
description: Fully automated self-improving loop — takes a project prompt, designs a team, runs the benchmark, analyzes results, optimizes framework code, rebuilds, and repeats until target grade is reached.
argument-hint: "<project description>" [--target <grade>] [--port <number>] [--max-iterations <number>]
---

# /benchmark-loop

You are an autonomous benchmark runner for VibeHQ. Given a single project prompt, you design the team, run the benchmark, analyze results, optimize the framework, and repeat — fully unattended.

## Loop overview

```
┌─────────────────────────────────────────────────────┐
│  0. Parse prompt → design team → generate configs   │
│  for each iteration (v1, v2, v3, ...):              │
│    1. Start hub + spawn agents                      │
│    2. Wait for benchmark completion                 │
│    3. Analyze results (vibehq-analyze)              │
│    4. Check stop conditions                         │
│    5. Run /optimize-protocol to fix issues          │
│    6. Rebuild (npx tsup)                            │
│    7. Update loop state → next iteration            │
│ ─────────────────────────────────────────────────── │
└─────────────────────────────────────────────────────┘
```

## Step 0: Check for resume

**ALWAYS start here.** Read `~/.vibehq/analytics/optimizations/loop-state.json` if it exists.

- If it exists and `phase` is NOT `"completed"`, **resume from the saved phase**. Skip to the appropriate step. The team config, dirs, and everything are already saved in loop-state.
- If it does NOT exist OR phase is `"completed"`, this is a fresh run. Continue to Step 1.

Also read `~/.vibehq/analytics/optimizations/history.jsonl` for previous optimization context.

## Step 1: Design the team from prompt

**Input**: The user's $ARGUMENTS contains the project description and optional flags.

Parse the arguments:
- Everything in quotes or before `--` flags is the **project prompt**
- `--target <grade>` — target grade (default: B)
- `--port <number>` — hub port (default: 3013)
- `--max-iterations <number>` — max iterations (default: 8)

### 1a. Analyze the project prompt

Read the project prompt and determine:
1. **Project name** (short, kebab-case, e.g., `chat-app`, `ecommerce`, `blog-platform`)
2. **Required roles** — Always include a PM/orchestrator. Analyze the prompt to determine what specialist roles are needed. Common patterns:
   - Frontend + Backend → need Frontend Engineer + Backend Engineer
   - UI/UX mentioned → need Product Designer
   - Data/ML → need Data Engineer or ML Engineer
   - DevOps/infra → need DevOps Engineer
   - **Default team** (when prompt doesn't specify): PM + Designer + Backend Engineer + Frontend Engineer (4 agents)
3. **Agent names** — assign human names (Emma, Sam, Alex, Jordan, Taylor, Riley, etc.)
4. **Directory structure** — each non-PM agent gets a subdirectory matching their domain (e.g., `design/`, `backend/`, `frontend/`, `data/`, `infra/`)

### 1b. Generate system prompts

For the **PM/Orchestrator**, generate a system prompt that includes:
```
You are <Name>, the Project Manager for: <project prompt>

Project scope:
<break down the user's prompt into concrete deliverables>

Your workflow:
1. Create a project brief (publish_artifact)
2. Create design/spec tasks first, then implementation tasks with proper dependencies
3. Use depends_on and consumes fields to enforce task ordering
4. Track progress via list_tasks, unblock agents, ensure quality
5. When all tasks are done, publish a final status report

Team:
<list each teammate with their role>

You are a COORDINATOR. Never write code. Only use MCP coordination tools.
```

For **worker agents**, do NOT generate custom system prompts — the spawner's built-in role presets are sufficient. Workers automatically know how to use MCP tools and work on assigned tasks.

### 1c. Write config files

1. Write the PM's system prompt to a temp file:
   ```
   /tmp/vibehq-loop-pm-prompt.md
   ```

2. Generate and write the spawn config to `/tmp/vibehq-loop-config.json`:
   ```json
   {
     "team": "<project-name>-benchmark",
     "hubPort": <port>,
     "agents": [
       {
         "name": "Emma",
         "role": "Project Manager",
         "subdir": "",
         "systemPromptFile": "/tmp/vibehq-loop-pm-prompt.md"
       },
       {
         "name": "Sam",
         "role": "Product Designer",
         "subdir": "design",
         "systemPromptFile": null
       },
       {
         "name": "Alex",
         "role": "Backend Engineer",
         "subdir": "backend",
         "systemPromptFile": null
       },
       {
         "name": "Jordan",
         "role": "Frontend Engineer",
         "subdir": "frontend",
         "systemPromptFile": null
       }
     ]
   }
   ```

### 1d. Create initial loop state

**CRITICAL**: The `team` field MUST include the iteration number (e.g., `<project-name>-benchmark-v1`). Each iteration uses a completely fresh team name so that hub state, shared files, and MCP server names don't carry over from previous iterations. The `baseTeam` field stores the base name for reference.

```json
{
  "team": "<project-name>-benchmark-v1",
  "baseTeam": "<project-name>-benchmark",
  "projectPrompt": "<the full user prompt>",
  "currentIteration": 1,
  "phase": "benchmarking",
  "targetGrade": "<target>",
  "maxIterations": <max>,
  "hubPort": <port>,
  "baseDir": "D:\\<project-name>-benchmark",
  "agents": [<copy from spawn config>],
  "iterationDir": "D:\\<project-name>-benchmark-v1",
  "history": []
}
```

Save to `~/.vibehq/analytics/optimizations/loop-state.json`.

### 1e. Print team design for user confirmation

```
========================================
Team designed for: <project prompt>
========================================
Team: <project-name>-benchmark
Port: <port>
Target: <grade>

Agents:
  - Emma (Project Manager) → D:\<project>-benchmark-v1\
  - Sam (Product Designer) → D:\<project>-benchmark-v1\design\
  - Alex (Backend Engineer) → D:\<project>-benchmark-v1\backend\
  - Jordan (Frontend Engineer) → D:\<project>-benchmark-v1\frontend\

Starting iteration 1...
========================================
```

Then immediately proceed to Step 2 (do NOT wait for user confirmation — this is full auto).

## Step 2: Start benchmark

### 2a. Create fresh directories

For iteration N, create a brand new directory tree:

```bash
ITER_DIR="D:\<project-name>-benchmark-v<N>"
mkdir -p "$ITER_DIR"
# Create subdirectories for each agent that has a subdir
mkdir -p "$ITER_DIR/design"
mkdir -p "$ITER_DIR/backend"
mkdir -p "$ITER_DIR/frontend"
```

Also delete the hub-state.json for the team if it exists:
`~/.vibehq/teams/<team-name>/hub-state.json`

### 2b. Start the hub

```bash
node dist/bin/hub.js --port <hubPort> --team <team-name> &
```

Run with `run_in_background: true`. Wait 3 seconds for startup.

### 2c. Spawn agents

Write a Node.js spawn script to `/tmp/vibehq-loop-spawn.js` that reads the config from loop-state and spawns all agents. The script should:

1. Read loop-state.json to get team config, iteration dir, hub port
2. For each agent:
   a. Compute the agent's working directory: `iterationDir + "/" + subdir`
   b. Write a `.cmd` launcher file (Windows):
      ```
      @echo off
      chcp 65001 >nul
      set CLAUDECODE=
      cd /d "<agent-cwd>"
      vibehq-spawn --name "<name>" --role "<role>" --team "<team>" --hub "ws://localhost:<port>" --skip-permissions [--system-prompt-file "<path>"] -- claude
      pause
      ```
   c. Launch with: `wt -w new --title "<name>" cmd /k "<launcher-path>"`
3. Wait 2 seconds between each agent spawn

**CRITICAL**: The `.cmd` files must use Windows syntax (`>nul` not `>/dev/null`, `\r\n` line endings). Use Node.js `fs.writeFileSync()` and `child_process.exec()` — do NOT use bash heredocs to write .cmd files.

**CRITICAL**: Include `set CLAUDECODE=` in every launcher to clear the env var that prevents nested Claude Code sessions.

Run the spawn script:
```bash
node /tmp/vibehq-loop-spawn.js
```

### 2d. Update loop state

Set `phase: "benchmarking"`, save loop-state.json.

## Step 3: Wait for completion

Poll `~/.vibehq/teams/<team-name>/hub-state.json` every 30 seconds.

**Completion check logic:**
- If hub-state.json doesn't exist AND less than 3 minutes passed → keep waiting (agents still loading)
- If hub-state.json doesn't exist AND more than 5 minutes passed → something's wrong, alert user
- Count tasks: if ALL tasks have status `"done"` or `"rejected"` → **COMPLETE**
- If any task is still active → keep waiting

Write a poll script to `/tmp/vibehq-loop-poll.js`:
```javascript
const fs = require('fs');
const path = require('path');
const home = process.env.USERPROFILE || process.env.HOME;
const team = process.argv[2] || 'default';
const statePath = path.join(home, '.vibehq', 'teams', team, 'hub-state.json');

if (!fs.existsSync(statePath)) {
  console.log('NO_STATE');
  process.exit(0);
}

const state = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
const tasks = Object.values(state.tasks || {});
const total = tasks.length;
const done = tasks.filter(t => t.status === 'done' || t.status === 'rejected').length;
const agents = Object.values(state.agents || {});

console.log('Agents: ' + agents.map(a => a.name + '(' + a.status + ')').join(', '));
console.log('Tasks: ' + done + '/' + total);

for (const t of tasks) {
  const icon = t.status === 'done' ? 'v' : t.status === 'in_progress' ? '>' : t.status === 'rejected' ? 'x' : '.';
  console.log('  [' + icon + '] ' + t.title + ' -> ' + t.status + ' (' + (t.assignee || 'unassigned') + ')');
}

if (total > 0 && done === total) console.log('\nCOMPLETE');
else if (total === 0) console.log('\nNO_TASKS');
else console.log('\nWAITING');
```

Use: `node /tmp/vibehq-loop-poll.js <team-name>`

**Polling pattern**: Use `sleep 30 && node /tmp/vibehq-loop-poll.js <team>` with a 60s timeout. Repeat until COMPLETE or 20 minutes elapsed.

**Timeout**: If waiting > 20 minutes, stop and proceed to analysis. Benchmark is likely stuck.

## Step 4: Analyze results

### 4a. Run analysis

```bash
node dist/bin/analyze.js --team <team-name> --with-llm --save --run-id loop-v<N>
```

### 4b. Read results

Read:
- `~/.vibehq/analytics/runs/loop-v<N>/report_card.json`
- `~/.vibehq/analytics/runs/loop-v<N>/detected_flags.json`
- `~/.vibehq/analytics/runs/loop-v<N>/run_metrics.json`

Extract: grade, score, flags count, critical flags count, duration, parallel efficiency.

### 4c. Update loop state

Add this iteration to the history array and set `phase: "analyzed"`.

### 4d. Report

```
========================================
Iteration <N> complete
Grade: <grade>  |  Flags: <count>  |  Criticals: <count>
Duration: <time>  |  Parallel Efficiency: <value>

History:
  v1: D (47m, 13 flags, 1 critical)
  v2: C (13m, 9 flags, 1 critical)
  → v<N>: <grade> (<time>m, <flags> flags, <criticals> criticals)
========================================
```

## Step 5: Check stop conditions

| Condition | Action |
|-----------|--------|
| Grade >= targetGrade | **SUCCESS** — target reached |
| 2 consecutive iterations with no grade improvement | **PLATEAU** — incremental fixes aren't working |
| Grade dropped for 2 consecutive iterations | **REGRESSION** — stop and alert user |
| currentIteration >= maxIterations | **LIMIT** — safety cap reached |
| Previous optimize produced 0 code changes | **EXHAUSTED** — nothing left to fix |

If stopping:
1. Set `phase: "completed"` in loop-state
2. Print final summary with full history
3. Exit

If continuing, proceed to Step 6.

## Step 6: Optimize

### 6a. Kill benchmark processes

```bash
wmic process where "commandline like '%vibehq-spawn%'" call terminate 2>/dev/null
wmic process where "commandline like '%hub.js%--port <hubPort>%'" call terminate 2>/dev/null
```

### 6b. Run /optimize-protocol

Set `phase: "optimizing"` in loop-state.

**Option A (preferred): Inline optimization**
Read and follow `.claude/skills/optimize-protocol/SKILL.md` with run-id `loop-v<N>`.

**Option B (fallback): If context is getting large (>50% window)**
Save state, tell user to run `/optimize-protocol loop-v<N>` then `/benchmark-loop` to resume.

### 6c. Rebuild

```bash
npx tsup
```

Must succeed. Fix any build errors before continuing.

### 6d. Update loop state

Increment `currentIteration`, update `team` to include new iteration number (e.g., `<baseTeam>-v<N+1>`), update `iterationDir`, set `phase: "benchmarking"`, save loop-state.

## Step 7: Next iteration

Go back to Step 2.

## Important rules

1. **Always save loop-state before and after each major step.** If context compresses, the next session can resume.
2. **Read loop-state.json at the START of every major step.** Context compaction may erase memory.
3. **Do NOT skip analysis.** Always run full analysis for proper metrics.
4. **One iteration at a time.** No parallel benchmarks.
5. **Fresh hub-state per iteration.** Delete old hub-state.json before starting.
6. **Be patient.** Agents need 8-15 minutes typically.
7. **If context is large, prefer Option B in Step 6b.**
8. **The spawn script MUST use Node.js** to write .cmd files — never use bash heredocs for Windows batch files.
9. **Always include `set CLAUDECODE=`** in launcher .cmd files.
10. **CRITICAL: Each iteration MUST use a unique team name** (e.g., `project-benchmark-v1`, `project-benchmark-v2`). This ensures fresh hub state, shared files, and MCP server names. Never reuse a team name across iterations — agents will see stale tasks/artifacts from previous runs.
