# hooks.js `--flag=value` Form Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let every `plugin/bin/hooks.js` verb accept `--name=value` for each flag in `VALUE_FLAGS`, so a worktree-isolated session can mark a multi-spec spec finished with a plain `spec-status ... --status=complete ...` instead of the composed `node -e` workaround.

**Architecture:** One pure helper, `expandValueFlags(args)`, rewrites each `--name=value` token whose `name` is in `VALUE_FLAGS` into the two tokens `--name`, `value` (split on the first `=`). `main()` applies it once to the verb's arguments, before the flag-strict guard and before dispatch, so `firstUnknownFlag`, `resolveRunArg` and every `flagVal` call all read the same expanded list and the spaced form is untouched. The skill prose then switches the completion call to the plain `=` form.

**Tech Stack:** Node 18+ CommonJS, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-29T003937-record-4353/work/4353-spec.md` (record #4353)

Scope keywords: firstUnknownFlag, --status complete, multispec-progress-banner

## Global Constraints

- Deliverable 1 probe already ran in this live worktree-isolated session on 2026-10-29: `node /abs/plugin/bin/hooks.js spec-status --run /abs/parent --spec 1 --status=complete --phase wrap-up` was not refused by the guard (it reached hooks.js and printed hooks.js's own usage line), and the spaced `--status complete` form was refused with "runs a string through complete, which can't be verified to stay inside the worktree". The passing path applies; Deliverable 4 does not.
- "teach `hooks.js` the `--flag=value` form for every flag in `VALUE_FLAGS`, uniformly across `flagVal`, `firstUnknownFlag` and `resolveRunArg`'s `--run` lookup, so one rule covers every verb rather than `spec-status` alone. The spaced form keeps working unchanged."
- "Keep `VALUE_FLAGS` as the single list of flags that take a value." Flags outside `VALUE_FLAGS` (`--worktree`, `--spec-slug`, `--mode`, `--record`, `--checks`, boolean flags such as `--dispatch`) are not split.
- `--x=` (empty value) is exactly `--x ''`: each verb's existing empty-value handling applies (spec-status prints its usage line; an empty `--run` is rejected as "--run requires a value").
- Expand-contract: the parser and the doc switch ship in the same release (both are in the `plugin/` payload), and the PR's Release Note says so.
- Commit message style: `{Verb} {what} — {detail}`, ending with "refs #4353" (never "closes"/"fixes") and the `Claude-Session:` trailer.
- Run `pwd` and `git rev-parse --show-toplevel` as plain commands before any commit; both must print `/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude/worktrees/dispatch-record-4353`. Never `git stash`.

## Review Focus

1. A value that itself contains `=` (`--run=/tmp/a=b/run`): split on the first `=` only, so the path survives whole. Test in Task 1.
2. A boolean flag written with `=` (`record-worktree --dispatch=x`): not in `VALUE_FLAGS`, so it stays one undeclared token and the flag-strict guard prints usage instead of running. Test in Task 1.
3. A declared value flag that this verb does not accept (`record-worktree --status=x`): expands, then the guard refuses `--status` for that verb. Covered by the same guard path as 2; no separate test.
4. `--run=` with an empty value on a resolveRunArg verb: rejected as `--run requires a value`, never a silent fallback to implicit run resolution. Test in Task 1.
5. A hook event (`pre-tool-use` etc.) never has its argv rewritten — expansion runs only for a `VERBS`-table verb. No test (events take no flags).

---

### Task 1: `expandValueFlags` in hooks.js

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/hooks.js` (`VALUE_FLAGS` at ~195, new helper beside `firstUnknownFlag`/`flagVal` at ~197-219, `main()` at ~1894-1924)
- Test: `tests/hooks-spec-status.test.js`
- Test: `tests/hooks-help-guard.test.js`
- Waived `tools/guard-refusals/shapes.js`: reference only — its `complete-token` detector (`wholeWord('complete')`) is read, not changed; Task 2 Step 5 runs its suites.

**Interfaces:**
- Produces: `function expandValueFlags(args: string[]): string[]` (module-private) — returns a new array; each string token that starts with `--`, contains `=`, and whose part before the first `=` is in `VALUE_FLAGS` becomes `[name, value]`; every other token passes through unchanged.
- Produces (behavior): `main()` computes `const args = verb ? expandValueFlags(argv.slice(3)) : argv.slice(3)` and hands verbs `[...argv.slice(0, 3), ...args]`; the flag-strict guard runs on `args`.

- [ ] **Step 1: Write the failing tests in `tests/hooks-spec-status.test.js`** (append, reusing the file's `runHook` and `runDirWithManifest`)

```js
function bothForms(spacedArgs, equalsArgs, prep) {
  const a = runDirWithManifest([{ id: 159, status: 'pending' }]);
  const b = runDirWithManifest([{ id: 159, status: 'pending' }]);
  if (prep) { prep(a); prep(b); }
  const ra = runHook(spacedArgs(a), { cwd: a });
  const rb = runHook(equalsArgs(b), { cwd: b });
  return { ra, rb, ma: readManifest(a).multispec.specs[0], mb: readManifest(b).multispec.specs[0] };
}

test('AC2.1: --status=complete and --status complete produce the same manifest transition and banner', () => {
  const start = (run) => runHook(['spec-status', '--run', run, '--spec', '159', '--status', 'running', '--phase', 'build', '--now', '2026-05-16T14:00:00.000Z'], { cwd: run });
  const { ra, rb, ma, mb } = bothForms(
    (r) => ['spec-status', '--run', r, '--spec', '159', '--status', 'complete', '--phase', 'wrap-up', '--now', '2026-05-16T14:12:34.000Z'],
    (r) => ['spec-status', '--run', r, '--spec', '159', '--status=complete', '--phase', 'wrap-up', '--now', '2026-05-16T14:12:34.000Z'],
    start,
  );
  assert.equal(rb.stdout, '## Flow: Running wrap-up (1/1) — spec #159\nspec #159: complete — deferred (12m34s)\n');
  assert.equal(rb.stdout, ra.stdout);
  assert.equal(mb.status, 'complete');
  assert.equal(mb.status, ma.status);
});

test('AC2.2: --run=<dir> / --run <dir> and --spec=<n> / --spec <n> produce the same transition and banner', () => {
  const { ra, rb, ma, mb } = bothForms(
    (r) => ['spec-status', '--run', r, '--spec', '159', '--status', 'running', '--phase', 'build'],
    (r) => ['spec-status', `--run=${r}`, '--spec=159', '--status=running', '--phase=build'],
  );
  assert.equal(rb.stdout, '## Flow: Running build (1/1) — spec #159\n');
  assert.equal(rb.stdout, ra.stdout);
  assert.equal(mb.status, 'running');
  assert.equal(mb.status, ma.status);
});
```

Plus three more tests in the same file, each asserting the manifest is unchanged (`status` still `pending`) and no `## Flow:` banner is printed:
- `'AC3.1: --status= with an empty value is a usage error, not a silent empty status'` — args `['spec-status', '--run', run, '--spec', '159', '--status=', '--phase', 'build']`; stdout matches `/usage: spec-status/`.
- `'--run= with an empty value is rejected, never a fallback to implicit resolution'` — args `['spec-status', '--run=', '--spec', '159', '--status', 'running', '--phase', 'build']`; stdout matches `/--run path rejected: --run requires a value/`.
- `'--run=<dir> keeps a value that itself contains = (split on the first = only)'` — fixture project created with `fs.mkdtempSync(path.join(os.tmpdir(), 'ct-specstatus-a=b-'))` (add an optional `prefix` parameter to `runDirWithManifest`, default `'ct-specstatus-'`); args `['spec-status', `--run=${run}`, '--spec', '159', '--status', 'running', '--phase', 'build']`; stdout is `'## Flow: Running build (1/1) — spec #159\n'` and status becomes `running` (this one asserts the transition, not "unchanged").

- [ ] **Step 2: Write the failing tests in `tests/hooks-help-guard.test.js`** (append, reusing its `runHook` and `projectWithRun`)

- `'AC3.1: an undeclared --bogus=x is still refused by the unknown-flag guard'` — `spec-status --run <run> --spec 1 --status=running --phase build --bogus=x`, cwd the project: exit 0, stdout `claude-tweaks: usage: ${USAGE['spec-status']}\n`, and `run-state.json` byte-identical before and after.
- `'a boolean flag written with = (--dispatch=x) is an undeclared token, refused by the guard'` — `record-worktree --run <run> --dispatch=x <dir>`: exit 0, stdout `claude-tweaks: usage: ${USAGE['record-worktree']}\n`, `run-state.json` byte-identical.

- [ ] **Step 3: Run the new tests to verify they fail**

Run: `node --test tests/hooks-spec-status.test.js tests/hooks-help-guard.test.js`
Expected: FAIL — AC2.1, AC2.2, the `a=b` test and the empty `--run=` test fail (today `--status=complete`/`--run=…` are unknown flags, so the guard prints the bare usage line and nothing transitions). The AC3.1 `--status=`, `--bogus=x` and `--dispatch=x` tests already pass (they pin behavior that must survive the change).

- [ ] **Step 4: Implement `expandValueFlags` and wire it into `main()`**

Add the helper next to `firstUnknownFlag` with a short comment naming #4353 (the worktree guard refuses the whole word `complete`; `--status=complete` is one shell word it does not match). In `main()`, compute the expanded `args` once for a verb and use it for both the `-h`/`firstUnknownFlag` guard and the `argv` passed to `verb.run`; hook events keep `argv` as-is. Update the `VALUE_FLAGS` comment to say these flags also accept `--name=value`. `flagVal`, `firstUnknownFlag` and `resolveRunArg` need no change — they receive expanded arguments.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test tests/hooks-spec-status.test.js tests/hooks-help-guard.test.js tests/hooks-dispatcher.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/hooks.js tests/hooks-spec-status.test.js tests/hooks-help-guard.test.js
git commit -m "Teach hooks.js the --flag=value form — every VALUE_FLAGS flag, expanded once in main(); refs #4353"
```

### Task 2: Document the probe and switch the completion call

**Role:** integration

**Files:**
- Modify: `plugin/skills/_shared/scratch-worktree.md` (§7 table, the `complete`-token row at ~250, plus one new row after it)
- Modify: `plugin/skills/flow/multispec-progress-banner.md` (the "Per-spec completion summary" paragraph and its `node -e` fence, ~22-28)
- Modify: `plugin/skills/flow/multispec-review-console.md` (re-entry step 4's `spec-status ... --status complete` call — spec premise said step 4 names no `spec-status` call; it now does, so the same refused shape is switched here too)
- Test: `tests/scratch-worktree-shell-constraint-table.test.js`
- Modify: `tests/flow-pass-reentry-conformance.test.js` (~95: its re-entry token list pins `'--status complete'` against `multispec-review-console.md`; change that entry to `'--status=complete'`)
- Run unchanged: `tests/skill-fence-guard-shapes.test.js` (Step 5, AC4.1).
- Run unchanged: `tests/guard-refusals/shapes.test.js` (Step 5).
- No change: `tests/fixtures/guard-refusals/banned-shapes.md` — frozen fixture; its `--status complete` stays flagged (Step 5).
- No change (Check B hits, citations of the banner file by name only): `plugin/skills/flow/multi-spec.md`, `plugin/skills/flow/multispec-failure-handling.md`, `plugin/skills/dispatch/sequential-execution.md`, `docs/plugin-structure.md`.
- Waived `tests/timing-prose-conformance.test.js`: named by the spec's Gotchas as a banner-prose pin; run in Step 5, edited only if it goes red.
- Waived `tests/flow-mixed-execution-convention.test.js`: named by the spec's Gotchas as a banner-prose pin; run in Step 5, edited only if it goes red.
- No change: `docs/journeys/finish-a-multispec-run-after-the-parent-session-ended.md` — its `--status complete` mention (Red flags line) is descriptive prose about which status to offer, not a command.

**Interfaces:**
- Consumes: Task 1's behavior — `hooks.js spec-status ... --status=complete ...` performs the same transition as the spaced form.

Byte headroom (RAIL_BYTES 52,500): `scratch-worktree.md` 31,872 B (+~600); `multispec-progress-banner.md` 4,765 B (shrinks); `multispec-review-console.md` 51,235 B — the edit swaps one space for `=`, so +0 B; do not add text to that file.

- [ ] **Step 1: Write the failing test in `tests/scratch-worktree-shell-constraint-table.test.js`** (append, reusing `table()`, `splitRow` and `BANNER`)

```js
test('AC1.1: section 7 carries the dated #4353 passes verdict for --status=complete', () => {
  const row = table().rows.find((r) => splitRow(r)[1].includes('--status=complete'));
  assert.ok(row, 'no section 7 row shows --status=complete');
  const cells = splitRow(row);
  assert.strictEqual(cells[2], 'passes');
  assert.match(cells[5], /^2026-10-29 \(#4353\)/);
});

test('#4353: the banner completion call is the plain --status=complete form, not a composed node -e', () => {
  assert.ok(BANNER.includes('spec-status --run "$MULTISPEC_PARENT_DIR" --spec {n} --status=complete --phase wrap-up'));
  assert.ok(!BANNER.includes("['c','o','m','p','l','e','t','e']"), 'banner still composes the word');
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/scratch-worktree-shell-constraint-table.test.js`
Expected: FAIL on both new tests (no such row; banner still holds the composed form).

- [ ] **Step 3: Edit the three docs**

- `scratch-worktree.md` §7: add one `passes` row directly below the `complete`-token row — Shape: "`complete` inside a larger shell word, e.g. a `--flag=value` argument (only the whole word `complete` is refused; see the row above)"; Example: `` `node "/abs/plugin/bin/hooks.js" spec-status --run "/abs/parent" --spec 1 --status=complete --phase wrap-up` ``; Verdict `passes`; Refusal wording `—`; Workaround `—`; Last verified `2026-10-29 (#4353)`. In the `complete`-token row, change the Workaround cell to lead with "For `hooks.js` callers, spell the flag `--status=complete` (one shell word, passes — the next row); elsewhere, compose the word inside one `node -e` call …" (keep the existing composed-word text after it), and change Last verified to `2026-10-29 (#4353); first #1651` (the spaced form was re-probed refused today). Leave the Example cell `` `echo complete` `` unchanged — `tools/guard-refusals/shapes.js` binds its detector to it.
- `multispec-progress-banner.md`: replace the sentence telling the reader to compose the word inside `node -e`, and its fence, with: the guard refuses the whole word `complete` as an argument (keep the `_shared/scratch-worktree.md` §7 citation and #1651), so pass it as `--status=complete`, one shell word the guard does not match (#4353); the fence becomes exactly `node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" spec-status --run "$MULTISPEC_PARENT_DIR" --spec {n} --status=complete --phase wrap-up` in a `bash` fence. In the following `--status failed` parenthetical, replace "is not a git-pattern-matched token, so that call keeps the plain literal form" with "is not a refused token, so the spaced form works there".
- `multispec-review-console.md` step 4: in the "for a spec that genuinely finished" command, change `--status complete` to `--status=complete`. Nothing else in the file.

- [ ] **Step 4: Re-point the re-entry pin, then run the touched suites**

In `tests/flow-pass-reentry-conformance.test.js`, change the token list entry `'--status complete'` to `'--status=complete'`.

Run: `node --test tests/scratch-worktree-shell-constraint-table.test.js tests/flow-pass-reentry-conformance.test.js`
Expected: PASS.

- [ ] **Step 5: Run the guard-shape and prose-pin suites (AC4.1)**

Run: `node --test tests/skill-fence-guard-shapes.test.js tests/guard-refusals/shapes.test.js tests/timing-prose-conformance.test.js tests/flow-mixed-execution-convention.test.js`
Expected: PASS (AC4.1: the new banner fence is not flagged by `complete-token`, the frozen fixture's `--status complete` still is, and the new passes-row example trips no detector).

- [ ] **Step 6: Commit**

```bash
git add plugin/skills/_shared/scratch-worktree.md plugin/skills/flow/multispec-progress-banner.md plugin/skills/flow/multispec-review-console.md tests/scratch-worktree-shell-constraint-table.test.js tests/flow-pass-reentry-conformance.test.js
git commit -m "Switch the multi-spec completion call to --status=complete — record the #4353 guard probe in scratch-worktree §7; refs #4353"
```

Waived AC4.1: no new test — the existing live-corpus sweep `tests/skill-fence-guard-shapes.test.js` and `tests/guard-refusals/shapes.test.js` (frozen-fixture flagging) already enforce it; Task 2 Step 5 runs both after the banner edit.

Waived AC5.1: `npm test` passing is verified by `/build`'s Common Step 5 runner (`verify.js`), not by a task step.
