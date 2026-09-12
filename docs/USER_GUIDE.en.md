# AI Task Board User Guide

[繁體中文](USER_GUIDE.md) | English

This guide walks you through *using* the board to manage tasks — no coding knowledge required. If you're installing or deploying the project, see [README.en.md](../README.en.md).

## Table of Contents

1. [Board Overview](#1-board-overview)
2. [Creating & Editing Tasks](#2-creating--editing-tasks)
3. [Moving Tasks (Drag / Mobile)](#3-moving-tasks-drag--mobile)
4. [Marking a Task as Done](#4-marking-a-task-as-done)
5. [Task Description (Markdown) & Comments](#5-task-description-markdown--comments)
6. [Search & Filter](#6-search--filter)
7. [Switching Views: Board / List / Gantt](#7-switching-views-board--list--gantt)
8. [Light / Dark Mode](#8-light--dark-mode)
9. [Letting AI Complete a Task (Hermes Automation)](#9-letting-ai-complete-a-task-hermes-automation)
10. [FAQ](#10-faq)

---

## 1. Board Overview

When you open the site, the "Board" view is shown by default with three columns:

| Column | Meaning |
|---|---|
| **To Do** | Tasks that haven't started |
| **In Progress** | Tasks currently being worked on |
| **Review** | Finished tasks waiting for you to verify |

"Done" tasks are not shown on the main board — they're collected on a dedicated page accessible via the "**Done (N)**" link in the top right, keeping the main board uncluttered.

Each card shows: title, priority (high/medium/low), tags (GitHub/Issue/BUG/PR), assignee initials, and progress (if set).

---

## 2. Creating & Editing Tasks

**Create**: Click "**+ New Task**" in the top right. A form slides in from the right — fill in:

- **Title** (required)
- **Priority**: high / medium / low
- **Column**: which column to place it in
- **Tags**: multi-select from GitHub / Issue / BUG / PR
- **Assignees**: multi-select (Josh / Amy / Ken)
- **Progress**: a number from 0–100, optional
- **Due date**: optional, only used by the Gantt chart
- **Automation directory / Automation skill**: optional, see section 9

Click "**Create**" when done.

**Edit**: Click any existing card to open the same form. Modify fields, then click "**Save**". A "**Delete**" button appears at the bottom of the form (with a confirmation prompt, to avoid accidental deletion).

---

## 3. Moving Tasks (Drag / Mobile)

**Desktop**: Drag a card with your mouse and drop it in another column.

**Mobile** (automatically switches on narrow screens): A horizontally-scrollable row of column tabs appears at the top — tap a tab to switch which column is shown. Each card also gets a "**Move to...**" dropdown to change its column without dragging.

---

## 4. Marking a Task as Done

Two ways:

1. **Drag to mark done** (desktop): Drag a card onto the "**Drop here to mark as done**" bar at the bottom of the board.
2. **Manual selection**: Open the task's edit form and set "Column" to "**Done**", then save.

Once marked done, the task disappears from the main board and moves to the Done page. To bring it back, open it from the Done page and change "Column" to something else.

---

## 5. Task Description (Markdown) & Comments

Open a task's edit form and scroll down to find:

**Description**: Supports Markdown — headings (`#`), lists (`-`), tables, code blocks (```` ``` ````), etc. Use the "**Edit / Preview**" tabs at the top to switch between raw text and rendered output.

**Comments / Runs**: These tabs only appear after a task has been saved at least once (not on a brand-new, unsaved task):
- **Comments**: A simple comment thread — add, edit, or delete comments to track discussion or add context.
- **Runs**: If this task has used the "AI automation" feature (section 9), this tab shows the full history of every run.

---

## 6. Search & Filter

Two icons on the toolbar:

- **Search** 🔍: Click to expand a text input; typing filters tasks by **title** in real time (description and comments are not searched). Clear the text or click the X to show all tasks again.
- **Filter**: Click to open a tag filter panel — select multiple tags; a task shows if it matches *any* selected tag (OR logic). The filter icon shows a badge with the number of tags currently selected.

Search and filter can be combined (e.g. filter by tag first, then search within the results).

---

## 7. Switching Views: Board / List / Gantt

Three tabs in the middle of the toolbar:

- **Board**: The default drag-and-drop three-column view.
- **List**: A table view — one row per task, columns are Title / Column / Priority / Assignee. Shows **all** tasks (including Done), no dragging, click a row to open the edit form.
- **Gantt**: Horizontal axis is time (switch between "Week" / "Month" view), each task draws a bar from its **creation date** to its **due date**. **Only tasks with a due date set are shown** — tasks without one won't appear. Click a bar or task title to edit.

All three views can be combined with search and tag filtering.

---

## 8. Light / Dark Mode

Click the sun/moon icon on the left side of the toolbar to toggle light/dark mode — it applies site-wide, including dialogs and the Done page. Your choice is saved in the browser and persists across page reloads (it does not follow your OS's system theme setting).

---

## 9. Letting AI Complete a Task (Hermes Automation)

This feature lets an AI agent (Hermes) actually complete a task for you, rather than just tracking it as a to-do.

### Setting it up

1. Open a task's edit form.
2. Fill in **"Automation directory"**: an **absolute path** to a real git project folder on your machine (e.g. `/home/yourname/my-project`).
3. (Optional) **"Automation skill"**: pick a skill from the dropdown for the AI to prioritize using; if left blank, the AI decides how to approach the task on its own.
4. Write a clear **description** of what you want done (Markdown step lists work well).
5. Save, then drag the card into (or move it via "Move to...") the **"In Progress"** column.

### What happens next

- The AI starts working inside the folder you specified, using an **isolated worktree** — a separate working copy that won't touch files you're currently using.
- Open the task's "**Runs**" tab to watch what it's doing, refreshing automatically every 2 seconds — close to real time.
- Once done, the AI automatically **pushes its work to a new branch** (e.g. to GitHub), but **it does not open a Pull Request for you** — you need to review it and open the PR yourself on GitHub.
- On success the card moves automatically to "**Review**"; if something fails (e.g. wrong path, timeout), the card stays where it was — open the Runs tab to see the failure reason.

### Limits

- Only **1** AI task runs system-wide at a time; others wait in a queue (higher priority tasks go first).
- Each run is capped at **15 minutes**.
- This feature requires the Hermes CLI to be installed on **the machine running the backend server** — it's not available if you're running the app via Docker.

---

## 10. FAQ

**Q: I dragged a task onto the "mark as done" bar but nothing happened.**
A: The drop-to-complete bar only appears on desktop (wider screens). On mobile, use the "Move to..." dropdown on the card instead.

**Q: A task I just created doesn't show up on the Gantt chart.**
A: The Gantt chart only shows tasks with a due date set. Open the task's edit form and fill in "Due date".

**Q: I set an automation directory but nothing happens when I drag the card to "In Progress".**
A: Check that: (1) the path you entered actually exists and is a git repository; (2) the machine running the backend server has the `hermes` CLI installed and working; (3) another automation task might already be running — since only one runs at a time, yours may simply be queued. Open the Runs tab for detailed error messages.

**Q: Where does my code end up after AI automation finishes?**
A: A new branch is created inside the folder you specified (you can see the branch name in the Runs tab), and it's pushed to the remote (if that repo has one configured). You'll need to review it on GitHub yourself, open a Pull Request, and merge it manually.

**Q: I switched to dark mode, but it's back to light mode on another computer.**
A: This setting is stored locally in your browser (localStorage) and doesn't sync across devices or browsers — you'll need to set it again.
