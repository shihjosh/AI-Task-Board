# AI Task Board

[繁體中文](README.md) | English

A task management tool that combines a traditional Kanban board with AI agent automation: use it to schedule and track tasks, or hand a task card directly to [Hermes Agent](https://github.com/NousResearch/hermes-agent) to have it completed automatically inside an isolated git worktree.

- 📋 Three-column board (To Do / In Progress / Review) + a dedicated Done page, with drag-and-drop and mobile support
- 📝 Task details: Markdown description, comments, priority, tags, assignees, due date
- 🔍 Search, tag filtering, list view, Gantt chart
- 🌓 Light / dark mode
- 🤖 Hermes Agent automation: drag a card to "In Progress" to have an AI agent complete the task in an isolated worktree and auto-push the branch

For the full walkthrough, see **[docs/USER_GUIDE.en.md](docs/USER_GUIDE.en.md)** (written for non-technical users). This file focuses on install, development, and deployment.

![AI Task Board screenshot](docs/images/task_board.webp)

---

## Installation

### Requirements

- Node.js 22+
- npm

### Steps

```bash
git clone <this repo's URL>
cd AI-Task-Board
npm install

# Before first run: create the SQLite database and seed it
npm run db:seed
```

### Start (local development)

```bash
npm run dev
```

Once started:
- Frontend (Vite dev server with HMR): http://localhost:8088
- Backend API server: http://localhost:3001 (the frontend proxies `/api` requests through Vite, so you only need to open the frontend URL)

`npm run dev` uses `concurrently` to run `npm run dev:client` (Vite) and `npm run dev:server` (`node --watch server/index.mjs`, auto-restarts on file changes) at the same time. You can also run these two commands manually in separate terminals.

To stop: press `Ctrl+C` in the terminal running `npm run dev`, or terminate the background process via your tooling.

### Deploy with Docker

**⚠️ Set up login credentials before deploying.** This service has no
built-in authentication by default — once deployed anywhere beyond
localhost (public internet, shared internal host, etc.), anyone who knows
the URL can read and write all task data. Create `.env` first:

```bash
cp .env.example .env
# Edit .env and set AUTH_USER and a strong AUTH_PASS (e.g. openssl rand -base64 24)
```

If `AUTH_USER` / `AUTH_PASS` are left blank, the server disables auth and
prints a startup warning — suitable only for fully local, non-exposed
development.

```bash
docker compose up -d --build
```

Once running, access it at `http://localhost:8088` — your browser will
prompt for the username/password (HTTP Basic Auth). Both the frontend and
`/api/*` are served from the same port by a single Node service — no extra
nginx needed. The SQLite database lives in the named volume
`taskboard-data:/app/.data`, so data survives container restarts/rebuilds.

**Seed data after first startup:**

```bash
docker compose exec taskboard node server/seed.mjs
```

> `npm run db:seed` (used in local dev mode) cannot be used interchangeably with the command above — local mode writes to `.data/taskboard.sqlite` on the host, while the Docker database file lives inside the container's volume. You must run the seed script *inside* the container via `docker compose exec` so it writes to the same database. This command is idempotent — re-running it when data already exists just prints `Tasks table already has data, skipping seed.` and does nothing.

> **Known limitation**: The Hermes Agent automation feature (below) requires the `hermes` CLI to be installed and directly callable **on the host running the API server**. The Docker container does not currently have `hermes` installed, so automation is unavailable in Docker deployments — it only works when the API server is run directly on a host with `npm run dev` / `npm start`.

---

## Usage

### Basics

- **Create/edit a task**: Click "New Task" in the top right, or click any existing card. Fill in title (required), priority, column, tags, assignees, progress, and due date, then save.
- **Move between columns**: Drag cards on desktop; on mobile (viewport < 640px) use the "Move to..." dropdown on each card instead of dragging.
- **Mark as done**: Drag a card onto the "Drop here to mark as done" bar at the bottom of the board, or open the edit form and set "Column" to "Done". Completed tasks move to a dedicated Done page and no longer take up board space.
- **Markdown description**: The "Description" field in task details supports headings, lists, tables, and code blocks. Toggle between "Edit" and "Preview" tabs to see the rendered output.
- **Comments**: The "Comments" tab under task details lets you add/edit/delete comments to track discussion.
- **Search & filter**: The toolbar search box filters tasks by title in real time; the tag filter panel supports multi-select (matches any selected tag).
- **Multiple views**: Switch between "Board" (default drag-and-drop view), "List" (table view, includes done tasks), and "Gantt" (timeline from creation date to due date; only shows tasks with a due date set) from the toolbar.
- **Light/dark mode**: Use the sun/moon icon on the toolbar to toggle manually — your choice is remembered in the browser (it does not follow your OS setting).

### Hermes Agent Automation

This is the project's core differentiator: hand a task card to an AI agent to actually get it done, not just track it.

1. When editing a task, fill in **"Automation directory"** (`targetPath`, an absolute path to a local git repo), and optionally **"Automation skill"** (a specific Hermes skill for the agent to load).
2. Drag the card to (or PATCH it into) the **"In Progress"** column to trigger automation.
3. The backend spawns `hermes chat` inside that directory using an isolated **git worktree** — the agent actually edits code, runs commands, then commits and pushes its branch to `origin` when done (**it does not open a PR automatically** — opening a PR and merging is always done by you on GitHub).
4. Output streams live to the **"Runs"** tab in task details, auto-refreshing every 2 seconds while running. On completion the card automatically moves to "Review" (success) or stays in place (failure).

**Limits**: Only 1 automation run executes system-wide at a time (others queue, sorted by priority); each run is capped at 15 minutes; and it's only available on hosts with the `hermes` CLI installed (see the Docker limitation above).

For full details and walkthroughs, see **[docs/USER_GUIDE.en.md](docs/USER_GUIDE.en.md)**.

---

## API

```
GET    /api/tasks           List all tasks
POST   /api/tasks           Create a task
PATCH  /api/tasks/:id       Update a task (including columnId when moved between columns)
DELETE /api/tasks/:id       Delete a task
GET    /api/tasks/:taskId/comments   List comments for a task
POST   /api/tasks/:taskId/comments   Add a comment
PATCH  /api/comments/:id             Edit a comment
DELETE /api/comments/:id             Delete a comment
GET    /api/tasks/:taskId/automation-runs   List all Hermes automation runs for a task (read-only, no write endpoint)
GET    /api/skills                          List available Hermes skill names
```

**Validation rules:**
- `priority` only accepts `high` / `medium` / `low`; other values return `400`
- `columnId` only accepts `todo` / `in_progress` / `review` / `done`; other values return `400`
- `progress`, if provided, must be a number between `0` and `100`; other values return `400`
- `title`, if provided, must not exceed 500 characters
- `description`, if provided, must not exceed 50000 characters
- Comment `content` must not exceed 5000 characters and cannot be blank
- Request body size is capped at 1MB; larger requests return `413`
- `POST`/`PATCH` use an allowlist of accepted fields — extra fields (e.g. a client-supplied `id`) are silently ignored and never override server-generated values
- `PATCH`/`DELETE` on a nonexistent `id` returns `404`
- Unexpected server errors return a generic `500` (no stack trace exposed; full details are logged server-side only)

## Tech Stack

**Frontend**: React + Vite + TypeScript + Tailwind CSS, react-router-dom, @dnd-kit/core (drag-and-drop), lucide-react (icons), react-markdown + remark-gfm (Markdown rendering)

**Backend**: Node.js + Express (`/api/*` REST + serves frontend static files from a single server), SQLite (better-sqlite3), database file at `.data/taskboard.sqlite`

## Project Structure

```
AI-Task-Board/
├── docs/
│   ├── USER_GUIDE.md / USER_GUIDE.en.md   End-user guide
│   ├── spec.md
│   └── superpowers/            Development spec/plan archive
├── server/
│   ├── index.mjs               Express app and all routes
│   ├── db.mjs                  SQLite schema and migrations
│   ├── taskRepository.mjs
│   ├── commentRepository.mjs
│   ├── automationRunner.mjs    Hermes agent spawn logic
│   ├── automationRunRepository.mjs
│   ├── skillsRepository.mjs    Scans ~/.hermes/skills
│   └── seed.mjs
├── src/
│   ├── components/              TaskDrawer / BoardColumn / TaskCard / ListView / GanttView …
│   ├── contexts/ThemeContext.tsx
│   ├── data/                    Fixed options (tags/assignees/columns)
│   ├── lib/                     API clients (api.ts / commentsApi.ts / automationRunsApi.ts / skillsApi.ts)
│   ├── types/task.ts
│   ├── App.tsx
│   └── main.tsx
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
├── Dockerfile
└── docker-compose.yml
```

## Credits

Board design inspired by [dashi-taskboard](https://github.com/chuspeeism/dashi-taskboard).

## License

This project is licensed under the [MIT License](./LICENSE).
