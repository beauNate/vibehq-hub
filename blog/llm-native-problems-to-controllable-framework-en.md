# From LLM-Native Collaboration Problems to a Controllable Multi-Agent Framework

> When you put four AI Agents to work together, you think you're getting an elite team. In reality, you get four independent geniuses, each holding a different map and heading to a different destination.

---

## Preface: The Beautiful Vision and Harsh Reality of Multi-Agent Systems

Since 2025, multi-agent systems have become the hottest buzzword in the AI space. In theory, assigning one Agent to research, one to frontend, one to quality verification, and one to coordination should work as efficiently as a well-organized team with clear division of labor.

But when I actually ran this in **VibHQ**, the multi-agent collaboration framework I built, I discovered a harsh truth:

**LLMs are not human engineers. They have an entirely different set of "behavioral instincts," and these instincts systematically create problems in multi-agent scenarios.**

This article documents the seven LLM-native behavioral problems I uncovered during VibHQ development through real session logs, and how the framework corrected each one. All cases come from the same controlled experiment: having the same Agent team (GPT-5.3 Codex Orchestrator + three Claude Opus 4.6 Workers) execute the task "Analyze $NVDA and build an interactive HTML dashboard."

---

## VibHQ: What We're Building

VibHQ is a multi-agent collaboration framework using a Hub-and-Spoke architecture: one Orchestrator connects to multiple Worker Agents through a WebSocket hub, with all coordination handled via MCP (Model Context Protocol) tools.

```
                    ┌─────────────┐
                    │    User     │
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │    Emma     │  Codex Orchestrator
                    │ Orchestrator│  Hub (WebSocket)
                    └──┬───┬───┬──┘
                       │   │   │
            ┌──────────┘   │   └──────────┐
            ▼              ▼              ▼
     ┌────────────┐ ┌────────────┐ ┌────────────┐
     │   Sarah    │ │    Mike    │ │   Alan     │
     │ Researcher │ │ Sentiment  │ │  Frontend  │
     │ Opus 4.6   │ │ Opus 4.6   │ │ Opus 4.6   │
     └────────────┘ └────────────┘ └────────────┘
```

Each Worker interacts with the hub through MCP tools (`accept_task`, `complete_task`, `publish_artifact`, `share_file`). The Orchestrator schedules tasks via `create_task`, `check_status`, and `list_tasks`.

Sounds clean. Until you actually run it.

---

## Problem 1: Three Agents, Three Schemas, One Broken Dashboard

### Symptoms

In VibHQ V1's first experiment, I had three Agents produce data in parallel, then handed it to a frontend Agent to integrate into an interactive dashboard. The result:

**Sarah** produced flat-structured JSON:
```json
{ "meta": {...}, "kpis": {...}, "valuation": {...} }
```

**Mike** produced namespaced dot-notation:
```json
{ "nvda.sentiment.composite": 6.2, "nvda.gammaZones": [...] }
```

**Dave** (frontend) completely ignored Sarah's JSON and built his own:
```json
{ "meta": {...}, "financials": {...} }
```

Three Agents each produced "reasonable" output—the problem was their versions of "reasonable" were mutually incompatible.

### The Cascading Failure Seen in Logs

Orchestrator Emma spotted the issue at `13:50:33`:

> *"Mike's artifact is in and strong. One key integration issue surfaced: Mike's rules use `nvda.*` namespaced paths. Sarah's JSON schema uses top-level keys (`meta`, `kpis`, `valuation`, `sentiment`)..."*

Over the next 9 minutes, Emma completely deviated from her "orchestrator" role and started writing JavaScript herself:

`13:53:32`:
> *"I found a real integration bug: the current adapter short-circuits on `meta` and won't properly normalize Sarah's canonical schema. I'm patching the adapter to transform Sarah-format data into the UI format..."*

`13:55:01`:
> *"Applied. I patched nvda-dashboard-interactive.html to handle Mike's mapping appendix correctly. What I fixed: Added a robust schema adapter..."*

Then the user reported upon first opening the dashboard:

`13:56:31`:
> *"Failed to load dashboard data. Network error — ensure nvda-dashboard-data.json is in the same directory."*

Emma diagnosed that the `file://` protocol was blocking XHR requests and wrote a third round of patches:

`13:59:10`:
> *"Root cause: browser blocked XHR to nvda-dashboard-data.json when opened via file://. I fixed it by adding local JS fallback data file..."*

**End result:** An orchestrator spent 6 manual code patches producing a still-fragile dashboard. An Agent meant to only "arrange work" became an emergency full-stack engineer putting out fires.

### Root Cause: LLMs Freely Interpret Output Formats

This isn't hallucination, nor is it unclear instructions. Each Agent completed the requirement of "deliver NVDA data as JSON." The problem is: **when task descriptions are written in natural language, LLMs interpret output formats in whatever way they consider most reasonable.** Three Agents' versions of "most reasonable" resulted in three different schemas.

This is a problem that also occurs in human teams (integration failure due to insufficient communication), but the LLM version is more extreme: human engineers would at least ask on Slack "what do your JSON keys look like"—LLMs won't.

### VibHQ's Fix: Structured Task Contracts

We added three machine-readable fields to `create_task`:

```
⚠️ OUTPUT TARGET:
Create file: nvda-dashboard-fundamentals-pack.md

📥 REQUIRED INPUTS (do not recreate these):
- READ: nvda-fundamental-memo.md (owned by Sarah)
- READ: nvda-sentiment-memo.md (owned by Mike)

📤 EXPECTED OUTPUT:
Publish artifact: nvda-dashboard-fundamentals-pack.md
```

`output_target` specifies the exact filename and format. `REQUIRED INPUTS` tells the Agent which existing files to read rather than rebuild. `EXPECTED OUTPUT` defines the form of the deliverable.

**Post-fix results:** Schema conflict incidents dropped from 15 to 2 (-87%). Orchestrator manual code interventions dropped from 6 to 0.

---

## Problem 2: Agents Start Working as Soon as They Receive a Queued Task

### Symptoms

We introduced a task dependency queue: Task B depends on Task A's output, so Task B's status is `QUEUED`. But when frontend Agent Alan received the QUEUED notification, he saw the full task description attached and **immediately started building the dashboard with hardcoded data**, rather than waiting for Sarah's JSON to be ready.

### Root Cause: LLMs' "Immediate Production" Bias

LLMs are trained to "act upon receiving instructions." `QUEUED — waiting for dependencies` doesn't register as "please wait" in their eyes, but rather "this is a task with a detailed description, and I have enough information to start." The model's instruction-following bias drives it to produce output immediately rather than idle and wait.

It's like an overly eager intern: you're still writing the requirements doc, and they've already read the title and started coding.

### VibHQ's Fix

QUEUED tasks no longer send the full description. The Agent only receives "a task is waiting to be assigned; you'll be notified when dependencies are ready." The full task description (including file references in `REQUIRED INPUTS`) is only sent when the status changes to `READY`.

---

## Problem 3: The 43-Byte Ghost Files

### Symptoms

This was the problem we spent the most time debugging. An Agent called `share_file` and successfully uploaded a complete 69KB HTML file, then called `publish_artifact` to "announce" this deliverable. But the `content` field in `publish_artifact` read:

```
"See local file: nvda-analysis-dashboard.html — Full single-file HTML/CSS/JS dashboard..."
```

A 143-byte pointer string. Not the full 69KB of content.

Orchestrator Emma read the artifact metadata and saw 143 bytes of "content." She determined the deliverable was incomplete and requested republication. The Agent uploaded the full content to `share_file` again, then again wrote a pointer string in `publish_artifact`. The cycle repeated.

In one test, **this loop persisted for 68 minutes, consuming 21% of the orchestrator's message budget.**

### Stub Detection in the Logs

In later VibHQ iterations, Emma learned to detect this problem:

> *"copied file looks suspiciously small... placeholder string"*

But fundamentally, the problem persisted—the Agent kept writing pointer strings in `publish_artifact` instead of full content.

### Root Cause: LLMs' "Summarize Rather Than Duplicate" Optimization

LLMs have a deep behavioral pattern: **when they've already "completed" something (uploaded full content via `share_file`), subsequent actions tend to substitute a summary for repetition.**

In the model's understanding, `publish_artifact` is an "announcement" action—it already placed the full content in `share_file`, so why put it again in the announcement? So it writes a human-readable reference: "See shared file X."

This is perfectly reasonable reasoning. The problem is that the downstream consumer (the orchestrator) doesn't know to read from `share_file`—it only reads the `content` field of `publish_artifact`.

### VibHQ's Fix

Two-level fix:

1. **Hub-side validation**: If `content.length < 200` in a `publish_artifact` call and contains keywords like `"See"` or `"local file"`, reject it outright with the error message: `"Content appears to be a stub. Pass FULL content."`

2. **Tool consolidation**: `share_file` automatically triggers artifact registration, eliminating the scenario where the Agent needs to call two separate tools.

**Post-fix results:** Stub incidents dropped from 18 to 5 (-72%), and each was resolved within 2 turns—no more 68-minute death loops.

---

## Problem 4: "No Response" and "Busy" Look Exactly the Same

### Symptoms

In one test, frontend Agent Dave's CLI session never successfully connected. Emma kept sending messages, creating tasks, and waiting for replies via MCP. **18 minutes passed**, and nobody told Emma "Dave is offline."

Emma eventually concluded on her own that Dave might have an issue and transferred the work to Alan. But by then, Alan had absorbed both his own work and all of Dave's, causing the session to balloon from a normal ~50 turns to 165 turns, tripling costs.

### Root Cause: LLMs Have No Concept of "I Am About to Become Unavailable"

LLMs aren't like microservices with health check endpoints. When a CLI session crashes, a WebSocket disconnects, or an API rate limit is hit, there's no signal. The Agent simply stops responding—and "executing a complex task that needs 5 minutes" and "already dead" look the same to the orchestrator: silence.

### VibHQ's Fix: Heartbeat Monitoring

The hub tracks each Agent's last activity timestamp. If a configurable timeout elapses without activity, the Agent is automatically marked as `agent_unresponsive`, and the orchestrator is notified immediately.

In the fixed version, logs show Emma's reaction was completely different:

`05:49:31`:
> *"Mike is blocked (agent_unresponsive), reassigning to Sarah immediately"*

**From detection to reassignment took only 11 seconds.** Compare that to the previous 18-minute idle wait.

However, a new problem emerged: the timeout was set too short (~60 seconds), causing Alan and Mike to be falsely flagged as offline while executing long tasks (generating large HTML, batch web searches). Emma started building redundant fallback work, only for the Agent to come back minutes later, having already completed the task.

**Lesson:** Detection too slow wastes 18 minutes; detection too fast creates redundant work. We've currently adjusted the timeout to a 3–5 minute range and added a "delayed" buffer state—first flag as suspected delay, and only mark as unresponsive on the second timeout.

---

## Problem 5: The Orchestrator Becomes a Developer Under Pressure

### Symptoms

Back to Problem 1's scenario. Emma was designed as the "task coordination" role—her system prompt explicitly states "your job is to assign tasks, monitor progress, and route artifacts." But when schema conflicts caused integration failure, she immediately started writing JavaScript.

In another test, when all Worker Agents were flagged as unresponsive, Emma used the `Write` tool to generate a complete HTML dashboard herself.

A "manager" rolling up their sleeves when the team hits trouble—sounds admirable, but in a multi-agent system it's catastrophic because:

1. The orchestrator's context window is supposed to contain only task states and communication messages; code inserted into it permanently inflates the context
2. Every subsequent turn must re-read this code (stateless architecture), and the accumulated cache read costs are enormous
3. The orchestrator's code quality is usually worse than a dedicated worker's—it doesn't have the frontend Agent's full system prompt and toolchain

### Root Cause: LLMs' Problem-Solving Drive

When facing a problem, an LLM's first instinct is "solve it," not "delegate it." This is a direct result of training objectives—models are optimized to provide useful responses in conversation, and "I've created a new task for another Agent" intuitively feels more like passing the buck than "I've written the code for you."

### VibHQ's Fix

Two levels:

1. **Eliminate the trigger**: Structured contracts dramatically reduced the frequency of integration failures, so the "orchestrator needs to step in" scenarios themselves became rare
2. **System prompt hard rules**: `"do not write implementation code — create a new task for a worker instead"` directly constrains behavior

The latter is effective under normal conditions, but still gets overridden when the model perceives an emergency state of "all workers are unresponsive, the user is waiting." This is a problem not yet fully solved—LLMs' instruction-following yields to problem-solving instincts under pressure.

---

## Problem 6: The Same Agent Cannot Effectively Review Its Own Output

### Symptoms

In V1, Sarah generated the NVDA fundamental analysis, and this analysis data was directly used to build the dashboard. Nobody checked how the "18.8% expected return" figure was calculated, nor whether "Gaming segment QoQ -14.0%" was consistent with source data.

You could have Sarah go back and check—but when an LLM reviews content it just produced, it exhibits obvious confirmation bias. It tends to find evidence that "yes, this is correct" rather than "wait, this number is wrong."

### VibHQ's Fix: Independent QA Stage

We added a dedicated QA step in the pipeline. Sarah's data is verified by Mike, and Mike's data is verified by Sarah—using a different Agent, a different session, and a different context for cross-validation.

In the fixed version, QA logs show:

Sarah validating fundamental data:
> *"QA complete. 67 items validated across both source files: 60 pass, 7 minor flags, 0 failures. Corrected tables provided for direct merge."*

Mike validating sentiment data:
> *"QA complete. Validated all catalyst dates (12/12 match), options metrics (6/6 match), trigger probabilities (internally consistent, scenario sums = 100%)"*

**7 data errors were caught before reaching the final dashboard.** This is the most irreplaceable advantage of a multi-agent framework over a single Agent—you can't have the same person write the exam and grade it.

---

## Problem 7: LLMs Prefer Regenerating Over Reading Existing Artifacts

### Symptoms

Frontend Agent Dave's task was "build an interactive dashboard using NVDA analysis data." Sarah had already published `nvda-dashboard-data.json` containing all structured data. But Dave didn't read it—he regenerated a JSON from his own memory.

The two JSONs had different key names, different structures, and even some different values.

### Root Cause: Generation Takes Priority Over Retrieval

For LLMs, "generating from memory" is the zero-cost path—just output tokens directly. "Reading an external file" requires calling a tool (`read_shared_file`), waiting for a response, parsing the content, and only then starting work. The model's default behavior always takes the path of least resistance.

This explains why "RAG-first" architectures often underperform expectations in practice—the model knows external data exists, but it prefers to answer using its own parametric knowledge unless forced to read.

### VibHQ's Fix

The wording of `REQUIRED INPUTS (do not recreate these)` was carefully designed:

```
📥 REQUIRED INPUTS (do not recreate these):
- READ and follow: nvda-dashboard-fundamentals-pack.md (owned by Sarah)
  ⚠️ Do NOT create your own version of this file
```

"do not recreate" and "Do NOT create your own version" are intentional double constraints. We tested writing only `Read: xxx.md`—the Agent still self-generated 30% of the time. Adding the explicit prohibition brought it down to near 0%.

---

## Real Data: Before and After Comparison

Same task, same Agent team, same user instructions. Only the framework rules differ.

| Metric | Before Fix (V1) | After Fix | Change |
|---|---|---|---|
| End-to-end time | 107 minutes | 58 minutes | **-46%** |
| Final output | ❌ Broken (file:// load error) | ✅ Working (62KB, 8 interactive features) | Fixed |
| Schema conflict incidents | 15 | 2 | -87% |
| Orchestrator manual coding | 6 times | 0 times | Eliminated |
| Data errors caught by QA | 0 (no QA) | 7 | New capability |
| Agent offline detection | None | Auto-detected within 60 seconds | New capability |

---

## Being Honest: When Don't You Need Multi-Agent?

After completing all the fixes above, we ran a control group—**a single Claude Opus 4.6 Agent executing the exact same task**.

| | Multi-Agent (Post-Fix) | Single Agent |
|---|---|---|
| Time | 58 minutes | **9.5 minutes** |
| Cost | $58.51 | **$5.92** |
| Output | 62KB HTML, 8 features | 70KB HTML, equivalent features |

A single Agent used **1/6 the time and 1/10 the cost**, producing equivalent quality results.

The reason is simple: the "real workload" of this task is only 29K output tokens (11 searches + 1 HTML file). But the multi-agent framework consumed ~140K output tokens + 12M cache_read tokens just on coordination communication. **The ratio of coordination overhead to actual work was 5:1.**

It's like asking 4 people to carry one box—the time spent just communicating "who carries which side" exceeds the time it takes one person to just carry it.

### When Does Multi-Agent Actually Have an Advantage?

After multiple rounds of experimentation, we identified four conditions, at least one of which should be met:

1. **A single context window can't fit everything**: Claude Opus 4.6 has a 200K context, and this NVDA task only used 87K. When your codebase has 50+ files, or you need to process multiple long documents simultaneously, splitting makes sense.

2. **Subtasks are truly independent and each is substantial**: The NVDA research tasks each took only 3 minutes. If each subtask takes 30+ minutes (e.g., deep analysis of 20 stocks simultaneously), the time savings from parallelization will exceed coordination costs.

3. **Different tools or permissions are required**: Agent A queries databases, Agent B queries Jira, Agent C modifies production code—cramming all tools into one Agent causes system prompt bloat and tool conflicts.

4. **Independent quality verification is needed**: This is the one truly irreplaceable advantage of multi-agent. You can't have the same Agent both write and review its own output—confirmation bias renders self-review meaningless.

---

## Where VibHQ Is Now

Currently, VibHQ's Hub-and-Spoke architecture has passed multiple rounds of iterative testing. The framework's core value isn't "letting you use multiple Agents"—anyone can open four Claude Code sessions. The core value is:

**VibHQ solves LLM-native collaboration problems through structured constraints, transforming multi-agent systems from "luck-based" to "predictable."**

Every mechanism we added corresponds to a reproducible LLM behavioral problem observed in real logs:

| LLM-Native Problem | VibHQ Mechanism |
|---|---|
| Free interpretation of output formats | Structured task contracts (`output_target`, `REQUIRED INPUTS`, `EXPECTED OUTPUT`) |
| Eager to start, won't wait for dependencies | QUEUED status delays full description delivery |
| Pointer references instead of full content | Hub-side content validation + `share_file` auto-registration |
| Cannot detect offline Agents | Heartbeat monitoring + `agent_unresponsive` status |
| Orchestrator role drift | Structured contracts eliminate triggers + system prompt hard rules |
| Cannot self-verify | Independent QA stage (cross-validation) |
| Regeneration instead of reading | "do not recreate" double constraints + ownership tracking |

---

## Next Steps

Multi-agent isn't about stacking models. It's about building an organizational structure that can "constrain model behavior."

VibHQ's iteration process proved one thing: **When you treat LLMs as organizational members rather than API response generators, collaboration quality transforms fundamentally.** Schema conflicts dropped from 15 to 2, not because the models got stronger—but because the organizational rules got clearer.

Now, the framework is in place. Communication layer, coordination layer, monitoring layer, quality layer—all four layers have been validated through real tasks.

But one controlled experiment isn't enough.

The next phase focuses on: **stress-testing the framework with more diverse task scenarios, collecting data, and optimizing incrementally.**

Questions we want to answer include:

- **Where is the coordination overhead crossover point?** In the current NVDA case, multi-agent coordination cost is 5x the actual work. How large and complex must a task be for multi-agent to truly beat a single Agent in time and cost?
- **What is the optimal heartbeat timeout range?** 60 seconds is too short and causes false positives; 5 minutes is too long and wastes time waiting. Do different task types (research, generation, search) need different thresholds?
- **How should load balancing work?** When one Agent goes briefly offline, the orchestrator dumps 5 tasks onto the same Agent—that's not a proper fallback strategy.
- **How large are cross-model behavioral differences?** Do Claude and GPT perform the same on stub problems, role drift, and generation preferences? Do different models need different constraint rules?

Each of these questions requires more session logs, more failure cases, and more data to answer.

The real question is no longer: **Are the models powerful enough?**

It's: **Is the organizational design right?**

And that is the core of multi-agent systems.

---

*VibHQ is an open-source multi-agent collaboration framework. All experiment session logs and analysis scripts are available in the repository.*

*If you're interested in framework design, LLM behavioral patterns, or cost optimization for multi-agent systems, feel free to open an issue or discussion on GitHub.*
