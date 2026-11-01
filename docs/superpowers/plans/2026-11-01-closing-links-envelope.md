# closing-links Envelope Object Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `post-merge.js` reads closing-links' post-merge envelope as an object returned by an exported core function, instead of driving the CLI and re-parsing its stdout.

**Architecture:** `plugin/bin/closing-links.js` gains an exported core, `closingLinks(opts, overrides)`, that does everything `run()` does today after argument parsing and returns `{ code, envelope }` without printing. `run(argv, overrides)` becomes a thin printer over it: parse, `--help`, required-flag checks (exit 2), then call the core and print `JSON.stringify(envelope)` + `\n` when `code === 0`. `plugin/bin/lib/reconcile/post-merge.js` calls the core with an options object and branches on the returned object, so `parseEnvelope` and the "unreadable envelope" state disappear.

**Tech Stack:** Node 18+ CommonJS, `node --test` (built in), no new dependencies.

**Spec:** `.claude-tweaks/pipelines/2026-11-01T204931-record-4781/work/4781-spec.md` (record #4781)

## Global Constraints

- Commit message style: `{Verb} {what} — {detail}` (imperative, no conventional-commit prefix), with `refs #4781` in the body. Never `closes`/`fixes #4781`.
- Every commit ends with the line `Claude-Session: https://claude.ai/code/session_016yg3zoN7tBVHYZNM7N7Wbd`.
- Use `git -C "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude/worktrees/dispatch-record-4781" …` for every git call. Never `git stash` in any form, never `git reset`/`git checkout .`. Stage files by explicit path.
- Run only the task's targeted suites; the full `npm test` runs centrally.
- `plugin/bin/lib/flow/closing-links.js` (the pure matcher/neutralizer) is not changed — the core does gh I/O, so it lives in `plugin/bin/closing-links.js`. (AC1.1 allows either file.)
- Governing project skill `gh-api-module-pattern` (`.claude/skills/gh-api-module-pattern/cli-wrapper-contract.md`), quoted verbatim: "**A module that calls a CLI's `run(argv, deps)` in-process and branches on one of its exit codes imports that code from the CLI, and so does any bound it re-applies.** … Export the code from the CLI module in the same change that adds the first in-process caller branching on it." → `post-merge.js` keeps importing `EXIT_GH_FAILURE` and `ERR_TEXT_MAX` from `../../closing-links`; never a bare `5` or `300`.
- Same skill, verbatim: "**A CLI that reports a decision as data logs that entry itself; the skill hand-logs it only when the CLI reports the append failed.**" → the core keeps appending its own `decisions.md` entries (the `unchecked()` SKIP for gh-absent / exit 4 / exit 5, and every `log`/`degraded` line); `run()` adds no logging.
- Same skill, verbatim: "Tests never touch real `gh`: fake runners branch on the `args` shape … and `throw new Error('unexpected ' + args.join(' '))` on anything unhandled".

## Review Focus

1. **Printed bytes unchanged.** Every action the CLI printed before (pre-merge and post-merge, `logFailed` included) prints the identical JSON line after — the existing `closing-links-cli.test.js` cases all drive `run()` and stay green unmodified; Task 1 adds a core-vs-`run()` deep-equal for one action per mode.
2. **The core never writes stdout.** An in-process caller passes no `stdout`; a core that still printed would leak JSON into the reconcile pass's output. Task 1 asserts `out` stays empty; Task 2 asserts post-merge passes no `stdout` dep.
3. **Non-zero exits still log and still return no envelope.** Exit 3 returns `{ code: 3, envelope: null }` and logs nothing; exit 5 returns `{ code: 5, envelope: null }` and still appends its `/wrap-up` SKIP. Task 1 tests both.
4. **A throwing core still becomes post-merge's `error` skip** with the claim released and no marker. Task 2 keeps that test, re-shaped to the new call.
5. **`--help` and usage errors never reach the core** (exit 0 / exit 2, no gh call). Existing tests `--help exits 0 without touching gh` and `usage errors exit 2` cover it unchanged.

---

### Task 1: closing-links core function

**Role:** integration

**Files:**
- Modify: `plugin/bin/closing-links.js` (header comment lines 1-79; `run` lines 178-505; `module.exports` line 507)
- Test: `tests/bin-lib/flow/closing-links-cli.test.js`
- Waived plugin/bin/lib/flow/closing-links.js: the spec's AC1.1 allows the core in either file; it does gh I/O, so it lives in the bin file and the pure matcher module is only read (its exports are imported unchanged by Step 3's core).

**Interfaces:**
- Produces: `closingLinks(opts, overrides = {}) -> { code: number, envelope: object | null }`, exported from `plugin/bin/closing-links.js` beside `run`, `parseArgs`, `EXIT_GH_FAILURE`, `ERR_TEXT_MAX`.
  - `opts = { run: string, mode: 'pre-merge' | 'post-merge', settleMs = DEFAULT_SETTLE_MS, closeWindowMs = null }` — already-validated values (no parsing inside the core).
  - `overrides` is the same deps seam `run` takes today (`{ ...realDeps, ...overrides }`).
  - `envelope` is exactly the object `run` used to `JSON.stringify` (including `logFailed: true` when set); non-null iff `code === 0`. Exits 3, 4 and 5 return `envelope: null`, with their stderr lines and SKIP appends unchanged.
- `run(argv, overrides = {}) -> number`: unchanged signature and behavior.

- [ ] **Step 1: Write the failing tests** — add to `tests/bin-lib/flow/closing-links-cli.test.js` (import `closingLinks` in the existing `require` line), reusing `fixture`, `makeDeps`, `body`, `mergedView`, `preView`, `POST`, `PRE`, `CLOSED_AFTER`:

```js
test('AC1.1/AC1.2: closingLinks returns the post-merge envelope run() prints, and prints nothing itself', () => {
  const setup = () => {
    const { main, runDir } = fixture({ pr: { number: 7 } });
    const h = makeDeps(main, { prReads: [mergedView(body(), [2724, 3997])], issues: { 2724: [{ state: 'CLOSED', closedAt: CLOSED_AFTER }] } });
    return { runDir, h };
  };
  const a = setup();
  assert.equal(run(['--run', a.runDir, ...POST], a.h.deps), 0);
  const b = setup();
  const r = closingLinks({ run: b.runDir, mode: 'post-merge' }, b.h.deps);
  assert.equal(r.code, 0);
  assert.deepEqual(r.envelope, a.h.json());
  assert.equal(r.envelope.action, 'reopened');
  assert.deepEqual(b.h.out, []);
});

test('AC1.1: closingLinks returns the pre-merge envelope run() prints', () => {
  // same shape as above with preView(body(), [3997]) and mode 'pre-merge'; assert code 0, deepEqual to run()'s JSON, out empty
});

test('AC1.1: closingLinks exit 5 returns no envelope and still logs its /wrap-up SKIP', () => {
  const { main, runDir } = fixture({ pr: { number: 7 } });
  const h = makeDeps(main, { prReads: [new Error('network down')] });
  assert.deepEqual(closingLinks({ run: runDir, mode: 'post-merge' }, h.deps), { code: 5, envelope: null });
  assert.deepEqual(h.out, []);
  assert.match(h.log(runDir), /SKIP .*Closing links \(post-merge\) \(degraded\)/);
});

test('AC1.1: closingLinks exit 3 (missing run dir) returns no envelope', () => {
  // fixture's main + a non-existent run dir path; assert { code: 3, envelope: null }, h.calls empty
});
```

The two bodies given as comments follow the shape of the test directly above them; write them out in full.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/bin-lib/flow/closing-links-cli.test.js`
Expected: FAIL with `TypeError: closingLinks is not a function` in the four new tests; every existing test passes.

- [ ] **Step 3: Implement `closingLinks(opts, overrides)` in `plugin/bin/closing-links.js`**

Move everything in `run` from step 2 (run-dir anchoring) to the end into `closingLinks`, reading `o.run`/`o.mode`/`o.settleMs`/`o.closeWindowMs` from `opts` with the two defaults applied. Replace `print(body)` / `done(envelope)` with returns of `{ code: 0, envelope: … }` (`done` keeps adding `logFailed: true`), and every `return 3` / `return 4` / `ghFailed(...)` with `{ code, envelope: null }`. `run` keeps step 1 (parse, `--help`, the two required-flag checks), then calls `closingLinks(o, overrides)` and, when `code === 0`, writes `${JSON.stringify(envelope)}\n` via `deps.stdout`; returns `code`. Update the header comment: name `closingLinks` as the core in-process callers use, state the `{ code, envelope }` contract (envelope non-null iff code 0, the same object the CLI prints), and that `run` is a thin printer over it.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/flow/closing-links-cli.test.js tests/closing-links-prose-conformance.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Commit**

```bash
git -C "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude/worktrees/dispatch-record-4781" add plugin/bin/closing-links.js tests/bin-lib/flow/closing-links-cli.test.js
git -C "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude/worktrees/dispatch-record-4781" commit -m "Export closing-links' core as closingLinks() — run() prints its envelope object" -m "refs #4781" -m "Claude-Session: https://claude.ai/code/session_016yg3zoN7tBVHYZNM7N7Wbd"
```

### Task 2: post-merge consumes the envelope object

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/reconcile/post-merge.js` (header lines 7-9 and 24-33; `parseEnvelope` lines 235-243; `processRun` lines 365-417)
- Test: `tests/bin-lib/reconcile/post-merge.test.js`

Consumers of `deps.closingLinksRun` / `closingLinksRun` (enumerated by grep): `post-merge.js` only; its fakes live only in `post-merge.test.js`.

**Interfaces:**
- Consumes: `closingLinks(opts, overrides) -> { code, envelope }` from Task 1, imported as `const { closingLinks, EXIT_GH_FAILURE, ERR_TEXT_MAX } = require('../../closing-links');`. The `deps.closingLinksRun` injection seam keeps its name and now takes `(opts, overrides)`.
- Produces: `postMerge` entries unchanged in shape; the `closingLinks: 'an unreadable envelope'` value can no longer occur.

- [ ] **Step 1: Update the tests to the new seam (failing first)** in `tests/bin-lib/reconcile/post-merge.test.js`:
  - `fakeClosingLinks(envelope, code = 0)` becomes `(opts, d) => { calls.push({ opts, deps: d }); return { code, envelope: code === 0 ? envelope : null }; }`.
  - In `'merged unmarked run: Step 4.0 argv, …'` (rename `argv` → `options` in the title) replace the argv deep-equal with
    `assert.deepEqual(links.calls[0].opts, { run: dir, mode: 'post-merge', settleMs: 0, closeWindowMs: CLOSE_WINDOW_MS });` and add `assert.ok(!('stdout' in d), 'the core prints nothing, so post-merge passes no stdout');`.
  - `'claim: a closing-links runner that throws …'`: the inline runner becomes `(opts) => { n += 1; if (opts.run === bad) throw new Error('kaboom'); return { code: 0, envelope: ENVELOPE }; }`.
  - M4: `links.calls[0].argv[1]` → `links.calls[0].opts.run`.
  - Delete test `'K4: an exit-0 envelope with neither closingSet nor action is labelled unreadable …'`.
  - `'step40Failed marks a non-zero exit and an unreadable exit-0 envelope, …'` → rename to `'step40Failed marks a non-zero exit, never a readable envelope without a closing set'`; replace its unreadable half with a `fakeClosingLinks(null, 3)` run asserting `{ runDir: dir, pr: 11, action: 'ran', closingLinks: 'exit 3', parentsClosed: 0, step40Failed: true }`; keep the not-merged and ok halves.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/bin-lib/reconcile/post-merge.test.js`
Expected: FAIL — the options deep-equal receives the argv array, and runs that expect `ran` read the returned object as `exit undefined`/unreadable.

- [ ] **Step 3: Implement in `plugin/bin/lib/reconcile/post-merge.js`**

`processRun` calls `const { code, envelope } = runClosingLinks({ run: dir, mode: 'post-merge', settleMs: 0, closeWindowMs: CLOSE_WINDOW_MS }, { cwd: () => root, mainRoot: root, ghAvailable: () => true, gh: timedGh, stderr: () => {} });` (no `out` buffer, no `stdout`). Delete `parseEnvelope`. In the no-closing-set branch: `const returned = code !== 0 ? \`exit ${code}\` : envelope.action;`, `const baseUnchecked = code === 0 && envelope.baseUnchecked === true;`, and the entry flag becomes `...(code !== 0 || baseUnchecked ? { step40Failed: true } : {})`. Update the comment above that `write` (drop "an unreadable envelope"), header line 8 (Step 4.0 runs through `bin/closing-links.js`'s `closingLinks()` core, in-process) and header line 33 (drop "as is an unreadable exit-0 envelope").

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/reconcile/post-merge.test.js tests/bin-lib/flow/closing-links-cli.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Commit**

```bash
git -C "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude/worktrees/dispatch-record-4781" add plugin/bin/lib/reconcile/post-merge.js tests/bin-lib/reconcile/post-merge.test.js
git -C "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude/worktrees/dispatch-record-4781" commit -m "Have post-merge consume closingLinks()'s envelope object — parseEnvelope and the unreadable-envelope state are gone" -m "refs #4781" -m "Claude-Session: https://claude.ai/code/session_016yg3zoN7tBVHYZNM7N7Wbd"
```

### Task 3: Sweep stale references to the retired state

**Role:** transcription

**Files** (from the sweep grep below, run on the pre-change tree):
- Modify: `plugin/bin/hooks.js:1881` — comment becomes `// Runs whose steps did not complete: Step 4.0 itself failed (non-zero exit or an unread base: a SKIP`
- Modify: `docs/reconcile-checks.md:662` — `are deterministic, as is an unreadable exit-0 envelope; exit 4 is pre-merge only.` → `are deterministic; exit 4 is pre-merge only.` (re-wrap the paragraph's lines only as needed)
- Modify: `docs/reconcile-checks.md:721-723` — drop the clause `, or an unreadable envelope` so it reads `… exit 5 or a \`base-unchecked\` envelope only once its retries are spent, a SKIP marker is written, …`
- Modify: `tests/bin-lib/hooks/reconcile-background.test.js:252` — fixture `/r/f` uses `closingLinks: 'exit 3'` instead of `'an unreadable envelope'`; the asserted counts stay the same.
- Modify: `.claude/skills/gh-api-module-pattern/cli-wrapper-contract.md:44` — `runs \`closing-links.js\`'s \`run\` and retries` → `runs \`closing-links.js\`'s exported \`closingLinks\` core (an object return since #4781, no stdout parse) and retries`; the rest of the bullet is unchanged.

- [ ] **Step 1: Apply the five edits above.**

- [ ] **Step 2: Verify the sweep is complete**

Run: `git -C "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude/worktrees/dispatch-record-4781" grep -n -i -e "parseEnvelope" -e "unreadable envelope" -e "unreadable exit-0" -e "closing-links.js\`'s \`run\`" -- ":!.claude-tweaks/pipelines" ":!docs/superpowers/plans" ":!docs/plans/*-ledger.md"`
Expected: no output, exit 1. (Control, run at authoring time against the pre-change tree: this exact command matched 13 lines across `cli-wrapper-contract.md`, `docs/reconcile-checks.md`, `hooks.js`, `post-merge.js`, `reconcile-background.test.js` and `post-merge.test.js`. The three pathspec exclusions were added per #4579.)

- [ ] **Step 3: Run the affected suites**

Run: `node --test tests/bin-lib/hooks/reconcile-background.test.js tests/bin-lib/reconcile/post-merge.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 4: Commit**

```bash
git -C "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude/worktrees/dispatch-record-4781" add plugin/bin/hooks.js docs/reconcile-checks.md tests/bin-lib/hooks/reconcile-background.test.js .claude/skills/gh-api-module-pattern/cli-wrapper-contract.md
git -C "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude/worktrees/dispatch-record-4781" commit -m "Sweep the retired unreadable-envelope state from docs, comments and fixtures — post-merge reads closingLinks() directly" -m "refs #4781" -m "Claude-Session: https://claude.ai/code/session_016yg3zoN7tBVHYZNM7N7Wbd"
```

## Spec coverage

| Clause | Covered by |
|---|---|
| AC1.1 core function returns the post-merge envelope | Task 1 tests `AC1.1/AC1.2: …`, `AC1.1: …` (×3) |
| AC1.2 the CLI prints that object unchanged | Task 1 test `AC1.1/AC1.2: …` + the unmodified existing `run()` suite |
| AC2.1 post-merge calls the core, no stdout parse, parseEnvelope and unreadable state gone | Task 2 (options deep-equal, no-stdout assertion, K4 deleted) + Task 3 Step 2 absence grep |
| AC3.1 `npm test` passes incl. `closing-links-cli.test.js` | Central full-suite run after Task 3 (orchestrator) |
