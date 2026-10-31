# Accept Verdict Labels (Expand Step) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Read `accept:*` acceptance labels everywhere `demo:*` is read, under one most-conservative-wins precedence, and add a parser for the machine-readable verdict comment. Remove nothing, and switch no writer.

**Architecture:** `record-vocabulary.js` owns the label table and one precedence function, `acceptanceOf(names)`. `acceptance.js` and every other reader call it instead of comparing strings. `accept-verdict.js` is a new pure module. The guard test stops new `demo:` literals appearing in `plugin/bin`.

**Tech Stack:** Node 18+, `node --test`, markdown skills.

**Spec:** `.claude-tweaks/pipelines/2026-10-30T132109-spec-4609-4610/spec-4610/work/4610-spec.md`

Scope keywords: demo:pending, demo:approved, demo:changes-requested, demo:approved-batch, DEMO_PENDING, DEMO_APPROVED, DEMO_CHANGES_REQUESTED, APPROVAL_PROVENANCE_LABEL

## Global Constraints

- Expand only: add the new, read both, remove nothing. No writer switches: `/demo`, wrap-up and tidy keep adding `demo:*`. **Human ruling at plan review:** `/demo` reads the acceptance facet at entry, and its verdict also removes `accept:pending` when the record carries it.
- Precedence is one rule across both vocabularies: `changes-requested` beats `pending` beats `approved` beats no verdict. **Human ruling at plan time:** this applies to `demo:pending` + `demo:approved` too, which now resolves `pending`. `tests/bin-lib/issues/acceptance.test.js:29` changes to match. It is the one deliberate exception to AC7, and the PR lists it.
- No test pinning `demo:*` behaviour is otherwise deleted or weakened; new `accept:*` cases go beside the old ones. The only other tests that may change pin prose spelling, the record-graph badge text, or the two `acceptance-gap` filter pins Task 4 names.
- Only `work-record.md`, `label-bootstrap.md` and `work-record-permission-matrix.md` list both label spellings. Other skill prose names the acceptance facet and cites `_shared/work-record.md`.
- Leave `docs/journeys/*` and `docs/plans/*` alone, except this run's own ledger: they mention `demo:*` as history.
- `plugin/bin` code uses `plugin/bin/lib/path-guard` rather than bare `fs.existsSync`/`fs.realpathSync` (`tests/path-guard-conformance.test.js`). `accept-verdict.js` is pure and needs neither.
- Test files read skill markdown through `readText` from `tests/helpers/read-skill.js` (`tests/raw-markdown-read-conformance.test.js`).
- Governing skill `work-record-facet-rename`, verbatim: "Emit one spelling, read two — forever." and "bump `LABEL_BOOTSTRAP_VERSION` in the same edit — without the bump, existing repos keep the stale marker and never re-provision the new label." and "Re-run the vocabulary sweep after every upstream merge." This record emits nothing new, so `recordPayload` and `serializeFrontmatter` are untouched and no emit-side rejection guard applies.
- Governing skill `bin-source-scan-conformance`, verbatim: "Import it: `const { stripComments, stripperVerdict, STRIPPER_VERDICT_MESSAGES } = require('./helpers/strip-comments');`." and "A scan reports `misparsed` and `unparseable` as an offender" and "`assert.deepEqual(offenders, [])` over the walk also passes when the matcher matches nothing." and "Add the stem to both lists in the commit that adds the suite." and "Walking `plugin/bin` with `fs.readdirSync(dir, { recursive: true })`" is an anti-pattern: use a manual `withFileTypes` walk.
- Commit messages use `{Verb} {what} — {detail}`, reference `refs #4610`, never a closing keyword, and end with `Claude-Session: https://claude.ai/code/session_017vXcAbLyMggDiKEFoQofDa`.

## Review Focus

1. A marker note holding `-->`, `<` or `>`: `renderVerdictMarker` escapes it and the note round-trips. Task 3 pins this.
2. A marker inside a fence, an indented block or an inline code span, including a fence opened with `~~~` and a CRLF body: rejected, never parsed as a verdict, while a well-formed block in a CRLF body parses. Task 3 pins this.
3. A record with a stale `demo:*` label and a new `accept:*` verdict: every reader agrees on one disposition. Task 2's agreement test pins this.
4. A scan filtering on "no acceptance label" over a record carrying only `accept:pending`: not reported as a gap. Task 4 pins this in the `acceptance-gap` search text.
5. JSON with a repeated key (`{"verdict":"approved","verdict":"changes-requested"}`): `JSON.parse` keeps the last, so the parser must reject it. Task 3 pins this.

---

### Task 1: One precedence function, both vocabularies

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/issues/record-vocabulary.js`
- Modify: `plugin/bin/lib/issues/acceptance.js`
- Test: `tests/bin-lib/issues/acceptance.test.js`
- Test: `tests/bin-lib/issues/record.test.js`

**Interfaces:**
- Produces: `LABELS.ACCEPT_PENDING` (`'accept:pending'`), `LABELS.ACCEPT_APPROVED`, `LABELS.ACCEPT_CHANGES_REQUESTED`; `acceptanceOf(names: string[]) -> 'changes-requested' | 'pending' | 'approved' | null`, exported from `record-vocabulary.js`; `APPROVAL_PROVENANCE_LABELS` (`['demo:approved-batch', 'accept:approved-batch']`) exported from `acceptance.js`, with the existing `APPROVAL_PROVENANCE_LABEL` export kept because skill prose requires it.
- `record-vocabulary.js` requires nothing from `acceptance.js`; the dependency runs from `acceptance.js` to `record-vocabulary.js`.

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/issues/acceptance.test.js`, and change line 29 to expect `pending` with a comment naming the human ruling:

```js
for (const x of ['pending', 'approved', 'changes-requested']) {
  test(`AC1.1: accept:${x} resolves the same disposition and facet as demo:${x}`, () => {
    assert.equal(dispositionState([`accept:${x}`]), x);
    assert.equal(dispositionState([`demo:${x}`]), x);
    assert.equal(parseRecordFacets([`accept:${x}`]).acceptance, x);
    assert.equal(parseRecordFacets([`demo:${x}`]).acceptance, x);
  });
}

test('AC3.1: mixed labels resolve to one disposition, most conservative first', () => {
  for (const [labels, want] of [
    [['accept:pending', 'demo:changes-requested'], 'changes-requested'],
    [['accept:approved', 'demo:changes-requested'], 'changes-requested'],
    [['accept:approved', 'demo:pending'], 'pending'],
    [['accept:approved', 'demo:approved'], 'approved'],
    [['accept:pending', 'accept:approved'], 'pending'],
    [['demo:pending', 'demo:approved'], 'pending'],
  ]) {
    assert.equal(dispositionState(labels), want, labels.join('+'));
    assert.equal(dispositionState([...labels].reverse()), want, `reversed ${labels.join('+')}`);
    assert.equal(parseRecordFacets(labels).acceptance, want, labels.join('+'));
  }
});

test('AC3.2: accept:approved-batch is batch provenance, like demo:approved-batch', () => {
  assert.equal(approvalProvenance(['accept:approved', 'accept:approved-batch']), 'batch');
  assert.equal(approvalProvenance(['demo:approved', 'accept:approved-batch']), 'batch');
  assert.equal(approvalProvenance(['accept:approved']), 'walkthrough');
  assert.equal(approvalProvenance(['accept:pending', 'accept:approved-batch']), null);
});
```

`parseRecordFacets` comes from `plugin/bin/lib/issues/record-vocabulary.js`. Add a case to `tests/bin-lib/issues/record.test.js` beside its existing acceptance tests. If `record.test.js` pins a last-match result for two labels, stop and report it, because that is another AC7 exception this plan does not rule on.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/bin-lib/issues/acceptance.test.js`
Expected: FAIL on the `accept:` cases.

- [ ] **Step 3: Implement.** In `record-vocabulary.js`: add the three `LABELS`, and add `acceptanceOf` checking `changes-requested`, then `pending`, then `approved`, each against both spellings. In `parseRecordFacets`, replace the three `DEMO_*` branches with one assignment from `acceptanceOf(names)` that leaves the `facet-shape.js` default `null` when nothing matches. The three old branches `continue`, so confirm no later branch in the loop relied on that: an acceptance label matches none of them. Replace the "no such precedence" comment (lines 118-120) with the rule. In `acceptance.js`: `dispositionState` returns `acceptanceOf(names) ?? 'none'`. Delete `ACCEPTANCE_BY_LABEL` and its comment, which it no longer serves; it is not exported. `approvalProvenance` reads both batch labels.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/issues/acceptance.test.js tests/bin-lib/issues/record.test.js tests/bin-lib/issues/trust.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

### Task 2: Migrate readers, the badge and the guard

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/wrap-up/engine-verify.js`
- Modify: `plugin/bin/lib/issues/merge-lane-breaker.js`
- Modify: `plugin/bin/lib/issues/trust.js`
- Modify: `plugin/bin/lib/issues/grant-sampling.js`
- Modify: `plugin/bin/lib/issues/oversight-floor.js`
- Modify: `plugin/bin/lib/skill-audit/anti-patterns.js`
- Modify: `plugin/bin/lib/record-graph/encode.js`
- Test: `tests/bin-lib/wrap-up/engine-verify.test.js`
- Test: `tests/bin-lib/issues/merge-lane-breaker.test.js`
- Test: `tests/bin-lib/issues/trust.test.js`
- Test: `tests/bin-lib/record-graph/encode.test.js`
- Test: `tests/bin-lib/record-graph/render-d2.test.js`
- Test: `tests/bin-lib/issues/local-store.test.js`
- Create: `tests/accept-label-reader-conformance.test.js`
- Modify: `tests/helpers/strip-comments.js`
- Modify: `.claude/skills/parse-signal-discipline/SKILL.md`

Waived plugin/bin/lib/console/resolve.js: no acceptance-label logic; the boundary re-validation grep for `demo:|acceptance|DEMO_` found 0 hits on the merged tip.
Waived plugin/bin/lib/issues/local-store.js: stores the bare disposition; this task only adds a round-trip test.
Waived plugin/bin/lib/issues/comment-trust.js: reused unchanged by Task 3.

**Interfaces:**
- Consumes: `acceptanceOf`, `LABELS.ACCEPT_*` from Task 1; `dispositionState` from `acceptance.js`.

Reader inventory, classified from Task 0's grep of `demo:`, `DEMO_` and `'demo'` under `plugin/bin`. `demo:` in any other file is a comment or unrelated (`candidates-app-store-readiness.js`, `tidy-report-lint/rules.js`):

| Site | Today | After |
|---|---|---|
| `engine-verify.js:918` | `labels.some((l) => l.name === 'demo:pending')` | `dispositionState(labels.map((l) => l.name)) === 'pending'`. A record with no pending label keeps the existing failure text, which `engine-verify.test.js` pins. A record whose pending label is outranked by a verdict gets its own line: `` `#${target}: pending label outranked by a verdict` `` |
| `merge-lane-breaker.js:139` | `labels.includes('demo:changes-requested')` | `dispositionState(labels) === 'changes-requested'`; `reason` is whichever spelling the record carries, preferring `demo:` so the existing pin holds |
| `trust.js:341` | `dispositionState` | unchanged; update comments at 323 and the others that name the labels |
| `grant-sampling.js:38`, `oversight-floor.js:6`, `anti-patterns.js:17` | comment | name the acceptance facet |
| `encode.js:31` | `` `demo:${…}` `` | `` `accept:${…}` `` |

- [ ] **Step 1: Write the failing tests**

```js
// tests/bin-lib/issues/merge-lane-breaker.test.js
test('AC2.1: accept:changes-requested trips the breaker exactly as demo:changes-requested does', () => { /* same fixture as line 149, label swapped; expect { action: 'trip', reason: 'accept:changes-requested' } */ });

// tests/bin-lib/wrap-up/engine-verify.test.js
test('AC1.1: accept:pending satisfies the pending-label check', () => { /* the existing demo:pending passing fixture, label swapped */ });
test('AC3.1: engine-verify agrees on mixed labels', () => { /* accept:approved + demo:pending passes; demo:pending + demo:changes-requested fails with the outranked line, not the missing line; no pending label keeps the missing line */ });

// tests/bin-lib/issues/trust.test.js: accept:* twins of the batch tests at lines 789 and 798
test('AC3.2: accept:approved-batch counts as approvedBatch and batchOnly, exactly as demo:approved-batch does', () => { /* assert approvedBatch, batchOnly and the mixed verdict */ });

// tests/bin-lib/record-graph/encode.test.js
test('AC6.1: a record whose acceptance facet is approved renders the badge accept:approved', () => { /* … */ });

// tests/bin-lib/issues/local-store.test.js
test('AC6.1: the acceptance field round-trips pending, approved and changes-requested', () => { /* writeRecord then readRecord per value */ });
```

`tests/accept-label-reader-conformance.test.js` holds three tests:

- `AC3.1`: for each mixed pair in Task 1's table, `dispositionState`, `parseRecordFacets`, `classifyWatchedRecord` and `trustRows` agree: the lane breaker trips only for `changes-requested`, and the trust cell counts the same bucket. `engine-verify`'s agreement is pinned in `engine-verify.test.js`, by the Step 1 case below.
- `AC3.3`: "no reader sees `accept:pending` as no acceptance state": walk every `plugin/bin` module whose stripped source uses `LABELS.DEMO_` or a `demo:` literal. For each, assert it is in the classified list above, so a new reader fails this test. For each module in the list, run its branch with `accept:*` and `demo:*` and assert the outcome matches.
- Guard: strip comments with `stripComments` from `tests/helpers/strip-comments.js`, check `stripperVerdict`, and fail on any `demo:(pending|approved|changes-requested|approved-batch)` in `plugin/bin` code outside `{ record-vocabulary.js, acceptance.js, engine-verify.js, merge-lane-breaker.js }`, reporting a `stripperVerdict` mis-parse as an offender, with floors on both files walked and literal sites matched, and self-tests asserting exact flagged lines: a live literal flags, a comment naming the label does not, `accept:pending` does not, and a planted mis-parse is an offender. Literals are the target, so use keep mode, not `literals: 'blank'`. Follow the shape of `tests/windows-hide-spawn-conformance.test.js`, and add this test's stem to `tests/helpers/strip-comments.js`'s header and `parse-signal-discipline` item 15, as `tests/strip-comments-callers-twin.test.js` requires.

Update the three pins in `encode.test.js:42,47` and `render-d2.test.js:31`. The PR lists them.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/accept-label-reader-conformance.test.js`
Expected: FAIL, because `merge-lane-breaker.js` and `engine-verify.js` still compare `demo:` strings, so the mixed-pair and `accept:pending` branch checks go red.

- [ ] **Step 3: Implement** per the table.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/accept-label-reader-conformance.test.js tests/bin-lib/wrap-up/engine-verify.test.js tests/bin-lib/issues/merge-lane-breaker.test.js tests/bin-lib/issues/trust.test.js tests/bin-lib/issues/grant-sampling.test.js tests/bin-lib/issues/local-store.test.js tests/bin-lib/record-graph/encode.test.js tests/bin-lib/record-graph/render-d2.test.js tests/strip-comments-callers-twin.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

### Task 3: The verdict marker module

**Role:** judgment
**Review risk:** high

**Files:**
- Create: `plugin/bin/lib/issues/accept-verdict.js`
- Create: `tests/bin-lib/issues/accept-verdict.test.js`

**Interfaces:**
- Consumes: `isTrustedComment` from `comment-trust.js`, which takes a comment object; pass `{ authorAssociation }`.
- Produces: `renderVerdictMarker(obj) -> string` (throws on an invalid object, since the plugin's own callers are its only input); `parseVerdictMarker({ body, authorAssociation }) -> { ok: true, verdict } | { ok: false, reason }`, never throwing; `verdictAgreement({ labels, verdict }) -> { action: 'proceed' | 'none', note?: 'verdict label and comment disagree' }`.

Format, from the spec: one single-line comment, `<!-- accept-verdict: {"v":1,"verdict":"changes-requested","choice":"fix-forward","note":"text"} -->`. `v` must be `1`. `verdict` is `approved` or `changes-requested`. `choice` (`fix-forward` | `revert-now`) is required with `changes-requested` and rejected with `approved`. `note` is a string of at most 2000 characters. Unknown fields are rejected. The JSON escapes `<` as `\u003c` and `>` as `\u003e` (human ruling at plan review), so `JSON.parse` decodes them with no extra code. A raw `<` or `>` anywhere in the JSON is rejected, which also rejects a raw `-->`. When writing the code, build these from a backslash and `u003c`; a copied literal has already lost its backslash once in this record's text.

- [ ] **Step 1: Write the failing tests.** Each named reason below is asserted by `result.ok === false` and a non-empty `result.reason`, and each case is wrapped so an exception fails the test:

```js
const good = '<!-- accept-verdict: {"v":1,"verdict":"changes-requested","choice":"fix-forward","note":"x"} -->';
test('AC4.1: a well-formed block from a trusted comment parses', () => { /* OWNER, MEMBER and COLLABORATOR each give { ok: true, verdict: {…} } */ });
test('AC4.1: each malformed block is { ok: false }, never an exception', () => {
  /* an unterminated comment; v: 2; an unknown verdict word; choice missing with changes-requested;
     choice present with approved; a 2001-character note (and a 2000-character one parses); an unknown field;
     a repeated JSON key; a block in a ``` fence, a ~~~ fence, an indented block and an inline span;
     a second block in one comment; a block broken across lines; a body that is not a string; a raw `<` or `>` inside a note */
});
test('AC4.1: a well-formed block from an untrusted comment is rejected', () => { /* NONE, and no association field */ });
test('AC4.1: CRLF bodies: a well-formed block parses, and a fenced or indented block is rejected', () => { /* normalize line endings before masking; GitHub web comments are typically CRLF */ });
test('AC4.2: a note holding --> is rejected unescaped and round-trips through render', () => {
  /* the raw form from a hand-built comment is rejected; render({ note: 'a --> b <c>' }) parses back to the same note, and the rendered text holds no raw --> before the closing one */
});
test('AC4.3: a verdict that disagrees with the label yields no action and the note', () => {
  /* labels accept:approved with verdict changes-requested → { action: 'none', note: 'verdict label and comment disagree' }; matching labels → { action: 'proceed' }; a stale demo:pending beside accept:approved reads pending, so an approved marker also disagrees */
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/bin-lib/issues/accept-verdict.test.js`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement.** Pure: require only `comment-trust.js` and `acceptance.js`. Check trust first. Mask code regions before searching, so a fence or span cannot hide a real block from the duplicate count; treat any block found in a masked region as a rejection. Detect repeated keys by scanning the JSON text with a small tokenizer rather than comparing `JSON.parse`'s output, which has already dropped them. Add a comment naming the trust limit, `#3358`, as `comment-trust.js` documents it.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/bin-lib/issues/accept-verdict.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

### Task 4: Shared contracts and the scan's read sites

**Role:** integration

**Files:**
- Modify: `plugin/skills/_shared/label-bootstrap.md`
- Modify: `plugin/skills/_shared/work-record.md`
- Modify: `plugin/skills/_shared/work-record-permission-matrix.md`
- Modify: `plugin/skills/_shared/pr-run-comments.md`
- Modify: `plugin/skills/_shared/github-pr-scan-acceptance.md`
- Test: `tests/bin-lib/issues/labels.test.js`
- Test: `tests/acceptance-scan-server-filter.test.js`
- Test: `tests/pr-run-comments.test.js`

Headroom: `github-pr-scan-acceptance.md` is at 46,898 B of the 52,500 B rail, and this adds about 150 B. The others have more room.

- [ ] **Step 1: Write the failing tests,** appended to the existing files. Append to `tests/bin-lib/issues/labels.test.js`: `test('AC5.1: LABELS_JSON holds the three accept labels and accept:approved-batch', …)`, reading the fence through the file's `extractCanonicalLabels`. `pr-run-comments.test.js`: the registry names `accept-verdict`. `acceptance-scan-server-filter.test.js`: the `acceptance-gap` search excludes all three `accept:` labels and the queue query reads `label:demo:pending,accept:pending`. Update its two existing pins, the exact-string regex at line 99 and the `deepEqual` at line 120, to the six-label form. They widen coverage and every `demo:*` assertion stays; the PR lists both under AC 7.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/bin-lib/issues/labels.test.js`
Expected: FAIL on the new AC5.1 case; the existing cases in this file keep passing. Then run `node --test tests/acceptance-scan-server-filter.test.js tests/pr-run-comments.test.js`, which fails on their new cases too.

- [ ] **Step 3: Edit.**
- `label-bootstrap.md`: add four rows after the `demo:` rows, in the same colour, descriptions under 100 characters, and bump `LABEL_BOOTSTRAP_VERSION` in the same edit. Bootstrapping these labels creates them; it does not write them to a record.
- `work-record.md`: lines 53-54 and 104-105 list both spellings. Replace line 266's "mutually exclusive by construction" with the precedence rule. Next to the acceptance facet, document the marker, the label-versus-marker disagreement rule and the trust limit (`#3358`).
- `work-record-permission-matrix.md`: `accept:*` takes the same who-may-set rules as each `demo:*` twin, as "reserved until the accept-skill record switches the writers", so no skill gains a write it does not perform.
- `pr-run-comments.md`: a registry row for `accept-verdict`. It is written by Dispatch or the human, never the plugin, and is not a `run-comment` kind.
- `github-pr-scan-acceptance.md:26`: `gh issue list --search "label:demo:pending,accept:pending" --state all --json number,title --limit 200`. Verbatim-command probe, run at plan time: `gh issue list --repo thn-inc/claude-tweaks --search "label:demo:pending,accept:pending" --state all --json number --limit 3` returned rows. Line 73: add `-label:accept:approved -label:accept:changes-requested -label:accept:pending`. Lines 20, 36 and 701-702 name the facet.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/issues/labels.test.js tests/acceptance-scan-server-filter.test.js tests/pr-run-comments.test.js tests/comment-trust-conformance.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

### Task 5: Remaining prose consumers

**Role:** integration

**Files:**
- Modify: `plugin/skills/wrap-up/verification-brief-parent-gate.md`
- Modify: `plugin/skills/wrap-up/verification-brief.md`
- Modify: `plugin/skills/wrap-up/auto-merge-short-circuit.md`
- Modify: `plugin/skills/wrap-up/execution-and-verification.md`
- Modify: `plugin/skills/wrap-up/review-console.md`
- Modify: `plugin/skills/wrap-up/SKILL.md`
- Modify: `plugin/skills/tidy/actions-github-issues.md`
- Modify: `plugin/skills/tidy/scan-procedures.md`
- Modify: `plugin/skills/tidy/SKILL.md`
- Modify: `plugin/skills/tidy/step-6-auto.md`
- Modify: `plugin/skills/tidy/step-1-records.md`
- Modify: `plugin/skills/backlog/refine-headless.md`
- Modify: `plugin/skills/backlog/refine-mode.md`
- Modify: `plugin/skills/backlog/overview-mode.md`
- Modify: `plugin/skills/dispatch/settle-and-merge.md`
- Modify: `plugin/skills/help/status-scan.md`
- Modify: `plugin/skills/visualize/record-graph.md`
- Modify: `plugin/skills/flow/summary-template.md`
- Modify: `plugin/skills/_shared/trust-table.md`
- Modify: `plugin/skills/_shared/acceptance-labeling-landed.md`
- Modify: `plugin/skills/_shared/autonomy-ceiling.md`
- Modify: `plugin/skills/_shared/try-it.md`
- Modify: `plugin/skills/_shared/policy-schema.md`
- Modify: `plugin/skills/demo/SKILL.md`
- Modify: `plugin/skills/demo/entry-paths.md`
- Modify: `plugin/skills/demo/legacy-brief-compatibility.md`
- Modify: `docs/getting-started.md`
- Modify: `docs/skill-graph.md`
- Modify: `docs/plugin-structure.md`
- Test: `tests/comment-trust-conformance.test.js`
- Test: `tests/acceptance-labeling-landed-check.test.js`
- Test: `tests/tidy-arm-ready-pr-acceptance-guard.test.js`
- Test: `tests/auto-merge-short-circuit-ledger-deletion.test.js`
- Test: `tests/below-floor-parent-close-conformance.test.js`
- Test: `tests/try-it-contract-conformance.test.js`

Waived docs/journeys: history, per the spec Gotchas. A journey describing a label this build changes is the journeys step's call, at Common Step 6.
Waived CHANGELOG.md: append-only history.
Waived README.md: names the label only if the Step 3 grep finds it; then it is edited here.
Waived tests/bin-lib/backlog-grant-gate/backlog-grant-gate.test.js: a behaviour fixture, unchanged.
Waived tests/bin-lib/console/fixtures/staged/reflect-table-3877.md: a recorded fixture, unchanged.
Waived tests/bin-lib/issues/grant-sampling.test.js: a behaviour fixture, unchanged.
Waived tests/bin-lib/record-graph/fixtures.js: its `demo:pending` input keeps pinning the old read path; the badge change is in the assertions.

Waived AC7.1: Global Constraints carry it, with the one human-ruled exception at `acceptance.test.js:29`; review checks the diff.
Waived AC7.2: Global Constraints carry it, and each task adds its `accept:*` cases beside the `demo:*` ones.
Waived AC7.3: review checks the PR body lists each changed test; the PR summary names them at the build phase exit.
Waived AC7.4: Common Step 5 runs `npm test` through the verify runner.

Headroom, of the 52,500 B rail: `_shared/policy-schema.md` 52,130 B, `tidy/scan-procedures.md` 51,400 B, `tidy/step-6-auto.md` 50,504 B, `dispatch/settle-and-merge.md` 47,575 B. These edits must be net-zero or smaller: "the pending acceptance label" replaces `demo:pending` at about +14 B each, so cut words elsewhere in the same sentence.

Classify each hit of `git grep -n -E "demo:(pending|approved|changes-requested)" -- plugin/skills` in the files above:

| Hit | Action |
|---|---|
| A command that writes a label (`gh issue edit --add-label demo:pending`) | Unchanged: no writer switches |
| A command or filter that reads a label | Read both, as Task 4 does |
| A sentence describing the state or the rule | Name the facet ("the pending acceptance label"), cite `_shared/work-record.md` once per file if it does not already |
| A sentence stating what a skill writes | Unchanged while it is true |
| `demo/entry-paths.md:56,95` and any other `/demo` branch on the label | Branch on the record's acceptance facet being `pending` |
| `demo/SKILL.md:264` and the other verdict writes | Still add only `demo:*`; also remove `accept:pending`, only when the record carries it, because `gh issue edit --remove-label` errors on a label the repo has never created |

- [ ] **Step 1: Run the moved-prose check.** For each sentence you will reword, `git grep -n -F '{distinctive phrase}' -- tests plugin`. Each hit in `tests/`, or in a skill file a test reads, is a pin to update in this task, under the prose-spelling exception. Record any behaviour pin as a stop, not an edit.
- [ ] **Step 2: Run to confirm the current state**

Run: `node --test tests/try-it-contract-conformance.test.js`
Expected: PASS. This task changes prose only, so nothing goes red first.

- [ ] **Step 3: Edit per the table,** one file at a time, then re-run the sweep: `git grep -n -E "demo:(pending|approved|changes-requested)" -- plugin/skills docs/getting-started.md docs/skill-graph.md docs/plugin-structure.md .claude/skills`. Every hit left must be a writer statement or sit in a contract file.
- [ ] **Step 4: Verify.**

Run: `node --test tests/comment-trust-conformance.test.js tests/acceptance-labeling-landed-check.test.js tests/tidy-arm-ready-pr-acceptance-guard.test.js tests/auto-merge-short-circuit-ledger-deletion.test.js tests/below-floor-parent-close-conformance.test.js tests/try-it-contract-conformance.test.js tests/ceremony-profile-roster.test.js`
Expected: PASS. Also run `wc -c` on the four near-rail files; each stays under 52,500.

- [ ] **Step 5: Commit**
