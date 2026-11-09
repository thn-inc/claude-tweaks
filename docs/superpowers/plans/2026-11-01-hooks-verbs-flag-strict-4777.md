# hooks.js Default-Strict Flag Guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every `plugin/bin/hooks.js` verb refuses an undeclared `--*` flag with its usage line instead of running, starting with `reconcile`.

**Architecture:** Take the spec's second alternative, default-strict. `KNOWN_FLAGS` gains an entry for every `VERBS` verb (an empty array for the flagless ones), `main()` applies the existing unknown-flag guard to every `VERBS` verb, and the HELP_FLAGS-only fallback branch is deleted. A registration test asserts `KNOWN_FLAGS` and `VERBS` have the same keys, so a new verb cannot ship without declaring its flags. No opt-out list: the caller audit (Task 2) found no verb that must stay lenient.

**Tech Stack:** Node 18+ CommonJS, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-11-01T073629-spec-4777/work/4777-spec.md`

Scope keywords: KNOWN_FLAGS, HELP_FLAGS, firstUnknownFlag, flag-strict

## Global Constraints

- Refusal contract, uniform for every verb (unchanged from #1012): stdout is exactly `claude-tweaks: usage: {VERBS[verb].usage}\n`, exit 0, before any lib call or write. `-h` and `--help` refuse the same way.
- `reconcile`'s refusal string is exactly `claude-tweaks: usage: reconcile [--dry-run] [--json] [--mcp-reachable] [--checks <c1,c2,...>]` (spec AC 1).
- The `KNOWN_FLAGS` line for reconcile keeps the shape `  reconcile: [` (two-space indent, bare key) so `git grep -n -F -e "  reconcile: [" -- plugin/bin/hooks.js` matches (spec AC 3).
- Commit messages: `{Verb} {what} — {detail}`, ending with the line `Claude-Session: https://claude.ai/code/session_016yg3zrQKAz6hRNqmKyivqj`. Stage named files only.
- Tests run per file with `node --test <file>`; the full suite runs centrally after the plan, not inside tasks.

**Ruling: resolve-run-dir keeps the uniform stdout/exit-0 refusal.** The controller asked whether `resolve-run-dir`, whose stdout callers capture as a path, should refuse on stderr with exit 1. The plan keeps the uniform contract, for two reasons. First, `tests/hooks-help-guard.test.js` (#1143) already pins `--help`/`-h` → stdout usage + exit 0 for every `USAGE` verb, `resolve-run-dir` included. Second, an empty capture is the worse failure for its callers: `wrap-up/SKILL.md` Phase 1 and `release/SKILL.md` treat an empty `RUN_DIR` as "nothing resolved" and fall through to `--standalone … --create`, silently minting a stray run dir. A captured usage line is visibly not a path, and the next write against it fails. Cost if wrong: one follow-up record moving a single verb to stderr.

## Governing skill rules (`.claude/skills/hooks-js-verb-registration/SKILL.md`, quoted)

- Decision 5: "Before adding an existing verb to the table, check that every call site passes only the flags you declare (`git grep -n 'hooks.js" {verb}'`), then land rows 2 and 8 and a spawn test that runs an undeclared flag in both argument orders and asserts the usage stdout, exit 0, and that nothing moved or committed (`tests/archive-run-verb.test.js`)." → Task 2 (call sites), Task 3 (rows 2 and 8), Task 1 (spawn tests).
- "Adding a flag" row 4: "`VALUE_FLAGS` | Only for a value-taking flag on a flag-strict verb, so the unknown-flag scan skips the value token." → Task 1's `VALUE_FLAGS` additions.
- Decision 2: "If a skill parses it, stdout carries only the machine-readable result." → weighed for `resolve-run-dir` in the Ruling above.

**Retirement sweep:** Task 1 deletes `HELP_FLAGS`. `git grep -n HELP_FLAGS` at 9685e20af hits only `plugin/bin/hooks.js` (lines 160, 166, 172, 1930, 1941) and an archived run's `work/4773-spec.md`, which is history and stays. Task 3 rewrites the three comment mentions; Task 1 removes the constant and its one reader. No test pins the rewritten prose (checked: `git grep -F` over `tests/ plugin/ docs/ .claude/` for each rewritten phrase).

Waived AC3.2: a fact about the base commit, not this change — the spec's own probe already showed `  reconcile: [` absent on origin/main at 79f3c3c84, and it is still absent at 9685e20af (`git grep -n -F -e "  reconcile: [" -- plugin/bin/hooks.js` exits 1).

**Check B scope review (plan-audit at c26ae8f13, scope-creep policy `add-to-plan`):** `tests/hooks-resolve-console.test.js` is added to Task 1's Step 4 run list, since it spawns a `KNOWN_FLAGS` verb. The other hits need no change: `tests/hooks-dispatcher.test.js` is already in that run list. `docs/journeys/recover-from-a-mistyped-hooks-js-verb-4181.md` belongs to `/claude-tweaks:build` Common Step 6. The two `docs/superpowers/plans/2026-10-31-*.md` files are history. `plugin/skills/wrap-up/cleanup-procedures-execution.md:276` cites the `teardown-run` removal comment, which this plan leaves in place.

**AC evidence:** AC 2 is verified by Task 2's audit. Its table goes in Task 2's report file and is quoted in PR #4822's body, so the evidence outlives the scratch run.

## Review Focus

- A value token that itself starts with `--` (e.g. `reconcile --checks --json`): `firstUnknownFlag` skips a declared value flag's next token, so `--checks` must be in `VALUE_FLAGS`. Pinned in Task 1 (`--checks` value is consumed, not classified).
- An empty value (`reconcile --checks ''`, used by `tests/reconcile.test.js:1874`) must still run, not refuse. Pinned in Task 1.
- `record-pr`'s positional `<number> <url>` and `record-worktree`'s positional `<worktree-path>` stay unaffected (they don't start with `--`). Already covered by existing tests; Task 1 runs `tests/hooks-dispatcher.test.js` to confirm.
- `reconcile-background` is spawned with no args by `plugin/bin/lib/reconcile/background-spawn.js:54`; an empty `KNOWN_FLAGS` entry must not refuse a bare call. Pinned in Task 1.
- An EVENTS name (`session-start --help`) is still not intercepted (table-scoped guard, `tests/hooks-help-guard.test.js:93`). Task 1 runs that file.

---

### Task 1: Default-strict guard and every verb's declared flags

**Review risk:** high

**Files:**
- Modify: `plugin/bin/hooks.js:162-212` (`KNOWN_FLAGS`, `VALUE_FLAGS`), `:1915-1944` (`main()` guard), `:2033` (`module.exports`)
- Create: `tests/hooks-js-flag-strict.test.js`

**Interfaces:**
- Produces: `module.exports` gains `KNOWN_FLAGS` (object: verb → string[]). `KNOWN_FLAGS` keys equal `VERBS` keys exactly.
- New `KNOWN_FLAGS` entries (flags each handler parses today):
  - `'resolve-run-dir': ['--spec-slug', '--mode', '--standalone', '--create', '--root-only', '--archived']`
  - `'sweep-shadow': ['--run', '--worktree']`
  - `'adopt-run-dir': ['--run', '--worktree']`
  - `'check-resume-freshness': ['--run']`, `'check-staged-inventory': ['--run']`, `'check-session-residue': ['--run']`
  - `'check-sibling-sessions': ['--record']`
  - `reconcile: ['--dry-run', '--json', '--mcp-reachable', '--checks']`
  - `'reconcile-summary': []`, `'reconcile-background': []`
- `VALUE_FLAGS` gains `--spec-slug`, `--mode`, `--standalone`, `--worktree`, `--record`, `--checks`.

- [ ] **Step 1: Write the failing tests** in `tests/hooks-js-flag-strict.test.js`, reusing `tests/archive-run-verb.test.js`'s `git`/`runHook`/`HOOK_SANDBOX` helper shape (`PIPELINE_RUN_DIR: ''` in env, never the runner's cwd):
  - `'#4777 AC3.1: KNOWN_FLAGS declares every VERBS verb, and nothing else'`: `assert.deepStrictEqual(Object.keys(KNOWN_FLAGS).sort(), Object.keys(VERBS).sort())` (via `require('../plugin/bin/hooks.js')`). Also pin spec AC 3's line shape: `assert.ok(fs.readFileSync(HOOKS, 'utf8').includes('\n  reconcile: ['))`.
  - `'#4777: every VERBS verb refuses an undeclared flag with its usage line'`: for each verb, `runHook([verb, '--definitely-not-a-flag'])` in `HOOK_SANDBOX` → `code === 0` and `stdout === \`claude-tweaks: usage: ${USAGE[verb]}\n\``.
  - **Shared fixture `reconcileFixture()`**: the `runDirFixture('clean')` shape, plus a bare `origin` remote (`git init --bare` in a sibling temp dir, `git remote add origin`, `git push -q origin main`, `git remote set-head origin main`). Without a remote, `reconcile()` returns `skipped: [{check:'all', reason:'no-remote'}]` before any check (`plugin/bin/lib/reconcile/index.js:242-245`), and side-effect assertions could never fail. **Positive control in the same test file:** in a fresh `reconcileFixture()`, `runHook(['reconcile', '--json'])` (no typo, no `--dry-run`) DOES change state. Assert the effect the run actually produces, e.g. `.claude-tweaks/reconcile-cache.json` written; confirm the effect first and assert that one. Without that proof, the refusal tests' "nothing changed" assertions are not discriminating.
  - `'#4777 AC1.1 AC1.2: reconcile --dryrun prints the reconcile usage line and runs no check'`: in a `reconcileFixture()`, for both `['reconcile', '--dryrun']` and `['reconcile', '--json', '--dryrun']`: stdout is exactly `claude-tweaks: usage: reconcile [--dry-run] [--json] [--mcp-reachable] [--checks <c1,c2,...>]\n` and exit 0. The positive control's state effect is absent, the run dir still exists, nothing exists under `.claude-tweaks/pipelines/archive/`, and `git rev-parse HEAD` is unchanged. **Declared-flag control (makes AC1.2's go-red real):** in the same test, `runHook(['reconcile', '--dry-run', '--json'])` does NOT print the usage line. This assertion goes red when reconcile's `KNOWN_FLAGS` entry is removed, because the fail-closed guard (Step 3) then refuses every flag.
  - `'#4777: adopt-run-dir refuses an undeclared flag before adopting'`: both orders `['adopt-run-dir', '--run', runDir, '--worktree', wt, '--bogus']` and `['adopt-run-dir', '--bogus', '--run', runDir, '--worktree', wt]` (wt = a `git worktree add` of the fixture repo) → exact usage stdout, exit 0, and the worktree holds no `.claude-tweaks/pipelines/{runId}` copy. Positive control: the same arguments without `--bogus` do produce that copy, or whatever `tests/hooks-adopt-run-dir.test.js`'s success case asserts.
  - `'#4777: sweep-shadow refuses an undeclared flag before sweeping'`: a `git init` main root holding the run dir, plus a `git worktree add` worktree `wt` holding a shadow file under `wt/.claude-tweaks/pipelines/{runId}/staged/` (the shadow shape from `tests/bin-lib/hooks/sweep-shadow.test.js`). Run both orders `['sweep-shadow', '--run', runDir, '--worktree', wt, '--bogus']` and `['sweep-shadow', '--bogus', '--run', runDir, '--worktree', wt]` → exact usage stdout, exit 0, shadow file still present. Positive control: the same arguments without `--bogus` sweep the file (it moves into the main run dir or is reported swept), proving the fixture can be swept.
  - `'#4777: reconcile-background and reconcile-summary refuse an undeclared flag and change nothing'` (user decision at plan review): in a `reconcileFixture()`, `['reconcile-background', '--bogus']` and `['reconcile-summary', '--bogus']` → exact usage stdout, exit 0. For each, the positive control's state effect is absent, `.claude-tweaks/reconcile-background-status.json` is absent, the run dir is not archived, and `HEAD` is unchanged.
  - `'#4777: resolve-run-dir --create refuses an undeclared flag and mints nothing'`: both orders `['resolve-run-dir', '--spec-slug', 'x', '--create', '--bogus']` / `['resolve-run-dir', '--bogus', '--spec-slug', 'x', '--create']` in a fresh git repo → exact usage stdout, exit 0, `.claude-tweaks/pipelines` absent or empty.
  - `'#4777: declared value flags consume their value token'`: `reconcile --dry-run --checks --json` in the fixture repo does NOT print the usage line (the `--json` token is `--checks`'s value); `reconcile --dry-run --checks ''` does not print it either.
  - `'#4777: a flagless verb still runs bare'`: `runHook(['reconcile-summary'], { cwd: fixtureRoot })` stdout starts with `reconcile:` (not `claude-tweaks: usage:`).

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/hooks-js-flag-strict.test.js`
Expected: FAIL — `KNOWN_FLAGS` is undefined (not exported), and `reconcile --dryrun` prints reconcile output instead of the usage line.

- [ ] **Step 3: Implement** in `plugin/bin/hooks.js`: add the entries and `VALUE_FLAGS` members listed under Interfaces; in `main()` change the guard condition to `if (verb)` and pass `KNOWN_FLAGS[cmd] || []` to `firstUnknownFlag`. That fails closed: a verb missing its entry refuses every `--*` flag rather than skipping the guard, and the registration test catches the missing entry and delete the `else if (verb && argv.slice(3).some((a) => HELP_FLAGS.has(a)))` branch; delete `HELP_FLAGS` if nothing else reads it (`grep -n HELP_FLAGS plugin/bin/hooks.js`); add `KNOWN_FLAGS` to `module.exports`. Leave the existing entries' order and the `teardown-run` removal comment untouched. Comment edits belong to Task 3.

- [ ] **Step 4: Run tests to verify they pass, plus the suites that pin the guard**

Run: `node --test tests/hooks-js-flag-strict.test.js tests/hooks-help-guard.test.js tests/hooks-dispatcher.test.js tests/archive-run-verb.test.js tests/hooks-adopt-run-dir.test.js tests/hooks-resolve-console.test.js tests/reconcile.test.js tests/bin-lib/hooks/reconcile-summary.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Prove discrimination.** Temporarily delete the `reconcile` line from `KNOWN_FLAGS`, re-run `node --test tests/hooks-js-flag-strict.test.js` and confirm these fail: the AC1 reconcile test (its declared-flag control), the AC3.1 registration test, and the value-flag test. Restore the line and confirm it passes. Report both outputs.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/hooks.js tests/hooks-js-flag-strict.test.js
git commit -m "Make every hooks.js verb refuse an undeclared flag — KNOWN_FLAGS covers the whole VERBS table (#4777)" -m "Claude-Session: https://claude.ai/code/session_016yg3zrQKAz6hRNqmKyivqj"
```

### Task 2: Caller audit (spec AC2.1)

**Files:**
- Create: none. Output: the audit table in the task report, which the PR body quotes.

**Interfaces:**
- Consumes: Task 1's `KNOWN_FLAGS`.

- [ ] **Step 1: Write the check.** List every invocation of the ten newly strict verbs across `plugin/` and `tests/`. Use `git grep -n -E 'hooks\.js"? +(reconcile|reconcile-summary|reconcile-background|resolve-run-dir|sweep-shadow|adopt-run-dir|check-resume-freshness|check-staged-inventory|check-session-residue|check-sibling-sessions)\b' -- plugin/ tests/` for prose and shell forms. Add an array-form search for spawns: `git grep -n -E "'(reconcile|reconcile-summary|reconcile-background|resolve-run-dir|sweep-shadow|adopt-run-dir|check-[a-z-]+)'" -- plugin/bin tests/`.

- [ ] **Step 2: Run the audit verification (AC2.1) and expect undeclared flags to be absent**

Run: the two greps above, then for each hit compare its `--*` tokens against Task 1's `KNOWN_FLAGS` entry.
Expected: every flag is declared. The controller's pre-audit at 9685e20af found only these flags in `plugin/`: `--checks`, `--dry-run`, `--json`, `--mcp-reachable`, `--spec-slug`, `--standalone`, `--mode`, `--create`, `--root-only`, `--archived`, `--run`, `--worktree`, `--record`. Background-spawn calls `reconcile-background` bare. Check C note: this step has no `Expected: FAIL`, because it is an audit, not a test.

- [ ] **Step 3: Resolve any undeclared hit.** A flag the handler parses but `KNOWN_FLAGS` omits → add it in `hooks.js` with a test case in `tests/hooks-js-flag-strict.test.js`. A flag the handler never parsed → fix the caller. Re-run Task 1's Step 4 command if `hooks.js` changed.

- [ ] **Step 4: Report** the table, columns `verb | call sites (count) | flags passed | all declared?`, in the task report file. Commit only if Step 3 changed a file:

```bash
git add {changed files}
git commit -m "Fix {verb} callers passing undeclared flags — caller audit for #4777" -m "Claude-Session: https://claude.ai/code/session_016yg3zrQKAz6hRNqmKyivqj"
```

### Task 3: Comments and the verb-registration skill

**Files:**
- Modify: `plugin/bin/hooks.js:108-118` (VERBS comment), `:162-172` (KNOWN_FLAGS comment), `:1918-1930` (main() guard comment)
- Modify: `.claude/skills/hooks-js-verb-registration/SKILL.md` — registration table rows 1, 2, 8; "Decisions each verb owes" item 5; "Adding a flag" table rows 3, 4 and decision 1
- Test: `tests/hooks-js-flag-strict.test.js` (add prose pins)

**Interfaces:**
- Consumes: Task 1's default-strict guard (every verb has a `KNOWN_FLAGS` entry; HELP_FLAGS-only branch gone).

- [ ] **Step 1: Write the failing prose pins** in `tests/hooks-js-flag-strict.test.js`:
  - `'#4777: hooks.js comments no longer describe a lenient verb set'`: read `plugin/bin/hooks.js`; `assert.doesNotMatch(src, /Every other resolveRunArg caller/)` and `assert.doesNotMatch(src, /Every other VERBS-table verb keeps the\s+\/\/ narrower HELP_FLAGS-only guard/)`.
  - `'#4777: the registration skill states default-strict membership'`: read `.claude/skills/hooks-js-verb-registration/SKILL.md`. Assert `assert.doesNotMatch(skill, /Only for a flag-strict verb/)` and `assert.doesNotMatch(skill, /The lenient mutating verbs still in `VERBS`/)`. Assert `assert.match(skill, /every `VERBS` verb/i)` in the row-2 text.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/hooks-js-flag-strict.test.js`
Expected: FAIL — both prose pins fail on today's text.

- [ ] **Step 3: Rewrite the prose.**
  - **`KNOWN_FLAGS` comment:** membership is every `VERBS` verb (an empty array for a flagless verb). The registration test enforces it. Keep the sentence that `--help`/`-h` fall out as unknown. Keep the note that `unambiguousOnly` is chosen per call site (`resolveOpts`), not by this table. Drop the "Every other resolveRunArg caller … unchanged" sentence.
  - **`main()` comment:** the guard now covers every verb. Drop the "Every other VERBS-table verb keeps the narrower HELP_FLAGS-only guard" sentence.
  - **`VERBS` comment:** "One table feeds the `--help`/`-h` intercept" becomes "the unknown-flag guard, which also intercepts `--help`/`-h`".
  - **Skill row 1:** name rows 2 and 8 as still required.
  - **Skill row 2:** every new verb gets an entry, `[]` when it takes no flags; the registration test in `tests/hooks-js-flag-strict.test.js` fails otherwise.
  - **Skill row 8:** the comment no longer enumerates verbs, so it needs an edit only when the membership rule itself changes.
  - **Skill decision 5:** becomes "Flag-strict is the default (#4777)". Keep the #4773 history in one clause and the call-site check plus spawn-test instruction for a verb whose flags change.
  - **"Adding a flag" rows 3 and 4:** drop the "Only when the verb has an entry there" conditionals.
  - **"Adding a flag" decision 1:** a typo is refused with the usage line on every verb.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/hooks-js-flag-strict.test.js tests/hooks-help-guard.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/hooks.js .claude/skills/hooks-js-verb-registration/SKILL.md tests/hooks-js-flag-strict.test.js
git commit -m "Describe default-strict flag membership — hooks.js comments and the verb-registration skill (#4777)" -m "Claude-Session: https://claude.ai/code/session_016yg3zrQKAz6hRNqmKyivqj"
```

Not in this plan: `docs/journeys/recover-from-a-mistyped-hooks-js-verb-4181.md` step 4's "On the flag-strict verbs (…)" list belongs to `/claude-tweaks:build` Common Step 6 (journeys), which runs after these tasks.
