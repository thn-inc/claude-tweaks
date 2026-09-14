# Dev URL Detection

Shared procedure for auto-detecting a running development server. Checks persisted config first, then probes ports. Persists detected URLs for future runs. Referenced by `/claude-tweaks:stories`, `/claude-tweaks:test`, `/claude-tweaks:flow`, `/claude-tweaks:visual-review`, and `/claude-tweaks:demo`. (`/claude-tweaks:review` invokes this transitively via `/visual-review` — it does not call this procedure directly.)

> **Permissions required:** this procedure performs file **writes** in Step 4 (creates or updates `stories/servers.yml`). Any skill that invokes this procedure must run with Write and Edit tool access enabled. Read-only callers will fail at Step 4 — there is no read-only path; persistence is mandatory, not optional.

## When This Runs

- `/claude-tweaks:stories` is invoked without a URL argument
- `/claude-tweaks:test` runs QA story validation and needs a dev server
- `/claude-tweaks:flow` triggers automatic story generation after detecting UI changes
- `/claude-tweaks:visual-review` needs a dev URL for page, journey, or discover modes (also called transitively from `/review` full mode)
- `/claude-tweaks:demo`'s Prepare/Validate steps need a verified dev URL, but only for `app-route`/`rendered-page` Observation plans — Prepare's fallback resolves the entry point via this procedure, and Validate then probes it before Show; `cli`/`flow`/`diff` plans skip this procedure entirely (the legacy pre-flight naming survives only in `skills/demo/legacy-brief-compatibility.md`, for briefs posted before the Observation plan schema shipped)

## Procedure

### Step 0: Check Persisted Config

Before probing ports, check if a URL was previously detected and persisted:

1. Read `stories/servers.yml` (or `{STORIES_DIR}/servers.yml`) using the Glob tool to check existence first
2. If file exists and has a `servers.default.url` entry:
   a. Probe the persisted URL with the same HTTP check used in Step 1
   b. If it responds (2xx or 3xx) → before accepting it, apply the same lease-first rule Step 0.5/2.7 use against the persisted URL's port: with a lease (run Step 0.5's `bin/ports.js env` first if it hasn't run yet this invocation), accept iff the port is a member of `LEASE_PORTS`; with no lease, run the worktree-awareness check from Step 2.7's no-lease branch (MATCH/FOREIGN) instead. A persisted URL is exactly as fallible as a freshly-probed port here — `stories/servers.yml` is "safe to commit," so it is present and identical in the worktree's own checkout, and a URL it persisted from an earlier run against the main checkout can still be responding. On **member of `LEASE_PORTS`**, **MATCH**, or non-worktree-with-no-lease → use it. Set `APP_URL = {persisted URL}`. Log: "Using persisted dev URL: {url}". Skip Steps 1-2.7. On **not a member of `LEASE_PORTS`**, **FOREIGN**, or PID/cwd unresolvable → treat the persisted URL as not responding for this worktree, discard it, and fall through to Step 1's fresh probe rather than trusting it. Log: "Persisted URL {url} responds but serves a foreign checkout — probing ports..." and continue to Step 1.
   c. If it doesn't respond → log: "Persisted URL {url} not responding — probing ports..." and continue to Step 1
3. If no file or no `servers` section → continue to Step 1

> **File split:** `stories/servers.yml` holds server URLs only — safe to commit and share between runs. Credentials live in the encrypted Auth Vault (saved via `agent-browser auth save`), never in a file under `stories/` — `stories/servers.yml` must not be gitignored.

### Step 0.5: Lease-First Probe

Before falling through to Step 1's guesswork, check whether this checkout has a port-isolation lease (#1791-#1793) — a lease *is* the worktree-awareness proof, so it makes Steps 1-2.7's probing/config-reading/lsof machinery unnecessary when it hits.

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/ports.js" env
```

- **No lease** (the command prints nothing and exits 0 — `bin/ports.js env`'s own documented contract for an unleased path): treat this as "no lease" and fall through to Step 1 as before. No `LEASE_PORTS` is set.
- **A lease exists**: parse every printed `KEY=value` line into `LEASE_PORTS` — the full *set* of port values across every line (`PORT`, and every `{NAME}_PORT`), plus the leading `CLAUDE_TWEAKS_LEASE` line — the block's base, numerically equal to `PORT`, not an extra port, not just the `PORT` line. Then HTTP-probe `http://localhost:{PORT}` (the value from the `PORT` line specifically) with the same check Step 1 uses:
  - **Responds (2xx/3xx)** → set `APP_URL = http://localhost:{PORT}`. Skip Steps 1 through 2.7 entirely.
  - **No response** → continue to Step 1, carrying `LEASE_PORTS` forward (Step 2.7 below reads it).

### Step 1: Probe Common Ports

> **Parallel execution:** Use parallel tool calls — all port checks are independent operations.

Check these ports for a running HTTP server:

| Port | Common framework |
|------|-----------------|
| 3000 | Next.js, Create React App, Express |
| 3001 | Next.js (alternate), Remix |
| 5173 | Vite |
| 8080 | Vue CLI, webpack-dev-server |
| 4200 | Angular CLI |
| 8000 | Django, FastAPI, custom |

For each port, run a lightweight HTTP check:

```bash
node -e "require('http').get('http://localhost:{PORT}', r => { console.log(r.statusCode); r.resume() }).on('error', () => { process.exit(1) })"
```

Collect all ports that respond with a 2xx or 3xx status code.

### Step 2: Check Project Configuration

If no ports responded (or to validate the best match), check project configuration:

1. **CLAUDE.md Commands section** — look for a dev server command (e.g., `npm run dev`, `yarn dev`, `pnpm dev`). Extract the port if specified.
2. **package.json scripts** — read `scripts.dev`, `scripts.start`, `scripts.serve` for port configuration.
3. **Framework config files** — check for port settings in:
   - `vite.config.*` (`server.port`)
   - `next.config.*` (port in dev script)
   - `angular.json` (`serve.options.port`)
   - `vue.config.*` (`devServer.port`)
   - `.env` or `.env.local` (`PORT=`)

### Step 2.7: Worktree Awareness (mandatory before trusting a responding port)

A responding port is **not** proof that the server is serving *this* checkout. When the pipeline runs inside a git worktree (the default for `/flow` and `/build`), a dev server on a common port is most likely the **main checkout's** server — pointing the browser at it would review the wrong code and report false confidence.

**With a lease** (`LEASE_PORTS` set by Step 0.5): the MATCH rule is lease membership, no `lsof` involved. For **each responding port**:

- **MATCH** — the port is a member of `LEASE_PORTS`. Accept it as in Step 3.
- **FOREIGN** — the port is not a member of `LEASE_PORTS`. Treat it as **not responding for this worktree**. Do not use it. Fall through to the "no usable server" rows in Step 3 so an ephemeral worktree server can be started instead.

This lease-membership check applies regardless of `PRIMARY`/`WORKTREE` status — a lease is per-checkout by construction (#1791: keyed by the checkout's own realpath), so it is exactly as meaningful for the main checkout as for a worktree.

**With no lease:** fall back to the pre-#1795 heuristic — POSIX-only, since it shells out to `lsof`. Detect a linked worktree (CWD is a worktree, not the primary checkout) by reusing this repo's own linked-worktree heuristic — `bin/lib/hooks/worktree-detect.js`'s `repoInfo()`, the same submodule guard and symlink-safe path resolution the `worktree-always` policy gate relies on — rather than hand-rolling git's own worktree-vs-primary-checkout comparison in raw bash:

```bash
node -e "const { repoInfo } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/hooks/worktree-detect.js'); console.log(repoInfo(process.cwd()).isLinkedWorktree ? 'WORKTREE' : 'PRIMARY')"
```

When the result is `WORKTREE`, for **each responding port** verify it is serving the active worktree before accepting it:

```bash
# Resolve the listening process's working directory and compare to the worktree root
PID=$(lsof -nP -iTCP:{PORT} -sTCP:LISTEN -t 2>/dev/null | head -1)
SRV_CWD=$(lsof -a -p "$PID" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p')
WT_ROOT=$(git rev-parse --show-toplevel)
[ "$SRV_CWD" = "$WT_ROOT" ] && echo "MATCH" || echo "FOREIGN"
```

- **MATCH** → the responding server serves this worktree. Accept it as in Step 3.
- **FOREIGN** (or PID/cwd can't be resolved) → treat the port as **not responding for this worktree**. Do not use it. Fall through to the "no usable server" rows in Step 3 so an ephemeral worktree server can be started instead.

In the `PRIMARY` (non-worktree) case, skip this check — a responding port is assumed to serve the current checkout.

**Windows outcome (accepted trade-off, no-lease path only):** `lsof` doesn't exist on Windows, so the PID is always unresolvable there → always `FOREIGN` → always start a fresh ephemeral server. On Windows, an unleased project never reuses an already-running dev server, unlike POSIX where `lsof` can still find a same-cwd match. A leased checkout (Step 0.5) does not hit this at all — lease membership needs no `lsof` call on any platform, which is exactly what makes worktree-awareness work at all on Windows.

### Step 3: Resolve

| Scenario | Action |
|----------|--------|
| **One port responding (and MATCH / non-worktree)** | Use it. Set `APP_URL = http://localhost:{port}`. |
| **Multiple ports responding (and MATCH / non-worktree)** | Prefer the port matching the project's framework config. If ambiguous, use the first responding port and note the alternatives. |
| **No usable server + dev command known — auto mode** | **Start an ephemeral dev server on a free port** (see "Ephemeral server start" below). This is the worktree-correct path: it guarantees the browser reviews *this* checkout, not a foreign one. Set `SERVER_STARTED = true`. No prompt — starting a tracked, torn-down-at-wrap-up server on a free port clears every reversibility floor (see `_shared/auto-mode-contract.md`, "Always-reversible"). Log an `AUTO` decision-log entry. |
| **No usable server + dev command known — interactive mode** | Offer to start the server: "No dev server detected for this checkout. Start with `{command}` on a free port?" Set `SERVER_STARTED = true` if the user agrees. Wait for the server to be reachable before proceeding. |
| **No usable server + no dev command** | Auto mode: cannot start (nothing to run) — return no `APP_URL` and let the caller's auto-skip branch handle it (log the gap). Interactive: ask the user: "No running dev server and no dev command found. Enter the URL or start your dev server and re-run." |

#### Ephemeral server start

**Ownership.** A server started as a Bash background task belongs to the agent turn that spawned it — it lives only as long as that turn's process tree, whether or not the turn is waiting on it. (This is not in tension with the foreground-execution rule elsewhere in this plugin (#1965): that rule covers commands the agent *blocks on*; this server is started, polled once, and then left running, never awaited.) When the caller is a dispatched Task call and the server must stay reachable past that call's own end — e.g. dispatch's `build,test` call starting the server for a second call's `review`/`stories`/QA work — it must be **detached** at start, or it dies with the call:

- **POSIX:** launch under `setsid` (e.g. `setsid {dev command} > {log} 2>&1 &`) so the child is reparented off the caller's process group and survives the caller's own exit. Record `detached: yes`.
- **Windows:** no equivalent detach primitive is available to this procedure. Record `detached: no` and accept that the server does not outlive the spawning turn there.

When starting a server (auto mode, or interactive with consent):

1. **Pick a port** — **with a lease:** re-run `node "${CLAUDE_PLUGIN_ROOT}/bin/ports.js" env` now, at start time (not the `LEASE_PORTS` snapshot cached from Step 0.5, to avoid acting on a stale read), and pass every printed `KEY=value` line into the spawned server's environment verbatim — no allowlist beyond "whatever this checkout's own managed region currently contains," so sibling services (a backend on `API_PORT`, say) resolve to their own block too. Use the `PORT` value as the port to start on. **Without a lease:** keep the pre-#1795 rule — probe upward from the framework's default (e.g. 3001, 3002, …) until one is free, skipping any port already found responding in Step 1, using the `node -e` check from Step 1 inverted (free = connection refused).
2. **Anchor to the worktree root** — run the dev command from `git rev-parse --show-toplevel`, never from an assumed CWD (CWD does not propagate reliably — see "Working Directory Discipline" in `subagent-dispatch-core.md`). Pass the port via the framework's env var when arg-passing is unreliable (e.g. `PORT={port}` for Next.js — `next dev` respects `PORT`).
3. **Run in the background** — detached per the Ownership rule above when the server must outlive this turn, plain background otherwise — and poll the port until it responds (2xx/3xx) or a timeout (~90s for first compile). Set `APP_URL = http://localhost:{free-port}` once reachable.
4. **Record the PID + port + detach state**: write `{run-dir}/ephemeral-server.txt` (one line: `{pid} {port} {worktree-root} detached:{yes|no}`) when a pipeline run dir exists — via a plain Bash redirect, e.g. `printf '%s %s %s detached:%s\n' "$PID" "$PORT" "$WORKTREE_ROOT" "$DETACHED" > "{run-dir}/ephemeral-server.txt"`, never the Edit/Write tool: this path is anchored under the main checkout, so a worktree session's Edit/Write attempt against it is refused by the harness's own cross-checkout write-pinning, while a plain Bash write into `.claude-tweaks/pipelines/` is already exempted from claude-tweaks' own worktree-always gate and untouched by that tool-level pin (see `_shared/pipeline-run-dir.md`, "Anchoring" — "necessary but not sufficient"). This file is also the **liveness handle** for the rest of the run — it is what any later step (this run's own, or a subsequent dispatched call's) re-probes before trusting the server is still up, not a promise that it is. `/wrap-up` cleanup reads it to stop the server; a later step that finds the recorded pid dead re-runs this procedure and rewrites this file rather than treating the file's mere existence as proof of a live server. Outside a pipeline (standalone), the calling skill stops it at the end of its own run.
5. If the server fails to come up within the timeout, do not block: set no `APP_URL`, log the failure, and let the caller degrade to code-only mode.

### Output

This procedure sets two variables for the calling skill:

| Variable | Value |
|----------|-------|
| `APP_URL` | The detected or user-provided URL (e.g., `http://localhost:3000`) |
| `SERVER_STARTED` | `true` if this procedure started the server, `false` otherwise |

### Step 4: Persist Result

After resolving `APP_URL`, persist it for future runs. **This write is mandatory — do not skip it.**

Server URLs are written to `stories/servers.yml` (safe to commit). Credentials, if any, live in the encrypted Auth Vault — never in this file.

1. Use the Glob tool to check if `stories/servers.yml` (or `{STORIES_DIR}/servers.yml`) exists.
2. **File exists:** Use the Read tool to load the current contents. Parse the YAML to preserve existing `servers` entries.
3. **File missing:** Start with this minimal structure:
   ```yaml
   # Dev server config (safe to commit — server URLs only, no credentials)
   servers:
     default:
       url: http://localhost:3000
       detected: {YYYY-MM-DD — today's date when this run resolves}
   ```
4. Set (or update) `servers.default.url` to the resolved `APP_URL`.
5. Set `servers.default.detected` to today's date.
6. If a start command was discovered in Step 2 (from CLAUDE.md or package.json), set `servers.default.start_command`.
7. **Use the Write tool (if creating) or Edit tool (if updating) to save the file now.** Do not defer this to a later step.
8. **Verify:** Use the Glob tool to confirm `{STORIES_DIR}/servers.yml` exists after writing.

`stories/servers.yml` is safe to commit — it contains no credentials. Do NOT add it to `.gitignore`.

### Cleanup

If `SERVER_STARTED = true`, the ephemeral server must be stopped once visual work completes:

- **In a pipeline** (`{run-dir}/ephemeral-server.txt` was written): `/claude-tweaks:wrap-up` cleanup (Section D in `wrap-up/cleanup-procedures.md`) reads the file — its current content, per the Ephemeral server start's liveness-handle rule, not necessarily the value recorded at start time, since a dispatched second call may have restarted the server and rewritten it since this file was first written — and kills the PID at end-of-run. In multi-spec runs the server stays up across specs and is torn down once at the consolidated end (deferred under `MULTISPEC_REVIEW_DEFER=1`). The calling skill does not stop it mid-pipeline — later steps may also need it.
- **Standalone** (no run dir): the calling skill stops the server before it returns, and notes that it was started for automation. `ephemeral-server.txt` is never written on this path (Step 4 above writes it only "when a pipeline run dir exists"), so cleanup uses `lsof -ti tcp:{port} | xargs kill` directly — the same port-based mechanism Section D's rule in `wrap-up/cleanup-procedures-execution.md` uses when no lease exists, which is always the case here.
