# AI Task Board — 專案規格 (Spec)

## 專案目標
仿照 [chuspeeism/dashi-taskboard](https://github.com/chuspeeism/dashi-taskboard) 的前端 Kanban 看板 UI，
先實作**純前端、無後端**的靜態看板頁面（使用 mock 資料），之後視需求再擴充後端/資料庫。

## 參考來源
- 原專案：https://github.com/chuspeeism/dashi-taskboard
- 原專案技術棧：React 19 + Vite 8 + TypeScript，純手刻 CSS（無 UI 元件庫），
  react-markdown + remark-gfm 渲染任務描述，ws（WebSocket）即時同步。
- UI 截圖分析：三欄式 Kanban 看板 + 左側導覽側邊欄 + 頂部視圖切換列。

## 技術棧選型（本專案）
| 項目 | 選擇 | 理由 |
|---|---|---|
| 框架 | React + Vite | 純前端 SPA，無需 SSR/API routes，開發啟動快 |
| 語言 | TypeScript | 看板卡片/欄位/任務狀態有明確資料結構，型別安全 |
| 樣式 | Tailwind CSS | Utility-first，開發看板卡片/標籤等視覺元件快速 |
| 拖拉互動 | @dnd-kit/core | 現代、輕量，支援跨欄位拖拉 |
| 圖示 | lucide-react | Outline 風格，統一視覺語言 |
| 狀態管理 | React useState/useReducer（前期）→ 視需要導入 zustand | 資料量小，先用內建 state |

## 版面配置（三層式）
1. **頂部工具列**：麵包屑、視圖切換分頁（Dashboard / 看板 / 列表 / 甘特圖）、搜尋、篩選、新增按鈕
2. **主要看板區**：三欄式 Kanban
   - **等待認領**（To Do）
   - **處理中**（In Progress，含進度條）
   - **等你確認**（Review / Pending Approval）
3. （選配，後期）左側導覽側邊欄：專案清單、任務歷史

## 任務卡片元件（TaskCard）欄位
- ID 編號
- 標題
- 優先級標籤（高 / 中 / 低）
- 分類標籤（GitHub / Issue / BUG 等，可複選）
- 負責人頭像（可多人堆疊顯示協作者）
- 進度條（處理中欄位使用）
- 留言數量
- 狀態提示點（如：待確認未讀標記）

## 開發階段規劃
- **Phase 1（本次）**：純前端 + Mock 資料的靜態三欄看板 UI，支援拖拉換欄
- **Phase 2（後續，視需求）**：串接後端 API / 資料庫，任務 CRUD、多人協作、即時同步

## 專案結構（預計）
```
AI-Task-Board/
├── docs/
│   └── spec.md          # 本檔案
├── src/
│   ├── components/
│   │   ├── TaskCard.tsx
│   │   ├── BoardColumn.tsx
│   │   └── Toolbar.tsx
│   ├── data/
│   │   └── mockTasks.ts
│   ├── types/
│   │   └── task.ts
│   ├── App.tsx
│   └── main.tsx
├── index.html
├── package.json
├── tailwind.config.js
├── tsconfig.json
└── vite.config.ts
```
