# Residue errors lead with gh's stderr (#5393) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reconcile's recorded residue-error text names why a `gh` call failed (its stderr) instead of a cut-off echo of the full argv.

**Architecture:** One reconcile-local helper, `residueErrorText(err)` in `plugin/bin/lib/reconcile/escalate-residue.js`, builds the failure text from the thrown error object while it is still in hand: stderr first, then a short command form (program + subcommand, never a flag or its value). Every escalate/resolve site that today passes `errorText(err)` into a residue `reason`/`error` uses it instead. `boundedError` (`cache.js`) keeps collapsing to one line and capping at 200 characters, unchanged. The shared `errorText` in `plugin/bin/lib/feedback/file-feedback.js` is untouched (it has other consumers).

**Tech Stack:** Node 18+ CommonJS, `node:test`, no dependencies.

**Spec:** `.claude-tweaks/pipelines/2026-11-14T095432-spec-5393-5392/spec-5393/work/5393-spec.md`

## Global Constraints

- Cap: `RESIDUE_ERROR_MAX_CHARS` stays `200`; the `detail` suffix (#4794) is appended whole, unchanged.
- The recorded text never contains a `--body` value (or any flag value).
- A no-stderr `execFileSync` failure records text beginning `Command failed:` (decided: `Command failed: {short command}`, not today's full-argv message — logged in `spec-5393/decisions.md`).
- Non-exec errors (plain `Error('HTTP 502')`, thrown strings, `undefined`) keep exactly today's `errorText` text — existing tests pin `'HTTP 502'`, `'rate limited'`, `'boom'`, `'gh: not found'`, `/gh: command not found/`.
- `plugin/bin/lib/feedback/file-feedback.js` is not modified.
- Commit style: `{Verb} {what} — {detail}`, trailer `Claude-Session: https://claude.ai/code/session_01X7gPF9XHCpwWz1g3CTGtMY`.
- Governing skill `.claude/skills/gh-api-module-pattern/batching-failure-posture.md`, quoted: "A cap is not enough when the text becomes a reason a person reads or a filed issue carries: the argv comes first, so a cap keeps the command line (for a claim write, the base64 claim payload) and cuts GitHub's answer. Remove the line instead." and "Test with an error in the real shape, as the `real-shape refusal` case in `tests/bin-lib/claim-targets/claim-targets.test.js` does: a fake returning a clean `HTTP 403: …` passes with or without the cleaner." and "Never cap text whose remedy comes last, such as an origin-host gate refusal (215-340 characters ending in its `GH_HOST` advice): collapse its whitespace, cap only the error beside it, and append the refusal whole."
- Why not reuse `claim-store.js`'s `refusalText` (#4899): it cleans the already-joined `errorText` string, dropping only lines that start `Command failed:`; a `--body` holding a newline puts body lines below that line, where they survive. Building from the error object (`err.stderr`, the message's first line only) has no such leak.

Waived AC4.1: it asks that existing tests keep passing, so no new test step cites it; Task 2 Step 4 runs the existing reconcile suites and must pass.

## Review Focus

- `err.stderr` as a `Buffer` (a runner without `encoding`) → treated as its UTF-8 text, never `[object Buffer]` or a byte list.
- Whitespace-only stderr (`'\n'`, `'  '`) → treated as empty (the `Command failed:` form), never a leading blank.
- An error object carrying stderr but no `Command failed:` message prefix (an injected runner's own error) → stderr alone, no empty `()` suffix.
- A timeout kill (`code: 'ETIMEDOUT'`, message `spawnSync gh ETIMEDOUT`, no stderr) → today's `errorText` text, unchanged.
- A long multi-line stderr → still one line and ≤200 characters after `boundedError` (the cap applies to the whole helper output).
- A `--body` value holding a newline (residue bodies are multi-line) → no body line reaches the text; only the message's first line is read.

---

### Task 1: `residueErrorText` helper

**Files:**
- Modify: `plugin/bin/lib/reconcile/escalate-residue.js` (add the helper near the `errorText` import at ~line 42; export it)
- Test: `tests/bin-lib/reconcile/escalate-residue.test.js`

**Interfaces:**
- Consumes: `errorText(err)` from `../feedback/file-feedback` (already imported).
- Produces: `residueErrorText(err: unknown) -> string`, exported from `escalate-residue.js`. Rules, in order:
  1. Not an object (string, `undefined`, number) → `errorText(err)`.
  2. `stderr` = `String(err.stderr ?? '')` (a `Buffer` stringifies as UTF-8), trimmed.
  3. `short` = when `String(err.message)`'s first line starts with `Command failed: `, the whitespace-split tokens after that prefix up to (not including) the first token starting with `-`, at most 4, joined by one space; else `null`.
  4. stderr non-empty → `short ? `${stderr} (${short})` : stderr`.
  5. stderr empty and `short` → `Command failed: ${short}`.
  6. Otherwise → `errorText(err)`.
  Output is not collapsed or capped here — `boundedError` does that.

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/reconcile/escalate-residue.test.js`, importing `residueErrorText`:
  - `residueErrorText: exec failure with stderr leads with stderr, then the short command` — fixture `execErr(stderr)` = `Object.assign(new Error('Command failed: gh issue comment 2724 --repo o/r --body ' + 'x'.repeat(300) + '\n' + stderr), { status: 1, stderr, stdout: '' })`; with `stderr = 'HTTP 403: secondary rate limit\n'` assert `=== 'HTTP 403: secondary rate limit (gh issue comment 2724)'`.
  - `residueErrorText: exec failure with empty stderr is 'Command failed:' plus the short command` — `execErr('')` → `=== 'Command failed: gh issue comment 2724'`; same for `execErr('  \n')`.
  - `residueErrorText: never carries a flag value` — for both fixtures above assert `!text.includes('xxxx')` and `!text.includes('--repo')`.
  - `residueErrorText: Buffer stderr reads as text` — `Object.assign(new Error('Command failed: gh api x'), { stderr: Buffer.from('HTTP 404: Not Found') })` → `=== 'HTTP 404: Not Found (gh api x)'`.
  - `residueErrorText: stderr without a Command failed prefix is stderr alone` — `Object.assign(new Error('boom'), { stderr: 'denied' })` → `=== 'denied'`.
  - `residueErrorText: non-exec errors keep errorText` — `new Error('HTTP 502')` → `'HTTP 502'`; `'gh: not found'` (a string) → `'gh: not found'`; `Object.assign(new Error('spawnSync gh ETIMEDOUT'), { code: 'ETIMEDOUT' })` → `'spawnSync gh ETIMEDOUT'`; `undefined` → `'undefined'`.
  - `residueErrorText: caps the command at 4 tokens` — `Object.assign(new Error('Command failed: gh api graphql repos o r'), { stderr: 'x' })` → `=== 'x (gh api graphql repos)'`.
  - `residueErrorText: a multi-line --body leaks no body line` — `Object.assign(new Error('Command failed: gh issue comment 1 --body line-one\nSECRET-BODY-LINE\nHTTP 403: x'), { stderr: 'HTTP 403: x\n' })` → `=== 'HTTP 403: x (gh issue comment 1)'`; same message with `stderr: ''` → `=== 'Command failed: gh issue comment 1'`; assert neither contains `SECRET-BODY-LINE`.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/bin-lib/reconcile/escalate-residue.test.js`
Expected: FAIL — `residueErrorText is not a function`.

- [ ] **Step 3: Implement and export `residueErrorText(err)`** in `escalate-residue.js` per the Interfaces rules.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/bin-lib/reconcile/escalate-residue.test.js`
Expected: PASS, every test including the pre-existing ones.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/reconcile/escalate-residue.js tests/bin-lib/reconcile/escalate-residue.test.js
git commit -m "Add residueErrorText — stderr-first failure text with a short command and no flag values (#5393)"
```

### Task 2: Route every residue failure through `residueErrorText`

**Files:**
- Modify: `plugin/bin/lib/reconcile/escalate-residue.js` (the 8 `reason: errorText(err)` sites, ~lines 270, 278, 298, 365, 397, 443, 465, 492)
- Modify: `plugin/bin/lib/reconcile/cache.js` (the import at line 21 and the 3 `errorText(err)` catch sites at ~lines 338, 386, 436)
- Test: `tests/bin-lib/reconcile/cache.test.js`
- Waived `plugin/bin/lib/feedback/file-feedback.js`: the spec's "if the fix lands there" condition does not hold — the fix lands in the reconcile layer (decided and logged); Task 1's helper reads its `errorText` as the fallback and the file is not changed.
- Consumer enumeration: an `escalation-failed`/`resolution-failed` result's `reason` is read only by `cache.js:382` (`recordResidueError(..., { error: result.reason })`); `archive-merged.js` and `reap-merged.js` route through `cache.js`'s `trackResidue`/`clearResidue` and never read `reason` themselves (`git grep -n "escalation-failed\|resolution-failed" -- plugin/bin`).

**Interfaces:**
- Consumes: `residueErrorText` from Task 1 (`require('./escalate-residue')`).
- Produces: no new exports. `cache.js` no longer imports `errorText`; drop it from the destructure if no other use remains. `escalate-residue.js` keeps exporting `errorText` (callers outside this change may import it).

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/reconcile/cache.test.js`, reusing the file's existing tracked-entry setup (the #4180 `lastResidueError` tests near lines 541-672) and the Task 1 `execErr` fixture shape:
  - `AC1.1 AC1.2 AC3.1: an escalation runner failure records gh's stderr, capped, without the --body` — drive an escalation to the one-shot escalate (as the existing `'rate limited'` escalate test does) with a runner that throws `execErr('HTTP 403: secondary rate limit\n')`; assert `lastResidueError.reason` includes `'HTTP 403: secondary rate limit'`, `.length <= 200`, and `!reason.includes('xxxx')`.
  - `AC2.1 AC3.1: an escalation failure with empty stderr records 'Command failed:'` — same with `execErr('')`; assert `reason.startsWith('Command failed:')` and `!reason.includes('xxxx')`.
  - `AC1.2 AC3.1: a resolve runner failure records gh's stderr` — drive the resolve path (as the existing `'HTTP 502'` resolve test does) with a runner throwing `execErr('HTTP 403: secondary rate limit\n')`; assert the same three properties on `lastResidueError.reason`.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/bin-lib/reconcile/cache.test.js`
Expected: FAIL — the new tests' `reason` begins `Command failed: gh … --body xxxx…` and lacks the stderr.

- [ ] **Step 3: Swap the call sites** — replace `errorText(err)` with `residueErrorText(err)` at the 8 `escalate-residue.js` sites and the 3 `cache.js` sites; update `cache.js`'s import.

- [ ] **Step 4: Run the reconcile suites**

Run: `node --test tests/bin-lib/reconcile/cache.test.js tests/bin-lib/reconcile/escalate-residue.test.js tests/bin-lib/reconcile/residue-summary.test.js tests/reconcile-archive-residue.test.js`
Expected: PASS (AC4.1), including every pre-existing `lastResidueError` assertion (`'HTTP 502'`, `'rate limited'`, `'boom'`, `'gh: not found'`, `'unknown-host (R)'`).

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/reconcile/escalate-residue.js plugin/bin/lib/reconcile/cache.js tests/bin-lib/reconcile/cache.test.js
git commit -m "Record residue failures through residueErrorText — gh's stderr survives the 200-character cap (#5393)"
```
