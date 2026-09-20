# Step 6.5 — Port Isolation (detailed procedure)

*Core Bootstrap step — runs unconditionally, once per project, right after Step 6. The injection
half of port isolation (#1794): Units 1-3 built the registry, the `port-services` policy key, and
the statusline/reaper wiring — this step is the one place that ever turns it on for a project.*

## 1. Detect literal dev-server ports

Scan the same inputs `_shared/dev-url-detection.md` Step 2 already reads live (CLAUDE.md Commands,
`package.json` scripts, `vite.config.*`, `next.config.*`, `angular.json`, `vue.config.*`,
`.env`/`.env.local` `PORT=`) — and, while reading those two env files, also `vitest.config.*` for a literal test-database name, which §3 reports — plus three more this step owns:

- `docker-compose.yml` / `compose.yml` — a service's host-side `ports:` mapping (`"5432:5432"`)
- a JS/TS server entry file — `app.listen(<int>)` / `.listen(<int>, ...)`
- README/Makefile/scripts — `runserver <int>`, `uvicorn --port <int>`, `flask run -p <int>`

A project with none of these matched is a **zero-detected-services outcome**: report nothing found
and skip the rewrite/`port-services`/`allocate` sequence entirely — no policy write, no lease.

## 2. The rewrite table

Six rewritable shapes. Anything else — including every named hard case below — is report-only,
never guessed at:

| Before (detected) | File | After (rewrite) |
|---|---|---|
| `server: { port: <int> }` | `vite.config.{js,ts,mjs}` | `server: { port: Number(process.env.PORT ?? <int>) }` |
| `devServer: { port: <int> }` | `vue.config.{js,ts}` | `devServer: { port: Number(process.env.PORT ?? <int>) }` |
| `app.listen(<int>)` / `.listen(<int>, ...)` | a JS/TS server entry file | `app.listen(process.env.API_PORT ?? <int>)` (offset preserved for a later service) |
| `target: 'http://localhost:<int>'` | a dev-server proxy config (`vite.config.*`, `next.config.*`) | `` target: `http://localhost:${process.env.API_PORT ?? <int>}` `` |
| a service's host-side `"<int>:<container-port>"` under `ports:` | `docker-compose.yml` / `compose.yml` | `"${DB_PORT:-<int>}:<container-port>"` (host side only — the container-internal URL/port stays literal) |
| `PORT=<int>` | `.env` / `.env.local` | folds into the managed region (`ports.js`'s marker-delimited block) — no manual line survives; `.env.example` is left unchanged plus a comment pointing at the managed region |

## 3. Report-only hard cases (named, never rewritten)

- **`package.json` scripts** (`"dev": "vite --port 3000"`) — shell expansion; this plugin has no
  Windows `cmd`-shell rewrite path for an inline flag, so a literal port here is always reported,
  never rewritten.
- **`angular.json`** `serve.options.port` — Angular's dev-server config cannot read an environment
  variable at this key; always reported, never rewritten.
- **README/Makefile Python commands** (`runserver 8000`, `uvicorn --port 8000`) — prose/build-file
  commands, not a config file this step edits; always reported, never rewritten.
- **A literal test-database name** (`test_db`, `testdb`, `test.db`) as a value in `.env`/`.env.local`
  or `vitest.config.*` — report it with the suggestion `test_${CLAUDE_TWEAKS_LEASE}` (the managed
  region's lease token, #1927); never rewritten, since a wrong rewrite points tests at a database
  that does not exist. False negatives for an unlisted literal are accepted — this row is
  report-only.
- **Catch-all:** a detected literal port matching none of the six rewrite rows above and none of
  the named hard cases above defaults to report-only. Never offer a guessed rewrite for a shape
  this table doesn't name.

## 4. Syntax-check every proposed rewrite before showing it

Before a rewrite is offered in the diff, parse the REWRITTEN snippet with the target language's own
parser (JS/TS via the JS/TS parser already available to this session; YAML/Compose via a YAML
parse). A snippet that fails to parse is downgraded to report-only for that location — it is never
offered in the diff, and never applied.

## 5. Service-name derivation

- The frontend dev server → `web`
- A backend process (the JS/TS `.listen()` case, or a proxy target) → `api`
- A Compose database service → `db`
- A second detected service in the same category gets a numeric suffix (`web2`, `api2`, …) rather
  than silently colliding with the first.

Confirm the derived list with one `AskUserQuestion` before doing anything else: list every detected
service with its derived name, `Recommended` pre-filled as the full list, and any numeric-suffix
disambiguation already applied as the pre-filled option text (so the user reviews the actual names
before anything is written, not just a count).

## 6. The reviewable-diff gate — every mode, including `auto`

One `AskUserQuestion`, always shown, never silenced by `auto`: this edits the user's own project
config outside the always-reversible floor, so it is on `_shared/auto-mode-contract.md`'s "What
`auto` does NOT silence" table (its own dedicated row, not a shared one).

- `question`: `"Rewrite these {n} literal port(s) to read from the environment?"`, `header`:
  `"Port rewrite"`, `multiSelect`: `false`
- Option 1 — `label`: `"Apply all (Recommended)"`, `description`: `"Rewrite every syntax-checked
  location shown in the diff."`
- Option 2 — `label`: `"Choose files"`, `description`: `"Review and select which locations to
  rewrite, file by file."`
- Option 3 — `label`: `"Skip rewrite"`, `description`: `"Leave every literal port as-is in the
  project's own config."`

**A declined rewrite (Option 3, or files left unchecked under Option 2) still sets `port-services`
and runs the first `allocate`**, leasing a block from the free pool — not matched to whatever
literal port remains hardcoded in the declined file(s). That mismatch between the registry's block
and a surviving literal is exactly what `update-mode.md`'s port-literal-drift check exists to catch
on a later `/claude-tweaks:init --update` run.

## 7. Queue the policy write, run the first allocate

**Do not write `.claude-tweaks/policy.yml` directly here.** Queue the derived service list (Step 5)
as this run's `port-services` decision and carry it forward exactly the way Step 6 carries its
`worktree-always` decision — same deferred-write mechanism, same reason (a `worktree-always: true`
write mid-run would deny this same run's own remaining direct-to-main-checkout writes). Read
`worktree-policy-finalization.md` in this skill's directory for where the write actually lands and
how it happens; that file's own body is what carries `port-services` alongside `worktree-always`.

Then, in the current checkout (not the deferred-write worktree — this call only reads/verifies port
availability and writes `.env.local`, neither of which is `worktree-always`-gated the way a policy
file edit is), run the first lease:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/ports.js" allocate --services {a,b,c}
```

Echo the resulting block (`{base}-{base+9}`) back to the user as this step's confirmation, the same
shape the `claude-tweaks: ports {base}-{base+9} (...)` SessionStart line renders later.

## 8. `.gitignore` suggestions

`.env.local` and `.env` join `bootstrap/step-04-gitignore-suggestions.md`'s suggested block — see
that file for the one-line reason and the "never modify `.gitignore` without asking" rule this step
does not override.
