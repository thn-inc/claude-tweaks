# Spec-qualified brief run-comment readers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the two readers of the PR `brief` run comment read the spec-qualified `brief:{n}` marker first and fall back to the plain `brief` marker.

**Architecture:** The writer side already shipped in #2970 (`wrap-up/verification-brief.md` Step 4 posts `<!-- run-comment: brief:{spec} -->` when `$MULTISPEC_PARENT_DIR` is set; `_shared/pr-run-comments.md` documents the kind). Only the readers still match the bare marker: `engine-verify.js`'s acceptance-labeling check (so a multi-spec run's check fails today — its brief is `brief:{n}`, never bare) and `/demo`'s PR run-comment lookup. Both learn one read order: `brief:{n}` for the record being checked, else plain `brief`. A sibling's `brief:{m}` never counts.

**Tech Stack:** Node 18+ CommonJS, `node --test`, skill markdown.

**Spec:** `.claude-tweaks/pipelines/2026-10-19T202056-record-3333/work/3333-spec.md` (record #3333)

## Global Constraints

- Single-spec runs and briefs posted before this change must still resolve via the plain `<!-- run-comment: brief -->` marker (spec Deliverable 2).
- Marker comments count only from trusted authors (`scanMarkerComments` / `_shared/pr-run-comments.md`'s Trusted authors) — the qualified read goes through the same trust scan as the plain one.
- Commits: `{Verb} {what} — {detail}` style, reference the record as `refs #3333` (never `closes`/`fixes`), end with the `Claude-Session:` trailer.

## Reader inventory (Reader-inventory derivation check)

Derived from every PR/issue comment read site in `plugin/` (`--json comments`, `/comments`, `get_comments`, `.comments`):

| Read site | Reads the PR `brief` run comment? |
|---|---|
| `plugin/bin/lib/wrap-up/engine-verify.js:933` (acceptance-labeling, pointer branch) | **Yes — Task 1** |
| `plugin/skills/demo/entry-paths.md` PR run-comment lookup step 2 (Brief bullet, and Try it's brief fallback) | **Yes — Task 2** |
| `demo/entry-paths.md` issue-side `## Verification Brief` lookup, `wrap-up/verification-brief-parent-gate.md:320`, `tidy/SKILL.md:196` | No — issue/parent-side heading, never spec-qualified (parent-gate briefs are one per parent) |
| `dispatch/settle-and-merge.md`, `assess-agent-autonomy/failure-check.md`, `tidy/scan-procedures.md` | No — retry/failure-tombstone markers |
| `_shared/console-on-pr.md`, `_shared/console-execution.md`, `reconcile/console-execute.js` | No — Review Console comment |
| `_shared/pr-run-comments.md` Find / post-or-update | Writer side, keyed by `{kind}` — already handles `brief:{spec}` (#2970) |

## Spec coverage map

- AC1.1 (two briefs on a two-spec PR, neither overwrites) — writer behavior, already shipped and pinned by `tests/pr-run-comments.test.js`'s #2970 regression test ("a second spec's brief/timing post no longer collides"); Task 1's sibling-isolation test pins the read side of the same isolation.
- AC2.1 (`/demo #N` on a bundled spec renders its own brief) — Task 2.
- AC3.1 (single-spec still posts and reads the unqualified marker) — Task 1 (plain-fallback test) + Task 2 (plain marker still named second).
- AC4.1 (`npm test` passes incl. a `brief:{spec}` marker test and a fallback read test) — Task 1 + final verification.

## Review Focus

1. A PR carrying only a *sibling's* `brief:{m}` must not satisfy record `n` — Task 1 test `AC1.1: a sibling spec's brief:{m} does not satisfy #n`.
2. Record number prefix collisions (`brief:90` vs `brief:900`) — the marker match includes the closing ` -->`, so `brief:90 -->` never matches `brief:900 -->`; Task 1 test uses 900 vs a `brief:9000` decoy in the sibling test.
3. An untrusted `brief:{n}` comment alongside a trusted plain `brief` — falls through to the plain read, passes, and names the skipped comment; Task 1 test `untrusted brief:{n} falls back to a trusted plain brief`.
4. Both qualified and plain present — qualified wins; no behavior difference for the check (pass either way), so no extra test.
5. Parent-redirected targets — a parent-gate brief is never qualified, so the qualified scan on the parent number simply misses and the plain read runs as before; existing parent tests cover it unchanged.

---

### Task 1: engine-verify acceptance-labeling reads `brief:{n}` first

**Files:**
- Modify: `plugin/bin/lib/wrap-up/engine-verify.js:928-940` (the `prBrief` scan in the acceptance-labeling pointer branch)
- Test: `tests/bin-lib/wrap-up/engine-verify.test.js` (append after the existing "pr-first pointer+brief" tests, ~line 1925)

**Interfaces:**
- Consumes: existing module-local `scanMarkerComments(comments, predicate) -> { trusted: boolean, ignored: string[] }`.
- Produces: module-local `scanPrBrief(prComments, target) -> { trusted: boolean, ignored: string[] }` — scans `<!-- run-comment: brief:${target} -->` + `### Confirmed` first; when not trusted, scans the plain `<!-- run-comment: brief -->` + `### Confirmed`; `ignored` is the concatenation of both scans' notes. Not exported.

- [ ] **Step 1: Write the failing tests**

Reuse the existing `acceptanceTrustRow({ issueComments, prComments, withPr })` helper and `TRUST_POINTER_BODY` (MEMBER pointer to PR #1199, record 900). Add:

```js
const QUALIFIED_BRIEF = (n) => `<!-- run-comment: brief:${n} -->\n\n## Verification Brief\n### Confirmed\n`;
const MEMBER_POINTER = [{ body: TRUST_POINTER_BODY, url: 'https://x/p1', author: { login: 'bot' }, authorAssociation: 'MEMBER' }];

test('AC4.1: acceptance-labeling passes via a spec-qualified brief:{n} PR comment', () => {
  const { row } = acceptanceTrustRow({ withPr: true, issueComments: MEMBER_POINTER,
    prComments: [{ body: QUALIFIED_BRIEF(900), url: 'https://x/pr1', author: { login: 'bot' }, authorAssociation: 'MEMBER' }] });
  assert.strictEqual(row.result, 'pass', row.detail);
});

test("AC1.1: a sibling spec's brief:{m} does not satisfy #n", () => {
  const { row } = acceptanceTrustRow({ withPr: true, issueComments: MEMBER_POINTER,
    prComments: [901, 9000].map((m) => ({ body: QUALIFIED_BRIEF(m), url: `https://x/pr${m}`, author: { login: 'bot' }, authorAssociation: 'MEMBER' })) });
  assert.strictEqual(row.result, 'fail');
  assert.match(row.detail, /pointer to PR #1199 found but no confirmed Verification Brief on PR #1199/);
});

test('AC3.1: acceptance-labeling falls back to the plain brief marker (single-spec / pre-change brief)', () => {
  const { row } = acceptanceTrustRow({ withPr: true, issueComments: MEMBER_POINTER,
    prComments: [{ body: TRUST_PR_BRIEF_BODY, url: 'https://x/pr1', author: { login: 'bot' }, authorAssociation: 'MEMBER' }] });
  assert.strictEqual(row.result, 'pass', row.detail);
});

test('AC4.1: an untrusted brief:{n} falls back to a trusted plain brief and names the skipped comment', () => {
  const { row } = acceptanceTrustRow({ withPr: true, issueComments: MEMBER_POINTER, prComments: [
    { body: QUALIFIED_BRIEF(900), url: 'https://x/q1', author: { login: 'eve' }, authorAssociation: 'NONE' },
    { body: TRUST_PR_BRIEF_BODY, url: 'https://x/pr1', author: { login: 'bot' }, authorAssociation: 'MEMBER' },
  ] });
  assert.strictEqual(row.result, 'pass', row.detail);
  assert.match(row.detail, /ignored: skipped marker comment https:\/\/x\/q1 by eve \(NONE\)/);
});
```

- [ ] **Step 2: Run tests to verify the qualified-read test fails**

Run: `node --test --test-name-pattern="spec-qualified brief" tests/bin-lib/wrap-up/engine-verify.test.js`
Expected: FAIL after Step 1 — `row.result` is `'fail'` ("pointer to PR #1199 found but no confirmed Verification Brief"), because the check only matches the bare `<!-- run-comment: brief -->` marker. (The sibling, plain-fallback and untrusted-fallback tests already pass at base — they are guards.)

- [ ] **Step 3: Implement `scanPrBrief(prComments, target)` in `plugin/bin/lib/wrap-up/engine-verify.js`**

Define it next to `scanMarkerComments`; replace the inline `prBrief` scan with `scanPrBrief(prComments, target)`. Update the pointer-branch comment to cite `_shared/pr-run-comments.md`'s "Multi-spec brief and timing comments" read side.

- [ ] **Step 4: Run the suite file to verify all pass**

Run: `node --test tests/bin-lib/wrap-up/engine-verify.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/wrap-up/engine-verify.js tests/bin-lib/wrap-up/engine-verify.test.js
git commit -m "Read the spec-qualified brief marker first in acceptance-labeling — falls back to plain brief, refs #3333"
```

### Task 2: `/demo` PR lookup and the contract state the read order

**Files:**
- Modify: `plugin/skills/demo/entry-paths.md:219-223` (PR run-comment lookup step 2's Try it and Brief bullets)
- Modify: `plugin/skills/_shared/pr-run-comments.md` ("Multi-spec brief and timing comments (#2970)" section — append one read-side paragraph)
- Test: `tests/pr-run-comments.test.js` (append after the #2970 tests; add `const DEMO = read('plugin', 'skills', 'demo', 'entry-paths.md');` with the other fixtures)
- Pins to keep green (Moved-/Prose-held pin check): `tests/try-it-contract-conformance.test.js:224-238` (lookup must still include `<!-- run-comment: brief -->`, `try-it`, `try-it:{n}`), `tests/comment-trust-conformance.test.js:219` (step 2 item must keep its Trusted authors citation and skip notice).

**Interfaces:**
- Consumes: Task 1's read order (`brief:{n}` → plain `brief`), stated identically in prose.
- Produces: none.

- [ ] **Step 1: Write the failing tests**

```js
const DEMO_LOOKUP = DEMO.split('### PR run-comment lookup')[1].split('### Full verification pointer')[0];

test("AC2.1: demo's PR lookup reads the record's own brief:{n} before the plain brief marker", () => {
  const brief = DEMO_LOOKUP.slice(DEMO_LOOKUP.indexOf('- **Brief**'));
  const q = brief.indexOf('<!-- run-comment: brief:{n} -->');
  const plain = brief.indexOf('<!-- run-comment: brief -->');
  assert.ok(q >= 0 && plain > q, 'Brief bullet names brief:{n} first, plain brief second');
  const tryIt = DEMO_LOOKUP.slice(DEMO_LOOKUP.indexOf('- **Try it**'), DEMO_LOOKUP.indexOf('- **Brief**'));
  assert.match(tryIt, /brief/, "Try it's brief fallback uses the same read order");
  assert.doesNotMatch(tryIt, /else the `<!-- run-comment: brief -->` comment's/, 'Try it no longer names only the bare brief marker');
});

test('AC3.1: pr-run-comments.md states the qualified-first brief read with a plain fallback', () => {
  const section = COMMENTS.split('## Multi-spec brief and timing comments')[1].split('## Trusted authors')[0];
  assert.match(section, /engine-verify\.js/);
  assert.match(section, /entry-paths\.md/);
  assert.match(section, /`<!-- run-comment: brief:\{n\} -->`[\s\S]*first[\s\S]*plain `<!-- run-comment: brief -->`/);
  assert.match(section, /sibling[\s\S]*`brief:\{m\}`/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test --test-name-pattern="brief:\{n\} before|qualified-first brief read" tests/pr-run-comments.test.js`
Expected: FAIL after Step 1 — neither file names `brief:{n}` on the read side yet.

- [ ] **Step 3: Edit the prose**

`demo/entry-paths.md` step 2 bullets become (keep the step's Trusted-authors sentence untouched):
- **Try it** — `try-it:{n}` (multi-spec), else `try-it`, else the `### Try it` section of the brief comment the Brief bullet's read order finds.
- **Brief** (pointer case only) — `<!-- run-comment: brief:{n} -->` (a multi-spec run, this record's own), else `<!-- run-comment: brief -->` (single-spec, or a brief posted before #3333), carrying `### Confirmed` — `engine-verify.js`'s own read order; a sibling's `brief:{m}` never counts.

`_shared/pr-run-comments.md`: append to the #2970 section a `**Read side (#3333).**` paragraph naming both readers (`bin/lib/wrap-up/engine-verify.js`'s acceptance-labeling check, `/claude-tweaks:demo`'s PR run-comment lookup in `demo/entry-paths.md`), the order (`<!-- run-comment: brief:{n} -->` for the record being read first, then the plain `<!-- run-comment: brief -->`), why (single-spec runs and pre-change briefs still resolve), and that a sibling spec's `brief:{m}` never satisfies record `n`.

- [ ] **Step 4: Run the affected suites**

Run: `node --test tests/pr-run-comments.test.js tests/try-it-contract-conformance.test.js tests/comment-trust-conformance.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/demo/entry-paths.md plugin/skills/_shared/pr-run-comments.md tests/pr-run-comments.test.js
git commit -m "Read brief:{n} before plain brief in /demo's PR lookup — and state the read order in pr-run-comments.md, refs #3333"
```

## Build notes (Common Step 4.5 alignment)

- Beneficial: `engine-verify.js` acceptance-labeling failure detail now names the markers it looked for (`looked for brief:{n}, then brief`) — final-review Minor 3, so an operator can tell a multi-spec miss from a single-spec one (d81746d43).
- Beneficial: `_shared/pr-run-comments.md` gained a **Read side (#3333)** paragraph stating the reader order and that only the plain fallback can be shared — the contract now names its readers, not just its writer (2b322457f, softened in d81746d43).
- Update the spec (staged): spec Deliverable 1 / Current State predate #2970, which already shipped the writer and the `_shared` kind; staged as `build-deviation-1` for the Review Console.
