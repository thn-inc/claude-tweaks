# Ad-hoc Friction Logging (#2783) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make an ad-hoc `EnterWorktree` session's guard refusals (plugin gates *and* the harness's own worktree-isolation Bash guard) land in a session-owned ad-hoc run dir that `friction-events.js` can still find after `ExitWorktree remove`.

**Architecture:** Three root causes, each with one fix. (1) Hooks treat `resolveRun`'s *guessed* `attribution: 'fallback'` run dir as if the session owned it, so `stampAdHocRunDir` never mints and denials log into an unrelated run — fix with one shared `resolveDenialRunDir` helper plus an `isTrustedOwnedRun` guard. (2) The harness's isolation guard is invisible to every registered hook — register `PostToolUseFailure` (Bash) and classify its `error` text. (3) The read side matches only by worktree path, which no longer resolves after `ExitWorktree remove` — also union ad-hoc dirs owned by the current session id.

**Tech Stack:** Node 18+, `node --test`, no external deps. Hook dispatcher `plugin/bin/hooks.js`, modules in `plugin/bin/lib/hooks/`.

**Spec:** `.claude-tweaks/pipelines/2026-10-16T172917-spec-2783/work/2783-spec.md` (record #2783; #2813 was closed as absorbed into it — its reproduction cases are covered here too).

Scope keywords: stampAdHocRunDir, stampAdHocRunDirForDenial, findRunsByWorktreePath, PostToolUseFailure, friction-events

## Diagnosis evidence (already gathered — do not re-derive)

- **D1 root cause, confirmed live:** `node -e` probe of `ctx.resolveRun(<this worktree>, {}, '00000000-fresh-session-probe')` in this repo returned `{"dir": ".../2026-10-16T173531-tidy-standalone", "attribution": "fallback"}` — a sibling session's run. `post-tool-use.js:298` (`if (ctx.ownedRun && ctx.ownedRun.dir) return;`) therefore no-ops. This very session's `EnterWorktree` minted no `*-adhoc-standalone` dir.
- **Same shape on the denial side (#2813's main-checkout denials):** `pre-tool-use.js:732` (shadow-run-dir guard) and `pre-tool-use.js:1007` (worktree-required `gate-denial`) use `ownedRun.dir || stampAdHocRunDirForDenial(ctx)`, so a fallback guess wins. `pre-tool-use.js:569-573` and `:637-648` already handle it correctly with inline copies of the same logic; `context.js:621` (`stampAdHocRunDirForDenial`'s own guard) also trusts any `ownedRun.dir`.
- **D2, measured by a headless probe** (`claude -p -w` with scratch hooks on every event, log kept in the session scratchpad): the harness's refusal ("This session is isolated in the worktree … Refusing to run it — a worktree-isolated session's git operations must target its own worktree") fires `PreToolUse` **before** and `PostToolUseFailure` **after**, with payload `{session_id, transcript_path, cwd, hook_event_name: "PostToolUseFailure", tool_name: "Bash", tool_input: {command, description}, tool_use_id, error: "<full refusal text>", is_interrupt: false, duration_ms}`. An ordinary non-zero exit *also* fires `PostToolUseFailure` (`error: "Exit code 128\nfatal: …"`). `PermissionDenied` did not fire. `plugin/hooks/hooks.json` registers no `PostToolUseFailure` entry today.
- **D3:** `friction-events.js:143-145` resolves siblings via `findRunsByWorktreePath(cwd, cwd, runDir)`; wrap-up runs from the main checkout after `ExitWorktree remove`, so the recorded (deleted) worktree path never matches. Ad-hoc dirs stay `status: active` (non-terminal) for 30 days after their worktree goes (`reconcile/archive-merged.js` `ADHOC_SUPERSEDED_TTL_MS`), so they *are* still enumerable — only the key is wrong. The run-state `sessionId` they carry is the right key.
- **Regression the D1 fix would introduce if done alone:** run dirs sort by name (UTC mint time). `/flow` mints its run dir at Step 2.8, *before* `EnterWorktree`; once `stampAdHocRunDir` mints on a fallback, that ad-hoc dir is newer, and after `record-worktree` stamps the formal dir with the same session id, `resolveRun`'s newest-first session arm would return the ad-hoc dir. Task 2 makes the session arm prefer a non-ad-hoc session-owned dir. The comment at `post-tool-use.js:277-284` ("a LATER formal run dir … sorts newer and wins") is false for `/flow` and gets corrected.
- **Consumer enumeration for the `resolveRun` change:** `grep -rn -e "resolveRun(" -e "resolveRunDir(" plugin/bin` → the only session-aware caller is `plugin/bin/hooks.js:1567` (`ownedRun`); `hooks.js:357/1565` and `pre-tool-use.js` pass no session id and take the `!me` branch, which this plan does not touch.

## Global Constraints

- Never break a session: every hook path exits 0; module code wraps its work in `try { … } catch { /* never break a session */ }` (docs/hooks.md).
- Test-mode tagging: a `gate-denial`/`wd-guard-refusal` event written while `process.env.CT_HOOKS_TEST_MODE === '1'` carries `test: true` (#1337) — copy the existing `testTag` idiom.
- `node --test` only; no new dependencies. Tests live in `tests/`, sized like neighbors.
- Byte ceilings: `plugin/skills/reflect/full-mode.md` is 34,227 bytes against the shared 46,080 ceiling (~11.8 KB headroom) — Task 5 adds well under 2 KB.
- Commit style: `{Verb} {what} — {detail}`, body ends with `refs #2783` (never a closing keyword in a commit) and the line `Claude-Session: https://claude.ai/code/session_011ZYKWYizjVE2LRbdQhzmBy`.
- Open PR #3240 (#2989) also edits `plugin/bin/friction-events.js` and `tests/friction-events-cli.test.js` — keep Task 4's edits there minimal and localized to ease the eventual merge.

## Review Focus

1. A formal `/flow`/`/build` run whose run dir was minted *before* `EnterWorktree`: after `record-worktree`, `ctx.ownedRun` must resolve to the formal dir, not the ad-hoc dir minted at `EnterWorktree` (Task 2 test).
2. An ordinary failing Bash command (non-zero exit) must never be logged as `wd-guard-refusal`, and must not mint an ad-hoc dir (Task 3 test).
3. The session-id read-side lookup must never pull a *different* session's ad-hoc dir, nor a non-ad-hoc run dir of the same session (Task 4 test).
4. An ad-hoc dir reachable by both the worktree-path and the session-id lookup is read exactly once — no duplicated events (Task 4 test).
5. Garbage / field-missing `PostToolUseFailure` payloads exit 0 with no stdout noise (Task 3: dispatcher invariant list).

---

### Task 1: One trusted denial-run-dir resolver for every pre-tool-use denial site

**Files:**
- Modify: `plugin/bin/lib/hooks/context.js:620-647` (`stampAdHocRunDirForDenial`) and its `module.exports` (line ~710)
- Modify: `plugin/bin/lib/hooks/pre-tool-use.js:565-577`, `:624-649`, `:726-736`, `:1006-1030` (read through to the `appendEvent` call that follows line 1014 so its `attribution` argument is switched too)
- Test: `tests/friction-main-checkout-denial-coverage.test.js` (add one test)
- Test: `tests/hooks-denial-run-dir.test.js` (create)

**Interfaces:**
- Produces (exported from `context.js`):
  - `isTrustedOwnedRun(ownedRun) -> boolean` — true iff `ownedRun && ownedRun.dir && ownedRun.attribution !== 'fallback'`.
  - `resolveDenialRunDir(ctx) -> { dir: string|null, attribution: string|undefined }` — trusted owned run → `{ dir: ownedRun.dir, attribution: ownedRun.attribution }`; else a fresh `stampAdHocRunDirForDenial` mint → `{ dir: <mint>, attribution: undefined }`; else the fallback guess → `{ dir: ownedRun.dir || null, attribution: ownedRun.attribution }`.

- [ ] **Step 1: Write the failing tests**

Create `tests/hooks-denial-run-dir.test.js`:

```js
'use strict';
// tests/hooks-denial-run-dir.test.js — #2783 / #2813: a denial must never be
// logged into resolveRun's GUESSED ('fallback') run dir when a session-owned
// ad-hoc dir can be minted instead. context.js's resolveDenialRunDir is the
// one resolver every pre-tool-use denial site uses.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ctxLib = require('../plugin/bin/lib/hooks/context');
const { gitRepo } = require('./helpers/git-fixtures');

function adhocDirs(main) {
  try {
    return fs.readdirSync(path.join(main, '.claude-tweaks', 'pipelines')).filter((n) => n.endsWith('-adhoc-standalone'));
  } catch { return []; }
}

test('isTrustedOwnedRun: session/env attribution is trusted, fallback and empty are not', () => {
  assert.strictEqual(ctxLib.isTrustedOwnedRun({ dir: '/r', attribution: 'session' }), true);
  assert.strictEqual(ctxLib.isTrustedOwnedRun({ dir: '/r', attribution: 'env' }), true);
  assert.strictEqual(ctxLib.isTrustedOwnedRun({ dir: '/r', attribution: 'fallback' }), false);
  assert.strictEqual(ctxLib.isTrustedOwnedRun({ dir: null, attribution: null }), false);
  assert.strictEqual(ctxLib.isTrustedOwnedRun(undefined), false);
});

test('resolveDenialRunDir: a trusted owned run is returned as-is, nothing minted', () => {
  const main = gitRepo();
  const owned = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-owned-'));
  const r = ctxLib.resolveDenialRunDir({ input: { session_id: 'sess-drd-1' }, cwd: main, ownedRun: { dir: owned, attribution: 'session' } });
  assert.deepStrictEqual(r, { dir: owned, attribution: 'session' });
  assert.deepStrictEqual(adhocDirs(main), []);
});

test('resolveDenialRunDir: a fallback guess is NOT used when an ad-hoc dir can be minted', () => {
  const main = gitRepo();
  const guess = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-guess-'));
  const r = ctxLib.resolveDenialRunDir({ input: { session_id: 'sess-drd-2' }, cwd: main, ownedRun: { dir: guess, attribution: 'fallback' } });
  const dirs = adhocDirs(main);
  assert.strictEqual(dirs.length, 1);
  assert.strictEqual(fs.realpathSync(r.dir), fs.realpathSync(path.join(main, '.claude-tweaks', 'pipelines', dirs[0])));
  assert.strictEqual(r.attribution, undefined);
  assert.strictEqual(ctxLib.readRunState(r.dir).sessionId, 'sess-drd-2');
});

test('resolveDenialRunDir: falls back to the guess (attribution kept) only when minting is impossible', () => {
  const notRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-notrepo-'));
  const guess = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-guess-'));
  const r = ctxLib.resolveDenialRunDir({ input: { session_id: 'sess-drd-3' }, cwd: notRepo, ownedRun: { dir: guess, attribution: 'fallback' } });
  assert.deepStrictEqual(r, { dir: guess, attribution: 'fallback' });
});

test('stampAdHocRunDirForDenial: a fallback-attributed ownedRun no longer short-circuits the mint', () => {
  const main = gitRepo();
  const guess = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-guess-'));
  const stamped = ctxLib.stampAdHocRunDirForDenial({ input: { session_id: 'sess-drd-4' }, cwd: main, ownedRun: { dir: guess, attribution: 'fallback' } });
  assert.notStrictEqual(stamped, guess);
  assert.strictEqual(adhocDirs(main).length, 1);
});
```

Append to `tests/friction-main-checkout-denial-coverage.test.js` (reuses that file's `runHook`, `runFrictionEvents`, `gitRepo`, `writeWorktreeAlwaysPolicy`):

```js
test('#2813: a main-checkout gate denial lands in a fresh ad-hoc dir even when an unrelated unowned run dir is present', () => {
  const project = gitRepo();
  writeWorktreeAlwaysPolicy(project);
  // An unrelated, adopted (decisions.md present), unowned run dir — exactly the
  // shape resolveRun's fallback arm guesses into (e.g. a sibling session's
  // *-tidy-standalone run).
  const pipelinesDir = path.join(project, '.claude-tweaks', 'pipelines');
  const sibling = path.join(pipelinesDir, '2026-10-01T000000-tidy-standalone');
  fs.mkdirSync(sibling, { recursive: true });
  fs.writeFileSync(path.join(sibling, 'decisions.md'), '## /tidy\n');

  const denyResult = runHook(['pre-tool-use'], {
    input: JSON.stringify({ tool_name: 'Write', tool_input: { file_path: path.join(project, 'a.txt') }, session_id: 'repro-session-2813' }),
    cwd: project,
  });
  assert.match(denyResult.stdout, /"permissionDecision":"deny"/);
  assert.ok(!fs.existsSync(path.join(sibling, 'events.jsonl')), 'the denial must not be logged into the unrelated sibling run');

  const laterRunDir = fs.mkdtempSync(path.join(pipelinesDir, '2026-10-02T000000-friction-repro-standalone-'));
  const events = runFrictionEvents(['--run', laterRunDir, '--worktree', project]);
  const denials = events.filter((e) => e.type === 'gate-denial');
  assert.strictEqual(denials.length, 1, JSON.stringify(events));
  assert.strictEqual(denials[0]._source, 'adhoc');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node -e "const c=require('./plugin/bin/lib/hooks/context'); if (typeof c.resolveDenialRunDir!=='function'||typeof c.isTrustedOwnedRun!=='function') { console.error('resolveDenialRunDir/isTrustedOwnedRun missing'); process.exit(1); }"`
Expected: FAIL (exit 1, "resolveDenialRunDir/isTrustedOwnedRun missing"). Then also run `node --test tests/hooks-denial-run-dir.test.js tests/friction-main-checkout-denial-coverage.test.js` and confirm the new #2813 test fails with the sibling's `events.jsonl` existing (the denial was logged into the guess).

- [ ] **Step 3: Implement**

In `context.js`, immediately above `stampAdHocRunDirForDenial`'s doc comment, add:

```js
// #2783/#2813: resolveRun's 'fallback' arm is a GUESS — the newest unowned,
// worktree-compatible run, routinely a sibling session's *-standalone dir in a
// busy checkout. It is never this session's own run, so no write path that
// stamps or logs friction may treat it as owned.
function isTrustedOwnedRun(ownedRun) {
  return !!(ownedRun && ownedRun.dir && ownedRun.attribution !== 'fallback');
}
```

Change `stampAdHocRunDirForDenial`'s first line from
`if (ctx.ownedRun && ctx.ownedRun.dir) return ctx.ownedRun.dir;` to
`if (isTrustedOwnedRun(ctx.ownedRun)) return ctx.ownedRun.dir;`.

Immediately after `stampAdHocRunDirForDenial`, add:

```js
// The one resolver every pre-tool-use denial site uses (#2783): trusted owned
// run first; else mint a session-owned ad-hoc dir; only when minting is
// impossible (cwd not a listed worktree, no session id) fall back to the guess,
// keeping its 'fallback' attribution so appendEvent stamps it as a guess.
// A fresh mint carries no attribution — it is this session's own run.
function resolveDenialRunDir(ctx) {
  const ownedRun = (ctx && ctx.ownedRun) || {};
  if (isTrustedOwnedRun(ownedRun)) return { dir: ownedRun.dir, attribution: ownedRun.attribution };
  const stamped = stampAdHocRunDirForDenial(ctx);
  if (stamped) return { dir: stamped, attribution: undefined };
  return { dir: ownedRun.dir || null, attribution: ownedRun.attribution };
}
```

Add `isTrustedOwnedRun, resolveDenialRunDir` to `module.exports`.

In `pre-tool-use.js`, replace each of the four inline resolutions with the helper:
- `:569-573` → `const { dir: ownCwdDenialRunDir, attribution: ownCwdAttribution } = ctxLib.resolveDenialRunDir(ctx);` (keep `ownCwdTestTag` and the `appendEvent` call unchanged).
- `:637-648` → `const { dir: denialRunDir, attribution: denialAttribution } = ctxLib.resolveDenialRunDir(ctx);` — keep the first paragraph of the comment above (why `hit.runDir` must not receive it) and replace the "A plain `ownedRun.dir` is NOT trusted…" through "…carry through whatever ownedRun.attribution already was." prose with one line: `// resolveDenialRunDir (context.js) never trusts a 'fallback' guess — see #2351/#2783.`
- `:731-736` → `const { dir: denialRunDir, attribution: denialAttribution } = ctxLib.resolveDenialRunDir(ctx);` and pass `denialAttribution` (not `ownedRun.attribution`) to `appendEvent`; drop the now-unused `const ownedRun`.
- `:1006-1007` → same destructure; switch that site's `appendEvent` attribution argument (a few lines below) to `denialAttribution`; drop the now-unused `ownedRun` only if nothing else in that block reads it.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/hooks-denial-run-dir.test.js tests/friction-main-checkout-denial-coverage.test.js tests/teardown-gate.test.js tests/hooks-pipeline-shadow-guard.test.js tests/hooks-dispatcher.test.js tests/hooks-pre-tool-use.test.js`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/hooks/context.js plugin/bin/lib/hooks/pre-tool-use.js tests/hooks-denial-run-dir.test.js tests/friction-main-checkout-denial-coverage.test.js
git commit -m "Route every pre-tool-use denial through resolveDenialRunDir — never log into a fallback-guessed run (refs #2783)"
```

---

### Task 2: Mint the ad-hoc dir on a fallback guess, and keep formal runs winning attribution

**Files:**
- Modify: `plugin/bin/lib/hooks/post-tool-use.js:271-298` (doc comment + `stampAdHocRunDir`'s first line)
- Modify: `plugin/bin/lib/hooks/context.js:355-373` (`resolveRun`'s session arm) — add an `isAdHocRunDir` helper near `isTrustedOwnedRun`
- Test: `tests/hooks-post-tool-use-adhoc-rundir.test.js` (add tests)

**Interfaces:**
- Consumes: `ctxLib.isTrustedOwnedRun` (Task 1).
- Produces: `isAdHocRunDir(dir) -> boolean` exported from `context.js` (basename ends with `-adhoc-standalone`); Task 4 uses it.

- [ ] **Step 1: Write the failing tests** (append to `tests/hooks-post-tool-use-adhoc-rundir.test.js`, reusing its `enterWorktreeCtx`, `createdAt`, `adhocDirs`, `pipelinesDir`, `gitRepo`, `harnessWorktreeOf`)

```js
test('#2783: stamps even when ctx.ownedRun is only a fallback GUESS (an unrelated unowned run), not this session\'s own', () => {
  const main = gitRepo();
  const wt = harnessWorktreeOf(main);
  const guess = fs.mkdtempSync(path.join(require('os').tmpdir(), 'ct-guess-'));
  post.run(enterWorktreeCtx(wt, { toolResponse: createdAt(wt), ownedRun: { dir: guess, attribution: 'fallback' }, sessionId: 'sess-2783-a' }));
  const dirs = adhocDirs(main);
  assert.strictEqual(dirs.length, 1);
  assert.strictEqual(ctxLib.readRunState(path.join(pipelinesDir(main), dirs[0])).sessionId, 'sess-2783-a');
});

function seedRun(main, name, state) {
  const dir = path.join(pipelinesDir(main), name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'decisions.md'), '');
  ctxLib.writeRunState(dir, state);
  return dir;
}

test('#2783: a formal run owned by this session wins resolveRun over a NEWER ad-hoc dir of the same session', () => {
  const main = gitRepo();
  const wt = harnessWorktreeOf(main);
  const formal = seedRun(main, '2026-10-01T000000-spec-42', { status: 'active', sessionId: 'sess-2783-b', worktree: wt });
  seedRun(main, '2026-10-02T000000-adhoc-standalone', { status: 'active', sessionId: 'sess-2783-b', worktree: wt });
  const r = ctxLib.resolveRun(wt, {}, 'sess-2783-b');
  assert.strictEqual(fs.realpathSync(r.dir), fs.realpathSync(formal));
  assert.strictEqual(r.attribution, 'session');
});

test('#2783: with only an ad-hoc dir owned, resolveRun still returns it with session attribution', () => {
  const main = gitRepo();
  const wt = harnessWorktreeOf(main);
  const adhoc = seedRun(main, '2026-10-02T000000-adhoc-standalone', { status: 'active', sessionId: 'sess-2783-c', worktree: wt });
  const r = ctxLib.resolveRun(wt, {}, 'sess-2783-c');
  assert.strictEqual(fs.realpathSync(r.dir), fs.realpathSync(adhoc));
  assert.strictEqual(r.attribution, 'session');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/hooks-post-tool-use-adhoc-rundir.test.js`
Expected: FAIL — the fallback-guess test finds 0 ad-hoc dirs; the formal-wins test returns the `-adhoc-standalone` dir.

- [ ] **Step 3: Implement**

`context.js` (next to `isTrustedOwnedRun`):

```js
// `{ts}-adhoc-standalone` — the suffix run-dir-resolve.js mints for
// `standalone: 'adhoc'` (post-tool-use.js's stampAdHocRunDir and
// stampAdHocRunDirForDenial). Same test as reconcile/archive-merged.js's
// isAdHocStandaloneMint's first clause.
function isAdHocRunDir(dir) {
  return typeof dir === 'string' && path.basename(dir).endsWith('-adhoc-standalone');
}
```

`resolveRun`'s session arm (the loop after `let unowned = null;`) becomes:

```js
  let unowned = null;
  let ownAdHoc = null;
  for (const { dir, state } of iterRunDirsWithState(resolvedCwd)) {
    const owner = state && typeof state.sessionId === 'string' && state.sessionId ? state.sessionId : null;
    // (keep the existing #1099 comment block here unchanged)
    if (owner === me && classifyOwnership({ sessionId: me, cwd: resolvedCwd }, state) !== 'foreign') {
      // #2783: an ad-hoc dir is a placeholder minted when no owned run existed
      // yet. A formal run (/flow mints its dir BEFORE EnterWorktree, so the
      // ad-hoc mint sorts newer) that this session later stamps via
      // record-worktree must win regardless of name order.
      if (!isAdHocRunDir(dir)) return { dir, attribution: 'session' };
      if (!ownAdHoc) ownAdHoc = dir;
      continue;
    }
    if (!owner && !unowned && !isSkippableFallbackCandidate(resolvedCwd, me, dir, state, includeWorktreeForeign)) unowned = dir;
  }
  if (ownAdHoc) return { dir: ownAdHoc, attribution: 'session' };
  return unowned ? { dir: unowned, attribution: 'fallback' } : { dir: null, attribution: null };
```

Export `isAdHocRunDir`.

`post-tool-use.js`: change `stampAdHocRunDir`'s first line to
`if (ctxLib.isTrustedOwnedRun(ctx.ownedRun)) return; // this session genuinely owns a run dir — a 'fallback' guess does not count (#2783)`.
Rewrite the doc comment's second paragraph (lines 271-284, "Fires only when this session owns NO run dir yet …" through "… is what finds it again later.") to:

```js
// Fires only when this session owns NO run dir yet — `ctx.ownedRun` is null
// or only resolveRun's 'fallback' GUESS (an unowned run that is routinely a
// sibling session's; trusting it is what left #2783's ad-hoc sessions with no
// dir at all). A session that genuinely owns one (`PIPELINE_RUN_DIR`, or an
// earlier `record-worktree` stamp) is left alone. When a formal skill later
// stamps its own run dir for this session, resolveRun's session arm prefers
// it over this ad-hoc dir regardless of name order (#2783 — /flow mints its
// dir before EnterWorktree, so the ad-hoc dir sorts newer). The ad-hoc dir is
// left behind; the Friction Lens's read side (friction-events.js) finds it
// again by `worktree` path or by owning session id.
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/hooks-post-tool-use-adhoc-rundir.test.js tests/hooks-context.test.js tests/hooks-dispatcher.test.js tests/hooks-log-modules.test.js tests/reconcile.test.js` (`tests/hooks-context.test.js` holds the existing `resolveRun` session-arm tests — plan-audit Check B surfaced it; every one must stay green)
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/hooks/context.js plugin/bin/lib/hooks/post-tool-use.js tests/hooks-post-tool-use-adhoc-rundir.test.js
git commit -m "Mint the ad-hoc run dir when ownedRun is only a fallback guess — formal runs keep winning attribution (refs #2783)"
```

---

### Task 3: Log the harness's own worktree-isolation refusals via PostToolUseFailure

**Files:**
- Create: `plugin/bin/lib/hooks/post-tool-use-failure.js`
- Modify: `plugin/hooks/hooks.json` (add a `PostToolUseFailure` block, matcher `Bash`)
- Modify: `plugin/bin/hooks.js:47` (`EVENTS`) and `:63-70` (`EVENT_MODULES`)
- Modify: `tests/hooks-dispatcher.test.js:75` (garbage-stdin event list)
- Test: `tests/hooks-post-tool-use-failure.test.js` (create)

**Interfaces:**
- Consumes: `ctxLib.resolveDenialRunDir(ctx)` (Task 1), `ctxLib.appendEvent(dir, type, data, attribution)`, `ctxLib.readEventLines(dir)`.
- Produces: `run(ctx) -> {}` and `HARNESS_ISOLATION_REFUSAL_RE` from `post-tool-use-failure.js`; event `wd-guard-refusal` with `{ tool: 'Bash', reason: 'harness-worktree-isolation', command }`.

- [ ] **Step 1: Write the failing test**

Create `tests/hooks-post-tool-use-failure.test.js`:

```js
'use strict';
// tests/hooks-post-tool-use-failure.test.js — #2783 Deliverable 2. Claude Code's
// own worktree-isolation Bash guard is invisible to PreToolUse/PostToolUse
// consumers; measured 2026-10-16, it fires PostToolUseFailure with the full
// refusal text in `error`. An ordinary non-zero exit fires the same event, so
// classification is by the refusal-text signature only.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const failure = require('../plugin/bin/lib/hooks/post-tool-use-failure');
const ctxLib = require('../plugin/bin/lib/hooks/context');
const { gitRepo, harnessWorktreeOf } = require('./helpers/git-fixtures');

const HOOKS = path.join(__dirname, '..', 'plugin', 'bin', 'hooks.js');

function refusal(wt) {
  return `This session is isolated in the worktree ${wt}, but this command runs sed with a value computed at runtime (the variable d) where an option may stand in a plain command, so what it runs cannot be shown not to be git. Refusing to run it — a worktree-isolated session's git operations must target its own worktree. Run the plain command from ${wt}.`;
}
function adhocDirs(main) {
  try { return fs.readdirSync(path.join(main, '.claude-tweaks', 'pipelines')).filter((n) => n.endsWith('-adhoc-standalone')); } catch { return []; }
}
function failureCtx(wt, error, { sessionId = 'sess-ptuf-1', toolName = 'Bash' } = {}) {
  return {
    input: { hook_event_name: 'PostToolUseFailure', tool_name: toolName, tool_input: { command: 'd=.; sed -n 1,2p $d/README.md' }, error, session_id: sessionId, cwd: wt, is_interrupt: false },
    cwd: wt,
    ownedRun: {},
  };
}

test('a harness worktree-isolation refusal is logged as wd-guard-refusal into a freshly minted ad-hoc dir', () => {
  const main = gitRepo();
  const wt = harnessWorktreeOf(main);
  assert.deepStrictEqual(failure.run(failureCtx(wt, refusal(wt))), {});
  const dirs = adhocDirs(main);
  assert.strictEqual(dirs.length, 1);
  const events = ctxLib.readEventLines(path.join(main, '.claude-tweaks', 'pipelines', dirs[0]));
  const refusals = events.filter((e) => e.type === 'wd-guard-refusal');
  assert.strictEqual(refusals.length, 1);
  assert.strictEqual(refusals[0].reason, 'harness-worktree-isolation');
  assert.strictEqual(refusals[0].tool, 'Bash');
  assert.strictEqual(refusals[0].command, 'd=.; sed -n 1,2p $d/README.md');
});

test('an ordinary failing Bash command is NOT a guard refusal — nothing logged, nothing minted', () => {
  const main = gitRepo();
  const wt = harnessWorktreeOf(main);
  failure.run(failureCtx(wt, 'Exit code 128\nfatal: not a git repository (or any of the parent directories): .git'));
  assert.deepStrictEqual(adhocDirs(main), []);
});

test('a non-Bash tool failure is ignored even if its text matches', () => {
  const main = gitRepo();
  const wt = harnessWorktreeOf(main);
  failure.run(failureCtx(wt, refusal(wt), { toolName: 'Edit' }));
  assert.deepStrictEqual(adhocDirs(main), []);
});

test('the command excerpt is capped at 200 characters', () => {
  const main = gitRepo();
  const wt = harnessWorktreeOf(main);
  const ctx = failureCtx(wt, refusal(wt));
  ctx.input.tool_input.command = 'x'.repeat(500);
  failure.run(ctx);
  const dir = path.join(main, '.claude-tweaks', 'pipelines', adhocDirs(main)[0]);
  assert.strictEqual(ctxLib.readEventLines(dir).find((e) => e.type === 'wd-guard-refusal').command.length, 200);
});

test('hooks.json registers PostToolUseFailure for Bash, routed to the post-tool-use-failure event', () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'plugin', 'hooks', 'hooks.json'), 'utf8'));
  const group = (cfg.hooks.PostToolUseFailure || []).find((g) => g.matcher === 'Bash');
  assert.ok(group, 'PostToolUseFailure has no Bash matcher group');
  assert.match(group.hooks[0].command, /hooks\.js" post-tool-use-failure$/);
});

test('dispatcher end-to-end: hooks.js post-tool-use-failure logs the refusal and exits 0', () => {
  const main = gitRepo();
  const wt = harnessWorktreeOf(main);
  const input = JSON.stringify(failureCtx(wt, refusal(wt), { sessionId: 'sess-ptuf-e2e' }).input);
  const out = execFileSync('node', [HOOKS, 'post-tool-use-failure'], { input, cwd: wt, encoding: 'utf8', env: { ...process.env, PIPELINE_RUN_DIR: '', CT_HOOKS_TEST_MODE: '' } });
  assert.strictEqual(out.trim(), '');
  const dirs = adhocDirs(main);
  assert.strictEqual(dirs.length, 1);
  const events = ctxLib.readEventLines(path.join(main, '.claude-tweaks', 'pipelines', dirs[0]));
  assert.ok(events.some((e) => e.type === 'wd-guard-refusal' && e.reason === 'harness-worktree-isolation'));
});
```

In `tests/hooks-dispatcher.test.js:75`, add `'post-tool-use-failure'` to the garbage-stdin event list (after `'post-tool-use'`).

- [ ] **Step 2: Run tests to verify they fail**

Run: `node -e "require('./plugin/bin/lib/hooks/post-tool-use-failure')"`
Expected: FAIL (exit 1, `Cannot find module`). Then also run `node --test tests/hooks-post-tool-use-failure.test.js tests/hooks-dispatcher.test.js` and confirm the garbage-stdin test's new `post-tool-use-failure` entry fails (the dispatcher exits 1 on an unrecognized subcommand).

- [ ] **Step 3: Implement**

Create `plugin/bin/lib/hooks/post-tool-use-failure.js`:

```js
// bin/lib/hooks/post-tool-use-failure.js — log tier only (#2783 Deliverable 2).
// Claude Code's own worktree-isolation Bash guard refuses a command in an
// EnterWorktree session ("This session is isolated in the worktree … Refusing
// to run it — …"). No PreToolUse/PostToolUse consumer sees that refusal; the
// harness reports it as a PostToolUseFailure whose `error` is the full refusal
// text (measured 2026-10-16 with a headless probe — the hooks docs do not
// state it). Every ordinary non-zero exit fires the same event, so only the
// refusal-text signature counts. Never surfaces a message; never breaks a session.
'use strict';
const ctxLib = require('./context');

const HARNESS_ISOLATION_REFUSAL_RE = /This session is isolated in the worktree [\s\S]*?Refusing to run it/;
const COMMAND_EXCERPT_CHARS = 200;

function run(ctx) {
  try {
    const input = (ctx && ctx.input) || {};
    if (input.tool_name !== 'Bash') return {};
    const error = typeof input.error === 'string' ? input.error : '';
    if (!HARNESS_ISOLATION_REFUSAL_RE.test(error)) return {};
    const toolInput = input.tool_input || {};
    const command = typeof toolInput.command === 'string' ? toolInput.command.slice(0, COMMAND_EXCERPT_CHARS) : null;
    const { dir, attribution } = ctxLib.resolveDenialRunDir(ctx);
    const testTag = process.env.CT_HOOKS_TEST_MODE === '1' ? { test: true } : null;
    ctxLib.appendEvent(dir, 'wd-guard-refusal', { tool: 'Bash', reason: 'harness-worktree-isolation', command, ...testTag }, attribution);
  } catch { /* never break a session over bookkeeping */ }
  return {};
}

module.exports = { run, HARNESS_ISOLATION_REFUSAL_RE };
```

`plugin/bin/hooks.js`: append `'post-tool-use-failure'` to `EVENTS` (after `'post-tool-use'`), and add `'post-tool-use-failure': () => require('./lib/hooks/post-tool-use-failure'),` to `EVENT_MODULES` after the `'post-tool-use'` line.

`plugin/hooks/hooks.json`: after the `PostToolUse` array, add:

```json
    "PostToolUseFailure": [
      {
        "matcher": "Bash",
        "hooks": [
          { "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/bin/hooks.js\" post-tool-use-failure" }
        ]
      }
    ],
```

(`bash-prefilter.js`'s `earlyGate` returns `null` for an event it does not govern, so the new event reads stdin itself — no prefilter change.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/hooks-post-tool-use-failure.test.js tests/hooks-dispatcher.test.js tests/hooks-gate-coverage.test.js tests/hooks-bash-prefilter.test.js tests/payload-boundary.test.js tests/claude-plugin-root-require-conformance.test.js tests/hooks-help-guard.test.js`
Expected: PASS. If a suite pins the `EVENTS` list or the `hooks.json` event keys literally (grep `tests/` for `'subagent-stop'` next to `'post-tool-use'`), update that pin in this task.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/hooks/post-tool-use-failure.js plugin/hooks/hooks.json plugin/bin/hooks.js tests/hooks-post-tool-use-failure.test.js tests/hooks-dispatcher.test.js
git commit -m "Log the harness worktree-isolation Bash refusal via a PostToolUseFailure hook (refs #2783)"
```

---

### Task 4: friction-events.js — also union ad-hoc dirs owned by the current session

**Files:**
- Modify: `plugin/bin/lib/hooks/context.js` (add `findAdHocRunsBySessionId` after `findRunsByWorktreePath`; export it)
- Modify: `plugin/bin/friction-events.js` (header comment, `USAGE`, `parseArgs`, `realDeps`, `run`)
- Test: `tests/friction-events-cli.test.js` (extend `fakeDeps`, add tests)
- Test: `tests/hooks-denial-run-dir.test.js` (add `findAdHocRunsBySessionId` tests)

**Interfaces:**
- Consumes: `isAdHocRunDir` (Task 2), `iterRunDirsWithState`.
- Produces: `findAdHocRunsBySessionId(cwd, sessionId, excludeDir) -> Array<{ runDir, state }>` — every non-terminal `-adhoc-standalone` dir whose `run-state.json` `sessionId === sessionId`, newest first, `excludeDir` omitted (realpath-compared, same as `findRunsByWorktreePath`). `friction-events.js --session <id>`, defaulting to `process.env.CLAUDE_CODE_SESSION_ID`.

- [ ] **Step 1: Write the failing tests**

In `tests/friction-events-cli.test.js`, extend `fakeDeps` with two defaults (before `...overrides`):

```js
    sessionId: () => null,
    findAdHocRunsBySessionId: (cwd, sessionId, excludeDir) => { calls.findAdHocRunsBySessionId.push({ cwd, sessionId, excludeDir }); return []; },
```
and add `findAdHocRunsBySessionId: []` to its `calls` object. Then append:

```js
test('--session unions this session\'s ad-hoc dirs even when the worktree path no longer matches (#2783)', () => {
  const deps = fakeDeps({
    readEvents: (runDir, source) => (runDir === '/run/adhoc-1' ? [{ type: 'wd-guard-refusal', reason: 'harness-worktree-isolation', _source: source, _runDir: runDir }] : []),
    findAdHocRunsBySessionId: () => [{ runDir: '/run/adhoc-1', state: { sessionId: 'S1' } }],
  });
  assert.strictEqual(run(['--run', '/run/primary', '--session', 'S1'], deps), 0);
  const out = JSON.parse(deps.calls.stdout.join(''));
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0]._source, 'adhoc');
  assert.strictEqual(out[0].type, 'wd-guard-refusal');
});

test('session id defaults to deps.sessionId() (CLAUDE_CODE_SESSION_ID) and excludes the primary run', () => {
  const deps = fakeDeps({ sessionId: () => 'S-env' });
  run(['--run', '/run/primary'], deps);
  assert.deepStrictEqual(deps.calls.findAdHocRunsBySessionId.map((c) => c.sessionId), ['S-env']);
  assert.strictEqual(deps.calls.findAdHocRunsBySessionId[0].excludeDir, '/run/primary');
});

test('no session id at all: the session lookup is not attempted', () => {
  const deps = fakeDeps();
  run(['--run', '/run/primary'], deps);
  assert.deepStrictEqual(deps.calls.findAdHocRunsBySessionId, []);
});

test('an ad-hoc dir found by BOTH the worktree and the session lookup is read once', () => {
  let reads = 0;
  const deps = fakeDeps({
    readEvents: (runDir, source) => {
      if (runDir !== '/run/adhoc-1') return [];
      reads += 1;
      return [{ type: 'gate-denial', _source: source, _runDir: runDir }];
    },
    findRunsByWorktreePath: () => [{ runDir: '/run/adhoc-1' }],
    findAdHocRunsBySessionId: () => [{ runDir: '/run/adhoc-1' }],
  });
  run(['--run', '/run/primary', '--session', 'S1'], deps);
  assert.strictEqual(reads, 1);
  assert.strictEqual(JSON.parse(deps.calls.stdout.join('')).length, 1);
});
```

Append to `tests/hooks-denial-run-dir.test.js`:

```js
const { harnessWorktreeOf } = require('./helpers/git-fixtures');

function seed(main, name, state) {
  const dir = path.join(main, '.claude-tweaks', 'pipelines', name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'decisions.md'), '');
  ctxLib.writeRunState(dir, state);
  return dir;
}

test('findAdHocRunsBySessionId: only this session\'s -adhoc-standalone dirs, never another session\'s or a formal run', () => {
  const main = gitRepo();
  const wt = harnessWorktreeOf(main);
  const mine = seed(main, '2026-10-02T000000-adhoc-standalone', { status: 'active', sessionId: 'S1', worktree: '/gone/wt' });
  seed(main, '2026-10-03T000000-adhoc-standalone', { status: 'active', sessionId: 'S2', worktree: '/gone/wt2' });
  seed(main, '2026-10-01T000000-spec-7', { status: 'active', sessionId: 'S1', worktree: wt });
  const hits = ctxLib.findAdHocRunsBySessionId(main, 'S1');
  assert.deepStrictEqual(hits.map((h) => fs.realpathSync(h.runDir)), [fs.realpathSync(mine)]);
  assert.deepStrictEqual(ctxLib.findAdHocRunsBySessionId(main, 'S1', mine), []);
  assert.deepStrictEqual(ctxLib.findAdHocRunsBySessionId(main, ''), []);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/friction-events-cli.test.js tests/hooks-denial-run-dir.test.js`
Expected: FAIL — `unknown argument: --session` (exit 1) for the `--session` tests; `ctxLib.findAdHocRunsBySessionId is not a function`.

- [ ] **Step 3: Implement**

`context.js`, after `findRunsByWorktreePath`:

```js
// #2783: the session-keyed sibling of findRunsByWorktreePath, for the Friction
// Lens's read side. The ordinary ad-hoc sequence ends with ExitWorktree(remove)
// BEFORE wrap-up, so wrap-up runs from the main checkout and the ad-hoc dir's
// recorded `worktree` no longer matches anything — but the dir is still
// non-terminal (reconcile sweeps it only after ADHOC_SUPERSEDED_TTL_MS) and
// still carries the owning session id. Ad-hoc dirs only: a formal run of the
// same session is a different run's record, not this session's ad-hoc friction.
function findAdHocRunsBySessionId(cwd, sessionId, excludeDir) {
  if (typeof sessionId !== 'string' || !sessionId) return [];
  let excl = excludeDir ? path.resolve(excludeDir) : null;
  if (excl) { try { excl = fs.realpathSync(excl); } catch { /* keep as-resolved */ } }
  const out = [];
  for (const { dir, state } of iterRunDirsWithState(cwd)) {
    if (!isAdHocRunDir(dir)) continue;
    if (!state || state.sessionId !== sessionId) continue;
    if (excl) {
      let d = dir;
      try { d = fs.realpathSync(dir); } catch { /* keep as-listed */ }
      if (d === excl) continue;
    }
    out.push({ runDir: dir, state });
  }
  return out;
}
```

Export it.

`friction-events.js`:
- `USAGE` → `'usage: friction-events.js --run <run-dir> [--worktree <path>] [--session <id>] [--help]\n'`.
- `parseArgs`: `opts` gains `session: null`; add `else if (a === '--session') opts.session = argv[++i];` next to the `--worktree` branch.
- `realDeps` gains `sessionId: () => process.env.CLAUDE_CODE_SESSION_ID || null,` and `findAdHocRunsBySessionId: ctxLib.findAdHocRunsBySessionId,`.
- `run`: replace the siblings block with:

```js
  const worktreePath = opts.worktree ? path.resolve(opts.worktree) : deps.cwd();
  const events = deps.readEvents(runDir, 'primary');
  const seen = new Set();
  const siblings = deps.findRunsByWorktreePath(worktreePath, worktreePath, runDir) || [];
  // #2783: after ExitWorktree(remove) the worktree path above matches nothing;
  // the owning session id still finds the ad-hoc dir.
  const sessionId = opts.session || deps.sessionId();
  const bySession = sessionId ? (deps.findAdHocRunsBySessionId(deps.cwd(), sessionId, runDir) || []) : [];
  for (const { runDir: siblingDir } of [...siblings, ...bySession]) {
    if (seen.has(siblingDir)) continue;
    seen.add(siblingDir);
    events.push(...deps.readEvents(siblingDir, 'adhoc'));
  }
```

- Header comment: after the paragraph ending "…before ever reaching wrap-up).", add: `// It also unions every non-terminal ad-hoc dir owned by the current session id (--session, default CLAUDE_CODE_SESSION_ID — a Bash-invoked CLI sees it, unlike a hook process): the ordinary ad-hoc order is ExitWorktree(remove) before wrap-up, after which the worktree-path match finds nothing (#2783). Each dir is read once even when both lookups return it.` and update the `// Usage:` line to include `[--session <id>]`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/friction-events-cli.test.js tests/hooks-denial-run-dir.test.js tests/friction-main-checkout-denial-coverage.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/hooks/context.js plugin/bin/friction-events.js tests/friction-events-cli.test.js tests/hooks-denial-run-dir.test.js
git commit -m "friction-events: union the current session's ad-hoc run dirs so friction survives ExitWorktree remove (refs #2783)"
```

---

### Task 5: End-to-end repro test + documentation of the mechanism and its one limitation

**Files:**
- Create: `tests/friction-adhoc-enterworktree-roundtrip.test.js`
- Modify: `plugin/skills/reflect/full-mode.md:94-115` (the "Ad-hoc-session fallback" paragraph — edit in place, do not move it)
- Modify: `docs/hooks.md` (line 13's `stampAdHocRunDir` sentence "It never overwrites an already-owned run: gated on `ctx.ownedRun.dir` being null…"; add the `post-tool-use-failure` module wherever the doc enumerates event modules — grep `docs/hooks.md` for `subagent-stop`)
- Modify: `docs/plugin-structure.md:180` (the `friction-events.js` CLI line: add `[--session <id>]` and the session-union sentence; also correct "fixed 5-type" vocabulary wording only if it is in the same sentence you edit — otherwise leave it)

**Interfaces:**
- Consumes: Tasks 1-4 (`post-tool-use.js` `run`, `post-tool-use-failure.js` `run`, `ctxLib.resolveRun`, `friction-events.js` CLI).

- [ ] **Step 1: Write the end-to-end test**

Create `tests/friction-adhoc-enterworktree-roundtrip.test.js`:

```js
'use strict';
// tests/friction-adhoc-enterworktree-roundtrip.test.js — record #2783's own repro,
// end to end: an ad-hoc EnterWorktree session in a checkout that already holds
// an unrelated unowned run dir (the fallback-guess shape that hid the bug),
// a harness worktree-isolation refusal inside the worktree, ExitWorktree
// remove, then a wrap-up run dir created from the main checkout. The real
// friction-events.js CLI must return the refusal.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const post = require('../plugin/bin/lib/hooks/post-tool-use');
const failure = require('../plugin/bin/lib/hooks/post-tool-use-failure');
const ctxLib = require('../plugin/bin/lib/hooks/context');
const { gitRepo, harnessWorktreeOf } = require('./helpers/git-fixtures');

const FRICTION_EVENTS = path.join(__dirname, '..', 'plugin', 'bin', 'friction-events.js');

test('#2783 repro: the harness refusal from an ad-hoc EnterWorktree session survives ExitWorktree remove', () => {
  const main = gitRepo();
  const pipelines = path.join(main, '.claude-tweaks', 'pipelines');
  const sibling = path.join(pipelines, '2026-10-01T000000-tidy-standalone');
  fs.mkdirSync(sibling, { recursive: true });
  fs.writeFileSync(path.join(sibling, 'decisions.md'), '## /tidy\n');

  const wt = harnessWorktreeOf(main);
  const S = 'sess-2783-roundtrip';
  const atEnter = ctxLib.resolveRun(wt, {}, S);
  assert.strictEqual(atEnter.attribution, 'fallback', 'precondition: the bug\'s shape — only a guessed run resolves');

  post.run({
    input: { tool_name: 'EnterWorktree', tool_response: { content: `Created worktree at ${wt} on branch wt-branch. The session is now working in the worktree.` }, session_id: S, cwd: wt },
    cwd: wt,
    ownedRun: atEnter,
  });
  const afterEnter = ctxLib.resolveRun(wt, {}, S);
  assert.strictEqual(afterEnter.attribution, 'session', 'EnterWorktree must have minted a session-owned ad-hoc dir');

  failure.run({
    input: {
      tool_name: 'Bash', tool_input: { command: 'd=.; sed -n 1,2p $d/README.md' }, session_id: S, cwd: wt,
      error: `This session is isolated in the worktree ${wt}, but this command … cannot be shown not to be git. Refusing to run it — a worktree-isolated session's git operations must target its own worktree.`,
    },
    cwd: wt,
    ownedRun: afterEnter,
  });

  execFileSync('git', ['-C', main, 'worktree', 'remove', '--force', wt]);

  const wrapUpRunDir = path.join(pipelines, '2026-10-03T000000-wrap-up-standalone');
  fs.mkdirSync(wrapUpRunDir);
  const events = JSON.parse(execFileSync('node', [FRICTION_EVENTS, '--run', wrapUpRunDir, '--session', S], { cwd: main, encoding: 'utf8' }));
  const refusals = events.filter((e) => e.type === 'wd-guard-refusal');
  assert.strictEqual(refusals.length, 1, JSON.stringify(events));
  assert.strictEqual(refusals[0]._source, 'adhoc');
  assert.strictEqual(refusals[0].reason, 'harness-worktree-isolation');
  assert.ok(!fs.existsSync(path.join(sibling, 'events.jsonl')), 'nothing may land in the unrelated sibling run');
});

test('#2783 control: without --session (and no env id), the same sequence after removal returns [] — the gap the session lookup closes', () => {
  const main = gitRepo();
  const pipelines = path.join(main, '.claude-tweaks', 'pipelines');
  const wt = harnessWorktreeOf(main);
  const S = 'sess-2783-control';
  post.run({ input: { tool_name: 'EnterWorktree', tool_response: { content: `Created worktree at ${wt} on branch b.` }, session_id: S, cwd: wt }, cwd: wt, ownedRun: ctxLib.resolveRun(wt, {}, S) });
  execFileSync('git', ['-C', main, 'worktree', 'remove', '--force', wt]);
  const wrapUpRunDir = path.join(pipelines, '2026-10-03T000000-wrap-up-standalone');
  fs.mkdirSync(wrapUpRunDir, { recursive: true });
  const env = { ...process.env };
  delete env.CLAUDE_CODE_SESSION_ID;
  const events = JSON.parse(execFileSync('node', [FRICTION_EVENTS, '--run', wrapUpRunDir], { cwd: main, encoding: 'utf8', env }));
  assert.deepStrictEqual(events, []);
});
```

- [ ] **Step 2: Run it**

Run: `node --test tests/friction-adhoc-enterworktree-roundtrip.test.js`
Expected: PASS (Tasks 1-4 landed). To prove it discriminates, temporarily revert `post-tool-use.js`'s `stampAdHocRunDir` first line to `if (ctx.ownedRun && ctx.ownedRun.dir) return;` and re-run — the first test must FAIL at the `afterEnter.attribution` assertion; restore it.

- [ ] **Step 3: Update `plugin/skills/reflect/full-mode.md`'s Ad-hoc-session fallback paragraph (in place)**

Replace its final sentence ("A formal `/claude-tweaks:build`/`/claude-tweaks:flow` run is unaffected: its own `PIPELINE_RUN_DIR` is set (or `record-worktree` stamps ownership) before either trigger fires, so `stampAdHocRunDir` sees an already-owned run and never mints a second, competing one.") with:

```markdown
"Owns no run dir" excludes `resolveRun`'s `fallback` guess — the newest unowned run, routinely a sibling session's — which every friction write path treats as not owned (#2783; before that fix the guess silently suppressed the mint and absorbed the session's events). A formal `/claude-tweaks:build`/`/claude-tweaks:flow` run is unaffected: once `record-worktree` stamps its own run dir for this session, `resolveRun` prefers that dir over any ad-hoc dir of the same session regardless of name order. The harness's own worktree-isolation Bash guard ("This session is isolated in the worktree … Refusing to run it") is captured too: it reaches no `PreToolUse`/`PostToolUse` consumer, so `bin/lib/hooks/post-tool-use-failure.js` reads Claude Code's `PostToolUseFailure` event and logs `wd-guard-refusal` (`reason: harness-worktree-isolation`) when the error carries that refusal text. Because the ordinary ad-hoc order is `ExitWorktree remove` before wrap-up — after which the recorded worktree path matches nothing — `friction-events.js` also unions every ad-hoc dir owned by the current session id (`--session`, default `CLAUDE_CODE_SESSION_ID`). **Known limitation:** a session whose id changes between the friction and the wrap-up (a resumed or account-switched session that receives a new id) finds the earlier dir only by worktree path, i.e. only when wrap-up runs inside that same still-live worktree; otherwise those events stay in the earlier session's ad-hoc dir, unread.
```

Before editing, verify the "resumed … new id" premise is stated conditionally (as above) — do not assert that resume always changes the id.

- [ ] **Step 4: Update `docs/hooks.md` and `docs/plugin-structure.md`**

`docs/hooks.md` line 13: replace "It never overwrites an already-owned run: gated on `ctx.ownedRun.dir` being null, so a formal pipeline's own `PIPELINE_RUN_DIR`/`record-worktree` stamp is never shadowed." with "It never overwrites a genuinely owned run: gated on `ctxLib.isTrustedOwnedRun(ctx.ownedRun)` — a `fallback`-attributed guess does not count as owned (#2783) — and `resolveRun`'s session arm prefers a formal session-owned run dir over an ad-hoc one regardless of name order, so a formal pipeline's later `record-worktree` stamp is never shadowed." Then add one bullet/sentence wherever the doc enumerates event modules (grep `docs/hooks.md` for `subagent-stop`): "`post-tool-use-failure` (`PostToolUseFailure`, Bash only, log tier) — logs Claude Code's own worktree-isolation Bash refusal as `wd-guard-refusal` (`reason: harness-worktree-isolation`); every other tool failure is ignored (#2783)."

`docs/plugin-structure.md:180`: change the command to `node plugin/bin/friction-events.js --run <run-dir> [--worktree <path>] [--session <id>]` and, after "…visible to a later wrap-up's reflect pass;", insert "it also unions every ad-hoc dir owned by the current session id (`--session`, default `CLAUDE_CODE_SESSION_ID`), since the worktree path no longer resolves once `ExitWorktree remove` ran before wrap-up (#2783);".

- [ ] **Step 5: Run prose/conformance suites touching these files**

Run: `node --test tests/reflect-friction-lens-vocab.test.js tests/reflect-transcript-judge-prose.test.js tests/materiality-floor-conformance.test.js tests/deferral-gate-conformance.test.js tests/reflect-wrap-up-insights-staging-conformance.test.js tests/friction-adhoc-enterworktree-roundtrip.test.js`
Expected: PASS. Also `wc -c plugin/skills/reflect/full-mode.md` must stay under 46,080.

- [ ] **Step 6: Commit**

```bash
git add tests/friction-adhoc-enterworktree-roundtrip.test.js plugin/skills/reflect/full-mode.md docs/hooks.md docs/plugin-structure.md
git commit -m "Pin #2783's repro end to end and document the ad-hoc friction mechanism and its session-id limitation (refs #2783)"
```

## Real-input probe (before whole-branch review)

After Task 4, run the CLI against this run's own session, whose `EnterWorktree` predates the fix (so it must return no ad-hoc dir): `node plugin/bin/friction-events.js --run "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-10-16T172917-spec-2783" --session 82e7b9ad-2cef-47ed-9c48-ca4063e76e9f` — expected: no `_source: adhoc` entries (none was minted), and independently `ls .claude-tweaks/pipelines | grep -c adhoc-standalone` in the main checkout to confirm the count it reflects.
