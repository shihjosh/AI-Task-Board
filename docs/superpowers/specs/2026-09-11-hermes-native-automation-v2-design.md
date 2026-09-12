# Spec：Hermes 原生自動化升級（Phase 4 → 4-v2）

## 背景

產品方向決策（brainstorming 結論）：AI-Task-Board 不跟 Vibe Kanban 等通用 AI coding board
正面競爭，走「Hermes Agent 原生任務看板」路線——做深、做窄，成為 Hermes 重度使用者的
視覺化排程/委派介面，而非通用多 agent 工具。

現有 Phase 4 自動化實作（`server/automationRunner.mjs`）的三個已知落差：
1. 沒有執行隔離：直接在 `targetPath` 原地 spawn，且全系統只能跑 1 個（`MAX_CONCURRENT = 1`）
2. 執行過程是黑箱：只有 prompt 層級「軟性要求」agent 自己 PATCH progress，使用者看不到即時輸出
3. 固定裸呼叫 `hermes chat -q <prompt> --cli`，沒有用到 Hermes CLI 內建的 worktree 隔離、skill 預載能力

## 決策（已與使用者確認）

1. **執行隔離**：改用 Hermes CLI 內建 `-w`/`--worktree` flag，取代自己刻 worktree 邏輯。
   `spawn` 的 `cwd` 仍是 `task.targetPath`，指令改為：
   ```
   hermes chat -q "<prompt>" -w --cli [-s <skill>]
   ```
   `-w` 會在該 repo 內自動建立隔離的 git worktree + 專屬分支，執行完成後該分支保留在
   worktree 目錄下（不會自動 merge、不會自動開 PR）。
2. **worktree 分支後續處理**：執行完成只需確保分支存在且可被使用者自行檢視/push/merge，
   **不自動開 PR**（沿用既有「PR 由使用者自己在 GitHub 網頁開」的專案慣例）。
   若 `-w` 建立的 worktree 分支尚未推到 remote，`automation_runs` 記錄裡要能讓使用者知道
   分支名稱與 worktree 路徑，方便他自己去處理。
3. **Skill 選擇**：每張任務卡新增「自動執行使用的 skill」欄位（選填），前端在 TaskDrawer
   提供下拉選單。選項來源：後端新增 `GET /api/skills` endpoint，掃描
   `~/.hermes/skills/<category>/<name>/SKILL.md` 取得可用 skill 名稱清單（不 parse
   `hermes skills list` 的 CLI 表格輸出，避免格式依賴）。未選則不傳 `-s`，維持現行「agent
   自行判斷」行為。
4. **執行過程可視化**：`automationRunner.mjs` 對 `child.stdout`/`child.stderr` 的
   `data` 事件即時 append 寫回該筆 `automation_runs` 資料列的一個新欄位（累積輸出，非等
   exit 才一次性寫入），前端「執行紀錄」頁籤對 `running` 狀態的紀錄改為定時輪詢
   （比照現有 `fetchTasks` 模式，例如每 2 秒呼叫一次 `GET /api/tasks/:taskId/automation-runs`），
   讓使用者能看到接近即時的執行輸出，不需要 SSE。

## 範圍界定（比照既有 Phase 4/4.2 的教訓）

- 不做：自動開 PR、自動 merge worktree 分支、UI 內建 diff review（維持現有「使用者自己去
  repo 看」的模式，只是現在多了 worktree 隔離這一層，減少了原地污染的風險）
- 不做：多 agent 同時執行提高並行度（`MAX_CONCURRENT` 維持 1，`-w` 隔離的價值在於「不污染
  原始工作目錄」，不是「本次順便解決併發」——併發提升留給更後面的 phase，且需先驗證
  worktree 隔離本身穩定後才適合疊加）
- 不做：即時 log 用 WebSocket/SSE 真推送（決策 4 已明確選輪詢）
- 不做：skill 清單快取或背景更新機制（每次開下拉選單即時掃描檔案系統即可，`~/.hermes/skills`
  規模小，掃描成本可忽略）

## 待實作階段（下一步：writing-plans 依此 spec 產生 plan）

依既定 workflow：本 spec commit 後（尚未實作），下一步用 `writing-plans` skill 針對此 spec
產生 `docs/superpowers/plans/2026-09-11-hermes-native-automation-v2.md`，再走
`subagent-driven-development` 執行。
