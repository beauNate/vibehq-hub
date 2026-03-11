<p align="center">
  <strong>🌐 語言:</strong>
  <a href="README.md">English</a> |
  繁體中文 |
  <a href="README.ja.md">日本語</a>
</p>

<h1 align="center">⚡ VibeHQ</h1>

<p align="center">
  <strong>平行跑 5 個 AI Agent 很簡單。<br/>讓它們不要互相搞砸才是難的。</strong>
</p>

<p align="center">
  <em>VibeHQ 為 Claude Code、Codex 和 Gemini CLI 加入合約簽署、任務追蹤與 Idle 感知訊息佇列 — 讓它們像真正的工程團隊一樣合作，而不是 5 個實習生同時改同一個檔案。</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/node-%3E%3D18-brightgreen?style=flat-square" />
  <img src="https://img.shields.io/badge/agents-Claude%20%7C%20Codex%20%7C%20Gemini-purple?style=flat-square" />
  <img src="https://img.shields.io/badge/license-MIT-orange?style=flat-square" />
</p>

---

## 沒有人在談的問題

每個「multi-agent」工具都能讓你平行跑多個 CLI agent。但平行 ≠ 協作。以下是 5 個 agent 同時開發同一個 app 時實際會發生的事：

| 出了什麼問題 | 我們 Log 裡的真實案例 |
|---|---|
| **Schema 衝突** — 每個 agent 自創一套 JSON 格式 | 前端預期 `{ data: [] }`，後端寫成 `{ results: [] }`，第三個 agent 自己又造了一份 |
| **協調者角色偏移** — PM 開始自己寫 code | PM 花了 6 次手動 JS 修補去修整合 bug，而不是做協調 |
| **幽靈檔案** — agent 發布 43 byte 的 stub 而非真正內容 | Agent 用 `share_file` 上傳完整檔案，卻在 `publish_artifact` 寫 `"See local file..."`。循環重複 68 分鐘 |
| **提前執行** — agent 在依賴完成前就開始動工 | Agent 看到 `QUEUED` 任務的描述，忽略狀態，直接用 hardcoded 資料開始寫 |
| **靜默失敗** — 當機的 agent 不會發出任何訊號 | 協調者等了 18 分鐘才發現一個已經死掉的進程 |

這些不是邊緣案例，而是 **LLM 原生行為模式**，在不同模型上都會可靠地出現。我們用完整 session log 記錄了 7 種。

📖 **[閱讀完整分析：7 個 LLM 原生問題 →](blog/llm-native-problems-to-controllable-framework-zh.md)**

---

## VibeHQ 做了什麼

VibeHQ 是一個**協作協議層**，疊在真正的 CLI agent 之上。每個 agent 仍然是完整的 Claude Code / Codex / Gemini 進程，保有全部原生功能 — VibeHQ 加上它們缺少的協調機制：

| 問題 | VibeHQ 的修正 |
|---|---|
| Schema 衝突 | **合約系統** — agent 必須先簽署 API 規格書才能開始寫 code |
| 角色偏移 | **結構化任務生命週期** — `create → accept → in_progress → done`，需附帶成品 |
| 幽靈檔案 | **Hub 端驗證** — 拒絕 `publish_artifact` 中的 stub 內容（<200 bytes） |
| 提前執行 | **Idle 感知佇列** — 在依賴完成前不發送任務細節 |
| 靜默失敗 | **心跳監控** — 自動偵測離線 agent，通知協調者 |
| 沒有品質檢查 | **獨立 QA** — 獨立的 agent 驗證資料正確性 |
| 沒有事後分析 | **13 條自動偵測規則** — 分析 session log 中的失敗模式 |

---

## 自我改善的協調機制：從 D 級到 B 級只用 4 次迭代

VibeHQ 不只是協調 agent — 它**自動分析失敗原因並寫 code 修復自己。**

我們建了一個自動化迴圈：跑基準測試 → 分析 log → `/optimize-protocol` 讀取分析結果並實作真正的程式碼修改 → 再跑一次並測量差異：

```
┌─────────────┐     ┌──────────────────┐     ┌───────────────────┐
│   基準測試   │────▶│  vibehq-analyze   │────▶│ /optimize-protocol│
│  （跑團隊）  │     │  --with-llm       │     │  （Claude skill） │
└─────────────┘     └──────────────────┘     └───────────────────┘
       ▲                                              │
       │              寫入真正的程式碼修改              │
       └──────────────────────────────────────────────┘
```

### 4 次迭代結果（同一個 4 Agent Todo App 基準測試）

| | v1 | v2 | v3 | v4 |
|---|---|---|---|---|
| **等級** | **D** | **C** | **C** | **B** |
| 耗時 | 47 分鐘 | 13 分鐘 | 10.3 分鐘 | **9.4 分鐘** |
| 標記（問題） | 13 | 9 | 11 | **7** |
| 嚴重標記 | 1 | 1 | 2 | **0** |
| 平行效率 | 0.18 | 0.64 | 0.88 | 0.51 |

**系統在各次迭代中學到並建構的東西：**

| 迭代 | 發現的問題 | 建構的修正 |
|---|---|---|
| v1→v2 | Hub 在開機期間誤殺 agent；PM 自己寫 code | 啟動寬限期（180s）；角色 preset 加入工具禁令 |
| v2→v3 | Codex PM 無視 prompt 約束（shell_command 4→42 次） | `--disallowedTools` CLI 層級強制執行；PM 改用 Claude |
| v3→v4 | PM 用 Glob 監視 worker；成品被覆寫為 0 byte | 擴充禁用工具清單；MCP 層 0-byte 內容拒絕 |

**核心洞察：** Prompt 約束只是建議。CLI 層級強制執行才是法律。Agent 會適應並繞過軟性限制 — 修復必須是架構層級的。

### 自己試試看

```bash
# 1. 跑基準測試
vibehq start --team your-team

# 2. 分析
vibehq-analyze --team your-team --with-llm --save --run-id v1

# 3. 自動優化（Claude Code skill）
/optimize-protocol v1

# 4. 再跑一次，比較
vibehq start --team your-team
vibehq-analyze --team your-team --with-llm --save --run-id v2
vibehq-analyze compare v1 v2
```

所有優化報告都儲存在 `~/.vibehq/analytics/optimizations/` 以供追蹤與稽核。

📖 **[完整部落格文章：自我改善的多 Agent 協調 →](blog-draft-self-improving-agents.md)**

---

## 📱 Web 儀表板 — 桌面 & 手機

用瀏覽器管理一切。在電腦啟動 agent，用手機監控。

### 手機

https://github.com/user-attachments/assets/9d056e18-44ea-418a-8831-dafc5cb724b8

### 桌面

https://github.com/user-attachments/assets/6f0fe691-bef8-49f9-a0ce-a65b215d264f

---

## 🚀 快速開始

```bash
git clone https://github.com/0x0funky/vibehq-hub.git
cd vibehq-hub && npm install
npm run build && npm run build:web
node dist/bin/web.js
```

開啟 `http://localhost:3100` — 建立團隊、加入 agent、按 Start。

```bash
# 加上驗證（建議 LAN/手機存取時使用）
VIBEHQ_AUTH=admin:secret node dist/bin/web.js
```

伺服器會印出 LAN IP — 手機開啟就能用。

---

## 🔧 20 個 MCP 工具

每個 agent 自動注入 20 個協作工具（透過 Model Context Protocol）：

**通訊（6）：** `ask_teammate`、`reply_to_team`、`post_update`、`get_team_updates`、`list_teammates`、`check_status`

**任務（5）：** `create_task`、`accept_task`、`update_task`、`complete_task`、`list_tasks`

**成品（5）：** `publish_artifact`、`list_artifacts`、`share_file`、`read_shared_file`、`list_shared_files`

**合約（3）：** `publish_contract`、`sign_contract`、`check_contract`

**系統（1）：** `get_hub_info`

> 🎬 **[觀看 7 個 Agent 即時協作 →](https://drive.google.com/file/d/1zzY3f8iCthb_s240rV67uiA9VpskZr2s/view?usp=sharing)**

<details>
<summary><strong>MCP 工具實際運作（影片）</strong></summary>

#### 查看隊友
https://github.com/user-attachments/assets/b4e20201-dc32-4ab4-b5fe-84b165d44e23

#### 隊友對話
https://github.com/user-attachments/assets/ea254931-9981-4eb6-8db3-44480ec88041

#### 分派任務
https://github.com/user-attachments/assets/fec7634e-976a-4100-8b78-bd63ad1dbec0

</details>

---

## 📊 會後分析 & 自動優化

### 分析

```bash
vibehq-analyze ./data                        # 分析 session log
vibehq-analyze --team my-team --with-llm     # 自動解析團隊 log + LLM 洞察
vibehq-analyze --team my-team --with-llm --save --run-id v1  # 儲存供優化使用
vibehq-analyze compare v1 v2                 # 兩次執行並排比較
vibehq-analyze history --last 10             # 查看歷史
```

**13 條自動偵測規則：** 成品回退、協調者角色偏移、Stub 檔案、任務超時、未完成任務、協調開銷、Agent 無回應、零成品產出、Context 膨脹、重複成品、過早接受任務、過度 MCP 輪詢、任務重新分派。

### `/optimize-protocol` — 自我改善 Skill

一個 Claude Code skill，讀取分析資料並**寫入真正的程式碼修正**到框架中：

```bash
/optimize-protocol v1    # 讀取 v1 的分析資料，實作修正
```

功能：
1. 載入當前 run + 所有先前的優化報告
2. 建構跨 run 趨勢表（哪些在改善、哪些回退、哪些是副作用）
3. 將每個問題分類為 NEW、RECURRING 或 SIDE-EFFECT
4. 實作真正的 TypeScript 修改（不是參數調整）
5. 驗證建置通過
6. 儲存詳細變更日誌至 `~/.vibehq/analytics/optimizations/`

支援 Claude Code 和 Codex CLI 原生 JSONL 格式。

<details>
<summary><strong>📱 遠端存取</strong></summary>

Web 平台預設可在區域網路存取。要從外部連線：

> ⚠️ **遠端暴露前務必設定 `VIBEHQ_AUTH`** — Web UI 提供完整終端存取權限。

| 方式 | 適用場景 |
|------|----------|
| **[Tailscale](https://tailscale.com/)** | 個人使用 — 私有 VPN，免設定，免費 |
| **[Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/)** | 分享 — 公開 URL 經 Cloudflare 保護，免費 |
| **[ngrok](https://ngrok.com/)** | 快速測試 — `ngrok http 3100`，臨時 URL |
| **SSH Tunnel** | 有 VPS — `ssh -R 8080:localhost:3100 your-server` |

**Tailscale（推薦）：** 電腦 + 手機安裝 → 兩邊登入 → `VIBEHQ_AUTH=admin:secret vibehq-web` → 手機開啟 `http://<tailscale-ip>:3100`。

</details>

<details>
<summary><strong>📝 設定</strong></summary>

### `vibehq.config.json`

```jsonc
{
  "teams": [{
    "name": "my-project",
    "hub": { "port": 3001 },
    "agents": [
      { "name": "Alex", "role": "Project Manager", "cli": "codex", "cwd": "D:\\project" },
      { "name": "Jordan", "role": "Frontend Engineer", "cli": "claude", "cwd": "D:\\project\\frontend",
        "dangerouslySkipPermissions": true, "additionalDirs": ["D:\\project\\shared"] }
    ]
  }]
}
```

| 欄位 | 說明 |
|------|------|
| `name` | Agent 顯示名稱（團隊內唯一） |
| `role` | 角色 — 未設定 `systemPrompt` 時自動載入 preset |
| `cli` | `claude`、`codex` 或 `gemini` |
| `cwd` | 工作目錄（每個 Agent 隔離） |
| `systemPrompt` | 自訂系統提示（覆蓋 preset） |
| `dangerouslySkipPermissions` | 自動批准 Claude 權限 |
| `additionalDirs` | Agent 可額外存取的目錄 |

**內建 Preset：** Project Manager、Product Designer、Frontend Engineer、Backend Engineer、AI Engineer、QA Engineer

</details>

<details>
<summary><strong>🛠 CLI 指令</strong></summary>

```bash
vibehq              # 互動式 TUI
vibehq-web          # Web 平台（瀏覽器 + 手機）
vibehq-hub          # 獨立 Hub 伺服器
vibehq-spawn        # 啟動單一 Agent
vibehq-analyze      # 會後分析
```

### 手動啟動

```bash
vibehq-spawn --name "Jordan" --role "Frontend Engineer" \
  --team "my-team" --hub "ws://localhost:3001" \
  --skip-permissions --add-dir "/shared" -- claude
```

</details>

<details>
<summary><strong>🏗 架構設計</strong></summary>

```
┌──────────────────────────────────────────────────┐
│                   VibeHQ Hub                      │
│              （WebSocket 伺服器）                  │
│  ┌────────┐ ┌──────────┐ ┌────────┐ ┌─────────┐ │
│  │  任務  │ │   成品   │ │  合約  │ │  訊息   │ │
│  │  儲存  │ │   登記   │ │  儲存  │ │  佇列   │ │
│  └────────┘ └──────────┘ └────────┘ └─────────┘ │
│  ┌──────────────────────────────────────────────┐│
│  │  Agent 登記處 — idle/working 偵測            ││
│  └──────────────────────────────────────────────┘│
└────────┬──────────┬──────────┬──────────┬────────┘
    ┌────▼───┐ ┌────▼───┐ ┌───▼────┐ ┌───▼────┐
    │ Claude │ │ Claude │ │ Codex  │ │ Claude │
    │ (前端) │ │ (後端) │ │ (PM)   │ │ (QA)   │
    │ 20 MCP │ │ 20 MCP │ │ 20 MCP │ │ 20 MCP │
    └────────┘ └────────┘ └────────┘ └────────┘
         ▲          ▲          ▲          ▲
         └──────────┴────┬─────┴──────────┘
                    ┌────▼─────────────┐
                    │   Web 儀表板     │
                    │  桌面 & 手機     │
                    └──────────────────┘
```

**核心設計：**
- **進程隔離** — 每個 Agent 是獨立 OS 進程，當機不影響團隊
- **合約驅動** — 規格書必須簽署後才開始寫 code
- **Idle 感知佇列** — Agent 忙碌時訊息排隊，閒置時刷新（JSONL watcher + PTY timeout）
- **狀態持久化** — 所有資料存於 `~/.vibehq/teams/<team>/hub-state.json`
- **MCP 原生** — 20 個專用工具，型別安全，自動配置
- **協調者強制執行** — Claude PM 使用 `--disallowedTools`（CLI 層級硬性封鎖 Bash/Write/Edit/Read/Glob）；Codex PM 使用 `--sandbox read-only`
- **內容驗證** — MCP 在工具層拒絕 0-byte 成品、stub 模式、以及 >80% 大小回退
- **自我改善** — analyze→optimize 迴圈，跨 run 趨勢追蹤與自動變更日誌

</details>

<details>
<summary><strong>⚠️ 平台支援</strong></summary>

| 功能 | Windows | Mac | Linux |
|------|---------|-----|-------|
| Web 平台 | ✅ 已測試 | ✅ 應可運作 | ✅ 應可運作 |
| TUI | ✅ 已測試 | ✅ 已測試 | ⚠️ 未測試 |
| Hub + Spawn | ✅ 已測試 | ✅ 已測試 | ✅ 應可運作 |
| JSONL 監聽 | ✅ 已測試 | ✅ 已測試 | ⚠️ 路徑編碼 |
| node-pty | ✅ 已測試 | ✅ 已測試 | ⚠️ 未測試 |

**Mac：** 需要 `xcode-select --install`。若出現 `posix_spawnp failed`：`chmod +x node_modules/node-pty/prebuilds/*/spawn-helper`

**Linux：** 需要 `build-essential` 和 `python3`。

</details>

<details>
<summary><strong>📁 專案結構</strong></summary>

```
agent-hub/
├── bin/                  # CLI 進入點（start、spawn、hub、web、analyze）
├── src/
│   ├── hub/              # WebSocket Hub、Agent 登記、訊息轉發
│   ├── spawner/          # PTY 管理、JSONL 監聽、idle 偵測
│   ├── web/              # Express 伺服器、REST API、WebSocket
│   ├── mcp/              # 20 個 MCP 工具 + hub-client 橋接
│   ├── analyzer/         # 會後分析管線（13 條規則）
│   ├── shared/           # TypeScript 型別
│   └── tui/              # TUI 畫面 + 角色 Preset
├── web/                  # React 前端（Vite + xterm.js）
├── blog/                 # LLM 行為模式技術文章
└── benchmarks/           # V1 vs V2 比較報告
```

</details>

---

## 🤝 貢獻

歡迎 PR。模組化架構：
- **新 MCP 工具？** → `src/mcp/tools/` + 在 `hub-client.ts` 註冊
- **新 CLI？** → `spawner.ts` 加偵測 + `autoConfigureMcp()` 加設定
- **新元件？** → `web/src/components/` 或 `src/tui/screens/`

## 📄 授權

MIT

---

<p align="center">
  <a href="https://x.com/0x0funky">𝕏 @0x0funky</a>
</p>
