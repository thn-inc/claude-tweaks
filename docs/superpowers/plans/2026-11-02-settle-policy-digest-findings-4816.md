# Settle 3 Policy Digest Findings (#4816) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Settle the three `policy`-area digest findings promoted from #1426: make the `model-profiles` block's two readers share one comment-stripping function (fixing a CRLF audit blind spot), and mark the not-yet-consumed control-mode keys as such in their comments and user-facing summaries.

**Architecture:** Two comment rules exist on purpose: flat keys and the `model-profiles` block cut a line at the first `#` (no value there can hold one), while `risk-path-globs` is quote-aware because a glob may hold `#`. The defect is that the `model-profiles` block's two readers (`parsePolicyModelConfig`, `extractMapEntry`) implement the cut-at-first-`#` rule two ways and disagree on CRLF input. Task 1 makes `extractMapEntry` call `policy-fragment.js`'s `stripComment`. Task 2 is comment and summary text only: `isControlModeOn` keeps its shape (its revisit condition, a first consumer, is unmet), and the 14 control-mode keys get a "Not yet used" summary marker plus a comment naming the #4608 leaf that wires each.

**Tech Stack:** Node 18+ CommonJS, `node --test`, no npm deps.

**Spec:** `.claude-tweaks/pipelines/2026-11-02T084445-record-4816/work/4816-spec.md`

Scope keywords: extractMapEntry, isControlModeOn, Read only with control mode on

Scope sweep, no-change hits: `plugin/skills/_shared/policy-schema.md` (names `isControlModeOn` as the one comparison site — still true; its owner column already says "none yet (#4608)") and `docs/superpowers/plans/2026-10-30-control-mode-policy-keys-4609.md` (a historical plan quoting the old summaries — a shipped record, not live prose). `stripComment` is deliberately not a keyword: it names unrelated per-module helpers repo-wide (`merge-verification.js`, `flow/manifest.js`, `release-preflight/pack.js`, `strip-comments.js`), none of which read `policy.yml` blocks.

## Global Constraints

- Commit subjects: `{Verb} {what} — {detail}`, ending `(refs #4816)` — never "closes"/"fixes".
- Commit only in the worktree `/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude/worktrees/dispatch-record-4816`; use `git -C "<worktree>"` or run from it. Stage files by explicit path.
- Run only the targeted suites named in each task; the full suite runs centrally after all tasks.
- From `.claude/skills/policy-key-addition/SKILL.md` item 1, verbatim: "`summary`, `category` and `tier` are required (`tests/policy-schema-metadata.test.js`)." That test also caps every summary at 140 characters and forbids a summary containing its own key verbatim.
- From `.claude/skills/policy-key-addition/SKILL.md` item 4, verbatim: "its summary must not be copied verbatim from the row's `summary` (`tests/policy-schema-metadata.test.js`)." — no new summary text may appear verbatim in `plugin/skills/_shared/policy-schema.md`. That file is not edited by this plan (its owner column already reads "none yet (#4608)").
- `.claude/skills/parse-signal-discipline/SKILL.md` names `plugin/bin/lib/policy.js` only for `readCommitScope`'s fallback rule, which this plan does not touch — no rule from it applies.
- Behavior: flat-key parsing (`parseFlatLines`) and `risk-path-globs.js`'s parsing must not change; only `extractMapEntry`'s comment handling changes.

## Review Focus

1. A `policy.yml` saved with CRLF endings and a trailing `# comment` on the `model-profiles:` line: audit must still see the block (Task 1's AC1.1 test).
2. A `model-profiles` row line with a trailing comment and CRLF (`  standard:  # x\r`): `stripComment` must return `  standard:` (Task 1's `stripComment` test).
3. An LF policy with no comments: audit behavior unchanged — covered by the existing `model-profiles:` audit tests at `tests/policy-schema.test.js` ~739-770, which must stay green.
4. A user listing advanced levers (`/claude-tweaks:help policy` → "show advanced") must not read a control-mode key as live behavior (Task 2's marker test).
5. A summary edit pushing a row past 140 characters: `tests/policy-schema-metadata.test.js` catches it; Task 2 runs it.

## Spec coverage

| Clause | Covered by |
|---|---|
| AC1.1 Each deliverable is fixed, or closed out with its reason recorded on this record. | D1 → Task 1; D2 → Task 2 (comment) plus the controller's disposition comment on #4816 after execution; D3 → Task 2 |

Waived AC2.1: already satisfied, with no code to change. Digest #1426's comment 6545562270 (run 2026-10-31T142701-release-standalone) carries `→ #4816` on all three promoted lines (materiality fingerprints `materiality-e1218f8c`, `materiality-8f132cc0`, `materiality-364cbdca`), read live with `gh api repos/thn-inc/claude-tweaks/issues/1426/comments` during build.

**Required controller gate (not an implementer task; runs after Task 2's review and before `/build`'s Common Step 3):** post one comment on #4816 recording each deliverable's disposition, then read it back (`gh issue view 4816 --comments`) and confirm all three lines are present. AC1.1 for D2 is not met until this comment exists. Text:

- D1 fixed for the `model-profiles` block: its two readers now share `policy-fragment.js`'s `stripComment`, which closes the CRLF + trailing-comment blind spot in `auditPolicy`. `risk-path-globs` keeps its quote-aware rule on purpose, because a glob may hold `#`. Flat keys keep their documented cut-at-first-`#` rule.
- D2 closed out with its reason. `isControlModeOn` is kept: #4609 shipped it as the single comparison site for the #4608 leaves, none of which has landed, so the finding's own revisit condition is unmet. When a leaf lands it becomes the first caller and the helper needs no change. Its comment now says this.
- D3 fixed: the Control mode comment names the #4608 leaf that wires each key, and all 14 summaries open "Not yet used" (pinned by `tests/resolve-policy-control-mode.test.js`).

---

### Task 1: model-profiles block readers share one comment rule

**Role:** integration

**Files:**
- Modify: `plugin/bin/lib/model-profiles/policy-fragment.js:10-13` (export `stripComment`; comment stating its rule)
- Modify: `plugin/bin/lib/policy-schema.js:8-9` (require), `:708-731` (`extractMapEntry` uses `stripComment`; comment)
- Modify: `plugin/bin/lib/risk-path-globs.js:53-54` (comment on why its `stripComment` differs)
- Modify: `docs/plugin-structure.md:27` (policy-fragment.js entry: its `stripComment` is also used by `policy-schema.js`'s `extractMapEntry`)
- Test: `tests/policy-schema.test.js` (after the `model-profiles:` audit tests, ~line 770)
- Test: `tests/bin-lib/model-profiles/policy-fragment.test.js`

**Interfaces:**
- Produces: `stripComment(line: string) -> string` exported from `plugin/bin/lib/model-profiles/policy-fragment.js` (`module.exports = { parsePolicyModelConfig, stripComment }`). Behavior unchanged: cut at the first `#` anywhere, then `trimEnd()`.

- [ ] **Step 1: Write the failing tests**

In `tests/policy-schema.test.js`, after the `model-profiles: an unrecognized sub-field…` test:

```js
test('AC1.1: model-profiles audit sees the block when policy.yml has CRLF endings and a trailing comment on the key line (#4816)', () => {
  const repo = tmpRepo();
  writePolicy(repo, ['model-profiles:   # project overrides', '  bogus:', '    model: opus', ''].join('\r\n'));
  const result = auditPolicy(repo);
  assert.strictEqual(result.invalidValues.length, 1);
  assert.strictEqual(result.invalidValues[0].key, 'model-profiles');
  assert.deepStrictEqual(result.invalidValues[0].value, { bogus: true });
});
```

In `tests/bin-lib/model-profiles/policy-fragment.test.js`, import `stripComment` beside `parsePolicyModelConfig` and add:

```js
test('stripComment cuts at the first # anywhere and drops a CRLF \\r (#4816)', () => {
  assert.strictEqual(stripComment('model-profiles:   # project overrides\r'), 'model-profiles:');
  assert.strictEqual(stripComment('  standard:  # x\r'), '  standard:');
  assert.strictEqual(stripComment('    model: opus#note'), '    model: opus');
  assert.strictEqual(stripComment('    effort: low'), '    effort: low');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/policy-schema.test.js tests/bin-lib/model-profiles/policy-fragment.test.js`
Expected: FAIL — the AC1.1 test gets `invalidValues.length` 0 (actual `0`, expected `1`); the `stripComment` test fails with `stripComment is not a function`.

- [ ] **Step 3: Implement**

- `policy-fragment.js`: export `stripComment`. Above it, a comment: this is the flat-key rule (`parseFlatLines`' `[^#]*`): a `#` anywhere ends the line, which is exact here because no `model-profiles` row name or field value can hold a `#`; `trimEnd()` also drops a CRLF's `\r`. Both readers of the block use this one function: `parsePolicyModelConfig` and `policy-schema.js`'s `extractMapEntry`. `risk-path-globs.js` keeps its own quote-aware rule on purpose.
- `policy-schema.js`: `const { stripComment } = require('./model-profiles/policy-fragment');` beside the existing `./model-profiles/profiles` require. In `extractMapEntry` replace `rawLine.replace(/#.*$/, '').trimEnd()` with `stripComment(rawLine)`. Extend its header comment: it shares `stripComment` with the resolver so the two never disagree (the old `/#.*$/` missed a comment on a CRLF line, since `.` does not match `\r`, #4816).
- `risk-path-globs.js`: extend the `stripComment` comment: it differs from the flat-key/`model-profiles` rule deliberately, because a glob may hold `#`.
- `docs/plugin-structure.md:27`: after "deliberately separate from policy-schema.js's flat-only parser", add that its `stripComment` is also `policy-schema.js`'s `extractMapEntry`'s comment rule.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/policy-schema.test.js tests/bin-lib/model-profiles/policy-fragment.test.js tests/resolve-policy-control-mode.test.js tests/resolve-policy-lib.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Commit**

```bash
git -C "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude/worktrees/dispatch-record-4816" add plugin/bin/lib/model-profiles/policy-fragment.js plugin/bin/lib/policy-schema.js plugin/bin/lib/risk-path-globs.js docs/plugin-structure.md tests/policy-schema.test.js tests/bin-lib/model-profiles/policy-fragment.test.js
git -C "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude/worktrees/dispatch-record-4816" commit -m "Share model-profiles comment stripping — extractMapEntry reuses policy-fragment's stripComment, fixing a CRLF audit blind spot (refs #4816)"
```

### Task 2: Mark the not-yet-consumed control-mode keys

**Role:** transcription

**Files:**
- Modify: `plugin/bin/lib/policy-schema.js:94-96` (risk-categories, risk-path-globs summaries), `:178` (block comment), `:179-191` (12 summaries)
- Modify: `plugin/bin/lib/policy.js:97-101` (`isControlModeOn` comment)
- Test: `tests/resolve-policy-control-mode.test.js` (after the `AC4.8: isControlModeOn…` test, ~line 233)

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: no code interface; `POLICY_KEYS[*].summary` text only.

- [ ] **Step 1: Write the failing test**

```js
// Control-mode keys no plugin code acts on yet; the #4608 leaves wire them
// (policy-schema.js's Control mode comment names which). The record that wires
// a key removes it from this list and drops "Not yet used" from its summary.
const NOT_YET_USED = ['control-mode', 'acceptance-target', 'deploy-reach', 'deploy-command', 'deploy-live-workflow', 'deploy-version-url', 'dev-base-url', 'dev-test-account', 'deploy-wait-seconds', 'deploy-poll-seconds', 'owned-owners', 'trusted-authors', 'risk-categories', 'risk-path-globs'];

test('AC1.1: every control-mode key nothing consumes yet says so in its summary (#4816)', () => {
  for (const key of NOT_YET_USED) {
    const row = POLICY_KEYS.find((r) => r.key === key);
    assert.ok(row, `${key} missing from POLICY_KEYS`);
    assert.match(row.summary, /^Not yet used[.;] /, key);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/resolve-policy-control-mode.test.js`
Expected: FAIL after Step 1 — `control-mode`'s summary "The single human-in-control switch; …" does not match `/^Not yet used[.;] /`.

- [ ] **Step 3: Implement**

Replace each summary with exactly this text (each ≤140 characters):

| Key | New summary |
|---|---|
| `control-mode` | `Not yet used. The single human-in-control switch; implied levers default at skill-default precedence, so any explicitly set lever wins.` |
| `acceptance-target` | `Not yet used; control mode only: where a human accepts work, locally or on the dev environment; pairs with deploy-reach when dev.` |
| `deploy-reach` | `Not yet used; control mode only: how a merge reaches the dev environment, if at all; pairs with acceptance-target set to dev.` |
| `deploy-command` | `Not yet used. Executed string, read only from the base branch's policy; meaningful only with deploy-reach command and control mode on.` |
| `deploy-live-workflow` | `Not yet used; control mode only: names the CI workflow whose success means dev is live; pairs with deploy-reach other than none.` |
| `deploy-version-url` | `Not yet used; control mode only: a URL returning the deployed version; pairs with deploy-reach other than none.` |
| `dev-base-url` | `Not yet used; control mode only: the dev environment's base URL, where acceptance runs; pairs with acceptance-target set to dev.` |
| `dev-test-account` | `Not yet used; control mode only: the vault entry name of the dedicated test account the smoke check signs in with; pairs with dev-base-url.` |
| `deploy-wait-seconds` | `Not yet used; control mode only: how long to wait for a deploy to go live; 0 skips the wait. Pairs with a live signal.` |
| `deploy-poll-seconds` | `Not yet used; control mode only: how often the live signal is polled while waiting; pairs with deploy-wait-seconds.` |
| `owned-owners` | `Not yet used; control mode only, from base-branch policy: orgs and users, beside the repo owner, whose repos are owned. Pairs with nothing.` |
| `trusted-authors` | `Not yet used; control mode only, from base-branch policy: GitHub logins trusted as record roots, beside the repo owner. Pairs with nothing.` |
| `risk-categories` | `Not yet used; control mode only: extra risk categories added to the four built-in ones; pairs with risk-path-globs.` |
| `risk-path-globs` | `Not yet used; control mode only: maps each risk category to its signal path globs, as an indented block; pairs with risk-categories.` |

Replace the block comment at `policy-schema.js:178` with:

```js
  // Control mode (#4609, human-in-control #4608): twelve flat keys here, plus `risk-categories` and `risk-path-globs` in the merge-safety group above. No plugin code acts on them yet, so each summary opens "Not yet used". The #4608 leaves wire them: control-mode -> #4624, and every control-mode-gated leaf through isControlModeOn (bin/lib/policy.js); acceptance-target -> #4615; deploy-reach, deploy-command, deploy-live-workflow, deploy-version-url, dev-base-url, dev-test-account, deploy-wait-seconds, deploy-poll-seconds -> #4616; owned-owners -> #4621; trusted-authors -> #4622; risk-categories, risk-path-globs -> #4618, #4619. The record that wires a key drops its marker and its entry in tests/resolve-policy-control-mode.test.js's NOT_YET_USED. All but `control-mode` itself are consulted only with control mode on. All advanced — the core tier is at its cap.
```

In `policy.js`, replace `isControlModeOn`'s comment (the five lines above `function isControlModeOn`) with exactly:

```js
// `control-mode` (#4609): the one comparison site every consumer of the control-
// mode keys goes through, so "is it on" is decided in exactly one place. Takes the
// resolved value (e.g. from resolve-policy.js --values), strictly the exact string
// `on` — `ON`, `yes`, an absent value and a boolean are all off, so a typo can
// never switch the mode on. No production caller yet: #4609 shipped it ahead of
// the #4608 control-mode leaves (#4615, #4616, #4618-#4624) so they share one
// comparison. The first leaf to land becomes its first caller; the helper itself
// needs no change then.
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/resolve-policy-control-mode.test.js tests/policy-schema-metadata.test.js tests/policy-schema.test.js tests/resolve-policy-cli.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Commit**

```bash
git -C "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude/worktrees/dispatch-record-4816" add plugin/bin/lib/policy-schema.js plugin/bin/lib/policy.js tests/resolve-policy-control-mode.test.js
git -C "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude/worktrees/dispatch-record-4816" commit -m "Mark the unconsumed control-mode keys — summaries say Not yet used, comments name the #4608 leaves that wire them (refs #4816)"
```
