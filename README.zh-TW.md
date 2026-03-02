<p align="center">
  <img src="images/vibehq_index.png" alt="VibeHQ" width="100%" />
</p>

<p align="center">
  <strong>🌐 語言:</strong>
  <a href="README.md">English</a> |
  繁體中文 |
  <a href="README.ja.md">日本語</a>
</p>

<h1 align="center">⚡ VibeHQ</h1>

<p align="center">
  <strong>多 Agent AI 協作平台</strong><br/>
  <em>讓 Claude、Codex 和 Gemini 像真正的工程團隊一樣協作。</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/node-%3E%3D18-brightgreen?style=flat-square" />
  <img src="https://img.shields.io/badge/platform-Windows%20(已測試)%20%7C%20Mac%20%7C%20Linux-blue?style=flat-square" />
  <img src="https://img.shields.io/badge/agents-Claude%20%7C%20Codex%20%7C%20Gemini-purple?style=flat-square" />
  <img src="https://img.shields.io/badge/license-MIT-orange?style=flat-square" />
</p>

<p align="center">
  <a href="#-問題">問題</a> •
  <a href="#-解決方案">解決方案</a> •
  <a href="#-功能">功能</a> •
  <a href="#%EF%B8%8F-快速開始">快速開始</a> •
  <a href="#-運作原理">運作原理</a> •
  <a href="#-設定">設定</a> •
  <a href="#-基準測試">基準測試</a> •
  <a href="#-展示">展示</a>
</p>

---

## 🧩 問題

你可以跟一個 AI 編碼助手對話。但**真正的軟體不是一個人做出來的。**

每個正經的專案都需要 PM 協調、設計師定義 UI、後端工程師設計 API、前端工程師建構介面、QA 驗證一切。當你試圖讓一個 agent 做所有事情：

- 🧠 **Context 崩潰** — 一個 agent 無法同時持有 PM + 前端 + 後端 + QA 的上下文
- 🔄 **沒有分工** — 每個 prompt 都是一次腦袋切換
- 🚫 **沒有流程** — 沒有規格書、沒有審查、沒有合約，只有 vibe
- 💬 **沒有協作** — agent 之間不能對話、不能審查彼此的工作、不能等待依賴

**業界充滿了所謂的「multi-agent 框架」，實際上只是包裝過的 chain-of-thought。** 它們在同一個 process 裡循序執行，對話是人工合成的。那不是協作——那是流水線。

## 💡 解決方案

VibeHQ 採用根本不同的方式：**真正的 CLI agent，真正的終端，真正的協作。**

```
你給 PM 一個提示。
7 個 agent 建構整個應用程式。
每個 agent 在自己的終端中運行。
它們通過結構化協議通信。
在規格書簽署之前不開始寫程式碼。
```

每個 agent 都是 Claude Code、Codex CLI 或 Gemini CLI 的**真正實例** — 在自己的終端視窗中運行，擁有自己的工作目錄、檔案存取範圍和對話上下文。Hub 不模擬對話。它路由訊息、管理任務、執行合約，並在 agent 準備好時才推送工作。

**因為每個 agent 都是真正的 CLI 進程，所有原生功能都完整保留：**
- 🔧 **Claude Code**：Skills、自訂 MCP 伺服器、`.claude/` 專案設定、記憶、全部 CLI 參數
- 🔧 **Codex CLI**：內建工具、檔案編輯、終端指令、自訂指示
- 🔧 **Gemini CLI**：Extensions、Google Cloud 整合、`.gemini/` 設定

VibeHQ **在既有功能之上添加** 20 個協作工具 — 永遠不替換或限制 CLI 本身的能力。你的 agent 保有完整的能力；它們只是多了與彼此溝通的能力。

**這就是「multi-agent」和「multi-agent 協作」的差異。**

<p align="center">
  <img src="images/vibehq_dashboard.png" alt="VibeHQ Dashboard" width="100%" />
</p>

---

## 🎥 實際運作展示

> 🎬 **[觀看完整的 7 個 Agent 協作展示 →](https://drive.google.com/file/d/1zzY3f8iCthb_s240rV67uiA9VpskZr2s/view?usp=sharing)**

### MCP 工具實際運作

#### 查看隊友 — 查看誰在線上以及狀態

https://github.com/user-attachments/assets/b4e20201-dc32-4ab4-b5fe-84b165d44e23

#### 隊友對話 — 即時 agent 間通訊

https://github.com/user-attachments/assets/ea254931-9981-4eb6-8db3-44480ec88041

#### 分派任務 — PM 建立並分派任務給工程師

https://github.com/user-attachments/assets/fec7634e-976a-4100-8b78-bd63ad1dbec0

---

## 📊 基準測試

以控制實驗測試：「分析 $NVDA 並建構互動式 HTML 儀表板」
使用相同的團隊組成（1 個協調者 + 3 個工作者）跨框架版本比較。

| | V1（變更前） | V2（變更後） | 單一 Agent |
|---|---|---|---|
| 時間 | 107 分鐘 | 58 分鐘 | 9.5 分鐘 |
| 最終產出 | ❌ 損壞 | ✅ 正常運作（62KB） | ✅ 正常運作（70KB） |
| Schema 衝突 | 15 | 2 | 0 |
| 協調者手動修復程式碼 | 6 | 0 | 0 |
| QA 攔截的資料錯誤 | 0（無 QA） | 7 | 0（無 QA） |

**V1 → V2 關鍵改進：**
- 結構化任務契約（`output_target`、`REQUIRED INPUTS`）消除了 Schema 不一致
- Agent 心跳監控在 60 秒內自動偵測離線 Agent
- QA 驗證階段在最終交付前攔截資料錯誤
- 協調者零次程式碼介入（對比 V1 的 6 次手動 JS 修補）

**何時使用多智能體 vs 單一 Agent：**
多智能體在需要獨立 QA 驗證、異質工具存取、或超過單一 context window 容量的工作負載時才有優勢。
對於小範圍任務，單一 Agent 顯著更快。

📖 [從 LLM 原生協作問題到可控的多智能體框架](blog/llm-native-problems-to-controllable-framework-zh.md)
📊 [完整基準測試：V1 vs V2 改進報告](benchmarks/vibhq-v1-vs-v2-improvement-report-zh-TW.md)

---

## 🔬 為什麼這個架構重要

### 真正的 Agent 隔離
每個 agent 都以**獨立的 OS 進程**在自己的 PTY（偽終端）中運行。這不是線程或協程 — 這是完整的進程隔離。一個 agent 當機不會拖垮整個團隊。一個 agent 的 context window 完全屬於自己。這就是真正的工程團隊運作方式：各自獨立的機器、各自獨立的上下文、共享的協議。

### 合約驅動開發
在任何程式碼被撰寫之前，規格書必須被發布並簽署。`publish_contract("api-spec.md", ["Jordan", "Sam"])` 要求前端工程師和設計師在後端開始寫程式碼之前批准 API schema。這消除了 multi-agent 失敗的首要原因：**agent 基於不同的假設在開發。**

### Idle 感知訊息佇列
當 Agent A 發送任務給 Agent B，而 Agent B 正在寫程式碼時，訊息**不會打斷**。它會排隊。當 B 完成時（透過 Claude Code 的 JSONL transcript 或 PTY 輸出超時偵測），佇列會刷新。這防止了「任務進行中收到新指令」的問題，該問題會嚴重影響 agent 的輸出品質。

### 狀態持久化
所有任務、成品、合約和團隊更新都持久化到磁碟（`~/.vibehq/teams/<team>/hub-state.json`）。Hub 重啟不會丟失狀態。Agent 可以重新連接並從上次中斷處繼續。

### MCP 原生通訊
Agent 之間不是透過 prompt injection hack 通訊。它們使用 **20 個專門建構的 MCP 工具**，在每個 agent 啟動時自動配置。工具具有型別安全、訊息具有結構化，Hub 驗證所有通訊。

---

## ✨ 功能

### 🎯 核心平台
- **多 CLI 支援** — Claude Code、Codex CLI、Gemini CLI 並行運作
- **即時儀表板** — 即時 agent 狀態、團隊更新、訊息路由視覺化
- **MCP 整合** — 20 個專門建構的工具，透過 Model Context Protocol 注入每個 agent
- **獨立 Agent 終端** — 每個 agent 擁有自己的終端視窗，完全可互動
- **熱重啟** — 重新連接任何當機的 agent，無需重啟團隊

### 🔄 V2 協作框架
- **任務生命週期** — `create → accept → in_progress → blocked → done`，需附帶成品
- **合約系統** — 發布 API/設計規格書，要求簽署後才開始寫程式碼
- **成品管理** — 帶有 metadata 和版本控制的結構化文件發布
- **Idle 感知佇列** — agent 忙碌時訊息排隊，閒置時刷新
- **狀態持久化** — 所有資料透過 JSON 檔案存儲，Hub 重啟不丟失

### 🧠 智慧偵測
- **Claude JSONL 監聽器** — 解析 `~/.claude/projects/` transcript 檔案，即時偵測 idle/working
- **PTY 輸出超時** — Codex/Gemini 的備用 idle 偵測（10 秒無輸出 = idle）
- **自動 Preset 載入** — 根據角色自動載入內建的系統提示

### 🔒 Agent 隔離與權限
- **獨立工作目錄** — 每個 agent 只能看到自己的程式碼
- **`additionalDirs`** — 授予選擇性的跨目錄存取（例如共享 mock 資料）
- **`dangerouslySkipPermissions`** — 在受信環境中自動批准 Claude 權限提示

---

## ⚡️ 快速開始

### 前置需求
- **Node.js** ≥ 18
- 至少安裝一個 AI CLI：
  - [Claude Code](https://docs.anthropic.com/en/docs/claude-code)（`npm install -g @anthropic-ai/claude-code`）
  - [Codex CLI](https://github.com/openai/codex)（`npm install -g @openai/codex`）
  - [Gemini CLI](https://github.com/google-gemini/gemini-cli)（`npm install -g @anthropic-ai/gemini-cli`）

### 安裝（從原始碼建構）

> ⚠️ `npm install -g @vibehq/agent-hub` 目前尚未上架 npm。套件將在註冊完成後發布。現在請使用建構 & link 的方式：

```bash
git clone https://github.com/0x0funky/vibehq-hub.git
cd vibehq-hub
npm install
npm run build
npm link
```

這會全域註冊 `vibehq`、`vibehq-spawn` 和 `vibehq-hub` 指令。

### 啟動（Windows — TUI 模式）

```bash
vibehq
```

選擇團隊 → Start → agent 在 Windows Terminal 的新分頁中啟動。

### 啟動（Mac / Linux — 手動模式）

TUI 自動啟動目前以 Windows Terminal（`wt`）、iTerm2 和標準 Linux 終端為目標。如果 TUI 在你的系統上無法正確啟動終端，可以手動啟動 agent：

```bash
# 終端 1：啟動 Hub
vibehq-hub --port 3001

# 終端 2：啟動 agent
cd /path/to/frontend
vibehq-spawn --name "Jordan" --role "Frontend Engineer" \
  --team "my-team" --hub "ws://localhost:3001" \
  --add-dir "/path/to/shared" \
  -- claude

# 終端 3：啟動另一個 agent
cd /path/to/backend
vibehq-spawn --name "Riley" --role "Backend Engineer" \
  --team "my-team" --hub "ws://localhost:3001" \
  -- claude

# 根據需要為每個 agent 重複...
```

### 重新啟動單一 Agent

如果 agent 當機或斷線，可以在不重啟團隊的情況下重新啟動：

```bash
cd D:\project\qa
vibehq-spawn --name "Casey" --role "QA Engineer" \
  --team "medvault" --hub "ws://localhost:3002" \
  --skip-permissions \
  --add-dir "D:\project\frontend" \
  --add-dir "D:\project\backend" \
  -- claude
```

---

## ⚠️ 平台支援

> **VibeHQ 目前在 Windows 上開發和測試。**
> Mac 和 Linux 支援在架構上已支援，但尚未完整測試。

| 功能 | Windows | Mac | Linux |
|------|---------|-----|-------|
| TUI（互動式團隊啟動器） | ✅ 已測試 | ⚠️ 未測試（iTerm2/Terminal.app） | ⚠️ 未測試（gnome-terminal/xterm） |
| Hub 伺服器 | ✅ 已測試 | ✅ 應可運作 | ✅ 應可運作 |
| 手動啟動（`vibehq-spawn`） | ✅ 已測試 | ✅ 應可運作 | ✅ 應可運作 |
| Claude JSONL idle 偵測 | ✅ 已測試 | ⚠️ 路徑編碼可能不同 | ⚠️ 路徑編碼可能不同 |
| PTY 啟動（node-pty） | ✅ 已測試 | ⚠️ 未測試 | ⚠️ 未測試 |
| MCP 自動設定 | ✅ 已測試 | ⚠️ 設定路徑可能不同 | ⚠️ 設定路徑可能不同 |

### Mac/Linux 可能遇到的問題

- **終端啟動**：TUI 在 Windows 使用 `wt`，Mac 使用 `osascript`，Linux 使用 `gnome-terminal`/`xterm`。如果你的終端模擬器未被偵測到，改用手動 `vibehq-spawn` 指令。
- **Claude JSONL 路徑編碼**：Claude Code 在不同 OS 上對專案路徑的編碼方式不同（`\` vs `/`）。監聽器使用 regex 替換來處理兩者，但可能存在邊緣情況。
- **node-pty 編譯**：`node-pty` 需要原生編譯。Mac 請確保已安裝 Xcode Command Line Tools（`xcode-select --install`）。Linux 請確保有 `build-essential` 和 `python3`。
- **node-pty spawn-helper 權限（macOS）**：預編譯的 `spawn-helper` 可能缺少執行權限（`0644`）。`postinstall` 腳本會自動修復。如果仍然出現 `posix_spawnp failed`，請執行：`chmod +x node_modules/node-pty/prebuilds/*/spawn-helper`
- **MCP 設定路徑**：Claude 在所有平台存儲 MCP 設定於 `~/.claude/`，但 Codex（`~/.codex/`）和 Gemini（`~/.gemini/`）的路徑可能有所不同。
- **檔案路徑分隔符**：設定檔案路徑在 Windows 使用 `\\`。Mac/Linux 請改用 `/`。

> 🍎 **Mac 測試即將到來。** 驗證通過後，本區段將更新為確認的支援狀態。

---

## 🏗 運作原理

```
┌──────────────────────────────────────────────────────────┐
│                      VibeHQ Hub                           │
│                 （WebSocket 伺服器）                       │
│                                                          │
│  ┌─────────┐  ┌──────────┐  ┌───────────┐  ┌─────────┐ │
│  │  任務    │  │  成品    │  │   合約    │  │  訊息   │ │
│  │  儲存    │  │  登記    │  │   儲存    │  │  佇列   │ │
│  └─────────┘  └──────────┘  └───────────┘  └─────────┘ │
│                                                          │
│  ┌─────────────────────────────────────────────────────┐ │
│  │              Agent 登記處                            │ │
│  │  idle/working 偵測 • 狀態廣播 • spawner 訂閱         │ │
│  └─────────────────────────────────────────────────────┘ │
└────────┬──────────┬──────────┬──────────┬───────────────┘
         │          │          │          │
    ┌────▼───┐ ┌────▼───┐ ┌───▼────┐ ┌───▼────┐
    │ Claude │ │ Claude │ │ Codex  │ │ Claude │
    │ (前端) │ │ (後端) │ │ (PM)   │ │ (QA)   │
    │ ┌────┐ │ │ ┌────┐ │ │ ┌────┐ │ │ ┌────┐ │
    │ │MCP │ │ │ │MCP │ │ │ │MCP │ │ │ │MCP │ │
    │ │20  │ │ │ │20  │ │ │ │20  │ │ │ │20  │ │
    │ │工具│ │ │ │工具│ │ │ │工具│ │ │ │工具│ │
    │ └────┘ │ │ └────┘ │ │ └────┘ │ │ └────┘ │
    └────────┘ └────────┘ └────────┘ └────────┘
     frontend    backend    root        qa
```

### 資料流

1. **PM** 透過 MCP 呼叫 `create_task("Build login page", ..., "Jordan")`
2. **Hub** 儲存任務，檢查 Jordan 的狀態
3. Jordan 正在**工作中** → 任務進入**訊息佇列**
4. Jordan 完成當前工作 → **JSONL 監聽器**偵測到 `turn_duration` 事件 → 狀態 = `idle`
5. Hub **刷新佇列** → Jordan 收到任務
6. Jordan 呼叫 `accept_task` → 寫程式碼 → 呼叫 `complete_task` 附帶成品
7. Hub **持久化**所有資料到磁碟，**廣播**狀態給團隊

---

## 📝 設定

### `vibehq.config.json`

```jsonc
{
  "teams": [
    {
      "name": "my-project",
      "hub": { "port": 3001 },
      "agents": [
        {
          "name": "Alex",
          "role": "Project Manager",       // 自動載入 preset 系統提示
          "cli": "codex",
          "cwd": "D:\\my-project"          // Mac/Linux 使用 "/"
        },
        {
          "name": "Jordan",
          "role": "Frontend Engineer",
          "cli": "claude",
          "cwd": "D:\\my-project\\frontend",
          "dangerouslySkipPermissions": true,
          "additionalDirs": ["D:\\my-project\\shared"]
        }
      ]
    }
  ]
}
```

### Agent 設定參考

| 欄位 | 類型 | 預設 | 說明 |
|------|------|------|------|
| `name` | `string` | *必填* | Agent 顯示名稱（團隊內唯一） |
| `role` | `string` | *必填* | 角色 — 未設定 `systemPrompt` 時自動載入對應的 preset |
| `cli` | `string` | *必填* | `claude`、`codex` 或 `gemini` |
| `cwd` | `string` | *必填* | 工作目錄（每個 agent 隔離） |
| `systemPrompt` | `string?` | preset | 自訂系統提示（覆蓋角色 preset） |
| `dangerouslySkipPermissions` | `bool?` | `false` | 跳過 Claude 權限提示（僅 Claude） |
| `additionalDirs` | `string[]?` | `[]` | agent 可額外存取的目錄（Claude `--add-dir`） |

### 內建角色 Preset

| 角色 | 重點 |
|------|------|
| Project Manager | 任務分派、規格優先工作流程、進度追蹤 |
| Product Designer | 設計規格、合約審查、視覺 QA |
| Frontend Engineer | UI 開發、合約優先 API 整合 |
| Backend Engineer | API 優先開發、合約發布 |
| AI Engineer | ML pipeline、模型整合 |
| QA Engineer | 測試計畫、跨模組驗證 |

---

## 📂 團隊資料與儲存

所有團隊協作資料都持久化儲存在你的 home 目錄下：

```
~/.vibehq/
  └── teams/
      └── <team-name>/
          ├── hub-state.json       # 團隊更新、任務、成品、合約
          └── shared/              # 透過 share_file() 和 publish_artifact() 分享的檔案
```

| 資料 | 已持久化？ | 位置 |
|------|-----------|------|
| 團隊更新（`post_update`） | ✅ | `hub-state.json` |
| 任務（`create_task`、`complete_task`） | ✅ | `hub-state.json` |
| 合約（`publish_contract`） | ✅ | `hub-state.json` |
| 共享檔案（`share_file`） | ✅ | `shared/` 資料夾 |
| 成品（`publish_artifact`） | ✅ | `shared/` 資料夾 |
| Agent 訊息（`ask_teammate`、`reply_to_team`） | ❌ | 僅即時轉發 |

> 💡 **提示：** 要查看團隊的協作歷史，請檢查 `~/.vibehq/teams/<team-name>/hub-state.json`。共享檔案可直接在 `shared/` 資料夾中取得。

---

## 🚀 V2 協作框架 — 20 個 MCP 工具

<details>
<summary><strong>💬 通訊（6 個工具）</strong></summary>

| 工具 | 說明 |
|------|------|
| `ask_teammate(name, question)` | 向隊友提問（非同步，忙碌時排隊） |
| `reply_to_team(name, message)` | 向特定隊友發送訊息 |
| `post_update(message)` | 向整個團隊廣播狀態更新 |
| `get_team_updates(limit?)` | 讀取近期團隊更新 |
| `list_teammates()` | 查看所有隊友的名稱、角色和狀態 |
| `check_status(name?)` | 檢查特定隊友是否 idle/working |

</details>

<details>
<summary><strong>📋 任務管理（5 個工具）</strong></summary>

| 工具 | 說明 |
|------|------|
| `create_task(title, desc, assignee, priority)` | 建立追蹤任務（回傳 taskId） |
| `accept_task(task_id, accepted, note?)` | 接受或拒絕任務 |
| `update_task(task_id, status, note?)` | 更新為 `in_progress` 或 `blocked` |
| `complete_task(task_id, artifact, note?)` | 標記完成 — **必須包含成品**引用 |
| `list_tasks(filter?)` | 列出任務：`all`、`mine` 或 `active` |

</details>

<details>
<summary><strong>📦 成品與共享檔案（5 個工具）</strong></summary>

| 工具 | 說明 |
|------|------|
| `publish_artifact(filename, content, type, summary)` | 發布帶 metadata 的結構化文件 |
| `list_artifacts(type?)` | 按類型列出已發布成品 |
| `share_file(filename, content)` | 儲存檔案到團隊共享資料夾 |
| `read_shared_file(filename)` | 從共享資料夾讀取 |
| `list_shared_files()` | 列出所有共享檔案 |

</details>

<details>
<summary><strong>📜 合約簽署（3 個工具）</strong></summary>

| 工具 | 說明 |
|------|------|
| `publish_contract(spec_path, required_signers[])` | 發布需要簽署的規格書 |
| `sign_contract(spec_path, comment?)` | 批准合約 |
| `check_contract(spec_path?)` | 檢查簽署狀態 |

</details>

---

## 🎬 展示

### 我們做了什麼：MedVault — AI 醫院系統

7 個 AI agent 協作，從一個 PM 提示建構完整的醫院管理平台：

| Agent | 角色 | CLI | 做了什麼 |
|-------|------|-----|---------|
| Alex | 專案經理 | Codex | 協調、任務追蹤、規格審查 |
| Sam | 產品設計師 | Claude | UI/UX 設計規格、色彩系統、元件佈局 |
| Jordan | 前端主管 | Claude | 儀表板、病人紀錄、登入頁面 |
| Taylor | 影像專家 | Claude | 醫學影像瀏覽器（縮放、平移、亮度） |
| Riley | 後端工程師 | Claude | REST API、SQLite DB、JWT 認證 |
| Morgan | AI 工程師 | Claude | AI 診斷端點，帶信心分數 |
| Casey | QA 工程師 | Claude | 整合測試、bug 回報 |

### 展示亮點

- **即時 agent 對話** — agent 之間透過 MCP 工具提問和回覆
- **任務建立與接受** — PM 建立任務，工程師接受/拒絕
- **合約協商** — 後端發布 API 規格 → 前端和設計師審查並簽署
- **合約批准廣播** — `"✅ CONTRACT APPROVED"` 同時發送給整個團隊
- **狀態即時變化** — 儀表板顯示 agent 在 `idle` ↔ `working` 之間切換
- **佇列運作** — 訊息在 agent 忙碌時等待，閒置時刷新
- **Bug 回報流程** — QA 發現問題 → 回報工程師 → 修復 → 重新測試
- **成品發布** — 設計規格、API 文件、測試報告跨團隊共享
- **最終產品** — 登入 → 儀表板 → 病人紀錄 → X 光瀏覽器 → AI 診斷

---

## 🛠 CLI 參考

```bash
vibehq              # 互動式 TUI（建議 Windows）
vibehq start        # 直接從設定啟動團隊
vibehq init         # 建立新的 vibehq.config.json
vibehq dashboard    # 僅儀表板（連接現有 Hub）
```

### 獨立 Hub

```bash
vibehq-hub --port 3001 --verbose
```

### 啟動單一 Agent

```bash
vibehq-spawn \
  --name "Jordan" \
  --role "Frontend Engineer" \
  --team "my-team" \
  --hub "ws://localhost:3001" \
  --skip-permissions \
  --add-dir "/path/to/shared" \
  -- claude
```

---

## 📁 專案結構

```
agent-hub/
├── bin/
│   ├── start.ts          # 主 CLI 進入點（TUI、團隊管理）
│   ├── spawn.ts          # 單一 agent spawner CLI
│   ├── hub.ts            # 獨立 Hub 伺服器
│   └── agent.ts          # MCP agent 伺服器
├── src/
│   ├── hub/
│   │   ├── server.ts     # WebSocket Hub + V2 儲存 + 持久化
│   │   ├── registry.ts   # Agent 登記 + idle 路由 + spawner 追蹤
│   │   └── relay.ts      # 訊息轉發引擎
│   ├── spawner/
│   │   └── spawner.ts    # PTY 管理 + JSONL 監聽 + idle 偵測
│   ├── mcp/
│   │   ├── hub-client.ts # MCP ↔ Hub WebSocket 橋接
│   │   └── tools/        # 20 個 MCP 工具實作
│   ├── shared/
│   │   └── types.ts      # 共享 TypeScript 型別（V2 訊息）
│   └── tui/
│       ├── role-presets.ts    # 內建角色系統提示（V2）
│       └── screens/           # 儀表板、歡迎、設定、建立團隊
├── vibehq.config.json    # 團隊設定
└── images/               # 截圖
```

---

## 🤝 貢獻

歡迎 PR。架構是模組化的：
- **新 MCP 工具？** 加到 `src/mcp/tools/` + 在 `hub-client.ts` 註冊
- **新 CLI 支援？** 在 `spawner.ts` 加偵測 + `autoConfigureMcp()` 加 MCP 設定
- **新儀表板元件？** 擴展 `src/tui/screens/dashboard.ts`

## 📄 授權

MIT

---

<p align="center">
  <a href="https://x.com/0x0funky">𝕏 @0x0funky</a>
</p>
