# Express-review filing dedupe Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A re-review of a partly-filed sampled express PR files no duplicate record, and the `express-review` marker still posts only once every finding is filed.

**Architecture:** `plugin/skills/_shared/express-lane.md`'s Post-merge sampling step 2 already reads earlier filings before it files (`gh issue list --search "\"express-review of PR #{pr}\" in:body"`, added by #4025), but it matches on a `{path}:{line}` that no rule makes a filed body carry, and it says nothing about a failed read. This plan makes the dedupe key part of each filed body's `Origin:` line (`express-review of PR #{pr} at {key}`), which capture's shaped-body branch renders verbatim as `Origin: {origin}` (`plugin/bin/lib/issues/record-payload.js` `specShapedBody`). It also matches that line as a whole line, and treats a failed read as a reason to file nothing (it joins the existing no-marker SKIP list). The capture-fingerprint alternative was rejected: capture's shaped-body branch passes no `fingerprint` (`plugin/skills/capture/SKILL.md` Shaped-body branch, step 3), and adding one would widen capture's contract for one caller.

**Tech Stack:** Markdown skill prose; `node --test` prose-conformance suite.

**Spec:** `.claude-tweaks/pipelines/2026-10-29T005715-record-4364/work/4364-spec.md`

## Global Constraints

- Edit only `plugin/skills/_shared/express-lane.md` (Key File), its pin suite `tests/express-lane-prose.test.js`, and the journey line that restates the rule (`docs/journeys/ship-a-small-record-on-the-express-lane-4025.md:83`, found by a behavior-change prose sweep: `git grep -n -F "express-review of PR" -- plugin tests docs`).
- `express-lane.md` is 17,916 B, against a `RAIL_BYTES` of 52,500 B: about 34.6 KB of headroom, no size risk.
- No legacy bodies need a transition rule: `gh issue list --state all --search "\"express-review of PR\" in:body"` returned `[]` at plan time, so nothing has been filed in the old origin form.
- Commit message style: `{Verb} {what} — {detail}`, with `refs #4364`, never `closes`/`fixes`.

## Review Focus

- A finding at `a.js:5` when an earlier record holds `a.js:50`: it must still be filed, because the match is on the whole line, not a substring. Pinned by the whole-line fact in Task 1.
- PR #12's sweep reading a PR #123 record (the search is token-fuzzy): it must not cite that record. The same whole-line fact covers this.
- The dedupe read fails (`gh` error or rate limit): nothing is filed and no marker is posted. Pinned by the two failed-read facts.
- A finding cited to an earlier record: it counts as filed, so the marker can post. Pinned by the counts-as-filed fact.
- A file-level finding with no line: its key is `{path}` alone. Stated in the key definition, which the Origin-key fact pins.

---

### Task 1: Per-finding Origin key, whole-line match, failed-read stop

**Role:** transcription

**Files:**
- Modify: `plugin/skills/_shared/express-lane.md:58-59` (Post-merge sampling step 2, the "File each confirmed finding" and "Post the review comment" bullets)
- Modify: `docs/journeys/ship-a-small-record-on-the-express-lane-4025.md:83`
- Test: `tests/express-lane-prose.test.js:83` (the `FACTS` array)

**Interfaces:**
- Consumes: none
- Produces: none (prose contract only)

- [ ] **Step 1: Write the failing test.** In `tests/express-lane-prose.test.js`, replace the `FACTS` entry named `'a retried sweep does not re-file a finding'` with these six entries, in this order, all `section: SAMP`. They cover AC1.1 (the first four) and AC2.1 (the fifth together with the existing `'marker only after every lens finished'` fact). The existing go-red loops exercise each one automatically. The regexes must not overlap the existing `/a failed capture/` fact: each go-red strips one regex (first occurrence) and expects exactly that fact to go red. For the same reason, the phrase `a failed capture` must stay unique in Post-merge sampling, and so must every new anchor.

```js
  { section: SAMP, re: /Each body's `Origin:` line is `express-review of PR #\{pr\} at \{key\}`, where `\{key\}` is the finding's `\{path\}:\{line\}` \(`\{path\}` alone for a file-level finding\)/, name: 'AC1.1: each filed body carries its finding key in its Origin line' },
  { section: SAMP, re: /a finding whose own `Origin:` line appears as a whole line in one of those bodies is cited in the comment by that record and not filed again/, name: 'AC1.1: a retried sweep does not re-file a finding' },
  { section: SAMP, re: /whole-line, so `a\.js:5` never matches `a\.js:50` and PR #12's records never match PR #123's/, name: 'AC1.1: the dedupe match is whole-line' },
  { section: SAMP, re: /A failed read files nothing/, name: 'AC1.1: a failed dedupe read files nothing' },
  { section: SAMP, re: /a finding cited to an earlier record counts as filed/, name: 'AC2.1: a cited finding counts as filed for the marker' },
  { section: SAMP, re: /a failed dedupe read/, name: 'AC1.1: a failed dedupe read leaves no marker' },
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/express-lane-prose.test.js`
Expected: FAIL, with `missingFacts` listing the new fact names.

- [ ] **Step 3: Edit `plugin/skills/_shared/express-lane.md`.** In the "File each confirmed finding" bullet, replace everything from `Each body names its origin as` to the end of the bullet with this exact text:

```
Each body's `Origin:` line is `express-review of PR #{pr} at {key}`, where `{key}` is the finding's `{path}:{line}` (`{path}` alone for a file-level finding); capture renders a body's `Origin:` line verbatim. The marker comment below is posted last, so a failed post leaves the PR to be reviewed again; before filing, one `gh issue list --state all --search "\"express-review of PR #{pr}\" in:body" --json number,body` read shows what an earlier, unfinished sweep already filed, and a finding whose own `Origin:` line appears as a whole line in one of those bodies is cited in the comment by that record and not filed again — whole-line, so `a.js:5` never matches `a.js:50` and PR #12's records never match PR #123's. A failed read files nothing: filing without it is what files a duplicate.
```

In the "Post the review comment" bullet, change `and every finding is filed:` to `and every finding is filed (a finding cited to an earlier record counts as filed):`, and change `A lens that returned \`BLOCKED\` or \`NEEDS_CONTEXT\`, a failed capture,` to `A lens that returned \`BLOCKED\` or \`NEEDS_CONTEXT\`, a failed dedupe read, a failed capture,`. Leave every other word in place.

In the journey file, line 83, replace `(each filed body names \`express-review of PR #{n}\`, which the retry searches for before filing)` with `(each filed body's \`Origin:\` line is \`express-review of PR #{n} at {path}:{line}\`, which the retry matches as a whole line before filing, and a failed lookup files nothing)`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/express-lane-prose.test.js`
Expected: PASS (all tests, including both go-red loops).

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/_shared/express-lane.md tests/express-lane-prose.test.js docs/journeys/ship-a-small-record-on-the-express-lane-4025.md
git commit -m "Key express-review filings by finding in their Origin line — whole-line dedupe, failed read files nothing; refs #4364"
```
