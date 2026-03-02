# 從 LLM 原生協作問題，到可控的多智能體框架

> 當你讓四個 AI Agent 一起工作，你以為得到的是一支菁英團隊。實際上，你得到的是四個各自為政的天才，拿著不同的地圖走向不同的目的地。

---

## 前言：多智能體的美好想像與殘酷現實

2025 年以來，多智能體（Multi-Agent）系統成為 AI 圈最熱門的關鍵字。理論上，讓一個 Agent 負責研究、一個負責前端、一個負責品質驗證、一個負責協調，應該能像一支分工明確的團隊一樣高效運作。

但當我在自己開發的 **VibHQ** 多智能體協作框架中真正跑起來時，發現了一件殘酷的事實：

**LLM 不是人類工程師。它們有一套完全不同的「行為本能」，而這些本能在多智能體場景中會系統性地製造問題。**

這篇文章記錄了我在 VibHQ 開發過程中，透過真實的 session log 發現的七個 LLM 原生行為問題，以及框架如何逐一修正它們。所有案例都來自同一個控制實驗：讓同一組 Agent 團隊（GPT-5.3 Codex 協調者 + 三個 Claude Opus 4.6 工作者）執行「分析 $NVDA 並建立互動式 HTML 儀表板」這個任務。

---

## VibHQ：我們在建的東西

VibHQ 是一個多智能體協作框架，採用 Hub-and-Spoke 架構：一個協調者（Orchestrator）透過 WebSocket hub 連接多個工作者 Agent，所有協調透過 MCP（Model Context Protocol）工具完成。

```
                    ┌─────────────┐
                    │   使用者      │
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │    Emma     │  Codex Orchestrator
                    │   協調者     │  Hub（WebSocket）
                    └──┬───┬───┬──┘
                       │   │   │
            ┌──────────┘   │   └──────────┐
            ▼              ▼              ▼
     ┌────────────┐ ┌────────────┐ ┌────────────┐
     │   Sarah    │ │    Mike    │ │   Alan     │
     │   研究員    │ │  情緒分析   │ │  前端工程   │
     │ Opus 4.6   │ │ Opus 4.6   │ │ Opus 4.6   │
     └────────────┘ └────────────┘ └────────────┘
```

每個工作者透過 MCP 工具（`accept_task`、`complete_task`、`publish_artifact`、`share_file`）與 hub 互動。協調者透過 `create_task`、`check_status`、`list_tasks` 進行任務調度。

聽起來很乾淨。直到你真的跑起來。

---

## 問題一：三個 Agent，三種 Schema，一個壞掉的儀表板

### 現象

在 VibHQ V1 的第一次實驗中，我讓三個 Agent 平行產出資料，再交給前端 Agent 整合成互動式儀表板。結果：

**Sarah** 產出了扁平結構的 JSON：
```json
{ "meta": {...}, "kpis": {...}, "valuation": {...} }
```

**Mike** 產出了命名空間點記法：
```json
{ "nvda.sentiment.composite": 6.2, "nvda.gammaZones": [...] }
```

**Dave**（前端）完全沒用 Sarah 的 JSON，自己又建了一份：
```json
{ "meta": {...}, "financials": {...} }
```

三個 Agent 各自產出了「合理」的輸出——問題是它們的「合理」互不相容。

### 從 Log 看到的連鎖崩壞

協調者 Emma 在 `13:50:33` 發現了問題：

> *"Mike's artifact is in and strong. One key integration issue surfaced: Mike's rules use `nvda.*` namespaced paths. Sarah's JSON schema uses top-level keys (`meta`, `kpis`, `valuation`, `sentiment`)..."*

接下來的 9 分鐘，Emma 完全偏離了「協調者」的角色。她開始自己寫 JavaScript：

`13:53:32`：
> *"I found a real integration bug: the current adapter short-circuits on `meta` and won't properly normalize Sarah's canonical schema. I'm patching the adapter to transform Sarah-format data into the UI format..."*

`13:55:01`：
> *"Applied. I patched nvda-dashboard-interactive.html to handle Mike's mapping appendix correctly. What I fixed: Added a robust schema adapter..."*

然後使用者回報第一次開啟儀表板：

`13:56:31`：
> *"Failed to load dashboard data. Network error — ensure nvda-dashboard-data.json is in the same directory."*

Emma 診斷出 `file://` 協議封鎖了 XHR 請求，又寫了第三輪修補：

`13:59:10`：
> *"Root cause: browser blocked XHR to nvda-dashboard-data.json when opened via file://. I fixed it by adding local JS fallback data file..."*

**最終結果：** 一個協調者花了 6 次手動程式碼修補，產出一個仍然脆弱的儀表板。一個本該只做「安排工作」的 Agent，變成了緊急救火的全端工程師。

### 根本原因：LLM 自由解讀產出格式

這不是幻覺（hallucination），也不是指令不清楚。每個 Agent 都完成了「交付 NVDA 資料的 JSON」這個要求。問題在於：**當任務描述用自然語言寫成時，LLM 會用自己認為最合理的方式解讀產出格式。** 三個 Agent 的「最合理」是三種不同的 Schema。

這是一個在人類團隊中也會發生的問題（溝通不足導致整合失敗），但 LLM 的版本更極端：人類工程師至少會在 Slack 上問一句「你的 JSON key 長什麼樣」，LLM 不會。

### VibHQ 的修正：結構化任務契約

我們在 `create_task` 中加入了三個機器可讀欄位：

```
⚠️ OUTPUT TARGET:
建立檔案：nvda-dashboard-fundamentals-pack.md

📥 REQUIRED INPUTS (do not recreate these):
- READ: nvda-fundamental-memo.md (owned by Sarah)
- READ: nvda-sentiment-memo.md (owned by Mike)

📤 EXPECTED OUTPUT:
Publish artifact: nvda-dashboard-fundamentals-pack.md
```

`output_target` 指定確切的檔名和格式。`REQUIRED INPUTS` 告訴 Agent 必須讀取哪些現有檔案，而非自己重建。`EXPECTED OUTPUT` 定義交付物的形式。

**修正後結果：** Schema 衝突事件從 15 次降至 2 次（-87%）。協調者手動程式碼介入從 6 次降至 0 次。

---

## 問題二：Agent 拿到排隊任務就開始動工

### 現象

我們引入了任務依賴佇列：Task B 依賴 Task A 的產出，所以 Task B 的狀態是 `QUEUED`。但前端 Agent Alan 收到 QUEUED 通知後，看到了附帶的完整任務描述，**立刻開始用寫死的資料建構儀表板**，而不是等 Sarah 的 JSON 就緒。

### 根本原因：LLM 的「即刻生產」偏差

LLM 被訓練為「收到指令就行動」。`QUEUED — waiting for dependencies` 在它眼中不是「請等待」，而是「這是一個有詳細描述的任務，我有足夠資訊開始了」。模型的指令遵循偏差驅使它立即產出，而非閒置等待。

這就像一個太積極的實習生：你還在寫需求文件，他已經看了標題就開始 coding 了。

### VibHQ 的修正

QUEUED 狀態的任務不再發送完整描述。Agent 只收到「有一個任務等待分派，依賴就緒後會通知你」。完整的任務描述（包含 `REQUIRED INPUTS` 的檔案引用）只在狀態變為 `READY` 時才傳送。

---

## 問題三：43 Bytes 的幽靈檔案

### 現象

這是我們花最多時間除錯的問題。Agent 呼叫 `share_file` 成功上傳了完整的 69KB HTML 檔案，然後呼叫 `publish_artifact` 來「公告」這個成果。但 `publish_artifact` 的 content 欄位裡寫的是：

```
"See local file: nvda-analysis-dashboard.html — Full single-file HTML/CSS/JS dashboard..."
```

143 bytes 的指標字串。不是 69KB 的完整內容。

協調者 Emma 讀取了 artifact metadata，看到的「內容」是 143 bytes。她判定交付物不完整，要求重新發布。Agent 再次上傳完整內容到 `share_file`，再次在 `publish_artifact` 寫了指標字串。循環重複。

在一次測試中，**這個迴圈持續了 68 分鐘，消耗了 21% 的協調者訊息量。**

### 從 Log 看到的 Stub 偵測

VibHQ 迭代版本中，Emma 學會了偵測這個問題：

> *"copied file looks suspiciously small... placeholder string"*

但從根本上，問題依然存在——Agent 每次都在 `publish_artifact` 裡寫指標而非完整內容。

### 根本原因：LLM 的「摘要而非重複」優化

LLM 有一個深層的行為模式：**當它已經「完成」了一件事（透過 `share_file` 上傳了完整內容），後續的動作會傾向用摘要來代替重複。**

在模型的理解中，`publish_artifact` 是一個「公告」行為——它已經把完整內容放到 `share_file` 了，為什麼要在公告裡再放一次？所以它寫了一句人類能理解的引用：「See shared file X」。

這是完全合理的推論。問題在於，下游的消費者（協調者）不知道要去 `share_file` 讀取，它只讀 `publish_artifact` 的 content 欄位。

### VibHQ 的修正

兩個層面的修正：

1. **Hub 端驗證**：`publish_artifact` 呼叫中，如果 `content.length < 200` 且包含 `"See"` 或 `"local file"` 等關鍵字，直接拒絕並回傳錯誤訊息：`"Content appears to be a stub. Pass FULL content."`

2. **工具整合**：`share_file` 自動觸發 artifact 登記，消除 Agent 需要分別呼叫兩個工具的場景。

**修正後結果：** Stub 事件從 18 次降至 5 次（-72%），且每次在 2 個 turn 內解決，不再出現 68 分鐘的死循環。

---

## 問題四：「沒有回應」和「正在忙」看起來一模一樣

### 現象

在一次測試中，前端 Agent Dave 的 CLI session 從未成功連線。Emma 不斷透過 MCP 發送訊息、建立任務、等待回覆。**18 分鐘過去了**，沒有任何人告訴 Emma「Dave 不在線」。

Emma 最終自行判斷 Dave 可能有問題，將工作轉給 Alan。但 Alan 此時已經吸收了自己的工作加上 Dave 的全部工作，session 從正常的 ~50 turns 膨脹到 165 turns，成本增為三倍。

### 根本原因：LLM 沒有「我即將不可用」的概念

LLM 不像微服務有 health check endpoint。當 CLI session 當機、WebSocket 斷線、或 API rate limit 被觸發時，不會有任何信號。Agent 只是停止回應——而「正在執行一個複雜任務，需要 5 分鐘」和「已經掛了」在協調者眼中是同一件事：沉默。

### VibHQ 的修正：心跳監控

Hub 追蹤每個 Agent 的最後活動時間戳。如果超過可配置的 timeout 仍無活動，Agent 自動被標記為 `agent_unresponsive`，協調者立即收到通知。

在修正後的版本中，Log 顯示 Emma 的反應完全不同：

`05:49:31`：
> *"Mike is blocked (agent_unresponsive), reassigning to Sarah immediately"*

**從偵測到重新分派只花了 11 秒。** 對比之前的 18 分鐘空等。

不過這裡也出現了一個新問題：timeout 設得太短（~60 秒），導致 Alan 和 Mike 在執行長任務（生成大型 HTML、批次 web search）時被誤判為離線。Emma 開始建構冗餘的 fallback 工作，幾分鐘後 Agent 回來了，已經完成了任務。

**教訓：** 偵測太慢會浪費 18 分鐘，偵測太快會製造冗餘工作。目前我們將 timeout 調整至 3-5 分鐘的區間，並加入了「delayed」緩衝狀態——先標記為疑似延遲，第二次 timeout 才標記為無回應。

---

## 問題五：協調者在壓力下變成開發者

### 現象

回到問題一的場景。Emma 是被設計為「任務協調」角色的——她的 system prompt 明確說「你的工作是分派任務、監控進度、路由產出物」。但當 Schema 衝突導致整合失敗時，她立刻開始寫 JavaScript。

在另一次測試中，當所有工作者 Agent 被標記為無回應時，Emma 自己用 `Write` 工具生成了一份完整的 HTML 儀表板。

一個「經理」在團隊出問題時捲起袖子自己幹——聽起來很有擔當，但在多智能體系統中這是災難性的，因為：

1. 協調者的 context window 本該只放任務狀態和溝通訊息，塞進去的程式碼會永久膨脹 context
2. 每個後續 turn 都要重讀這些程式碼（stateless 架構），累積的 cache read 成本巨大
3. 協調者寫的程式碼品質通常比專職工作者差——它沒有前端 Agent 的完整 system prompt 和工具鏈

### 根本原因：LLM 的問題解決驅動力

面對問題時，LLM 的第一反應是「解決它」，而不是「委派它」。這是訓練目標的直接結果——模型被優化為在對話中提供有用的回應，而「我幫你建了一個新任務給另一個 Agent」在直覺上比「我幫你寫好了程式碼」更像是在推諉。

### VibHQ 的修正

兩個層面：

1. **消除觸發條件**：結構化契約大幅減少了整合失敗的頻率，協調者「需要親自下場」的場景本身變少了
2. **System prompt 硬規則**：`"do not write implementation code — create a new task for a worker instead"` 直接約束行為

後者在正常情況下有效，但在模型感知到「所有工作者都無回應、使用者在等待」的緊急狀態時仍會被覆蓋。這是目前尚未完全解決的問題——LLM 的指令遵循在高壓下會讓步給問題解決本能。

---

## 問題六：同一個 Agent 沒辦法有效審查自己的產出

### 現象

在 V1 中，Sarah 生成了 NVDA 基本面分析，然後這份分析的數據直接被用於建構儀表板。沒有人檢查過「18.8% 預期報酬率」這個數字是怎麼算出來的，也沒有人核對「遊戲部門 QoQ -14.0%」是否跟來源數據一致。

你可以讓 Sarah 自己回去檢查——但一個 LLM 審查自己剛產出的內容時，會表現出明顯的確認偏差。它傾向找到「對，這是正確的」的證據，而非「等等，這個數字有問題」。

### VibHQ 的修正：獨立 QA 階段

我們在管線中加入了專門的 QA 步驟。Sarah 的資料由 Mike 驗證，Mike 的資料由 Sarah 驗證——用不同的 Agent、不同的 session、不同的 context 來做交叉檢查。

修正後的版本中，QA 的 Log 顯示：

Sarah 驗證基本面資料：
> *"QA complete. 67 items validated across both source files: 60 pass, 7 minor flags, 0 failures. Corrected tables provided for direct merge."*

Mike 驗證情緒資料：
> *"QA complete. Validated all catalyst dates (12/12 match), options metrics (6/6 match), trigger probabilities (internally consistent, scenario sums = 100%)"*

**7 個資料錯誤在到達最終儀表板前被攔截。** 這是多智能體框架相對於單一 Agent 最無可取代的優勢——你不能讓同一個人既出題又改卷。

---

## 問題七：LLM 傾向重複生成而非讀取現有產出物

### 現象

前端 Agent Dave 的任務是「用 NVDA 分析資料建構互動式儀表板」。Sarah 已經發布了 `nvda-dashboard-data.json`，包含所有結構化資料。但 Dave 沒有讀取它——他從自己的記憶中重新生成了一份 JSON。

兩份 JSON 的 key 名稱不同、結構不同、甚至部分數值不同。

### 根本原因：生成優先於檢索

對 LLM 來說，「從記憶中生成」是零成本的路徑——直接產出 token 即可。「讀取外部檔案」需要呼叫工具（`read_shared_file`）、等待回應、解析內容，然後才能開始工作。模型的預設行為永遠是阻力最小的路徑。

這解釋了為什麼「RAG 優先」的架構在實務中效果常常不如預期——模型知道外部資料存在，但它更傾向用自己的參數知識來回答，除非被強制讀取。

### VibHQ 的修正

`REQUIRED INPUTS (do not recreate these)` 的措辭經過精心設計：

```
📥 REQUIRED INPUTS (do not recreate these):
- READ and follow: nvda-dashboard-fundamentals-pack.md (owned by Sarah)
  ⚠️ Do NOT create your own version of this file
```

「do not recreate」和「Do NOT create your own version」是刻意的雙重約束。我們測試過只寫 `Read: xxx.md`，Agent 有 30% 的機率仍會自行生成——加上明確的禁止指令後降至接近 0%。

---

## 真實數據：修正前後的比較

同一個任務、同一組 Agent、同樣的使用者指令。只有框架規則不同。

| 指標 | 修正前（V1） | 修正後 | 變化 |
|---|---|---|---|
| 端到端時間 | 107 分鐘 | 58 分鐘 | **-46%** |
| 最終產出 | ❌ 損壞（file:// 載入錯誤） | ✅ 正常運作（62KB，8 項互動功能） | 修復 |
| Schema 衝突事件 | 15 次 | 2 次 | -87% |
| 協調者手動寫程式碼 | 6 次 | 0 次 | 消除 |
| QA 攔截的資料錯誤 | 0（無 QA） | 7 個 | 新功能 |
| Agent 離線偵測 | 無 | 60 秒內自動偵測 | 新功能 |

---

## 誠實面對：什麼時候不需要多智能體？

在完成上述所有修正後，我們跑了一個對照組——**用單一 Claude Opus 4.6 Agent 執行完全相同的任務**。

| | 多智能體（修正後） | 單一 Agent |
|---|---|---|
| 時間 | 58 分鐘 | **9.5 分鐘** |
| 成本 | $58.51 | **$5.92** |
| 產出 | 62KB HTML，8 項功能 | 70KB HTML，同等功能 |

單一 Agent 用了 **1/6 的時間、1/10 的成本**，產出同等品質的結果。

原因很簡單：這個任務的「真正工作量」只有 29K output tokens（11 次搜尋 + 1 份 HTML）。但多智能體框架光是協調通訊就消耗了 ~140K output tokens + 12M cache_read tokens。**協調開銷與實際工作的比例是 5:1。**

就像請 4 個人搬一個箱子——光是溝通「誰搬哪邊」的時間就比一個人直接搬完還久。

### 多智能體在什麼時候才有優勢？

經過多輪實驗，我們歸納出四個條件至少要滿足其中一個：

1. **單一 context window 放不下**：Claude Opus 4.6 有 200K context，這個 NVDA 任務只用了 87K。當你的 codebase 有 50+ 檔案、或需要同時處理多份長文件時，分割才有意義。

2. **子任務真正獨立且每個都很重**：NVDA 的研究任務各只需要 3 分鐘。如果每個子任務需要 30+ 分鐘（例如同時深度分析 20 支股票），平行化的時間節省才會超過協調成本。

3. **需要不同的工具或權限**：Agent A 查資料庫、Agent B 查 Jira、Agent C 改 production code——把所有工具塞給一個 Agent 會造成 system prompt 膨脹和工具衝突。

4. **需要獨立的品質驗證**：這是多智能體唯一無可取代的優勢。你不能讓同一個 Agent 既寫又審自己的產出——確認偏差會讓自我審查形同虛設。

---

## VibHQ 現在在哪裡

目前 VibHQ 的 Hub-and-Spoke 架構已經通過了多輪迭代測試。框架的核心價值不是「讓你用多個 Agent」——任何人都能開四個 Claude Code session。核心價值是：

**VibHQ 用結構化約束解決 LLM 原生協作問題，讓多智能體系統從「碰運氣」變成「可預測」。**

每個我們加入的機制，都對應一個在真實 log 中觀察到的、可重現的 LLM 行為問題：

| LLM 原生問題 | VibHQ 機制 |
|---|---|
| 自由解讀產出格式 | 結構化任務契約（`output_target`、`REQUIRED INPUTS`、`EXPECTED OUTPUT`） |
| 急於開始、不等依賴 | QUEUED 狀態延遲完整描述發送 |
| 指標引用而非完整內容 | Hub 端內容驗證 + `share_file` 自動登記 |
| 無法偵測離線 Agent | 心跳監控 + `agent_unresponsive` 狀態 |
| 協調者角色飄移 | 結構化契約消除觸發條件 + system prompt 硬規則 |
| 無法自我驗證 | 獨立 QA 階段（交叉驗證） |
| 重複生成而非讀取 | 「do not recreate」雙重約束 + 所有權追蹤 |

---

## 下一步

多智能體不是把模型疊起來。是建立一個能「約束模型行為」的組織結構。

VibHQ 的迭代過程證明了一件事：**當你把 LLM 當成組織成員，而不是 API 回傳器，協作品質會發生質變。** Schema 衝突從 15 次降到 2 次，不是因為模型變強了——是因為組織規則變清楚了。

現在，框架已經架起來了。通訊層、協調層、監控層、品質層——四層結構都經過了真實任務的驗證。

但一個控制實驗不夠。

下一階段的重點是：**用更多樣的任務場景持續壓測框架，收集數據，逐步優化。**

我們想回答的問題包括：

- **協調開銷的交叉點在哪？** 目前的 NVDA 案例中，多智能體的協調成本是實際工作的 5 倍。任務要多大、多複雜，多智能體才能在時間和成本上真正勝過單一 Agent？
- **心跳 timeout 的最佳區間是什麼？** 60 秒太短會誤判，5 分鐘太長會空等。不同類型的任務（研究、生成、搜尋）需要不同的閾值嗎？
- **負載平衡怎麼做？** 當一個 Agent 短暫離線，協調者把 5 個任務全丟給同一個 Agent——這不是正確的 fallback 策略。
- **跨模型的行為差異有多大？** Claude 和 GPT 在 stub 問題、角色飄移、生成偏好上的表現一樣嗎？不同模型需要不同的約束規則嗎？

每一個問題都需要更多的 session log、更多的失敗案例、更多的數據來回答。

真正的問題不再是：**模型夠不夠強？**

而是：**組織設計對不對？**

而這，才是多智能體的核心。

---

*VibHQ 是一個開源的多智能體協作框架。所有實驗的 session log 和分析腳本都可以在 repository 中找到。*

*如果你對框架設計、LLM 行為模式、或多智能體系統的成本優化有興趣，歡迎到 GitHub 上開 issue 或 discussion。*