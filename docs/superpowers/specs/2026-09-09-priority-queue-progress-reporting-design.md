# Hermes 自動化執行——優先級佇列 + 即時進度回報 設計文件

> 討論日期：2026-09-09
> 狀態：**Spec only — 本文件僅記錄設計決策，待確認後進入 plan + 實作階段**

## 背景

目前（Phase 4 + 執行紀錄獨立化後）的 Hermes 自動化執行有兩個行為要調整：

1. 目前 `automationRunner.mjs` 的等待佇列是單純 FIFO（先進先出），多張卡片同時拖到「處理中」時，先到的先跑，與卡片的優先級（`priority`）無關。
2. 目前允許最多同時 2 個 Hermes 程序併發執行（`MAX_CONCURRENT = 2`）。
3. 執行過程中沒有任何進度回饋，`progress` 欄位在自動化流程中完全不會被更新，即使任務描述裡寫了明確的執行步驟（Step 1、Step 2…），使用者在卡片上也看不到目前跑到哪一步。

本次規劃要解決這三點，讓自動化執行行為更貼近「一次專心做一件事、依重要性排序、有進度可看」的使用情境。

## 已確認的設計決策

| 決策點 | 選擇 |
|---|---|
| 等待佇列排序方式 | 從 FIFO 改為**依優先級排序**：`high` > `medium` > `low`；同優先級之間維持原本進入佇列的先後順序（穩定排序） |
| 併發執行數量 | 從 `MAX_CONCURRENT = 2` 改為 **`MAX_CONCURRENT = 1`**——全系統同一時間只執行一個 Hermes 自動化任務，正在執行中的先跑完，才輪到佇列裡優先級最高的下一個 |
| 進度回報時機 | **即時、逐 Step**：由 Hermes 子代理在執行過程中，每完成任務描述裡的一個 Step，主動呼叫看板自身的 API（`PATCH /api/tasks/:id`）更新該卡片的 `progress` 欄位，而不是等整個任務執行完才事後解析輸出、一次性回填 |
| 如何讓子代理知道要更新誰的 progress | 在 `buildPrompt()` 組出的 prompt 中，明確提供該任務的 API base URL 與 `task.id`，並用文字指示子代理：如果任務描述包含明確的 Step 清單，請在完成每個 Step 後呼叫 `PATCH <base_url>/api/tasks/<task.id>`，body 帶 `{"progress": <0-100之間的整數，依已完成 Step 佔全部 Step 的比例計算>}` |
| 子代理不遵照指示的風險 | 這是「信任子代理照做」的設計，屬於 prompt 層級的軟性約束，無法在程式層級強制保證一定會呼叫。若子代理未依指示回報，`progress` 就不會變化，但不影響任務本身照樣執行、最終仍會走既有的 `automationStatus`/`automation_runs` 完成流程 |

## 佇列排序邏輯（規劃）

目前：
```js
if (runningCount >= MAX_CONCURRENT) {
  queue.push(task)
  return
}
```
`onSlotFreed()` 裡用 `queue.shift()` 取出下一個（FIFO）。

改為：
- `queue.push(task)` 維持不變（新任務進佇列時機不變）。
- `onSlotFreed()` 改用「找出佇列中優先級最高的任務」取出，而非單純 `shift()`。優先級數值化：`high = 0, medium = 1, low = 2`（數字越小越優先），取陣列中數值最小的第一個（同數值時取先加入佇列的，即維持陣列原有順序），從陣列中移除該筆並執行。
- 不影響「已經在執行中」的任務（`MAX_CONCURRENT = 1` 之下同一時間只有一個在跑，佇列排序只決定下一個換誰跑）。

## API Base URL 傳遞方式（規劃）

`automationRunner.mjs` 目前不知道自己所在的 server 監聽的 port／base URL。沿用 `server/index.mjs` 現有的 `process.env.PORT ?? 3001` 邏輯，在 `automationRunner.mjs` 內部同樣讀取 `process.env.PORT ?? 3001` 組出 `http://localhost:<port>`，作為 prompt 裡教子代理呼叫的 base URL。

## Prompt 內容變更（規劃）

在 `buildPrompt(task)` 現有內容之後，新增一段進度回報指示：

```
若上述任務描述包含明確的執行步驟（例如「Step 1」「Step 2」等清單），請在完成每一個步驟後，
立即執行以下指令回報進度（將 <已完成步驟數/總步驟數的百分比整數> 換成實際數字，例如完成 2 個
step、共 5 個 step，則填 40）：

curl -s -X PATCH http://localhost:<port>/api/tasks/<task.id> \
  -H 'Content-Type: application/json' \
  -d '{"progress": <已完成步驟數/總步驟數的百分比整數>}'

若描述中沒有明確的步驟清單，則不需要回報進度。
```

（curl 是目前 sandbox 環境已知一定存在的工具，比要求子代理自己判斷用什麼語言呼叫 API 更明確可靠。)

## 範圍外（本次規劃不涉及）

- 不涉及讓使用者手動調整佇列順序（例如把某張卡片插隊到最前面）。
- 不涉及進度回報失敗時的重試機制（子代理若因故未呼叫成功，不會有額外提醒或補償邏輯）。
- 不涉及把 `MAX_CONCURRENT` 改成可設定值（沿用寫死常數的既有模式，只是把數值從 2 改成 1）。
- 不涉及優先級以外的其他佇列排序因子（例如建立時間、預估執行時長）。
