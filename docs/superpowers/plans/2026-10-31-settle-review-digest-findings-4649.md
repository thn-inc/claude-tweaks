# Settle 2 Below-Floor Review Digest Findings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pin the rename-old-path catch-up test to the merge decision it names, and stop a refused `review-followup-` proposal from dropping its finding silently.

**Architecture:** Two independent edits. (1) Tighten one `node --test` case in the pre-review catch-up CLI suite: it currently accepts `merged` or `conflict`. (2) Extend `wrap-up/refused-proposals.md`'s "Ledger origin" rule, which flips a refused proposal's ledger row back to `open`, so it covers `staged/review-followup-*.md` as well as `staged/ledger-record-*.md`, and pin it in the deferral-gate conformance suite.

**Tech Stack:** Node 18+ `node:test`, markdown skill prose.

**Spec:** `.claude-tweaks/pipelines/2026-10-31T110607-record-4649/work/4649-spec.md` (record #4649)

## Global Constraints

- Each Deliverables bullet is either fixed (with a test where behaviour changes) or closed out with a one-line rationale in the PR body.
- Commit messages: `{Verb} {what} — {detail}`, with `refs #4649`. Never `closes`/`fixes`.
- Touch only the files listed per task.
- Governing skill `skill-prose-conformance-tests` (Task 2), quoted: "freeze the bytes the change *replaced* as a fixture constant inside the test, then assert every pattern twice — it matches the live file, and it does **not** match the frozen excerpt". Also: "A bare `assert.throws(() => assertBlock(mutated))` is satisfied by whichever assertion fails first", so match the throw to the assertion's own message. And: "Read governed markdown through `tests/helpers/read-skill.js`'s `readText()`" (the suite's `read()` already does).
- Byte headroom: `plugin/skills/wrap-up/refused-proposals.md` is 3,964 B against the 52,500 B rail. The edit adds about 130 B.
- Prose sweep: the old rule's phrases ("came from a ledger item", "proposal refused", "Ledger origin") match only `refused-proposals.md`. `_shared/auto-decision-log.md`'s REFUSED row ("or flipped its ledger item back to `open`") is origin-agnostic, so no change. `docs/journeys/route-a-review-finding-the-release-gate-can-see-4488.md` describes staging, not refusal, so no change.

## Review Focus

- The rename fixture's merge result depends on git's rename detection. The fixture pins `GIT_CONFIG_GLOBAL`/`GIT_CONFIG_SYSTEM=/dev/null`, so a user's `merge.renames=false` cannot leak in. Task 1 asserts the merged content, not only the outcome word.
- A refused `review-followup-` proposal's ledger row must reopen (`open`), never stay a terminal `deferred` pointing at a staged file nothing will file. Task 2 pins the section text.
- The conformance assertion must read the "## Ledger origin" section only. A `review-followup` mention elsewhere in the file must not satisfy it. Task 2 slices the section.
- The parity premise: step3-routing.md writes a `review-followup` row `deferred` naming its staged path. Task 2 asserts this too, so the rule cannot outlive its reason unnoticed.
- The successful-filing path gets no write-back, by decision. It is closed out in the PR body, so no task.

---

### Task 1: Pin the rename-old-path test to `merged`

**Role:** transcription

**Files:**
- Modify: `tests/bin-lib/pre-review-catchup/cli.test.js:268-278`

**Interfaces:**
- Consumes: the file's existing `fixture()`, `invoke(f, MAIN)`, `f.run`, `f.work`, `fs`, `path`.
- Produces: nothing.

- [ ] **Step 1: Replace the either-outcome assertion in test `"overlap counts a rename's old path"`**

Replace `assert.ok(['merged', 'conflict'].includes(r.json.outcome), ...)` with:

```js
  assert.equal(r.json.outcome, 'merged');
  assert.deepEqual(r.json.overlapFiles, ['a.txt']);
  // The merge decision: rename detection carries the upstream edit into c.txt.
  f.run(f.work, ['merge-base', '--is-ancestor', 'origin/main', 'HEAD']);
  assert.equal(fs.existsSync(path.join(f.work, 'a.txt')), false);
  assert.match(fs.readFileSync(path.join(f.work, 'c.txt'), 'utf8'), /^O5$/m);
```

(The existing `overlapFiles` assertion stays, and appears once.)

- [ ] **Step 2: Run the suite**

Run: `node --test tests/bin-lib/pre-review-catchup/cli.test.js`
Expected: PASS (all tests; the tightened case passes because a 10-run probe returned `merged` each time)

- [ ] **Step 3: Commit**

```bash
git add tests/bin-lib/pre-review-catchup/cli.test.js
git commit -m "Pin the rename-old-path catch-up test to merged — asserts the edit lands in the renamed file, refs #4649"
```

### Task 2: Reopen a refused review-followup proposal's ledger row

**Role:** transcription

**Files:**
- Modify: `plugin/skills/wrap-up/refused-proposals.md` (the `## Ledger origin` section)
- Test: `tests/deferral-gate-conformance.test.js` (append after the `refused-proposals.md never hardcodes the vocabulary` test)

**Interfaces:**
- Consumes: the test file's existing `read(rel)` helper.
- Produces: nothing.

- [ ] **Step 1: Write the failing test**

```js
// --- #4649: a refused review-followup proposal reopens its ledger row, as ledger-record does ---

// The pre-change Ledger origin opening, frozen: it names only the ledger-record origin.
const PRE_CHANGE_LEDGER_ORIGIN = `## Ledger origin

When the refused proposal came from a ledger item (\`staged/ledger-record-*.md\`): set that item's
status back to \`open\` with note \`proposal refused — no defer reason\`, so the ledger's own
nothing-left-behind gate resurfaces it on the next resolve; delete the staged file (the ledger
item is the durable trace).
`;

function assertLedgerOriginCoversReviewFollowup(md) {
  const start = md.indexOf('## Ledger origin');
  assert.ok(start >= 0, 'Ledger origin section missing');
  const end = md.indexOf('\n## ', start + 1);
  const section = md.slice(start, end === -1 ? undefined : end);
  assert.ok(section.includes('`staged/ledger-record-*.md`'), 'ledger-record origin missing');
  assert.ok(section.includes('`staged/review-followup-*.md`'), 'review-followup origin missing');
}

test('refused-proposals.md Ledger origin reopens review-followup rows too (#4649)', () => {
  assertLedgerOriginCoversReviewFollowup(read('plugin/skills/wrap-up/refused-proposals.md'));
  // Go-red: the same assertion fails on the pre-change text, on its own message.
  assert.throws(() => assertLedgerOriginCoversReviewFollowup(PRE_CHANGE_LEDGER_ORIGIN), { message: 'review-followup origin missing' });
  // The premise: review writes the finding's ledger row deferred, naming the staged proposal.
  assert.ok(read('plugin/skills/review/step3-routing.md').includes('Resolution naming `staged/review-followup-{n}.md`'));
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test --test-name-pattern="Ledger origin reopens" tests/deferral-gate-conformance.test.js`
Expected: FAIL on `review-followup origin`

- [ ] **Step 3: Extend the Ledger origin paragraph**

In `plugin/skills/wrap-up/refused-proposals.md`, change the opening of `## Ledger origin` to read:

`When the refused proposal came from a ledger item (`staged/ledger-record-*.md`, or `staged/review-followup-*.md`, whose finding's ledger row `review/step3-routing.md` writes `deferred` naming that staged path): set that item's status back to `open` …`

Leave the rest of the paragraph unchanged. That covers the `proposal refused — no defer reason` note, the staged-file delete, the no-ledger-origin sentence, and the `--dry-run` paragraph.

- [ ] **Step 4: Run it to verify it passes**

Run: `node --test tests/deferral-gate-conformance.test.js`
Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/wrap-up/refused-proposals.md tests/deferral-gate-conformance.test.js
git commit -m "Reopen a refused review-followup proposal's ledger row — Ledger origin covered only ledger-record, refs #4649"
```

## Closed out in the PR body (no task)

- The successful-filing path gets no write-back. A filed `review-followup-` (or `ledger-record-`) row is already a complete `deferred` naming its `staged/…` path (`_shared/ledger-format.md`'s Resolution-text requirements). `review-console.md` "On approval" step 13 deletes the ledger right after step 7, before the merge, so a `#N` write-back would have no reader.
- AC 2 needs no change: both promoted digest lines on #1426 (materiality-a741e6c1, materiality-067f68fa) already end `→ #4649`.
