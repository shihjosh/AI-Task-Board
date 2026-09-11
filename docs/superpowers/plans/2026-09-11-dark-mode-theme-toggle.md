# Plan：明亮 / 黑暗模式切換

## 背景與決策（brainstorming 結論）
- 切換方式：手動切換按鈕（太陽/月亮圖示），使用者選擇後存到 `localStorage`（不跟隨系統偏好，避免頁面載入時的偵測延遲/閃爍）。
- 按鈕位置：Toolbar 左側（與現有 tabs 同列，LOGO 區塊右側）。
- 套用範圍：全站（Board / List / Gantt / 已完成頁全部跟進）。
- Tailwind v4 專案（`@import "tailwindcss"`，無 `tailwind.config.js`），改用 class-based dark variant：
  `@custom-variant dark (&:where(.dark, .dark *));` 寫在 `src/index.css`，並在 `<html>` 上切換 `.dark` class。

## Task 1：主題狀態管理（Context + Hook）
- 新增 `src/contexts/ThemeContext.tsx`：
  - `ThemeProvider`：`useState<'light'|'dark'>` 初始值從 `localStorage.getItem('theme')` 讀取，
    預設 `'light'`（找不到值時，不偵測系統偏好，符合上面決策）。
  - `useEffect` 在 `theme` 變動時，對 `document.documentElement` 加/移除 `dark` class，並寫回 `localStorage`。
  - `useTheme()` hook 回傳 `{ theme, toggleTheme }`。
- `src/main.tsx` 用 `ThemeProvider` 包住 `<App />`（含 `BrowserRouter` 外層或內層皆可，需含 `/done` 路由）。
- 驗證：`npx tsc -b` 過；瀏覽器 console 執行 `document.documentElement.classList.contains('dark')` 確認初始為 false，
  呼叫 `toggleTheme` 後變 true 且 `localStorage.getItem('theme')` 為 `'dark'`，重新整理頁面後維持深色。

## Task 2：Tailwind class-based dark variant 設定
- `src/index.css` 加入 `@custom-variant dark (&:where(.dark, .dark *));`（放在 `@import "tailwindcss";` 之後）。
- `:root { color-scheme: light; }` 改為依 `.dark` class 動態設定（用簡單 CSS：`.dark { color-scheme: dark; }`）。
- 驗證：手動在 devtools 幫 `<html>` 加 `class="dark"`，確認 `dark:` 開頭的 Tailwind class 能生效（先在任一元件加一個測試 `dark:bg-red-500` 驗證後移除）。

## Task 3：ThemeToggle 元件 + Toolbar 整合
- 新增 `src/components/ThemeToggle.tsx`：小按鈕，圖示用 `lucide-react` 的 `Sun` / `Moon`（依當前 theme 顯示對方圖示，例如目前 light 顯示月亮圖示可切換到 dark）。
- `Toolbar.tsx` 在 LOGO 區塊右側（`AI Task Board / my-taskboard` 之後、tabs 之前，或緊鄰新增任務按鈕左側都可，取「與現有 tabs 同列」）插入 `<ThemeToggle />`。
- 驗證：瀏覽器點擊按鈕，UI 圖示切換、`<html class="dark">` 出現/消失。

## Task 4：全站套用 dark: 樣式（Board 主頁）
- 逐一為以下元件的背景/文字/邊框 Tailwind class 補上對應 `dark:` 變體（沿用該元件既有的 slate 色階邏輯，深色模式用 `slate-800/900` 當背景、`slate-100/200` 當文字，`slate-700` 當邊框）：
  - `App.tsx`（頁面外層背景）
  - `Toolbar.tsx`
  - `BoardColumn.tsx`
  - `TaskCard.tsx` / `SortableTaskCard.tsx`
  - `DoneDropZone.tsx`
- 驗證：`npx tsc -b`；瀏覽器切到 dark 後，Board 頁面逐一視覺檢查無白底刺眼區塊、文字對比足夠。

## Task 5：全站套用 dark: 樣式（List / Gantt / 已完成頁 / Drawer / 其他彈出元件）
- 補上 `dark:` 變體：
  - `ListView.tsx`
  - `GanttView.tsx`
  - `DonePage.tsx`
  - `TaskDrawer.tsx`（含表單 input/select/textarea 的深色樣式）
  - `CommentList.tsx`、`AutomationRunList.tsx`
  - `SearchBox.tsx`、`TagFilterPanel.tsx`
- 驗證：瀏覽器切到每個頁面（Board/List/Gantt/已完成）+ 開啟 TaskDrawer 檢查留言/執行紀錄分頁，確認深色下都無白底/低對比問題；`npx tsc -b` + `npm run lint`。

## Task 6：README 更新 + 最終整支分支 review
- `README.md` 補充「明亮/黑暗模式」功能說明（手動切換、localStorage 記憶）。
- 依 workflow 做一次全分支 review（含瀏覽器實際點擊驗證，不只讀 diff）。
