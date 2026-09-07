# AI Task Board

一個仿照 [dashi-taskboard](https://github.com/chuspeeism/dashi-taskboard) 的前端 Kanban 任務看板專案。

目前為 **Phase 1**：純前端、無後端的靜態看板 UI（使用 mock 資料），之後視需求再串接後端與資料庫。

## 技術棧
- React + Vite
- TypeScript
- Tailwind CSS
- @dnd-kit/core（拖拉互動）
- lucide-react（圖示）

詳細規格請見 [docs/spec.md](docs/spec.md)。

## 看板設計
三欄式 Kanban：
- **等待認領**（To Do）
- **處理中**（In Progress）
- **等你確認**（Review / Pending Approval）

## 開發

```bash
npm install
npm run dev
```

## 專案結構
```
AI-Task-Board/
├── docs/
│   └── spec.md
├── src/
│   ├── components/
│   ├── data/
│   ├── types/
│   ├── App.tsx
│   └── main.tsx
├── index.html
├── package.json
├── tailwind.config.js
├── tsconfig.json
└── vite.config.ts
```

## 授權
Private project.
