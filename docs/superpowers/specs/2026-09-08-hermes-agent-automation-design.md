# AI Task Board — Hermes Agent 自動化設計文件（規劃階段，尚未實作）

> 討論日期：2026-09-08
> 狀態：**Spec only — 本文件僅記錄設計決策，尚未動工實作**

## 背景

目前看板是純 CRUD 工具（Phase 1-3 完成），使用者手動建卡、手動拖拉狀態。
本次規劃的目標：**當任務卡從「等待認領」拖到「處理中」時，自動觸發 Hermes agent
根據卡片標題與描述真的動手執行任務**（改程式碼、跑指令等），而不只是產生文字建議。

概念上類似 [codex-commander](https://github.com/sanshao85/codex-commander) 的委派模式：
先問清楚範圍，執行時規定範圍與驗收條件，完成或阻塞時回報，並檢查實際交付物。

## 核心流程

```
使用者拖卡片 → columnId 變成 in_progress
    ↓
後端偵測到這個狀態變化（PATCH /api/tasks/:id 且 columnId: todo → in_progress）
    ↓
組合 prompt：卡片 title + description + 目標專案路徑（targetPath 欄位）
    ↓
背景 spawn 一個 Hermes agent（hermes chat -q）去執行
    ↓
agent 執行完成 → 把結果寫回卡片留言區（POST /api/tasks/:taskId/comments）
    ↓
成功 → 自動把卡片移到 review 欄位（columnId: review），等待人工確認
```

## 已確認的設計決策

| 決策點 | 選擇 |
|---|---|
| AI 執行的動作性質 | Hermes 本身就是能操作系統/寫程式的 agent（呼叫 terminal/file 等工具真的動手做事），不只是產生文字建議 |
| 使用哪個 agent | Hermes（`hermes chat -q`，完整工具集：terminal / file / web 等） |
| 執行目錄/專案範圍 | **不固定單一專案**——卡片需新增欄位指定目標目錄/repo，支援多專案派工 |
| 觸發時機 | 卡片 `columnId` 從其他狀態變為 `in_progress` 時觸發（非建立時，也非任意欄位更新都觸發） |
| 執行完成後的卡片狀態 | 執行成功 → **自動移到 `review`**，並在留言區寫入執行結果 / 變更摘要；失敗/阻塞的處理方式待細化（可能保留在 `in_progress` 並標註錯誤，需在實作前再確認） |
| 回報位置 | 寫入既有留言系統（`POST /api/tasks/:taskId/comments`），沿用 Phase 3 已完成的留言 CRUD |

## 需要新增的資料欄位

### `tasks` 表新增欄位（規劃）

```sql
ALTER TABLE tasks ADD COLUMN target_path TEXT DEFAULT '';
```

- `targetPath`：Hermes agent 執行任務時的工作目錄（絕對路徑），對應到某個本機專案/repo
- 若卡片未填此欄位，代表這張卡不是「可自動執行」的任務卡（維持純手動看板卡片的舊行為）

可能還需要的欄位（待實作前細化）：
- 執行狀態標記（例如 `automationStatus`: `idle` / `running` / `done` / `failed`），避免同一張卡片被重複觸發或並行執行
- 執行歷程記錄（哪次 PATCH 觸發了哪次 Hermes 執行，方便追蹤與除錯）

## 觸發偵測邏輯（規劃）

- 在 `PATCH /api/tasks/:id` handler 中比對「更新前 columnId」與「更新後 columnId」
- 僅當 `existing.column_id !== 'in_progress' && patch.columnId === 'in_progress'` 且該卡有 `targetPath` 時才觸發
- 觸發後應立即回應 PATCH 請求（不要讓使用者等 Hermes 跑完），Hermes 執行改為背景 process
- 需要防止重複觸發：同一張卡片若已在執行中，再次符合觸發條件時應忽略或提示

## Hermes 呼叫方式（規劃）

```bash
hermes chat -q "<根據 task.title + task.description 組合的 prompt>"
```

- 工作目錄設為該卡片的 `targetPath`
- 背景執行（避免阻塞 API），執行完成後由呼叫端（Node 後端）解析輸出，寫回留言 + 更新 columnId
- Prompt 應包含：任務標題、Markdown 描述全文、明確要求 Hermes 回報做了什麼變更/遇到什麼阻塞

## 待實作前需要再確認的問題（Open Questions）

1. Hermes 執行**失敗或被阻塞**時的卡片狀態要怎麼處理？（目前只確認了「成功」路徑會自動移到 review，失敗路徑本次討論尚未拍板）
2. 同一張卡片重複拖回 `in_progress` 是否要允許重新觸發？
3. 是否需要在 UI 上顯示「Hermes 執行中」的視覺狀態（例如卡片上的 loading 指示）？
4. `targetPath` 欄位要不要做基本驗證（路徑存在性、避免使用者填入危險路徑）？
5. 多張卡片同時被拖到 `in_progress` 時，是否需要併發限制（例如同時最多跑 N 個 Hermes process）？
6. Hermes 執行的逾時策略（跑太久要不要強制中止）？

## 範圍外（本次規劃不涉及）

- Slack 整合（另有討論，屬於不同的觸發來源，本文件僅聚焦「拖拉觸發 Hermes」這條路徑）
- 9Router 直接呼叫 LLM API（本設計改採直接 spawn `hermes` CLI，由 Hermes 自行處理模型呼叫）
- 實際程式碼實作（本文件為 spec-only，待使用者確認後再進入 plan + 實作階段）
