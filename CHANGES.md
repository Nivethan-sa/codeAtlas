# Changes from the original upload

## Read this first: an exposed credential

Your uploaded `backend/.env` contained a **live GitHub personal access token**
(`ghp_...`). That file was not included in this rebuild - it's excluded from
everything below and I didn't use the token for anything. But the token itself has
been sitting in a plaintext file that left your machine, so please treat it as
compromised:

1. Go to https://github.com/settings/tokens and **revoke it**.
2. Generate a new one if you need it (it's optional - see `.env.example`).
3. Going forward, `.env` is in `.gitignore` (it wasn't before), so this shouldn't
   make it into a commit or an upload again.

This is exactly the kind of thing CodeAtlas itself is designed to catch (see
`securitySniffer.js`) - worth double-checking your own repo with your own tool once
it's on GitHub.

**Opening `index.html` directly (`file:///...`) broke every API call.** The
dashboard's `fetch('/api/...')` calls are relative, which is correct when the page
is served by the backend at `http://localhost:5001` - but if the file is opened
directly by double-clicking it, the browser resolves that same relative path
against the filesystem (`file:///C:/api/...`) instead of the API, which fails with
a CORS/protocol error that gives no hint about the real cause. Fixed with an
`API_BASE` constant that detects `window.location.protocol === 'file:'` and falls
back to `http://localhost:5001` automatically - the backend still needs to actually
be running for that address to answer, but at least the page no longer tries to
fetch a local file path.

## Bugs fixed

**The AST view only ever worked for JavaScript, and was silently broken even
there.** `astParser.js` only looked at `.js` files, so Python/Go/Java/Rust/etc.
repos always showed "no suitable file found." Separately, its `simplifyNode()`
function called `simplifyNode(children)` on an *array* of child nodes with no
`Array.isArray` check - so `node.type` was read on the array itself, which is
`undefined`, and `.replace(...)` on that threw on essentially any real file with
more than one statement. Both fixed: the array bug is a one-line guard; language
support now covers JS/TS (still a real AST via acorn), Python/Ruby (an
indentation-based structural parser), and Java/Go/Rust/PHP/C/C++/C# (a
brace-matching structural parser that tracks string/comment state so braces
inside a string don't get mis-counted). The AST tab is also now a proper node-link
diagram - circular nodes connected by lines, laid out with a simple tidy-tree
algorithm - instead of an indented text list; hover a node for its full label,
since the circles themselves only fit a few characters.

**Command injection in the scanner (`server.js`).** The clone step built a shell
command with string interpolation:
```js
execSync(`git clone --depth 1 ${cloneUrl} ${tempFolder}`);
```
`tempFolder` was built from the repo name in the URL you passed in. A URL like
`owner/repo; rm -rf ~` would have been interpolated straight into a shell command
and executed as a second command after the clone. Fixed by switching to
`execFileSync("git", [...])`, which passes arguments as an array with no shell
involved, plus an allow-list validator (`utils/validate.js`) that rejects anything
that isn't a plausible `owner/repo` before it ever reaches the filesystem. There's a
test (`tests/validate.test.js`) that asserts this exact payload shape is rejected.

**Path traversal, same root cause.** A crafted input like `../../etc/passwd` wasn't
being rejected either, though `../` segments didn't end up mattering in practice given
how the value was subsequently used - now rejected outright regardless.

**The AI chat was completely disconnected from the scan.** `server.js` imported
`askRepoChatbot` from `chatAgent.js` but the `/api/chat` route never called it - it
forwarded your raw message straight to Ollama with zero context about which repo you
were even asking about. Separately, the frontend's Send button called `sendMessage()`,
which was never defined anywhere in the file, so clicking it did nothing. Both are
fixed: chat is now tied to a specific `scanId`, loads that scan's real data, and
`sendMessage()` is fully implemented with proper streaming.

**The AST view rendered blank.** The backend's AST nodes are shaped like
`{ name, children }`, but the frontend's renderer checked `node.type`, which doesn't
exist on those nodes - so it returned an empty string for every node and the tab
looked empty for every scan. Fixed to match the actual shape.

**Stored XSS via scanned-repo content.** Several places (`classesList`,
`functionsList`, the API table, the security-leak list, the portfolio grid, and the
AST view) inserted text taken from the scanned repository or the GitHub API directly
into `innerHTML`. Anyone can set their GitHub repo's description to
`<img src=x onerror=...>` - if someone then ran "Find Repos" on that account, the
payload would execute in their browser. This mattered a lot more once real auth
tokens landed in `localStorage`, so it's fixed now (HTML-escaping at every one of
those points, plus the new chat bubbles are built via `textContent` instead of
`innerHTML` so the question doesn't even arise there).

**`dotenv` was used but never declared.** `server.js` calls
`require("dotenv").config()`, but `backend/package.json` didn't list `dotenv` as a
dependency, and it wasn't in `backend/node_modules` either - it only worked because
Node's module resolution walked up to a stray copy in the root `node_modules`. Moving
or deploying just the `backend/` folder on its own would have crashed immediately.
Now declared properly in `backend/package.json`.

**Technology detection silently missed almost every real import.** This is the
biggest accuracy bug in the original code, and it had nothing to do with my changes -
it would have affected every JavaScript/TypeScript repo CodeAtlas ever scanned. The
import-detection regex in `technologyMap.json` was anchored to the start of the line
for both `import` and `require` statements:
```
^\s*(?:import.*from\s+['"](...)['"]|require\(['"](...)['"]\))
```
That correctly matches `import express from "express"` and a bare
`require("dotenv").config()`, but **not** `const express = require("express")` -
by far the most common way `require` is actually written in real Node.js code,
because the anchor demands the line start with only whitespace before
`require`/`import`, and `const x = ` comes first. I only noticed because this
project's own dependencies (jsonwebtoken, express, axios...) weren't showing up in
its own "Frameworks" list despite obviously being used everywhere. Verified with a
quick regex test: the old pattern matched 2 of 7 realistic `require(...)` styles;
the fixed one (anchoring only the `import` branch, not `require`) matched all 7.
This one change is why "Frameworks" now correctly lists Express, JWT, Axios,
Bcrypt, etc. instead of just "Dotenv". Also added `bcryptjs` and `better-sqlite3`
as recognized aliases alongside `bcrypt`/`sqlite3`, since both are extremely common
in real projects (this one included) and weren't recognized at all before.

**The security scanner flagged itself as a leaked private key.** Its own detection
rule for RSA/SSH keys was a regex whose *source code* contained the exact five-hyphen
pattern it was searching for - so the moment CodeAtlas scanned its own repo (which is
exactly what the shipped GitHub Action does, on every single pull request), it found
"itself" and reported a CRITICAL leak, guaranteeing Grade F forever regardless of what
the PR contained. Fixed by building that one pattern from string fragments so the
source text no longer contains a self-matching run of hyphens, with a regression test
(`tests/securitySniffer.test.js`) that scans the file itself and asserts no match -
while also confirming real PEM headers, AWS keys, and hardcoded passwords are still
caught correctly.

**Dead code removed:** `frameworkDetector.js` and `languageDetector.js` (superseded by
the `technologyMap.json`-driven logic in `scanner.js`, and no longer even compatible
with its schema), two unused helpers (`findFile.js`, `readJSON.js`), and a leftover
`renderInteractiveAST()` function on the frontend that called `echarts.init(...)` even
though the ECharts library was never loaded - dead code that would have thrown if
anything had ever called it (nothing did).

**Root-level `package.json` was stray/unused.** It listed `acron` and `python-ast`
(a PyPI package name, not usable from Node) as dependencies, neither used anywhere -
the real app lives entirely under `backend/`. Replaced with a small orchestrator
(`npm run setup` / `npm run dev` from the repo root).

## What's new

- **A real database** (SQLite via Node's built-in `node:sqlite` - no native module,
  nothing to compile) - see the README for the schema.
  Every scan is now persisted instead of living in one in-memory variable that got
  overwritten by the next request.
- **Accounts** (email/password, JWT) - optional; scanning still works without logging in.
- **Scan history** - a public feed of recent scans plus a personal "My Scans" view.
- **Score trends** - re-scan a repo you've audited before and see a sparkline of how
  its health score has moved over time.
- **Smart caching** - re-requesting a repo scanned in the last 10 minutes returns the
  stored result instantly instead of re-cloning; `&force=true` bypasses it.
- **Rate limiting** on the scan and auth endpoints (`express-rate-limit`), plus
  `helmet` for standard security headers.
- **Export report** - download any scan as a Markdown file.
- **Tests** - the original `"test": "echo \"Error: no test specified\" && exit 1"`
  stub is now a real suite (`node --test`).
- **One-command run** - the backend now serves the frontend too, so `npm run dev`
  gives you the whole app on one port with no CORS setup between two dev servers.

## An expected quirk, not a bug

If you scan this project's own repo, `securitySniffer.test.js` will show up with a
few "vulnerabilities." That's intentional - those tests deliberately write
fake-secret-shaped strings (a fake AWS key, a fake PEM header, a fake password) into
temp fixtures to prove the scanner actually catches them. A secret scanner can't tell
"a real leaked key" from "a test string that looks exactly like one" without more
context (a known, universal tension in this category of tool, not unique to
CodeAtlas). If it bothers you for a clean self-scan, the straightforward fix is an
ignore-list for test/fixture paths - it's on the roadmap in the README rather than
built in, since deciding what should be ignorable is a product decision worth making
deliberately rather than defaulting to "test directories are exempt."

## Why `node:sqlite` and not Prisma or `better-sqlite3`

This went through two iterations before landing here, and both taught something worth
knowing if you extend this project:

**First attempt: Prisma.** A very reasonable default choice, and still a fine one for
a real deployment. Dropped because Prisma needs to download a platform-specific engine
binary from `binaries.prisma.sh` on `generate`/`migrate`, and that request is blocked
in the sandboxed environment I build in - so I couldn't verify it end-to-end myself.

**Second attempt: `better-sqlite3`.** A native module with prebuilt binaries, which
*did* install and test successfully in my sandbox - every route, migration, and the
full clone-and-scan pipeline ran against a real database before I shipped it. What I
couldn't test was your machine. `better-sqlite3` ships prebuilt binaries for common
Node-version/OS/architecture combinations, but when none matches (a very new Node
version, an unusual platform), npm falls back to compiling it from source via
`node-gyp`, which needs a full C++ toolchain (Visual Studio Build Tools on Windows,
Xcode command line tools on macOS) - and if that isn't installed and configured
correctly, the install fails exactly the way it did here.

**Final: `node:sqlite`**, Node's own built-in SQLite module (stable enough for this
since Node 22.5). It has no native addon at all - nothing to download, nothing to
compile - so this failure mode isn't possible on any platform. The trade-off: it's
newer and still labeled "experimental" by Node itself (you'll see a one-line warning
on startup; it's harmless), and it lacks a couple of `better-sqlite3`'s convenience
methods - notably `db.transaction(fn)`, which `db/queries.js` replaces with an
explicit `BEGIN`/`COMMIT`/`ROLLBACK` around the multi-table scan insert. Functionally
equivalent, just spelled out instead of wrapped.

If you'd rather use Prisma or a hosted Postgres for a resume-facing deployment,
`db/queries.js` is a self-contained data-access layer - swapping the implementation
behind those same function names is a contained change, not a rewrite of the routes.
