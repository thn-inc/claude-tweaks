# Ledger Reader Ownership Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every ledger reader outside wrap-up resolves *this run's* ledger through the ownership-aware ledger probe (`wrap-up-pack.js --print ledger`'s `value.files`), keeping the bare `docs/plans/*-ledger.md` glob only as the documented reader fallback.

**Architecture:** `_shared/ledger-format.md`'s Location section owns the one resolution rule: run the probe, read `value.files`; `value.unattributedFiles` are other runs' ledgers; the glob is a reader-only fallback when the probe is `ok: false`/unavailable or no run dir resolves; writers/deleters fail closed instead. `ledger/SKILL.md`, `review/code-mode-steps.md` and `wrap-up/auto-merge-short-circuit.md` cite that rule rather than restating a glob. A new `node --test` conformance suite pins it.

**Tech Stack:** Markdown skill prose; `node --test` (built-in).

**Spec:** `.claude-tweaks/pipelines/2026-10-21T181728-record-3687/work/3687-spec.md`

## Global Constraints

- The probe command is exactly `node "${CLAUDE_PLUGIN_ROOT}/bin/wrap-up-pack.js" --run "$PIPELINE_RUN_DIR" --print ledger --json "$PIPELINE_RUN_DIR/wrap-up-pack-ledger.json"` — the same form `wrap-up/SKILL.md`'s Phase 3 re-count already uses (a separate `--json` file so `wrap-up-pack.json`'s other probes stay intact). Run once read-only on this run (2026-10-21): `ok: true`, `value.files: ["docs/plans/2026-10-21-ledger-reader-ownership-ledger.md"]`, `value.unattributedFiles` = the three `2026-10-20-*-ledger.md` files inherited from `main`.
- `value.files` entry semantics (verified in `plugin/bin/lib/wrap-up/pack.js` `ledgerProbe`, lines 491-501 and 535): `ledger.md` → the run-dir file (checked first); `docs/plans/{file}` → relative to the run's worktree (`run-state.json`'s `worktree`, else cwd — `resolveInputs` line 331).
- Writers fail closed, never glob: cite `bin/lib/wrap-up/ledger-write.js`'s `resolveLedgerPath` (`unattributable` reason) — the existing convention.
- `tidy/scan-procedures.md` globs every ledger on purpose (cross-run sweep) and is **not** in scope; neither are `wrap-up/SKILL.md`/`residue-sweep.md` (already probe-keyed) nor `build/dispatch.md`'s `{ledger path}` sentence (pinned by `tests/build-sdd-ledger-residue-carryforward.test.js` — log as a follow-up observation, not edited here).
- Byte rail (`RAIL_BYTES` 52,500): `review/code-mode-steps.md` is 48,313 B (92%, near ceiling) — its edit must not grow it. `_shared/ledger-format.md` 34,554 B, `ledger/SKILL.md` 13,851 B, `wrap-up/auto-merge-short-circuit.md` 31,756 B — each grows < 1,500 B, ample headroom.
- Commit style: `{Verb} {what} — {detail}`, ending `refs #3687` (never `closes`/`fixes`) plus the `Claude-Session:` trailer.

## Review Focus

1. **Branch carrying inherited ledgers + its own** (this run's exact shape) — readers must take only `value.files`; pinned by the rule text naming `value.unattributedFiles` as another run's (Task 1 test).
2. **Run-dir `ledger.md` entry** — a reader must resolve it against the run dir, not the worktree; pinned by Task 1's assertion on the "relative to the run dir" literal.
3. **Probe `ok: false` during a delete** — `auto-merge-short-circuit.md` must delete nothing and log a `SKIP`, never fall back to a glob; pinned by Task 2's assertion.
4. **Empty `value.files`** — means "no ledger yet", never a cue to glob (which would pick an inherited ledger); pinned by Task 1's assertion on "not a cue to look further".
5. **Standalone `/claude-tweaks:ledger resolve` with a run dir but no own ledger** — must report `No ledger found for this run`, never default to the most recent (possibly inherited) ledger; pinned by Task 2's assertion.

## Spec coverage map

| AC clause | Covered by |
|---|---|
| AC1.1 — grep no longer matches a this-run lookup in the three files, only the fallback and explanatory prose | Task 1 test `AC1.1: ledger-format.md …` + Task 2 test `AC1.1/AC2.1: …` (live no-bare-glob assertion per file) |
| AC2.1 — a conformance test fails when an instruction step reintroduces the bare glob | Task 1 + Task 2 go-red controls (`AC2.1 go-red: …`) |
| AC3.1 — `npm test` passes | Common Step 5 verification (full suite via `verify.js`) |

---

### Task 1: Ownership-aware resolution rule in `_shared/ledger-format.md` + conformance suite

**Files:**
- Create: `tests/ledger-reader-ownership-conformance.test.js`
- Modify: `plugin/skills/_shared/ledger-format.md:21` (the paragraph beginning `— inside this run's own pipeline directory`)

**Interfaces:**
- Produces (in the test file, reused by Task 2): `assertNoBareGlob(text, label)` — throws when any sentence of `text` contains `GLOB_RE` (`/docs\/plans\/\*[^\s`"]*-ledger\.md/`) and none of `ALLOWED_RE` (`/fall ?back|inherited|unattributed|other run(?:'s|s')/i`); `sentences(text)` splits on `/(?<=[.!?])\s+(?=[A-Z*`(#\d-])/`; `read(rel)` reads `plugin/skills/{rel}` via `tests/helpers/read-skill.js`'s `readText`, whitespace-collapsed.

- [ ] **Step 1: Write the failing test**

```js
'use strict';
// tests/ledger-reader-ownership-conformance.test.js — pins #3687: ledger readers outside
// wrap-up resolve THIS run's ledger through the ownership-aware ledger probe
// (`wrap-up-pack.js --print ledger`'s `value.files`), never a bare `docs/plans/*-ledger.md`
// glob, which also matches ledgers inherited from the integration branch. The glob may
// survive only as the documented reader fallback, or in prose naming inherited / other
// runs' ledgers. Live-corpus read (skill-prose-conformance-tests: a convention this project
// enforces); go-red controls run the same assertion function against frozen pre-change text.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

const SKILLS = path.join(__dirname, '..', 'plugin', 'skills');
const flat = (s) => s.replace(/\s+/g, ' ');
const read = (rel) => flat(readText(path.join(SKILLS, rel)));

const GLOB_RE = /docs\/plans\/\*[^\s`"]*-ledger\.md/;
const ALLOWED_RE = /fall ?back|inherited|unattributed|other run(?:'s|s')/i;

function sentences(text) {
  return text.split(/(?<=[.!?])\s+(?=[A-Z*`(#\d-])/);
}

function assertNoBareGlob(text, label) {
  const bare = sentences(text).filter((s) => GLOB_RE.test(s) && !ALLOWED_RE.test(s));
  assert.deepStrictEqual(bare, [], `${label}: a this-run ledger lookup uses the bare docs/plans glob`);
}

function assertRuleIsProbeFirst(text) {
  assert.ok(text.includes('wrap-up-pack.js" --run "$PIPELINE_RUN_DIR" --print ledger --json "$PIPELINE_RUN_DIR/wrap-up-pack-ledger.json"'), 'rule runs the ledger probe');
  assert.match(text, /read its `value\.files`/);
  assert.match(text, /a `ledger\.md` entry is the run-dir file above \(relative to the run dir/);
  assert.match(text, /An empty `value\.files` means this run has no ledger yet — not a cue to look further/);
  assert.match(text, /`value\.unattributedFiles` lists the `docs\/plans\/` ledgers inherited from the integration branch: another run's/);
  assert.match(text, /\*\*Fallback, for a reader only:\*\*/);
  assert.match(text, /A caller that writes or deletes the ledger never takes this fallback: it fails closed/);
}

test('AC1.1: ledger-format.md resolves this run\'s ledger through the ledger probe', () => {
  const text = read('_shared/ledger-format.md');
  assertRuleIsProbeFirst(text);
  assertNoBareGlob(text, '_shared/ledger-format.md');
});

test('AC2.1 go-red: the pre-#3687 resolution rule fails the probe-first assertions', () => {
  const PRE = flat('**Resolution rule for a caller reading "the active ledger for this run":** when a run dir resolves (`$PIPELINE_RUN_DIR` or the most-recent-matching run), check `{run-dir}/ledger.md` for existence first — if it exists, that\'s the active ledger; if not, fall back to the `docs/plans/*-ledger.md` glob.');
  assert.throws(() => assertRuleIsProbeFirst(PRE));
});

test('AC2.1 go-red: a bare glob lookup sentence fails, a fallback/inherited sentence passes', () => {
  assert.throws(() => assertNoBareGlob(flat('1. Find active ledger files: glob `docs/plans/*-ledger.md`. Then show counts.'), 'fixture'));
  assert.throws(() => assertNoBareGlob(flat('LEDGER_FILE=$(git -C "$WORKTREE_PATH" ls-files "docs/plans/*-record-{n}-ledger.md")'), 'fixture'));
  assert.doesNotThrow(() => assertNoBareGlob(flat('Fallback: the `docs/plans/*-ledger.md` glob. It also matches inherited ledgers in `docs/plans/*-ledger.md`.'), 'fixture'));
});

module.exports = { assertNoBareGlob, read };
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/ledger-reader-ownership-conformance.test.js`
Expected: FAIL — `AC1.1: ledger-format.md …` fails on `rule runs the ledger probe` (the two go-red tests pass).

- [ ] **Step 3: Rewrite the paragraph at `plugin/skills/_shared/ledger-format.md:21`**

Replace the whole line-21 paragraph with these two paragraphs (exact text; every assertion above pins a literal from it):

```markdown
— inside this run's own pipeline directory (`.claude-tweaks/pipelines/{run-id}/`), which is already gitignored and commit-exempt (`_shared/auto-mode-contract.md`'s "Pipeline run directory" section) and already this run's own audit-trail home. Never committed, and never matched by the `docs/plans/*-ledger.md` fallback glob below. A run dir adopted already holding a `{run-dir}/ledger.md` written under the pre-#3036 rule keeps that file as its ledger for the rest of the run — the resolution rule below reads it consistently — rather than creating a second one; run dirs are per-run and archived at wrap-up, so no migration is needed.

**Resolution rule for a caller reading "the active ledger for this run" (#3687):** when a run dir resolves (`$PIPELINE_RUN_DIR` or the most-recent-matching run), run the ownership-aware ledger probe — `node "${CLAUDE_PLUGIN_ROOT}/bin/wrap-up-pack.js" --run "$PIPELINE_RUN_DIR" --print ledger --json "$PIPELINE_RUN_DIR/wrap-up-pack-ledger.json"` (its own `--json` file, so the `wrap-up-pack.json` another step reads keeps its other probes) — and read its `value.files`. Those are this run's ledgers: a `ledger.md` entry is the run-dir file above (relative to the run dir — the probe checks it first), and a `docs/plans/{file}` entry is relative to the run's worktree (`run-state.json`'s `worktree`, else the cwd). An empty `value.files` means this run has no ledger yet — not a cue to look further. `value.unattributedFiles` lists the `docs/plans/` ledgers inherited from the integration branch: another run's, never read, flipped, or deleted as this run's. **Fallback, for a reader only:** when the probe returns `ok: false` or cannot run (a caller already holding an `ok: false` result comes straight here, and never reads it as zero ledgers), check `{run-dir}/ledger.md` first, then the `docs/plans/*-ledger.md` glob; a caller with no run dir at all (no `$PIPELINE_RUN_DIR` resolves, and no run dir can be inferred) uses that glob only, since there is no run-dir-scoped file and no run to attribute ownership to. The glob is the fallback, never the rule, because it cannot tell this run's ledger from an inherited one: on a branch cut from an integration branch that still carries another run's ledger, every such file matches. A caller that writes or deletes the ledger never takes this fallback: it fails closed instead, as `bin/lib/wrap-up/ledger-write.js`'s `resolveLedgerPath` does (`unattributable`), since acting on an inherited ledger destroys another run's record.
```

Note: the "pre-#3036 rule keeps that file as its ledger" sentence moves up into the first paragraph and its deictic flips from "above" to "below" (the resolution rule now follows it) — `tests/flow-ledger-creation-timing-conformance.test.js`'s Gotcha-3 pin (`already holding a \`{run-dir}/ledger.md\` written under the pre-#3036 rule keeps that file as its ledger`) still matches verbatim.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/ledger-reader-ownership-conformance.test.js tests/flow-ledger-creation-timing-conformance.test.js`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add tests/ledger-reader-ownership-conformance.test.js plugin/skills/_shared/ledger-format.md
git commit -m "Resolve this run's ledger through the ownership-aware probe — ledger-format.md Location rule, glob kept as reader-only fallback (refs #3687)"
```

---

### Task 2: Repoint the three this-run ledger readers at the resolution rule

**Files:**
- Modify: `plugin/skills/ledger/SKILL.md:116`, `:126`, `:133` (the first numbered step of each Standalone Usage form)
- Modify: `plugin/skills/review/code-mode-steps.md:82` (QA Ledger Check's first sentence)
- Modify: `plugin/skills/wrap-up/auto-merge-short-circuit.md:133-150` (Ledger deletion's locate sentence + code block)
- Test: `tests/ledger-reader-ownership-conformance.test.js` (append)

**Interfaces:**
- Consumes: Task 1's `assertNoBareGlob(text, label)` and `read(rel)` (same file — append below them, before `module.exports`).
- Must keep (existing pins): `tests/auto-merge-short-circuit-ledger-deletion.test.js` — `git -C "$WORKTREE_PATH" rm "$LEDGER_FILE"`, `commit that deletion **before** the merge`, `is not an error … skip silently`, `cleanup-procedures.md … item 2`; `tests/flow-ledger-creation-timing-conformance.test.js` — QA Ledger Check section still names `` `build/worktree-setup.md` Step 4.6 `` and `` $MULTISPEC_PARENT_DIR/decisions.md` as well ``; ledger/SKILL.md Create's `resolved per \`_shared/ledger-format.md\`'s resolution rule` (unchanged lines).

- [ ] **Step 1: Write the failing test (append to the suite)**

```js
const RULE_CITE = "`_shared/ledger-format.md`'s resolution rule";
const READERS = ['ledger/SKILL.md', 'review/code-mode-steps.md', 'wrap-up/auto-merge-short-circuit.md'];

test('AC1.1/AC2.1: every repointed reader cites the resolution rule and carries no bare glob lookup', () => {
  for (const rel of READERS) {
    const text = read(rel);
    assert.ok(text.includes(RULE_CITE), `${rel} cites ${RULE_CITE}`);
    assertNoBareGlob(text, rel);
  }
});

test('ledger resolve never defaults to another run\'s ledger when a run dir resolves', () => {
  const text = read('ledger/SKILL.md');
  assert.match(text, /when the rule finds none, report `No ledger found for this run` rather than resolving another run's/);
});

test('auto-merge short-circuit deletes only value.files entries and fails closed on ok: false', () => {
  const text = read('wrap-up/auto-merge-short-circuit.md');
  assert.ok(text.includes('wrap-up-pack.js" --run "$RUN_DIR" --print ledger --json "$RUN_DIR/wrap-up-pack-ledger.json"'));
  assert.match(text, /For each `docs\/plans\/` path in the printed `value\.files`/);
  assert.match(text, /On `ok: false`, delete nothing and log one `SKIP` line/);
});

test('AC2.1 go-red: the pre-#3687 reader sentences fail the no-bare-glob assertion', () => {
  const PRE = [
    '1. Find active ledger files: glob `docs/plans/*-ledger.md`. When a run dir resolves for this invocation, also check `{run-dir}/ledger.md`.',
    'Otherwise, resolve against `docs/plans/*-ledger.md` the same way the `{feature-name}` form does above.',
    'After confirming `TEST_PASSED`, read the open items ledger (`docs/plans/*-ledger.md`, or the run-dir-scoped alternate) and filter for entries with phase `test/qa`:',
    'LEDGER_FILE=$(git -C "$WORKTREE_PATH" ls-files "docs/plans/*-record-{n}-ledger.md")',
  ];
  for (const s of PRE) assert.throws(() => assertNoBareGlob(flat(s), 'pre-change'), `must go red: ${s}`);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/ledger-reader-ownership-conformance.test.js`
Expected: FAIL — `AC1.1/AC2.1: every repointed reader …` fails (`ledger/SKILL.md` bare glob sentences), plus the resolve and auto-merge tests.

- [ ] **Step 3a: `plugin/skills/ledger/SKILL.md` — replace the three step-1 lines verbatim**

Line 116 (`/claude-tweaks:ledger`, no arguments):
```markdown
1. Find the ledgers: when a run dir resolves for this invocation (`$PIPELINE_RUN_DIR`, or the most-recent-matching run), resolve this run's own per `_shared/ledger-format.md`'s resolution rule and list it first, marked as this run's; then list every other ledger file — the probe's `value.unattributedFiles`, or on the rule's fallback the remaining `docs/plans/*-ledger.md` matches — as other runs' ledgers, never as this run's. With no run dir at all, the `docs/plans/*-ledger.md` glob is the complete listing (the rule's no-run-dir fallback).
```
Line 126 (`/claude-tweaks:ledger {feature-name}`):
```markdown
1. Match `{feature-name}` against each ledger file's `{feature}` slug (case-insensitive substring match — e.g. `auth` matches `2026-01-15-auth-refactor-ledger.md`): this run's ledger per `_shared/ledger-format.md`'s resolution rule (a run-dir `ledger.md` carries no slug and is always in the match set), plus every other `docs/plans/*-ledger.md` file — a by-name lookup the user directs, so inherited ledgers are candidates here, labeled as other runs'. With no run dir at all, the glob alone is the complete match set (the rule's no-run-dir fallback).
```
Line 133 (`/claude-tweaks:ledger resolve`):
```markdown
1. Find the ledger: a `{feature-name}` (`resolve {feature-name}`) is an explicit choice — match it the same way the `{feature-name}` form does above (no match → report `No ledger found for "{feature-name}"` and list the currently active ledgers instead of guessing). Without one, when a run dir resolves for this invocation, the active ledger is this run's per `_shared/ledger-format.md`'s resolution rule — when the rule finds none, report `No ledger found for this run` rather than resolving another run's. With no run dir at all, default to the most recent `docs/plans/*-ledger.md` (the rule's no-run-dir fallback).
```

- [ ] **Step 3b: `plugin/skills/review/code-mode-steps.md:82` — replace the sentence (net shorter; file is at 92% of the rail)**

```markdown
After confirming `TEST_PASSED`, read this run's open items ledger (per `_shared/ledger-format.md`'s resolution rule) and filter for entries with phase `test/qa`:
```

- [ ] **Step 3c: `plugin/skills/wrap-up/auto-merge-short-circuit.md` — locate step**

In the "Ledger deletion" paragraph, replace `Locate this run's ledger file in the worktree and, when one exists, delete it and commit that deletion **before** the merge call below` with `Locate this run's ledger per `_shared/ledger-format.md`'s resolution rule and, when one exists, delete it and commit that deletion **before** the merge call below` (rest of the paragraph unchanged). Replace the code block at lines 143-150 with:

````markdown
```bash
WORKTREE_PATH=$(node -e "console.log(require('$RUN_DIR/run-state.json').worktree)")
node "${CLAUDE_PLUGIN_ROOT}/bin/wrap-up-pack.js" --run "$RUN_DIR" --print ledger --json "$RUN_DIR/wrap-up-pack-ledger.json"
```

For each `docs/plans/` path in the printed `value.files`, as `LEDGER_FILE`, `git rm` it, then commit once (a `ledger.md` entry is the gitignored run-dir file — nothing to commit; archival takes it):

```bash
git -C "$WORKTREE_PATH" rm "$LEDGER_FILE"
git -C "$WORKTREE_PATH" commit -m "Wrap-up: delete resolved open items ledger for #{n} — auto-merge short-circuit"
```

This is a delete, so it never takes the resolution rule's reader fallback: a glob here can remove a ledger inherited from the integration branch — another run's. On `ok: false`, delete nothing and log one `SKIP` line via `log-decision.js` naming the probe error; the ledger stays for `/claude-tweaks:tidy`'s ledger sweep (`tidy/scan-procedures.md`).
````

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/ledger-reader-ownership-conformance.test.js tests/auto-merge-short-circuit-ledger-deletion.test.js tests/flow-ledger-creation-timing-conformance.test.js tests/wrap-up-pack-conformance.test.js`
Expected: PASS (all tests).

Then the AC1.1 grep: `grep -rn -F 'docs/plans/*-ledger.md' plugin/skills/_shared/ledger-format.md plugin/skills/ledger/SKILL.md plugin/skills/review/code-mode-steps.md` — every hit is a fallback / other-runs' / inherited sentence; `code-mode-steps.md` has none.

- [ ] **Step 5: Commit**

```bash
git add tests/ledger-reader-ownership-conformance.test.js plugin/skills/ledger/SKILL.md plugin/skills/review/code-mode-steps.md plugin/skills/wrap-up/auto-merge-short-circuit.md
git commit -m "Repoint ledger readers at the ownership-aware resolution rule — ledger, review QA check, auto-merge deletion (refs #3687)"
```
