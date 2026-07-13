# CodeAtlas

CodeAtlas audits a public GitHub repository and produces a full architecture, security,
and health report: a 0–100 health score, detected frameworks and database models,
extracted REST API routes, a security-leak scan, an AST view of the largest source file,
and a repo-aware AI chat to ask follow-up questions.

This version (v2) adds a real database layer, accounts, scan history, and fixes several
bugs found while reviewing the original code - see [`CHANGES.md`](./CHANGES.md) for the
full list.

## Quick start

**macOS/Linux:**
```bash
git clone <your-fork-url>
cd CodeAtlas
npm run setup                        # installs backend dependencies
cp backend/.env.example backend/.env
```

**Windows (PowerShell):**
```powershell
git clone <your-fork-url>
cd CodeAtlas
npm run setup                        # installs backend dependencies
Copy-Item backend\.env.example backend\.env
```
(`cp` also works in PowerShell - it's aliased to `Copy-Item` - just make sure it's
`cp`, not `cd`. `cd`/`Set-Location` only takes one path and will error on a second
argument, which is a very easy typo to make.)

Open `backend/.env` and set a `JWT_SECRET` (any long random string works - this one
command works identically in both bash and PowerShell since it just calls `node`):

```
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Then, either platform:

```
npm run seed                  # optional: creates demo@codeatlas.dev / password123
npm run dev                    # starts the API + serves the dashboard
```

Open **http://localhost:5001** - the frontend and API now run on the same origin/port,
so there's nothing else to start.

> **Don't double-click `frontend/index.html`.** Opening it directly gives it a
> `file:///` address instead of `http://localhost:5001`, which used to break every
> API call with a confusing CORS error. The dashboard now detects this and falls
> back to `http://localhost:5001` automatically - but the backend still has to
> actually be running (`npm run dev`) for that to work, so open the app through
> the URL above rather than the file itself.

**Node version:** requires **Node 22.5 or newer** (the database layer uses the
built-in `node:sqlite` module, added in 22.5). Run `node --version` if you're not
sure; `nvm install 22 --lts` (or the Windows equivalent, `nvm-windows`) if you need
to switch.

A GitHub token is optional but recommended (`GITHUB_TOKEN` in `.env`) - it raises the
GitHub API rate limit from 60 requests/hour to 5,000/hour. A fine-grained token with no
scopes is enough for scanning public repos.

## What's inside

```
CodeAtlas/
├── backend/
│   ├── analyzer/        # scanning/extraction engine (unchanged logic, a few bugfixes)
│   ├── db/
│   │   ├── schema.sql    # table definitions (SQLite)
│   │   ├── client.js     # opens the DB, applies schema.sql on boot
│   │   ├── queries.js    # every prepared statement lives here
│   │   └── seed.js       # creates a demo account
│   ├── middleware/auth.js  # JWT: optionalAuth / requireAuth
│   ├── routes/            # auth, scan history, repository trends
│   ├── utils/validate.js  # input validation (closes the injection bug - see CHANGES.md)
│   ├── tests/             # node --test unit tests
│   └── server.js
├── frontend/index.html    # single-file dashboard (Tailwind + vanilla JS)
└── .github/workflows/      # CI action that audits every PR and comments the report
```

## Database

Storage is SQLite via Node's built-in `node:sqlite` module - no server to install, no
native module to compile, the `.db` file is created
automatically on first run. The schema (`backend/db/schema.sql`) has seven tables:

| Table | Purpose |
|---|---|
| `users` | Accounts (email + bcrypt password hash) |
| `repositories` | One row per distinct repo ever scanned |
| `scans` | One row per audit run - score, grade, summary, timestamps |
| `vulnerabilities` | Security findings for a scan |
| `api_endpoints` | Extracted REST routes for a scan |
| `database_models` | ORM models detected *in the scanned repo* |
| `chat_messages` | Chat history, tied to a scan |

Every scan is kept (not overwritten), which is what powers the score-trend sparkline
and scan history. `db/queries.js` is a thin, framework-free data-access layer - if you'd
rather use an ORM, or move to Postgres/MySQL for a real deployment, that's the one file
to change; nothing else touches SQL directly.

## API reference

| Route | Notes |
|---|---|
| `GET /api/analyze?url=owner/repo` | Runs (or reuses a cached) scan. `&force=true` bypasses the 10-minute cache. |
| `GET /api/profile?user=username` | Lists a user/org's repos |
| `POST /api/auth/register` / `/login` | Returns a JWT |
| `GET /api/auth/me` | Current user (requires auth) |
| `GET /api/scans?scope=public\|mine` | Scan history feed |
| `GET /api/scans/:id` | Full report for one past scan |
| `DELETE /api/scans/:id` | Owner-only |
| `GET /api/repositories/:owner/:repo/history` | Score-over-time for one repo |
| `POST /api/chat` | `{ message, scanId }` → streamed SSE response |

Scanning and chat work without logging in; signing in just attributes your scans to
your account so they show up under "My Scans" instead of the public feed.

## Testing

```bash
npm test --prefix backend
```

Covers the input validator (including the exact injection/traversal payloads described
in CHANGES.md) and the health-scoring engine.

## Ideas to take this further

Roughly ordered by effort. Good picks for turning this into a complete capstone/major
project submission:

**Smaller (a few hours each)**
- Pagination on `/api/scans` (currently just `limit`)
- Badge endpoint: `GET /api/badge/:owner/:repo.svg` → embeddable shields.io-style health badge for READMEs
- Compare view: pick two scans of the same repo and diff the health score / vulnerabilities / API surface side by side
- Password reset flow (email token) now that there are real accounts
- Rate-limit response headers surfaced in the UI so people can see how many scans they have left

**Medium**
- Webhooks: register a GitHub webhook so a repo re-scans itself automatically on push, instead of waiting for someone to click a button
- Notifications: email or Slack message when a tracked repo's score drops or a new critical vulnerability appears
- Team/organization accounts: shared scan history and a dashboard across a whole GitHub org
- Swap the local-Ollama chat for a hosted LLM API behind a feature flag, so chat still works when deployed somewhere without a GPU/Ollama install (right now it only works if Ollama is running on the same machine as the backend - fine for local dev, not for a real deployment)
- Redis (or an in-process LRU you already have a start on in `server.js`) for hot scan data, so the SQLite file isn't hit on every chat token

**Bigger**
- Multi-language AST support - right now only JavaScript gets a real AST (via acorn); Python/Go/Java would need per-language parsers
- A "trust score" that combines this repo's health score with its dependencies' health scores (recursively scan what it depends on)
- Public API + API keys for programmatic access, with per-key usage tracking in the database
- A proper migrations tool if you outgrow `schema.sql`'s `CREATE TABLE IF NOT EXISTS` approach (e.g. adopt Prisma or Drizzle if/when you move to Postgres for a real deployment - see CHANGES.md for why this project uses `node:sqlite` + hand-written SQL instead of an ORM)

## A note on the AI chat

The chat assistant calls a local **Ollama** instance (`http://localhost:11434`, model
`mistral`) - see `backend/analyzer/chatAgent.js` and `summarizer.js`. Install
[Ollama](https://ollama.com), run `ollama pull mistral`, and keep it running alongside
the backend for AI summaries and chat to work. Without it, CodeAtlas still works fully
(scanning, scoring, history, everything) - the AI-dependent fields just report
themselves as unavailable instead of erroring.
