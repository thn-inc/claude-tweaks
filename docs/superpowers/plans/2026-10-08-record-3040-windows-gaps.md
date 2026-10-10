# Windows-only Release-Review Gaps (#3040) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the four gaps the v6.137.0 release gate review left: `resolve()` mislabels `engine-probe` failures, the doctor `--fix` guard test is vacuous on CRLF, batch-launcher escaping is unpinned on Linux CI, and the release hook probe is blind to CRLF workflows.

**Architecture:** Four independent, surgical fixes. (1) `resolve()` classifies an `engine-probe` failure the way `run()` already classifies a verb failure: only exit 127 (the launcher's own "no engine" answer) stays `engine-not-installed`; a timeout becomes `timeout`, any other exit or a spawn error becomes `exec-failed`, with `err.code`/exit status in `detail`. `FAILURE_REASONS` stays frozen at six. The resolver-level reason set grows from three to five, and every consumer doc that branches on resolver reasons is migrated (expand-contract: nothing is removed). (2)–(4) are regex/line-splitting fixes plus tests that run on every platform and pin the behavior on Linux CI.

**Tech Stack:** Node 18+, `node --test`, CommonJS. No new dependencies.

**Spec:** `.claude-tweaks/pipelines/2026-10-08T101832-record-3040/work/3040-spec.md` (record #3040)

## Global Constraints

- Neither `resolve()` nor `run()` may throw — every failure stays a returned `{ok: false, reason, ...}` value.
- `FAILURE_REASONS` stays exactly `['not-installed','upgrade-required','engine-not-installed','shape-mismatch','exec-failed','timeout']` (frozen contract; `tests/impeccable-engine-skip-reasons.test.js` pins it).
- `engine-not-installed` is kept for a probe that ran and answered "no engine" (exit 127). Every not-cached path in the real launcher (`impeccable` and `impeccable.cmd`, Impeccable 4.5.0) ends `exit 127` / `exit /b 127`.
- `plugin/skills/specify/design-pre-steps.md` is capped at 28,672 bytes (`SPECIFY_SUBFILE_CEILING_BYTES`, `tests/bin-lib/skill-audit/context-cost.test.js:228`); currently 24,309 — ~4.3 KB headroom. `plugin/skills/**/*.md` shared ceiling 46,080: `explore.md` 34,891, `impeccable-plugin.md` 21,461, `doctor.md` 12,494 — all have ample headroom for the edits below.
- Commit messages: `{Verb} {what} — {detail}` (imperative, no conventional-commit prefix), ending with the line `Claude-Session: https://claude.ai/code/session_01YLThbDRodwvW5fre9WE79S`.
- Every Bash command runs from the worktree root: `cd "C:/repos/claude-tweaks/.claude/worktrees/record-3040" && …`.
- Scope discipline (verbatim from the project's Working Approach): "Commit tests only where the task asks for them or the repo already keeps tests for this kind of change, sized like the neighboring test files; scratch checks stay scratch. Touch only what the task requires — a pre-existing bug you notice is a follow-up to report, not a fix to fold in, unless the task cannot work without it. Don't reformat or "improve" adjacent code; edit in place rather than rewrite when the result is the same."

## Review Focus

- A probe killed for timeout reports BOTH `err.killed`/`err.signal` and `err.code === 'ETIMEDOUT'`, with `err.status === null`. It must classify as `timeout`, never fall through to the "could not launch" branch (Task 1 pins this with the fake `ETIMEDOUT` test and a real-process test).
- A spawn error with no `code` and no numeric `status` (a bare `Error`) must still produce a non-empty `exec-failed` detail, not `undefined` text (Task 1 test "bare error").
- A command-injection argument `a"&echo pwned&"` must arrive as one literal argv entry. Dropping the second caret pass makes cmd.exe run `echo pwned` (verified on this Windows box: one-pass variant exited 9009 printing `["a\""]pwned`) (Task 4).
- A workflow whose `on:` line carries a trailing comment and CRLF (`on:  # trigger\r`) must still be detected (Task 5 test).
- A CRLF doc whose fence info string is followed by `\r\n` must yield its blocks, so the `--fix` guard actually iterates (Task 3 test).

---

### Task 1: `resolve()` classifies `engine-probe` failures

**Files:**
- Modify: `plugin/bin/lib/impeccable-engine/index.js:188-198` (the `catch` in `resolve()`), plus a new helper `probeFailure` placed directly above `resolve()` (after `spawnOptions`, ~line 166)
- Test: `tests/bin-lib/impeccable-engine/resolve.test.js` (append)

**Interfaces:**
- Consumes: nothing new.
- Produces: `resolve()` now returns, on an `engine-probe` failure, exactly one of:
  - `{ok:false, reason:'timeout', detail:'engine-probe timed out (<code or signal>)'}` — `err.killed`, `err.signal === 'SIGTERM'`, or `err.code === 'ETIMEDOUT'` (the same predicate `run()` uses at index.js:353).
  - `{ok:false, reason:'engine-not-installed', fix:'<launcher> engine-probe', detail: err.message}` — `err.status === 127`.
  - `{ok:false, reason:'exec-failed', detail:'engine-probe exit <status>: <last 20 lines of stderr or message>'}` — any other numeric `err.status`.
  - `{ok:false, reason:'exec-failed', detail:'engine-probe could not launch (<err.code || err.signal || "unknown">): <err.message>'}` — no numeric status (spawn error such as `EINVAL`/`ENOENT`/`EACCES`).
  Task 2's doc text describes exactly these shapes.

- [ ] **Step 1: Write the failing tests** — append to `tests/bin-lib/impeccable-engine/resolve.test.js`:

```js
const fs = require('fs');
const os = require('os');
const { run, defaultDeps } = require('../../../plugin/bin/lib/impeccable-engine');

const USER_ENTRY = [{ scope: 'user', installPath: '/fake/user/install', version: '4.4.0' }];
const probeThrows = (props) => fakeDeps({
  entries: USER_ENTRY,
  spawn: () => { throw Object.assign(new Error(props.message || 'probe failed'), props); },
});

test('#3040: a probe killed by the timeout -> timeout (not engine-not-installed), detail names engine-probe and the code', () => {
  const out = resolve({}, probeThrows({ code: 'ETIMEDOUT', signal: 'SIGTERM', killed: true, status: null }));
  assert.strictEqual(out.ok, false);
  assert.strictEqual(out.reason, 'timeout');
  assert.match(out.detail, /^engine-probe timed out/);
  assert.match(out.detail, /ETIMEDOUT/);
  assert.strictEqual(out.fix, undefined, 'a timeout has no canned fix');
});

test('#3040: a probe that cannot launch (EINVAL, the #3039 Windows bug) -> exec-failed carrying err.code', () => {
  const out = resolve({}, probeThrows({ code: 'EINVAL', message: 'spawnSync impeccable.cmd EINVAL' }));
  assert.strictEqual(out.reason, 'exec-failed');
  assert.match(out.detail, /^engine-probe could not launch \(EINVAL\)/);
  assert.strictEqual(out.fix, undefined);
});

test('#3040: a probe whose launcher is missing at spawn time (ENOENT) -> exec-failed carrying err.code', () => {
  const out = resolve({}, probeThrows({ code: 'ENOENT', message: 'spawnSync /x ENOENT' }));
  assert.strictEqual(out.reason, 'exec-failed');
  assert.match(out.detail, /\(ENOENT\)/);
});

test('#3040: a probe that exits non-zero other than 127 -> exec-failed with the exit code and stderr tail', () => {
  const out = resolve({}, probeThrows({ status: 1, stderr: 'line a\nline b\n' }));
  assert.strictEqual(out.reason, 'exec-failed');
  assert.match(out.detail, /^engine-probe exit 1: /);
  assert.match(out.detail, /line b/);
});

test('#3040: a bare error (no code, no status) still yields a non-empty exec-failed detail', () => {
  const out = resolve({}, probeThrows({ message: 'mystery' }));
  assert.strictEqual(out.reason, 'exec-failed');
  assert.match(out.detail, /^engine-probe could not launch \(unknown\): mystery/);
});

test('#3040: run() passes a probe timeout through unchanged rather than relabelling it', () => {
  const out = run('signals', [], {}, probeThrows({ code: 'ETIMEDOUT', signal: 'SIGTERM', killed: true, status: null }));
  assert.strictEqual(out.reason, 'timeout');
  assert.match(out.detail, /^engine-probe timed out/);
});

test('#3040: a real launcher that hangs on engine-probe -> resolve() returns timeout (real process)', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'impeccable-probe-home-'));
  const install = fs.mkdtempSync(path.join(os.tmpdir(), 'impeccable-probe-install-'));
  try {
    const scriptsDir = path.join(install, 'skills', 'impeccable', 'scripts');
    fs.mkdirSync(scriptsDir, { recursive: true });
    const isWin = process.platform === 'win32';
    const launcher = path.join(scriptsDir, isWin ? 'impeccable.cmd' : 'impeccable');
    const engine = path.join(scriptsDir, 'hang.js');
    fs.writeFileSync(engine, 'setTimeout(() => {}, 3000);\n');
    fs.writeFileSync(launcher, isWin
      ? ['@echo off', `"${process.execPath}" "${engine}" %*`, 'exit /b %errorlevel%', ''].join('\r\n')
      : ['#!/bin/sh', 'sleep 3', ''].join('\n'));
    if (!isWin) fs.chmodSync(launcher, 0o755); // root-safe — exec-bit setup for a fake launcher script, not a permission-denial simulation
    const pluginsDir = path.join(home, '.claude', 'plugins');
    fs.mkdirSync(pluginsDir, { recursive: true });
    fs.writeFileSync(
      path.join(pluginsDir, 'installed_plugins.json'),
      JSON.stringify({ version: 2, plugins: { 'impeccable@impeccable': [{ scope: 'user', installPath: install, version: '4.4.0' }] } })
    );
    const deps = {
      readFile: (p) => fs.readFileSync(p, 'utf8'),
      exists: (p) => fs.existsSync(p),
      realpath: (p) => fs.realpathSync(p),
      homedir: () => home,
      cwd: () => install,
      spawn: defaultDeps().spawn,
    };
    const out = resolve({ timeoutMs: isWin ? 1500 : 300 }, deps);
    assert.strictEqual(out.ok, false);
    assert.strictEqual(out.reason, 'timeout');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(install, { recursive: true, force: true });
  }
});
```

Merge the new `require` lines with the file's existing ones instead of duplicating `path`/`resolve`. The file already requires `path` and destructures `resolve`; extend that destructure to `{ resolve, run, defaultDeps }` and add `fs`/`os` requires at the top.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd "C:/repos/claude-tweaks/.claude/worktrees/record-3040" && node --test tests/bin-lib/impeccable-engine/resolve.test.js`
Expected: FAIL. The six `#3040` fake-deps tests fail with `'engine-not-installed' !== 'timeout'` / `!== 'exec-failed'`, and the real-process test fails the same way. The ten pre-existing tests still pass.

- [ ] **Step 3: Implement** — in `plugin/bin/lib/impeccable-engine/index.js`, add directly above `// opts: { projectPath, timeoutMs }. deps: { readFile, exists, realpath,` (the comment preceding `function resolve`):

```js
// engine-probe failure -> resolver reason. Only the launcher's own "no engine"
// answer (exit 127 — every not-cached path in the launcher ends there) means
// the engine isn't installed. A probe that timed out or never launched at all
// (spawn EINVAL/ENOENT — #3039's Windows bug read as `engine-not-installed`)
// gets the same `timeout`/`exec-failed` reasons run() uses for a verb.
function probeFailure(err, launcher) {
  const e = err || {};
  if (e.killed || e.signal === 'SIGTERM' || e.code === 'ETIMEDOUT') {
    return { ok: false, reason: 'timeout', detail: `engine-probe timed out (${e.code || e.signal || 'killed'})` };
  }
  if (e.status === 127) {
    return { ok: false, reason: 'engine-not-installed', fix: `${launcher} engine-probe`, detail: e.message };
  }
  if (typeof e.status === 'number') {
    const lastLines = String(e.stderr || e.message || '').split('\n').slice(-20).join('\n');
    return { ok: false, reason: 'exec-failed', detail: `engine-probe exit ${e.status}: ${lastLines}` };
  }
  return { ok: false, reason: 'exec-failed', detail: `engine-probe could not launch (${e.code || e.signal || 'unknown'}): ${e.message || ''}` };
}
```

Then replace the `catch` body in `resolve()`:

```js
  } catch (err) {
    return {
      ok: false,
      reason: 'engine-not-installed',
      fix: `${launcher} engine-probe`,
      detail: err && err.message,
    };
  }
```

with:

```js
  } catch (err) {
    return probeFailure(err, launcher);
  }
```

Also update the `launchSpec` comment at index.js:90 (`which made resolve() report \`engine-not-installed\` on every Windows install`) to read `which made resolve() report \`engine-not-installed\` on every Windows install (it now reports such a launch failure as \`exec-failed\`)`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd "C:/repos/claude-tweaks/.claude/worktrees/record-3040" && node --test tests/bin-lib/impeccable-engine/`
Expected: PASS. All of `resolve.test.js` (including the pre-existing AC2 exit-127 → `engine-not-installed` test), plus `run.test.js` and `windows-launch.test.js` unchanged.

- [ ] **Step 5: Commit**

```bash
cd "C:/repos/claude-tweaks/.claude/worktrees/record-3040" && git add plugin/bin/lib/impeccable-engine/index.js tests/bin-lib/impeccable-engine/resolve.test.js && git commit -m "Classify engine-probe failures in resolve() — timeout and launch errors no longer read as engine-not-installed

Claude-Session: https://claude.ai/code/session_01YLThbDRodwvW5fre9WE79S"
```

---

### Task 2: Migrate every resolver-reason consumer doc to the five-reason resolver set

**Files:**
- Modify: `plugin/skills/design-wrapper/impeccable-plugin.md` (the `## Resolution` envelope bullet ~line 56; `## Degradation` intro paragraph + rows `engine-not-installed`, `exec-failed`, `timeout` ~lines 70-78)
- Modify: `plugin/skills/design-wrapper/modes/doctor.md` (paragraph after the skip table, ~line 44)
- Modify: `plugin/skills/design-wrapper/modes/explore.md` (`## Availability` ~lines 44-50; line ~94; output catalog ~lines 304-305)
- Modify: `plugin/skills/specify/design-pre-steps.md` (Availability pre-check ~lines 52-54)
- Modify: `tests/impeccable-engine-skip-reasons.test.js` (comments at lines 20-23 and 82-83 only — the assertions already hold)

**Interfaces:**
- Consumes: Task 1's four return shapes (quoted in Task 1's Interfaces block).
- Produces: nothing code-facing.

All edits are in-place replacements. Apply each `replacing:` → `with:` pair exactly. Cell text in the Degradation table must not contain a `|` character, because `tests/impeccable-engine-skip-reasons.test.js` splits rows on `|`.

- [ ] **Step 1: Edit `impeccable-plugin.md`**

replacing:
```
- **`{ok: false, reason, fix?, detail?}`** — one of the six reasons in `## Degradation` below.
```
with:
```
- **`{ok: false, reason, fix?, detail?}`** — one of the six reasons in `## Degradation` below. `resolve` itself returns five of them: `not-installed`, `upgrade-required`, and `engine-not-installed` (each with a `fix`), plus `timeout` and `exec-failed` (each with a `detail`, no `fix`) when the `engine-probe` handshake itself timed out, could not launch, or exited with anything other than 127 — so a resolver miss is not always an install problem.
```

replacing:
```
Six conditions, all returned as `{ok: false, reason, fix?, detail?}` by `plugin/bin/lib/impeccable-engine/index.js` (`FAILURE_REASONS` — treat this list as authoritative; a module change to it is the one thing that could make this table stale). Three carry a canned `fix` string from the module itself; the other three carry only a `detail` naming what went wrong, because there is no single fix to print.
```
with:
```
Six conditions, all returned as `{ok: false, reason, fix?, detail?}` by `plugin/bin/lib/impeccable-engine/index.js` (`FAILURE_REASONS` — treat this list as authoritative; a module change to it is the one thing that could make this table stale). Three carry a canned `fix` string from the module itself. `shape-mismatch` and `exec-failed` carry only a `detail` naming what went wrong, and `timeout` carries a `detail` only when it was `resolve()`'s own `engine-probe` that timed out — for those three there is no single fix to print.
```

replacing the `engine-not-installed` row:
```
| `engine-not-installed` | The launcher exists but `engine-probe` failed — the design-engine binary isn't cached yet | `Impeccable design engine not cached` | Run the launcher's own `engine-probe` subcommand (the module's `fix` string is the exact command for this machine) |
```
with:
```
| `engine-not-installed` | The launcher exists and `engine-probe` ran, but answered "no engine" (exit 127) — the design-engine binary isn't cached yet | `Impeccable design engine not cached` | Run the launcher's own `engine-probe` subcommand (the module's `fix` string is the exact command for this machine) |
```

replacing the `exec-failed` row:
```
| `exec-failed` | The launcher exited non-zero, or crashed before producing output | `Impeccable {verb} unavailable (execution failed)` | `detail` carries the last lines of stderr — report it; usually a transient environment issue, not an install problem |
```
with:
```
| `exec-failed` | The launcher exited non-zero, or crashed before producing output — including an `engine-probe` that exited with anything other than 127, or could not be launched at all (a spawn error such as `EINVAL` or `ENOENT`) | `Impeccable {verb} unavailable (execution failed)` | `detail` carries the exit code and last lines of stderr, or the spawn error's `code` — report it; usually a transient environment issue, not an install problem |
```

replacing the `timeout` row:
```
| `timeout` | The run exceeded the engine module's 60-second timeout | `Impeccable {verb} timed out` | Retry; a persistent timeout points at something hanging inside the launcher, not this wrapper |
```
with:
```
| `timeout` | The run, or `resolve()`'s own `engine-probe` handshake, exceeded the engine module's 60-second timeout | `Impeccable {verb} timed out` | Retry; a persistent timeout points at something hanging inside the launcher, not this wrapper (`detail` names `engine-probe` when the handshake was what hung) |
```

- [ ] **Step 2: Edit `modes/doctor.md`**

replacing:
```
Rows 1, 2, 3, 5, 6, and 7 are the engine module's own six failure reasons — see `../impeccable-plugin.md`'s Degradation table, which is where those reasons and their fixes are worded in full. Do not re-derive them here; surface the `fix` field when the engine returned one.
```
with:
```
Rows 1, 2, 3, 5, 6, and 7 are the engine module's own six failure reasons — see `../impeccable-plugin.md`'s Degradation table, which is where those reasons and their fixes are worded in full. Do not re-derive them here; surface the `fix` field when the engine returned one. Rows 6 and 7 can also come from `run doctor`'s internal resolve, when the `engine-probe` handshake timed out, could not launch, or exited non-zero other than 127 — neither row means the engine is missing; only row 3 does.
```

- [ ] **Step 3: Edit `modes/explore.md`**

Read lines 40-52 and 90-96 first, so the replacements below match the file exactly.

replacing:
```
Run `node "${CLAUDE_PLUGIN_ROOT}/bin/impeccable-engine.js" resolve`. On `ok: false`, return immediately — before the `PRODUCT.md` check, before any `AskUserQuestion` call — naming the module's own `reason` and `fix` verbatim:
```
with:
```
Run `node "${CLAUDE_PLUGIN_ROOT}/bin/impeccable-engine.js" resolve`. On `ok: false`, return immediately — before the `PRODUCT.md` check, before any `AskUserQuestion` call — naming the module's own `reason` verbatim, plus whichever of `fix`/`detail` it returned:
```

replacing:
```
`reason` is one of the module's resolver-level failure reasons (`not-installed`, `upgrade-required`, `engine-not-installed`) — the module's exported `FAILURE_REASONS` list is authoritative if it differs from these names.
```
with:
```
`reason` is one of the module's resolver-level failure reasons: `not-installed`, `upgrade-required`, or `engine-not-installed` (each carrying `fix`, rendered as above), or `timeout`/`exec-failed` when the `engine-probe` handshake itself timed out or could not run (each carrying `detail` instead — render `{ "mode": "explore", "skipped": "<reason>", "detail": "<detail>" }`). The module's exported `FAILURE_REASONS` list is authoritative if it differs from these names.
```

On line ~94, the sentence fragment currently reads `surfaces here too — but as a \`fix\`-bearing Availability-stage reason (\`not-installed\`/\`upgrade-required\`/\`engine-not-installed\`), not a \`detail\`-bearing run-time one.` Replace exactly that fragment with:
```
surfaces here too — as one of `resolve()`'s own reasons: `fix`-bearing (`not-installed`/`upgrade-required`/`engine-not-installed`), or, when the `engine-probe` handshake itself timed out or failed to run, a `detail`-bearing `timeout`/`exec-failed` with the same shape as a run-time miss.
```
Leave the rest of that paragraph ("Check which field the `ok: false` envelope actually carries …") untouched. It already gives the right instruction.

In the output catalog, replacing:
```
- `{ "mode": "explore", "skipped": "<exec-failed|timeout|shape-mismatch>", "detail": "<detail>" }` — a `concept-seed` run-time miss (Deal and derive / Dealing / Lock-in), including the offline/sandboxed case where the catalog-service call itself cannot complete.
```
with:
```
- `{ "mode": "explore", "skipped": "<exec-failed|timeout|shape-mismatch>", "detail": "<detail>" }` — a `concept-seed` run-time miss (Deal and derive / Dealing / Lock-in), including the offline/sandboxed case where the catalog-service call itself cannot complete; also the `## Availability` section's `engine-probe` timeout or launch failure (`timeout`/`exec-failed` only).
```

- [ ] **Step 4: Edit `specify/design-pre-steps.md`**

replacing:
```
Record the result as `EXPLORE_AVAILABLE` (`true`/`false`) plus, when `false`, the module's own `reason` and `fix` — both branches below read this same result, so neither the identity nor the layout branch re-resolves.
```
with:
```
Record the result as `EXPLORE_AVAILABLE` (`true`/`false`) plus, when `false`, the module's own `reason` and its `fix` (or, for a `timeout`/`exec-failed` from the `engine-probe` handshake, its `detail` — those carry no `fix`) — both branches below read this same result, so neither the identity nor the layout branch re-resolves.
```

replacing:
```
- `EXPLORE_AVAILABLE: false` (`ok: false` — `not-installed`, `upgrade-required`, or `engine-not-installed`) → the tournament option is never presented as "Recommended." Replace Option 1's label/description in both branches' `AskUserQuestion` calls below with: `label`: `"Explore identities/layouts — unavailable"`, `description`: `"{fix} — explore cannot run this session."`, and drop the `(Recommended)` suffix.
```
with:
```
- `EXPLORE_AVAILABLE: false` (`ok: false` — `not-installed`, `upgrade-required`, `engine-not-installed`, or a `timeout`/`exec-failed` from the `engine-probe` handshake) → the tournament option is never presented as "Recommended." Replace Option 1's label/description in both branches' `AskUserQuestion` calls below with: `label`: `"Explore identities/layouts — unavailable"`, `description`: `"{fix} — explore cannot run this session."` (for a `timeout`/`exec-failed` result, which carries no `fix`: `"Impeccable engine probe failed ({reason}: {detail}) — explore cannot run this session."`), and drop the `(Recommended)` suffix.
```

- [ ] **Step 5: Edit `tests/impeccable-engine-skip-reasons.test.js` comments**

replacing:
```
// Reasons the engine module documents with a canned `fix` string returned at
// runtime (resolve()/run() in index.js) vs. the two that carry `detail`
// instead, and `timeout`, which carries neither (index.js returns a bare
// `{ok: false, reason: 'timeout'}`) — the doc must still say what to do.
```
with:
```
// Reasons the engine module documents with a canned `fix` string returned at
// runtime (resolve()/run() in index.js) vs. the two that carry `detail`
// instead, and `timeout`, which never carries a `fix` (run() returns a bare
// `{ok: false, reason: 'timeout'}`; resolve()'s engine-probe timeout adds a
// `detail`) — the doc must still say what to do.
```

replacing:
```
    // `timeout` carries neither `fix` nor `detail` (index.js returns a bare
    // {ok: false, reason: 'timeout'}) — only the non-empty-cell check above applies.
```
with:
```
    // `timeout` never carries a `fix` (and a `detail` only from resolve()'s
    // engine-probe) — only the non-empty-cell check above applies.
```

- [ ] **Step 6: Verify — conformance suites plus three independent greps**

Run: `cd "C:/repos/claude-tweaks/.claude/worktrees/record-3040" && node --test tests/impeccable-engine-skip-reasons.test.js tests/design-variant-exploration-availability-order.test.js tests/design-wrapper-doctor-no-fix.test.js tests/bin-lib/skill-audit/context-cost.test.js`
Expected: PASS. Before Task 3, `design-wrapper-doctor-no-fix.test.js` may fail its sanity test on this CRLF checkout. That is a pre-existing condition Task 3 fixes, so judge only the other files here.

Then run all three of these and confirm none returns a stale claim:
- `grep -rn "resolver-level failure reasons (\`not-installed\`, \`upgrade-required\`, \`engine-not-installed\`)" plugin/` → no output
- `grep -rn "or \`engine-not-installed\`) → the tournament" plugin/` → no output
- `grep -rn "Three carry a canned \`fix\` string from the module itself; the other three" plugin/` → no output

- [ ] **Step 7: Commit**

```bash
cd "C:/repos/claude-tweaks/.claude/worktrees/record-3040" && git add plugin/skills/design-wrapper/impeccable-plugin.md plugin/skills/design-wrapper/modes/doctor.md plugin/skills/design-wrapper/modes/explore.md plugin/skills/specify/design-pre-steps.md tests/impeccable-engine-skip-reasons.test.js && git commit -m "Document resolve()'s timeout and exec-failed probe reasons — explore, doctor, specify and the Degradation table

Claude-Session: https://claude.ai/code/session_01YLThbDRodwvW5fre9WE79S"
```

---

### Task 3: Doctor `--fix` guard test survives a CRLF checkout

**Files:**
- Modify: `tests/design-wrapper-doctor-no-fix.test.js:27` (`fencedCodeBlocks` regex) and append one test

**Interfaces:** none.

- [ ] **Step 1: Write the failing test** — append to `tests/design-wrapper-doctor-no-fix.test.js`:

```js
test('fencedCodeBlocks finds blocks in CRLF text, so the --fix guard is not vacuous on a Windows checkout (#3040)', () => {
  const crlf = 'intro\r\n\r\n```bash\r\nnode impeccable-engine.js run doctor --fix\r\n```\r\n\r\n```\r\nplain\r\n```\r\n';
  const blocks = fencedCodeBlocks(crlf);
  assert.strictEqual(blocks.length, 2, 'both CRLF fenced blocks must be found');
  assert.ok(blocks[0].includes('--fix'), 'the guard must see the --fix invocation inside a CRLF block');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd "C:/repos/claude-tweaks/.claude/worktrees/record-3040" && node --test tests/design-wrapper-doctor-no-fix.test.js`
Expected: FAIL. The new test reports `0 !== 2`, and on this CRLF working tree the existing sanity test also fails (`expected at least one fenced code block`).

- [ ] **Step 3: Implement** — replace line 27:

```js
  return [...doc.matchAll(/```[a-z]*\n([\s\S]*?)```/g)].map((m) => m[1]);
```
with:
```js
  return [...doc.matchAll(/```[a-z]*\r?\n([\s\S]*?)```/g)].map((m) => m[1]);
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd "C:/repos/claude-tweaks/.claude/worktrees/record-3040" && node --test tests/design-wrapper-doctor-no-fix.test.js`
Expected: PASS (all 4 tests).

Go-red probe: temporarily insert a fenced block into `plugin/skills/design-wrapper/modes/doctor.md` (e.g. append "\n```bash\nnode x run doctor --fix\n```\n") and rerun. Expected: FAIL on `no fenced code block in modes/doctor.md invokes --fix`. Revert the temporary edit with `git checkout -- plugin/skills/design-wrapper/modes/doctor.md` **only if Task 2's doctor.md change is already committed**. Otherwise remove the inserted lines by hand. Never commit the probe.

- [ ] **Step 5: Commit**

```bash
cd "C:/repos/claude-tweaks/.claude/worktrees/record-3040" && git add tests/design-wrapper-doctor-no-fix.test.js && git commit -m "Accept CRLF after a fence info string in the doctor --fix guard — the test iterated nothing on Windows checkouts

Claude-Session: https://claude.ai/code/session_01YLThbDRodwvW5fre9WE79S"
```

---

### Task 4: Pin the batch-launcher escaping on every platform

**Files:**
- Test: `tests/bin-lib/impeccable-engine/windows-launch.test.js` (append one platform-independent test; extend the win32 real-process fixture's `args` array)

**Interfaces:** none (tests `launchSpec(launcher, args, platform, env)` from `plugin/bin/lib/impeccable-engine/index.js`, unchanged).

The expected payloads below were produced by the current shipped `launchSpec` and checked on this Windows machine by a real `cmd.exe` round-trip. The shipped escaping returned every argument byte-identical. A one-caret-pass variant ran `echo pwned` for `a"&echo pwned&"`. A variant without trailing-backslash doubling merged `trail\` with the next argument.

- [ ] **Step 1: Write the test** — append:

```js
// The exact `/c` payload, pinned on every platform (#3040): the win32
// real-process test above is skipped on Linux CI, so without this pin dropping
// either caret pass or the trailing-backslash doubling left every CI test green.
// The second caret pass is what stops `a"&echo pwned&"` from closing the quote
// during the launcher's own `"%run%" %*` re-parse and running `echo pwned`.
test('launchSpec pins the exact escaped /c payload for metacharacter, quote, trailing-backslash and injection args', () => {
  const payload = (arg) => launchSpec('C:\\x\\impeccable.cmd', [arg], 'win32', { ComSpec: 'cmd.exe' }).args[3];
  assert.strictEqual(payload('a b'), String.raw`"C:\x\impeccable.cmd ^^^"a^^^ b^^^""`);
  assert.strictEqual(payload('x&y|z<w>v'), String.raw`"C:\x\impeccable.cmd ^^^"x^^^&y^^^|z^^^<w^^^>v^^^""`);
  assert.strictEqual(payload('say "hi"'), String.raw`"C:\x\impeccable.cmd ^^^"say^^^ \^^^"hi\^^^"^^^""`);
  assert.strictEqual(payload('trail\\'), String.raw`"C:\x\impeccable.cmd ^^^"trail\\^^^""`);
  assert.strictEqual(payload('a"&echo pwned&"'), String.raw`"C:\x\impeccable.cmd ^^^"a\^^^"^^^&echo^^^ pwned^^^&\^^^"^^^""`);
});
```

And in the win32 real-process test's `args` array, insert `'a"&echo pwned&"',` directly after `'say "hi"',`. The `--from` value pair stays intact, since it's a value, not a flag.

- [ ] **Step 2: Prove each assertion can go red (mutation probe, not committed)**

In `plugin/bin/lib/impeccable-engine/index.js`'s `escapeBatchArg`, temporarily change `return s.replace(CMD_META, '^$1').replace(CMD_META, '^$1');` to `return s.replace(CMD_META, '^$1');`. Run `cd "C:/repos/claude-tweaks/.claude/worktrees/record-3040" && node --test tests/bin-lib/impeccable-engine/windows-launch.test.js`. Expected: FAIL on the new pin test, and on win32 the real-process test also fails. Restore the line.

Then temporarily delete `.replace(/(\\*)$/, '$1$1')` and rerun. Expected: FAIL on the `trail\\` assertion. Restore it, and confirm `git diff plugin/bin/lib/impeccable-engine/index.js` shows no change left over from these probes.

- [ ] **Step 3: Run to verify it passes**

Run: `cd "C:/repos/claude-tweaks/.claude/worktrees/record-3040" && node --test tests/bin-lib/impeccable-engine/windows-launch.test.js`
Expected: PASS (on this win32 machine the real-process test runs too, and must pass with the new injection argument).

- [ ] **Step 4: Commit**

```bash
cd "C:/repos/claude-tweaks/.claude/worktrees/record-3040" && git add tests/bin-lib/impeccable-engine/windows-launch.test.js && git commit -m "Pin the batch-launcher /c payload on every platform — dropping a caret pass now fails Linux CI

Claude-Session: https://claude.ai/code/session_01YLThbDRodwvW5fre9WE79S"
```

---

### Task 5: Release hook probe reads CRLF workflows

**Files:**
- Modify: `plugin/bin/lib/release-preflight/pack.js:97` (`workflowPublishesRelease`'s line split)
- Test: `tests/bin-lib/release-preflight/pack.test.js` (append)

Place the new test after the existing `hook (pr-first)` test (~line 230), reusing its `hookOf` helper.

**Interfaces:** none.

- [ ] **Step 1: Write the failing test** — append:

```js
test('hook (pr-first): CRLF workflows are scanned like LF ones — a Windows checkout of mirror-marketplace.yml is a release hook (#3040)', async () => {
  // Byte-shape of this repo's own .github/workflows/mirror-marketplace.yml on a
  // core.autocrlf checkout: `on:\r` never matched ON_LINE_RE's `(.*)$`.
  const mirror = 'name: mirror-marketplace\n\non:\n  release:\n    types: [published]\n\npermissions:\n  contents: write\n\njobs:\n  mirror:\n    runs-on: ubuntu-latest\n'.replace(/\n/g, '\r\n');
  assert.strictEqual(await hookOf({ 'mirror-marketplace.yml': mirror }), true);
  assert.strictEqual(await hookOf({ 'publish.yml': 'on: release\r\njobs: {}\r\n' }), true);
  assert.strictEqual(await hookOf({ 'publish.yml': 'on:  # trigger\r\n  release:\r\n    types:\r\n      - published\r\n' }), true);
  assert.strictEqual(await hookOf({ 'publish.yml': 'on:\r\n  release:\r\n    types: [created]\r\njobs: {}\r\n' }), false);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd "C:/repos/claude-tweaks/.claude/worktrees/record-3040" && node --test tests/bin-lib/release-preflight/pack.test.js`
Expected: FAIL after Step 1 appends the test: the new test fails with `false !== true` for the mirror fixture, and every other test passes.

- [ ] **Step 3: Implement** — in `workflowPublishesRelease`, replace:

```js
  const lines = String(text).split('\n');
```
with:
```js
  const lines = String(text).split(/\r?\n/); // CRLF checkouts: `on:\r` never matches ON_LINE_RE's `(.*)$`
```

- [ ] **Step 4: Run to verify it passes, then probe the real checkout**

Run: `cd "C:/repos/claude-tweaks/.claude/worktrees/record-3040" && node --test tests/bin-lib/release-preflight/`
Expected: PASS.

Real-input probe (acceptance criterion "On a CRLF checkout of this repo, `gatherReleasePreflight({only:["hook"]})` returns `true`"). This worktree is a CRLF checkout: `git ls-files --eol .github/workflows/mirror-marketplace.yml` reports `i/lf w/crlf`. Write a scratch file `.claude-tweaks/pipelines/2026-10-08T101832-record-3040/scratch/hook-probe.js` (gitignored, never committed):

```js
'use strict';
const path = require('path');
const root = path.resolve(__dirname, '../../../..');
const { gatherReleasePreflight } = require(path.join(root, 'plugin/bin/lib/release-preflight/pack.js'));
gatherReleasePreflight({ cwd: root, only: ['hook'] }).then((p) => console.log(JSON.stringify(p.hook)));
```

Run: `cd "C:/repos/claude-tweaks/.claude/worktrees/record-3040" && node .claude-tweaks/pipelines/2026-10-08T101832-record-3040/scratch/hook-probe.js`
Expected: `{"ok":true,"value":true}`. As an independent count, `od -c .github/workflows/mirror-marketplace.yml | grep -c '\\r'` should be > 0, which confirms the probe ran against CRLF bytes. With Step 3 reverted, the probe should print `value:false`; check that once before Step 3, or by stashing the change via a WIP commit, never `git stash`.

- [ ] **Step 5: Commit**

```bash
cd "C:/repos/claude-tweaks/.claude/worktrees/record-3040" && git add plugin/bin/lib/release-preflight/pack.js tests/bin-lib/release-preflight/pack.test.js && git commit -m "Split workflow text on CRLF in the release hook probe — Windows checkouts reported no release hook

Claude-Session: https://claude.ai/code/session_01YLThbDRodwvW5fre9WE79S"
```
