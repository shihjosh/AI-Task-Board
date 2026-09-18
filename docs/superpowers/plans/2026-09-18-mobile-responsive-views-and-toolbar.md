# 手機版列表/甘特圖/工具列 響應式優化 實作計畫

> **給執行的 agent：** 必要子技能：使用 superpowers:subagent-driven-development（建議）或 superpowers:executing-plans 逐一任務執行本計畫。步驟使用 checkbox（`- [ ]`）語法追蹤進度。

**背景：** `2026-09-09-mobile-responsive-layout.md` 已完成看板（Board）視圖的手機適配（單欄 + 標籤切換 + 「移動到...」選單取代拖拉），該計畫「範圍外」章節明確排除了「Toolbar 的甘特圖/列表視圖等分頁本身內容的手機適配」。本計畫補齊這塊缺口。

**目標：** 在 `< 640px`（Tailwind `sm` 斷點）螢幕寬度下：
1. `ListView` 從純橫向捲動表格改為卡片式堆疊佈局，不需要橫向滑動就能看到單筆任務的完整資訊。
2. `GanttView` 提供手機可用的呈現（時間軸本質上不適合窄螢幕，採「簡化＋明確引導」而非硬擠進小螢幕）。
3. `Toolbar` 在手機寬度下不擁擠、不溢出，次要操作可視需要收合。

`≥ 640px`（桌面）三者行為與現有樣式完全不變。

**架構：** 沿用既有慣例，全程用 Tailwind `hidden sm:block` / `block sm:hidden` 純 CSS 切換兩種佈局，不用 JS 偵測視窗寬度。不新增 npm 依賴。

## 全域限制條件

- 不新增任何 npm 依賴。
- 桌面版（`≥ 640px`）的 `ListView`／`GanttView`／`Toolbar` 現有渲染邏輯與樣式維持完全不變。
- 響應式切換全部用 Tailwind CSS class 完成，不引入 `window.innerWidth`/`matchMedia`。
- 所有新增的使用者可見文字一律使用繁體中文。
- 觸控熱區（可點擊的按鈕/連結）在手機版新增的區塊中至少 40x40px。

---

### Task 1：`ListView.tsx` 手機卡片化

**檔案：**
- 修改：`src/components/ListView.tsx`

**介面：** 無新增 props；同一組 `tasks`/`onTaskClick` 依斷點渲染兩種佈局。

- [x] **Step 1：抽出卡片渲染邏輯**

在現有 `<table>` 版面（`hidden sm:block` 包起來，維持原樣）之後，新增手機版卡片列表（`sm:hidden`），每張卡片顯示：標題、欄位（column）、優先級（含現有 `priorityLabel` 對照）、負責人；卡片本身可點擊觸發 `onTaskClick(task)`，比照桌面版整列可點擊的互動方式。

- [x] **Step 2：處理空狀態**

確認「沒有符合條件的任務」的空狀態文案在兩種佈局下只渲染一次（不要手機/桌面各渲染一份重複的空狀態 DOM）。

- [x] **Step 3：瀏覽器手動驗證**

縮小視窗至 375px（iPhone SE 等窄機型）與 390px（一般手機）：
1. 確認不再需要橫向捲動即可看到單筆任務的標題/欄位/優先級/負責人。
2. 點擊卡片能正常開啟 `TaskDrawer` 編輯。
3. 切回 ≥ 640px，確認桌面版表格佈局、欄位、樣式與改動前完全一致。

- [x] **Step 4：Commit**

```bash
git add src/components/ListView.tsx
git commit -m "feat: add mobile card layout for ListView"
```

---

### Task 2：`GanttView.tsx` 手機版簡化呈現

**檔案：**
- 修改：`src/components/GanttView.tsx`

**介面：** 無新增 props。

- [x] **Step 1：手機寬度下以「本週待辦清單」取代時間軸格線**

甘特圖時間軸格線本質上需要較寬版面才可讀，手機版（`sm:hidden`）改為依 `dueDate` 排序的簡易清單，每筆顯示標題＋到期日期（相對表示，如「還有 2 天」／「已逾期」），點擊可開啟 `TaskDrawer`；週/月切換按鈕維持可用（影響清單的日期範圍篩選邏輯，複用既有 `rangeStart`/`dayCount`／`tasksWithDueDate` 計算，不重寫日期邏輯）。

- [x] **Step 2：桌面版時間軸格線包一層 `hidden sm:block`**

確保 ≥ 640px 時渲染邏輯、樣式與改動前完全一致（函式主體不得變動，只需要包一層顯示切換的容器）。

- [x] **Step 3：瀏覽器手動驗證**

在 375px/390px 寬度下確認簡易清單清楚可讀、無橫向溢出；週/月切換仍正確篩選清單內容。切回桌面寬度確認時間軸格線佈局與改動前一致。

- [x] **Step 4：Commit**

```bash
git add src/components/GanttView.tsx
git commit -m "feat: add mobile simplified list view for GanttView"
```

---

### Task 3：`Toolbar.tsx` 手機寬度收斂

**檔案：**
- 修改：`src/components/Toolbar.tsx`

**介面：** 無新增 props。

- [x] **Step 1：實測目前手機寬度下的擁擠/溢出狀況**

在 375px 下逐一檢查：logo/麵包屑列、視圖切換 tabs（含 ThemeToggle）、右側「已完成」連結＋搜尋框＋標籤篩選＋新增任務按鈕，是否有裁切、換行錯位或觸控熱區過小的問題。記錄實際發現的問題清單再動手，不要臆測。

- [x] **Step 2：依實測結果調整**

常見做法（依實測結果擇一或組合，不要無條件全套）：
- 讓右側次要操作（搜尋框、標籤篩選）在手機寬度下可以換行或收進單一「更多」下拉，主要保留「新增任務」按鈕明顯可見。
- 視圖切換 tabs 若在極窄螢幕仍擠壓，比照現有 `overflow-x-auto` + `whitespace-nowrap` + `shrink-0` 手法（已在舊計畫的 Task 4 用過的模式）。
- 若某個既有 `sm:` 響應式設定實測下已經沒問題，記錄「無需調整」即可，不要為了改而改。

- [x] **Step 3：瀏覽器手動驗證**

375px/390px 下確認新增任務按鈕與搜尋/篩選都可正常操作，無元素互相重疊或裁切；切回桌面寬度確認樣式與改動前一致。

- [ ] **Step 4：Commit（若 Step 2 有實際修改才需要；若全部「無需調整」則跳過，直接進入 Task 4）**

```bash
git add src/components/Toolbar.tsx
git commit -m "fix: refine Toolbar layout for narrow mobile widths"
```

---

### Task 4：README 同步 + 最終整分支 review

**檔案：**
- 修改：`README.md`
- 修改：`docs/superpowers/plans/2026-09-18-mobile-responsive-views-and-toolbar.md`（本檔案）

**介面：** 無（純文件任務）。

- [x] **Step 1：更新 `README.md`**

在既有手機版說明附近，補充：列表視圖（ListView）手機寬度下改為卡片堆疊；甘特圖（GanttView）手機寬度下改為依到期日排序的簡易清單；Toolbar 依實測結果的調整（若有）。

- [x] **Step 2：最終整分支 review**

- 執行 `npx tsc -b` 與 `npm run lint`，確認皆乾淨，無新增錯誤/警告。
- 執行 `npm test`（vitest），確認既有測試全數通過，未破壞既有元件測試。
- 確認桌面版（`≥ 640px`）三個元件的既有渲染邏輯字元級未被改動（`git diff main -- src/components/ListView.tsx src/components/GanttView.tsx src/components/Toolbar.tsx` 中桌面版分支僅被包裹容器，內部 JSX 與樣式未變動）。
- 用瀏覽器分別在 375px、390px、768px、1280px 四個寬度下走一輪三個視圖，確認無回歸。

- [x] **Step 3：Commit**

```bash
git add README.md docs/superpowers/plans/2026-09-18-mobile-responsive-views-and-toolbar.md
git commit -m "docs: sync README with mobile list/gantt/toolbar improvements, mark plan complete"
```

---

## 本計畫範圍外

- 不涉及看板（Board）視圖本身（已由 `2026-09-09-mobile-responsive-layout.md` 完成）。
- 不涉及 PWA/原生 App 化、離線支援、safe-area/viewport-fit 等進階行動裝置設定。
- 不新增「平板模式」第三種斷點。
- 不涉及甘特圖拖拉調整日期等新互動功能，僅做呈現方式的響應式調整。
