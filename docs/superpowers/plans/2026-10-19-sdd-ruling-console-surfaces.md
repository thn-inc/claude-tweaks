# SDD-ruling ratify/reverse on the PR-hosted and multi-spec Review Consoles — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make an `sdd-ruling-*` Pending-review row resolve to ratify or reverse — never a bare decline — on the PR-hosted console (`_shared/console-on-pr.md` + `_shared/console-execution.md`) and the multi-spec console (`flow/multispec-review-console.md`), and teach the human the `reverse` verb before the refusal message.

**Architecture:** Prose-only change across six skill markdown files; every behavioral write-back stays owned by `plugin/skills/wrap-up/review-console-appendix.md`'s existing `sdd-ruling-*` bullet, which each new clause cites instead of restating. Conformance pins go into the existing `tests/build-sdd-ledger-residue-carryforward.test.js` suite (it already pins the #3401 chat-console half).

**Tech Stack:** Markdown skill prose; `node --test` conformance tests.

**Spec:** `.claude-tweaks/pipelines/2026-10-19T185713-record-3513/work/3513-spec.md` (record #3513)

## Global Constraints

- Corrected fact: the record names `wrap-up/console-execution.md`; the file is `plugin/skills/_shared/console-execution.md` (no `wrap-up/` copy exists). Every edit and grep targets the `_shared/` path.
- Read-limit rail `RAIL_BYTES` = 52,500 B (`plugin/bin/lib/skill-audit/budgets.js`). `plugin/skills/flow/multispec-review-console.md` is 47,936 B (91%, near ceiling) — Task 2 adds ≤ 700 B, leaving ≥ 3.8 KB headroom. Other files are far below the rail (console-on-pr 13,334; console-execution 16,392; review-console-interactive 20,046; console-template 18,170; multispec-console-template 15,473).
- Existing pins that must stay green: `tests/console-on-pr.test.js` asserts `**Unticked when Resolve console is ticked** = declined` (keep that bullet verbatim — add the exception beside it); `tests/build-sdd-ledger-residue-carryforward.test.js` AC5.2 asserts `A bare \`skip {#}\` on one is refused with a one-line notice naming the two` (keep verbatim — append, don't rewrite).
- Never `git stash` (repo-wide shared stack). Go-red proofs use the per-task red run, and the final scratch-worktree check in Task 4.
- Commit style: `{Verb} {what} — {detail}`, body line `refs #3513` (never `closes`/`fixes`).

## Spec coverage

| AC clause | Covered by |
|---|---|
| AC1.1 | Task 1 (console-on-pr.md, console-execution.md tests), Task 2 (multispec-review-console.md test), Task 4 Step 1 grep |
| AC2.1 | Task 3 Step 1 test, Task 4 Step 1 grep |
| AC3.1 | Each task Step 2 red run + Task 4 Step 2 scratch-worktree go-red proof |
| AC4.1 | Task 4 Step 3 full `npm test` |

## Review Focus

1. A PR-console human unticks a ruling row expecting "reverse" — the legend must say unticked = reverse for that row, while the general declined rule stays for every other row (pinned in Task 1).
2. A chat accelerator answer `reverse {#}` reaching `resolve-console` — must map to `--decline` with the reverse performed first, and the reply comment's `declined` label must not be mistaken for the record (pinned in Task 1).
3. Multi-spec `skip`/`modify`/`revert` on a ruling row — must be refused, not silently skipped (pinned in Task 2).
4. Multi-spec Approve all with a staged `sdd-ruling-*.md` — it is not a patch; `git apply` must not be attempted on it (pinned in Task 2).
5. `modify {#}`/`revert {#}` on a ruling row in the single-spec chat console — refused like `skip` (pinned in Task 3).

---

### Task 1: PR-hosted console — row label, legend exception, execution routing

**Files:**
- Modify: `plugin/skills/_shared/console-on-pr.md` (Row shape section end, before `## Legend`; Legend block; after the Legend block)
- Modify: `plugin/skills/_shared/console-execution.md` (Execution routing section; Live-session accelerator "Chat answers first" bullet)
- Test: `tests/build-sdd-ledger-residue-carryforward.test.js`

**Interfaces:**
- Produces: module-level `ws(s)` helper in the test file (hoisted from inside the AC5.1 test — same body: escape regex metachars, replace each space with `\s+`), used by Tasks 1-3's tests. Module-level consts `CONSOLE_ON_PR`, `CONSOLE_EXECUTION` (read via the file's existing `read(...)`).

- [ ] **Step 1: Write the failing tests**

Hoist `ws` to module scope (AC5.1 keeps using it unchanged). Add:

```js
const CONSOLE_ON_PR = read('plugin', 'skills', '_shared', 'console-on-pr.md');
const CONSOLE_EXECUTION = read('plugin', 'skills', '_shared', 'console-execution.md');

test('AC1.1 #3513: console-on-pr.md — an sdd-ruling-* row label carries ratify/reverse, and the legend reads unticked = reverse, never a bare decline', () => {
  assert.match(CONSOLE_ON_PR, ws('carries its two dispositions in its label'));
  assert.match(CONSOLE_ON_PR, ws('`— tick = ratify · untick = reverse`'));
  assert.match(CONSOLE_ON_PR, ws('unticked when Resolve console is ticked = **reverse** (a reversal record is filed), never a bare decline'));
  assert.match(CONSOLE_ON_PR, ws("per `wrap-up/review-console-appendix.md`'s `sdd-ruling-*` bullet"));
  assert.match(CONSOLE_ON_PR, /\*\*Unticked when Resolve console is ticked\*\* = declined/, 'the general declined rule stays');
});

test('AC1.1 #3513: console-execution.md — an unticked or --decline sdd-ruling-* item routes to reverse, citing the appendix bullet', () => {
  assert.match(CONSOLE_EXECUTION, ws('it routes to **reverse**, never to a plain decline'));
  assert.match(CONSOLE_EXECUTION, ws("per `wrap-up/review-console-appendix.md`'s `sdd-ruling-*` bullet"));
  assert.match(CONSOLE_EXECUTION, ws('Log the item as `reversed`, not declined'));
  assert.match(CONSOLE_EXECUTION, ws('`reverse {#}` to `--decline`'));
  assert.match(CONSOLE_EXECUTION, ws('the `decisions.md` `reversed` line is the authoritative record'));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test --test-name-pattern="#3513" tests/build-sdd-ledger-residue-carryforward.test.js`
Expected: FAIL after Step 1 — both new tests fail on their first `assert.match` (the phrases do not exist yet).

- [ ] **Step 3: Edit `plugin/skills/_shared/console-on-pr.md`**

(a) Insert as a new paragraph at the end of `## Row shape` (after the `isMergeRow` paragraph):

```
**An `sdd-ruling-*` row** (Pending review, #3401 — its staged file is `staged/sdd-ruling-{N}.md`)
carries its two dispositions in its label, appended after the source reference:
`— tick = ratify · untick = reverse`. Unticked at Resolve time it means reverse, never a bare
decline (Legend below).
```

(b) In the Legend block, insert directly after the `- **Unticked when Resolve console is ticked** = declined.` bullet (keep that bullet byte-identical):

```
- **Exception — an SDD ruling row** (`sdd-ruling-*`): ticked = ratify; unticked when Resolve
  console is ticked = **reverse** (a reversal record is filed), never a bare decline.
```

(c) Insert directly after the Legend's closing fence (before `## Resolve checkbox`):

```
The SDD-ruling bullet is the one exception to the declined rule: the executing session performs the
ratify or reverse write-back per `wrap-up/review-console-appendix.md`'s `sdd-ruling-*` bullet
(`_shared/console-execution.md`'s Execution routing).
```

- [ ] **Step 4: Edit `plugin/skills/_shared/console-execution.md`**

(a) In `## Execution routing`, insert a new paragraph directly after the paragraph that ends `Every executed or declined item appends its own \`_shared/auto-decision-log.md\` line.`:

```
**Except an `sdd-ruling-*` item** (staged file `staged/sdd-ruling-{N}.md`, #3401): unticked at
Resolve time, or named in `resolve-console --decline`, it routes to **reverse**, never to a plain
decline — compose and file the reversal record per `wrap-up/review-console-appendix.md`'s
`sdd-ruling-*` bullet (ledger row → `deferred`, Resolution `reversed → #{new record}`; the row stays
`open`, cause logged, when the record is refused or not created). Ticked, it is ratify (ledger row →
`accepted`, per the same bullet). Log the item as `reversed`, not declined.
```

(b) Append to the end of the Live-session accelerator's **Chat answers first** bullet (continuation lines indented two spaces, matching the bullet):

```
  A ruling row's chat `ratify {#}` maps to `--approve` and `reverse {#}` to `--decline`; perform the
  reverse (Execution routing above) before this call — the reply comment `resolve-console` posts
  records a `--decline` id as `declined`, since `console.json` items carry no staged path to tell a
  ruling apart, so the `decisions.md` `reversed` line is the authoritative record.
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test tests/build-sdd-ledger-residue-carryforward.test.js tests/console-on-pr.test.js tests/console-execution.test.js`
Expected: PASS (all tests, including the pre-existing ones).

- [ ] **Step 6: Commit**

```bash
git add plugin/skills/_shared/console-on-pr.md plugin/skills/_shared/console-execution.md tests/build-sdd-ledger-residue-carryforward.test.js
git commit -m "Route an unticked sdd-ruling row to reverse on the PR console — legend exception, execution routing, accelerator mapping" -m "refs #3513"
```

---

### Task 2: Multi-spec console — ratify/reverse on step 1 and the Override vocabulary

**Files:**
- Modify: `plugin/skills/flow/multispec-review-console.md` (`## Present the consolidated console` pr-first Option 3 description; `## On approval (option 1)` step 1; `## On override (option 2)` step 2)
- Test: `tests/build-sdd-ledger-residue-carryforward.test.js`

**Interfaces:**
- Consumes: Task 1's module-level `ws(s)`.
- Produces: module-level const `MULTISPEC_CONSOLE`.

- [ ] **Step 1: Write the failing test**

```js
const MULTISPEC_CONSOLE = read('plugin', 'skills', 'flow', 'multispec-review-console.md');

test('AC1.1 #3513: multispec-review-console.md — step 1 ratifies a ruling, Override offers ratify/reverse and refuses skip/modify/revert on one', () => {
  assert.match(MULTISPEC_CONSOLE, ws("an `sdd-ruling-*` file is no patch — Approve all ratifies it per `wrap-up/review-console-appendix.md`'s `sdd-ruling-*` bullet (reverse is Override's `reverse {#}`)"));
  assert.match(MULTISPEC_CONSOLE, ws('ratify/reverse {#} for an SDD ruling row'));
  assert.match(MULTISPEC_CONSOLE, ws("an `sdd-ruling-*` row takes only `ratify {#}`/`reverse {#}` (the appendix bullet); `skip`/`modify`/`revert` on one is refused as `wrap-up/review-console-interactive.md` refuses it"));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --test-name-pattern="multispec-review-console.md" tests/build-sdd-ledger-residue-carryforward.test.js`
Expected: FAIL after Step 1 — fails on the first `assert.match`.

- [ ] **Step 3: Edit `plugin/skills/flow/multispec-review-console.md`**

(a) `## On approval (option 1)` step 1 currently ends `…re-derived from its \`Target:\`/\`Invariant:\` preamble`. Append: `; an \`sdd-ruling-*\` file is no patch — Approve all ratifies it per \`wrap-up/review-console-appendix.md\`'s \`sdd-ruling-*\` bullet (reverse is Override's \`reverse {#}\`)`.

(b) pr-first Option 3's `description` string: after `(e.g., \"skip 6, modify 8, revert 2\")` insert `; ratify/reverse {#} for an SDD ruling row` (before `; also the only path…`).

(c) `## On override (option 2)` step 2 `Apply (per step 1), skip, or modify per item` → append ` — an \`sdd-ruling-*\` row takes only \`ratify {#}\`/\`reverse {#}\` (the appendix bullet); \`skip\`/\`modify\`/\`revert\` on one is refused as \`wrap-up/review-console-interactive.md\` refuses it`.

Then `wc -c plugin/skills/flow/multispec-review-console.md` — must stay < 52,500 (expect ≈ 48.5 KB).

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/build-sdd-ledger-residue-carryforward.test.js tests/multispec-review-console-render-not-skip.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/flow/multispec-review-console.md tests/build-sdd-ledger-residue-carryforward.test.js
git commit -m "Give multi-spec console sdd-ruling rows ratify/reverse — step 1 ratifies, Override refuses skip/modify/revert" -m "refs #3513"
```

---

### Task 3: Teach `reverse` before the refusal — interactive Override option, refusals, Pending review headings

**Files:**
- Modify: `plugin/skills/wrap-up/review-console-interactive.md` (pr-first Option 3 description ~line 52; `sdd-ruling-*` rows paragraph ~line 62)
- Modify: `plugin/skills/wrap-up/console-template.md:28` (Pending review heading)
- Modify: `plugin/skills/flow/multispec-console-template.md:27` (Pending review heading)
- Test: `tests/build-sdd-ledger-residue-carryforward.test.js`

**Interfaces:**
- Consumes: Task 1's `ws(s)`; the existing module-level `INTERACTIVE` const.
- Produces: module-level consts `CONSOLE_TEMPLATE`, `MULTISPEC_TEMPLATE`.

- [ ] **Step 1: Write the failing tests**

```js
const CONSOLE_TEMPLATE = read('plugin', 'skills', 'wrap-up', 'console-template.md');
const MULTISPEC_TEMPLATE = read('plugin', 'skills', 'flow', 'multispec-console-template.md');

test('AC2.1 #3513: review-console-interactive.md names reverse in the Override option description and refuses modify/revert on a ruling row', () => {
  const reverseLines = INTERACTIVE.split('\n').filter((l) => /reverse/.test(l));
  assert.ok(reverseLines.length >= 2, `grep -c reverse must be >= 2, got ${reverseLines.length}`);
  assert.match(INTERACTIVE, ws('ratify/reverse {#} for an SDD ruling row; also the only path that drills Q#/M#/U# individually'));
  assert.match(INTERACTIVE, ws('`modify {#}` and `revert {#}` on a ruling row are refused with the same notice, that verb in place of `skip`'));
});

test('#3513: both Pending review headings name ratify/reverse for an sdd-ruling-* row', () => {
  const heading = '#### Pending review (staged — apply, skip, or modify per item; `ratify`/`reverse` an `sdd-ruling-*` row)';
  assert.ok(CONSOLE_TEMPLATE.includes(heading), 'console-template.md heading');
  assert.ok(MULTISPEC_TEMPLATE.includes(heading), 'multispec-console-template.md heading');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test --test-name-pattern="review-console-interactive.md names reverse|Pending review headings" tests/build-sdd-ledger-residue-carryforward.test.js`
Expected: FAIL after Step 1 — count is 1 today; heading text absent.

- [ ] **Step 3: Edit the three files**

(a) `review-console-interactive.md` pr-first Option 3 `description`: after `(e.g., \"skip 5, modify 7, revert 1\")` insert `; ratify/reverse {#} for an SDD ruling row` (before `; also the only path…`).

(b) Same file, end of the `**\`sdd-ruling-*\` rows (Pending review, #3401):**` paragraph (after `…never leaves it undecided.`), append: ` \`modify {#}\` and \`revert {#}\` on a ruling row are refused with the same notice, that verb in place of \`skip\` — a ruling has no patch to modify and no commit to revert.` Leave the existing sentences byte-identical (AC5.2 pins them).

(c) Both templates: replace `#### Pending review (staged — apply, skip, or modify per item)` with `#### Pending review (staged — apply, skip, or modify per item; \`ratify\`/\`reverse\` an \`sdd-ruling-*\` row)`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/build-sdd-ledger-residue-carryforward.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/wrap-up/review-console-interactive.md plugin/skills/wrap-up/console-template.md plugin/skills/flow/multispec-console-template.md tests/build-sdd-ledger-residue-carryforward.test.js
git commit -m "Name reverse in the console Override option and Pending review headings — refuse modify/revert on a ruling row" -m "refs #3513"
```

---

### Task 4: Go-red proof and full suite (verification)

**Files:**
- Test: `tests/build-sdd-ledger-residue-carryforward.test.js` (read-only here)

- [ ] **Step 1: AC grep (AC1.1, AC2.1)**

Run: `grep -c 'sdd-ruling' plugin/skills/_shared/console-on-pr.md plugin/skills/_shared/console-execution.md plugin/skills/flow/multispec-review-console.md` → each ≥ 1. Run: `grep -c 'reverse' plugin/skills/wrap-up/review-console-interactive.md` → ≥ 2.

- [ ] **Step 2: Scratch-worktree go-red proof (AC3.1)**

Create a scratch worktree (under the session scratchpad) at the materialize commit `a3072fe98` (prose before any change), copy the final `tests/build-sdd-ledger-residue-carryforward.test.js` into it, and run `node --test --test-name-pattern="#3513" tests/build-sdd-ledger-residue-carryforward.test.js` there.
Expected: every `#3513` test FAILS (prose absent) while the pre-existing tests pass; then remove the scratch worktree. Never `git stash`. If the harness refuses the scratch worktree, cite each task's Step 2 red output as the go-red evidence instead and say so.

- [ ] **Step 3: Full suite (AC4.1)**

Run: `npm test > {scratchpad}/npm-test-3513.txt 2>&1; echo exit=$?` in the foreground.
Expected: exit 0, `ℹ fail 0`.
