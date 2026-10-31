# Merge Mode Archived-Run Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/claude-tweaks:wrap-up #N merge` adopts a parked run that wrap-up already closed and archived, instead of stopping with "no pipeline run directory resolved".

**Architecture:** `resolve-run-dir` gains an opt-in `--archived` flag (`opts.archived` in `plugin/bin/lib/hooks/run-dir-resolve.js`). Only when steps 1-2 resolve nothing, it returns the newest closed match for `--spec-slug` whose `run-state.json` records a PR. A closed match is either an archived run under `pipelines/archive/`, or a live run with status `clean` that `archive-run` refused (plan-review ruling, spec's Plan Review Clarifications). It is read-only, and is refused with `--create`. `merge-mode.md` calls it as a fallback and drops the false "stays `status: active`" claim.

**Tech Stack:** Node 18+ CommonJS, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-31T094853-spec-4677/work/4677-spec.md` (record #4677)

Scope keywords: stays `status: active`

Scope ruling: the other hits of that phrase (`plugin/skills/wrap-up/resume-halted-run.md`, `docs/skill-graph.md:244`, `plugin/bin/lib/hooks/resume-freshness.js:24`) describe a headless dispatch firing whose console halted before Phase 4 ran. That run really does stay `active`, so they are correct and out of scope. `--archived` is opt-in, so no existing `resolve-run-dir` caller changes behavior.

## Global Constraints

- No `fs.existsSync`/`fs.realpathSync` tokens added under `plugin/bin/` (`tests/path-guard-conformance.test.js` counts them per file against an allowlist). Use `fs.readdirSync(..., { withFileTypes: true })` and `fs.readFileSync` inside try/catch.
- `--archived` never creates, renames or writes anything. It returns an existing archived path or falls through to the existing `unresolved` failure.
- The existing step-1/step-2 behavior is byte-for-byte unchanged when `--archived` is absent. A live match always wins over an archived one.
- `tests/wrap-up-merge-mode-conformance.test.js`'s `assertEachFactGoesRed` strips each fact's first match. The new merge-mode prose must not add a second match for `resolve-command` (`/resolve-run-dir --spec-slug "spec-\{n\}"/`), `no-create` (`/with no \`--create\`/`), `not-resume` or `unresolved-stops`. So write the fallback as `resolve-run-dir --archived --spec-slug "spec-{n}"` (flag first).
- `hooks-js-verb-registration` governs `plugin/bin/hooks.js`. Its rule 1: "`VERBS` table in `plugin/bin/hooks.js` | One entry, `'{verb}': { usage: '{verb} --run <dir> [...]', run: run{Verb} }`. `USAGE` (derived from it), the `--help`/`-h` intercept, dispatch and the unknown-verb usage listing all read this table". Its rule 2: "`KNOWN_FLAGS` … Only for a flag-strict verb". `resolve-run-dir` is not flag-strict, so only its `VERBS` usage string changes.
- Commit style `{Verb} {what} — {detail}`, each commit ending `Claude-Session: https://claude.ai/code/session_016yg3zpLEoD9UdpAu9qLWfV`.

## Review Focus

1. An archived match whose `run-state.json` is malformed JSON or an array. It is skipped like a no-PR one, never thrown. (Task 1 test `review-focus: malformed archived run-state is skipped`.)
2. Two archived matches where the newer one has no `pr`. The older one with `pr` wins. (Task 1 test `review-focus: newest archived match WITH a pr wins`.)
3. A segment collision: `spec-378` must not adopt `archive/…-spec-3784` (#3865). (Task 1 test `review-focus: archived lookup keeps whole-segment slug matching`.)
4. A non-canonical name under `archive/` (no `RUN_ID_RE` prefix) is never a candidate. (Task 1 test `review-focus: non-canonical archived name is ignored`.)
5. No `archive/` directory at all: `ok:false` with reason `unresolved`, no throw, nothing created. (Task 1 test `review-focus: missing archive dir resolves unresolved`.)

---

### Task 1: `--archived` fallback in the resolver and CLI

**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/hooks/run-dir-resolve.js` (add `archivedMatch`, wire it into `resolve` after step 2, add the `archived-create` refusal)
- Modify: `plugin/bin/hooks.js:121` (VERBS usage string) and `plugin/bin/hooks.js` `runResolveRunDir` (pass `archived: args.includes('--archived')`)
- Test: `tests/hooks-run-dir-resolve.test.js`, `tests/hooks-resolve-run-dir-cli.test.js`

**Interfaces:**
- Produces: `resolve({ ..., archived: true })`, returning `{ ok: true, path: <pipelinesRoot>/archive/<name> or <pipelinesRoot>/<name>, created: false }` or the existing `fail('unresolved', …)`. Two refusals come first, before step 1 runs, so a valid `PIPELINE_RUN_DIR` cannot mask them: `archived && create` returns `fail('archived-create', <message naming that --archived is read-only and refuses --create>)`, and `archived` without `specSlug` returns `fail('archived-unnamed', <message naming that --archived needs --spec-slug>)`. CLI: `hooks.js resolve-run-dir --archived --spec-slug <s>` prints that path and exits 0. Usage string: `resolve-run-dir [--spec-slug <slug>] [--mode <mode>] [--standalone <value>] [--create] [--root-only] [--archived]`.

- [ ] **Step 1: Write the failing tests** in `tests/hooks-run-dir-resolve.test.js`, using its `gitRepo`/`mkRunDir`/`writeRunState` helpers. Add a local `mkArchived(main, name)` that creates `.claude-tweaks/pipelines/archive/<name>`.
  - `AC1.1: --archived resolves an archived-only spec run carrying a pr object`: create `archive/2026-01-01T000000-spec-42` with `writeRunState(dir, { status: 'clean', worktree: null, worktreeAtClose: '/gone', pr: { number: 7, url: 'u', branch: 'b' } })` and `config.yml` `spec: 42\n`. Then `resolve({ cwd: main, env: {}, specSlug: 'spec-42', archived: true })` deep-equals `{ ok: true, path: <that dir>, created: false }` on `ok/path/created`.
  - `AC1.1 real writer: a run closed by closeRunState then moved to archive/ resolves`: `mkRunDir(main, '2026-01-02T000000-spec-43')`, then `writeRunState` with `{ status: 'active', worktree: null, pr: { number: 8, url: 'u' } }`, then `closeRunState(dir, { explicit: true, callerIdentity: { sessionId: 's-4677' }, checkLiveWorktree: false })` (from `../plugin/bin/lib/hooks/close-run-state`). Then `fs.renameSync` it into `archive/`. `resolve({ … specSlug: 'spec-43', archived: true }).path` equals the archived path.
  - `AC1.2: --archived skips an archived match with no pr object`: archived `…-spec-44` with `{ status: 'clean' }` → `ok:false`, `reason: 'unresolved'`.
  - `AC2.1: a live match still wins over an archived one under --archived`: live `2026-01-01T000000-spec-45` (no run-state) and archived `2026-02-01T000000-spec-45` with a `pr`. The result path is the live dir.
  - `without --archived an archived-only fixture stays unresolved`: the AC1.1 fixture without `archived` → `ok:false`, `reason: 'unresolved'`.
  - `--archived with --create is refused before any mkdir`: `resolve({ … specSlug: 'spec-46', archived: true, create: true })` → `ok:false`, `reason: 'archived-create'`, and `fs.readdirSync(pipelines)` contains no `-spec-46` entry. Repeat with `env: { PIPELINE_RUN_DIR: <a valid live run dir> }`: still `archived-create`.
  - `--archived without --spec-slug is refused`: `resolve({ cwd: main, env: {}, archived: true })` → `ok:false`, `reason: 'archived-unnamed'`.
  - `AC1.1 clarification: --archived adopts a live clean run that archive-run refused`: live `2026-01-03T000000-spec-49` with `{ status: 'clean', worktree: null, pr: { number: 9, url: 'u' } }` and nothing under `archive/` → result path is that live dir. Without `archived` → `unresolved` (the #4151 terminal refusal is unchanged).
  - `newest closed match wins across live-clean and archived`: archived `2026-01-01T000000-spec-50` and live clean `2026-02-01T000000-spec-50`, both with `pr` → the live clean one (newer name). Swap the dates → the archived one.
  - `a live clean dir whose run-id also exists under archive/ is never adopted` (#208 resurrection): the same name `2026-01-04T000000-spec-51` both live-clean-with-pr and under `archive/` with `pr` → the result path is the `archive/` one.
  - The five Review Focus tests named above. Malformed: write `'{'` as the archived `run-state.json` alongside an older valid archived match; the older one wins. Newest-with-pr: the older one has `pr`, the newer does not. Segment: archived `…-spec-3784` with `pr`, query `spec-378` → `unresolved`. Non-canonical: `archive/20260101T000000-spec-47` with `pr` → `unresolved`. Missing archive dir: `pipelines/` exists with no `archive/` → `unresolved`.
  - In `tests/hooks-resolve-run-dir-cli.test.js`: `AC3.1: CLI --archived prints the archived run path, exit 0`. Create an archived `…-spec-48` with a `pr` run-state, then run `['--archived', '--spec-slug', 'spec-48']` with `PIPELINE_RUN_DIR: ''` → code 0 and stdout trimmed equals the archived path. The same args without `--archived` → non-zero.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/hooks-run-dir-resolve.test.js tests/hooks-resolve-run-dir-cli.test.js`
Expected: FAIL. The new `archived: true` cases return `ok:false` with `unresolved`, and `archived-create` is not a known reason.

- [ ] **Step 3: Implement `closedPrMatch(pipelinesRoot: string, specSlug: string): string|null`** in `run-dir-resolve.js`, beside `newestMatch`.
  - **Candidates:**
    - (a) every `RUN_ID_RE` + `hasSegment(name, specSlug)` directory under `path.join(pipelinesRoot, 'archive')`;
    - (b) every such directory directly under `pipelinesRoot` whose `run-state.json` `status` is exactly `'clean'` and whose `archiveStatus(...)` is not `'archived'`.
    
    Read each listing with `withFileTypes`; a read error yields no candidates from that listing.
  - **Selection:** sort all candidates by name, walk them newest-first (on a name tie the archived one wins), and return the first whose `run-state.json` parses (in try/catch) to a plain non-array object whose `pr` is a non-null, non-array object.
  - **Wiring in `resolve`:**
    - Put the two refusals (`archived-create`, `archived-unnamed`) immediately after the `rootOnly` early return, before step 1.
    - After the step-2 block and before `if (opts.create)`, if `opts.archived`, return `ok(match, false)` when `closedPrMatch` finds one. Add a short header comment citing #4677. It should say this exists for `wrap-up/merge-mode.md`, because wrap-up archives a pr-first leave-open run before the human types `merge`. Thread `archived: args.includes('--archived')` in `hooks.js` and append ` [--archived]` to the usage string.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/hooks-run-dir-resolve.test.js tests/hooks-resolve-run-dir-cli.test.js tests/path-guard-conformance.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/hooks/run-dir-resolve.js plugin/bin/hooks.js tests/hooks-run-dir-resolve.test.js tests/hooks-resolve-run-dir-cli.test.js
git commit -m "Add resolve-run-dir --archived — read-only fallback to the newest archived spec run that records a PR (#4677)"
```

### Task 2: Merge-mode prose, flag docs, journey and conformance pins

**Files:**
- Modify: `plugin/skills/wrap-up/merge-mode.md:11-13` ("Resolve the run") and `:43` (the Conflict section's `no-worktree` condition)
- Modify: `plugin/skills/_shared/pipeline-run-dir.md:14` (usage line), plus a new `--archived` bullet after the `--root-only` bullet (`:47-50`)
- Modify: `docs/journeys/merge-a-parked-unattended-pr-3784.md:46` ("Run adoption" bullet)
- Test: `tests/wrap-up-merge-mode-conformance.test.js`

**Interfaces:**
- Consumes: Task 1's CLI form `resolve-run-dir --archived --spec-slug "spec-{n}"` and its read-only, live-wins semantics.

- [ ] **Step 1: Write the failing tests** in `tests/wrap-up-merge-mode-conformance.test.js`:
  - Add to `MERGE_MODE_FACTS`: `'archived-fallback': /resolve-run-dir --archived --spec-slug "spec-\{n\}"/` and `'worktree-at-close': /falls back to `worktreeAtClose` when `worktree` is null/`. The existing `merge-mode.md facts each go red when stripped` test then covers both.
  - `AC4.1: merge-mode.md no longer claims a parked run stays active`: `assert.ok(!read('plugin','skills','wrap-up','merge-mode.md').includes('a parked `pending-review` run stays `status: active`'))`, plus the same assertion for `docs/journeys/merge-a-parked-unattended-pr-3784.md` with `a parked run stays \`status: active\``.
  - `pipeline-run-dir.md documents --archived`: its usage line matches `/\[--root-only\] \[--archived\]/`, and the doc contains `` `--archived` ``.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/wrap-up-merge-mode-conformance.test.js`
Expected: FAIL. The fact table is missing `archived-fallback` and `worktree-at-close`, and AC4.1 fails because the sentence is present at base (`merge-mode.md:11`). That failure is the absence-grep control.

- [ ] **Step 3: Edit the prose.**
  - `merge-mode.md`: after "When nothing resolves," insert the fallback. When the live call resolves nothing, merge mode runs `node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" resolve-run-dir --archived --spec-slug "spec-{n}"` once. Wrap-up's own Phase 4 closes and archives a pr-first run whose merge it left open, so the parked run is usually under `archive/`. That call adopts it read-only, and only a run that records a PR.
  - Keep "merge mode stops and names the record" for when both calls resolve nothing.
  - Replace "a parked `pending-review` run stays `status: active`, so `resume`'s `status: interrupted` precondition never holds for it" with: a parked run is `active` or already closed (`clean`, often archived), never `interrupted`, so `resume`'s precondition never holds for it.
  - In the binding paragraph: "`{worktree-path}` below is that run's `run-state.json` `worktree`; it falls back to `worktreeAtClose` when `worktree` is null (close-run keeps the prior path there)".
  - Add one sentence: an adopted closed run takes every later `decisions.md` write at the path it was adopted from. Step 4.2's reconcile leaves it untouched, because `iterRunDirsWithState` (`plugin/bin/lib/hooks/context.js:255-258`) enumerates only top-level run-id dirs and skips `clean` ones by default.
  - Conflict section (`:43`): replace "when `run-state.json` carries no `worktree`, the path no longer exists" with "when `{worktree-path}` resolves to nothing (no `worktree` and no `worktreeAtClose`), the path no longer exists". Keep the trailing ATTENDED_FACTS `no-worktree` text, "report `pending-review`, reason `no-worktree`, and run no merge in any checkout", byte-identical.
  - `pipeline-run-dir.md`: append `[--archived]` to the usage line. Add a bullet covering `--archived`:
    - It needs `--spec-slug`, and is refused with `--create` or without `--spec-slug`, both checked before step 1.
    - It falls back, only after steps 1-2 resolve nothing, to the newest closed match that records a `pr`: an `archive/` dir, or a live `clean` dir `archive-run` refused.
    - It is read-only, an adoptable step-2 match always wins, and its only caller is `wrap-up/merge-mode.md`.
  - Merge-mode's fallback sentence names both closed shapes: archived, or closed but un-archived.
  - Journey line 46: replace "That is not `resume`: a parked run stays `status: active`." with "That is not `resume`: a parked run is never `interrupted`. When wrap-up already archived it, merge mode adopts it from `archive/` through `resolve-run-dir --archived`."

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/wrap-up-merge-mode-conformance.test.js tests/hooks-run-dir-resolve.test.js`
Then run the AC grep: `grep -F 'a parked `pending-review` run stays `status: active`' plugin/skills/wrap-up/merge-mode.md`
Expected: PASS, 0 failures. The grep prints nothing and exits 1.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/wrap-up/merge-mode.md plugin/skills/_shared/pipeline-run-dir.md docs/journeys/merge-a-parked-unattended-pr-3784.md tests/wrap-up-merge-mode-conformance.test.js
git commit -m "Teach merge mode to adopt an archived parked run — fallback to resolve-run-dir --archived, worktreeAtClose for the worktree path (#4677)"
```

## Spec coverage

| Clause | Covered by |
|---|---|
| AC1.1 | Task 1 `AC1.1` tests, including the real-writer one |
| AC1.2 | Task 1 `AC1.2` (no pr). The `spec: 43` half is the existing `record-binding` fact in `MERGE_MODE_FACTS`, per the human plan-review ruling in the spec's Plan Review Clarifications |
| Deliverable 3 (reconcile no-op) | Cited reading: `context.js:255-258` enumerates only top-level `RUN_ID_RE` dirs and skips `clean` ones by default, so an adopted archive/ or clean run is never visited |
| AC2.1 | Task 1 `AC2.1` |
| AC3.1 | Task 1 CLI `AC3.1`, plus Task 2 `archived-fallback` fact (the prose calls the flag) |
| AC4.1 | Task 2 `AC4.1` |
| AC5.1 | Final verification (`npm test` via `verify.js`) |
