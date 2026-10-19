# /claude-tweaks:capture should search open PRs for overlap before filing (#3191) Implementation Plan

**Goal:** `/claude-tweaks:capture`'s `github-issues` filing step screens a new record's title against open pull requests before filing, and posts one heuristic triage comment on the new record when an open PR overlaps.

**Spec:** `.claude-tweaks/pipelines/2026-10-19T065835-record-2933/spec-3191/work/3191-spec.md` (materialized from GitHub issue #3191)

---

### Task 1: Add the pure open-PR overlap function and wire it into capture's filing step

**Files:**
- Modify: `plugin/bin/lib/issues/recent-commit-check.js` (add + export `findOpenPrOverlap`; header comment names both screens)
- Test: `tests/bin-lib/issues/recent-commit-check.test.js`
- Modify: `plugin/skills/capture/SKILL.md` (Backend Selection, `github-issues` branch — pre-create screen + post-create comment, beside the existing **Recent-commit overlap check** paragraph)
- Modify: `docs/skill-graph.md` (`## capture` section — the `_shared/health-recent-commit-check.md` row, ~line 127, describes the open-PR screen alongside the recent-commit screen)

**Interface (decided here):** `findOpenPrOverlap({ title, prs, minTermMatches = DEFAULT_MIN_TERM_MATCHES })` → `{ prs: [{ number, title, url, matchedTerms }] }` sorted by `matchedTerms.length` descending (ties: higher `number` first), or `null` when nothing reaches the threshold or the input is unusable (non-string/empty title, `prs` not an array, entries without a string `title` are skipped). Terms come from `deriveKeyTerms(title)`; a PR matches a term when `deriveKeyTerms(pr.title)` contains it (set intersection — not substring). No network, no `gh`, no `git`. Threshold stays the module default (2) — never lowered.

- [ ] **Step 1: Failing test** — add to `tests/bin-lib/issues/recent-commit-check.test.js` (fixtures are the real incident titles, verbatim):
  - PR `{ number: 3172, title: 'bin/verify.js baseline adjudication mangles failing-file paths in a space-containing checkout path (#3155)', url: 'https://github.com/thn-inc/claude-tweaks/pull/3172' }`.
  - `AC3.1`: title of #3185 `'verify.js baseline adjudication misclassifies a flaky test as attributable when the checkout path contains a space'` → result names PR 3172, `matchedTerms` has 5 entries (`verify, baseline, adjudication, checkout, path`).
  - #3178 `'verify.js baseline isolation mis-extracts test-file paths containing a space'` → matches 3172 with 3 terms; #3189 `"bin/verify.js's --baseline adjudicator mis-extracts failing-test file paths on a checkout whose path contains a space"` → matches with 4 terms.
  - `AC3.2`: an unrelated open-PR title sharing at most one term with the candidate (e.g. candidate `'capture should list open pull requests before filing a record'` against PR 3172 plus a PR titled `'Add record snapshot invalidation to capture'`) → `null`.
  - Ranking: two matching PRs → the one with more `matchedTerms` first.
  - Unusable input → `null`: `prs` = `[]`, `undefined`, `'x'`, `{}`; empty/non-string `title`; entries missing `title` are skipped without throwing.
- [ ] **Step 2: Implement** — `findOpenPrOverlap` in `recent-commit-check.js` beside `findRecentCommitOverlap`, exported; update the module header comment (it currently describes only the commit screen) to name both screens and keep the "never the network, never `gh`" promise.
- [ ] **Step 3: Wire capture's `github-issues` filing step** (`plugin/skills/capture/SKILL.md`) — keep the edit tight (file is ~41.5 KB; add at most ~2.5 KB):
  1. **Before** the `gh issue create` branches (after `compose-record.js` writes the body), add an **Open-PR overlap check** paragraph: one plain Bash call `gh pr list --state open --json number,title,url --limit 200 > "/tmp/capture-${CLAUDE_CODE_SESSION_ID}-open-prs.json"` (plain `gh pr list`, never `--search`; `--limit` sized per `_shared/github-write-transport.md`'s "Sizing the list-then-filter window" — 16 open PRs measured 2026-10-19; a result equal to 200 reads as truncated), then one `node -e` call that reads the title from the already-written `/tmp/capture-${CLAUDE_CODE_SESSION_ID}-payload.json` (never an inline title — apostrophes break shell quoting) and the PR list file, calls `findOpenPrOverlap`, and writes its JSON result to `/tmp/capture-${CLAUDE_CODE_SESSION_ID}-open-pr-match.json`. Fail open: a non-zero `gh pr list`, non-JSON output, or a thrown function means no match file content (write `null`) and filing proceeds unchanged.
  2. `gh issue create` (native-type a/b/c, or labels) stays unchanged.
  3. **After** filing, beside the existing Recent-commit overlap check: post the existing commit comment first, then — only when the held result is non-null — one separate `gh issue comment {N} --body-file …` triage comment naming up to 5 PRs as `#{number} {title}`, stating it is a heuristic screen (open-PR overlap check, #3191), not a verdict, and never a block, hold, or absorb. Once per payload: a retry/replay of an already-screened payload does not post it again (same rule the commit check states). Any failure posting it is logged and filing is still reported as success.
  4. Add the two new temp files (`-open-prs.json`, `-open-pr-match.json`) to the existing `rm -f` cleanup line.
  5. Do not touch `_shared/health-recent-commit-check.md` (scope is capture only — it is also cited by the four health sweeps and `/intake`).
- [ ] **Step 4: Update `docs/skill-graph.md`** — in `## capture`, extend the `_shared/health-recent-commit-check.md` row (or add a sibling row for `bin/lib/issues/recent-commit-check.js`) so it states capture also runs the open-PR screen (`findOpenPrOverlap`) before `gh issue create`, posting its comment after filing — capture only, not the health sweeps.
- [ ] **Step 5: Run** `node --test tests/bin-lib/issues/recent-commit-check.test.js` — PASS; then `git grep -l "capture/SKILL.md" -- tests` and run those conformance tests — PASS. Prove the AC3.1 test goes red by temporarily returning `null` from `findOpenPrOverlap`, then restore.
- [ ] **Step 6: Commit** — one commit: `Screen capture filings against open PRs — findOpenPrOverlap + triage comment, refs #3191`.

---

## Self-review

- **Spec coverage:** Deliverable 1 → Steps 1-2; Deliverable 2 → Step 3.1-3.3; Deliverable 3 (fail open, once per payload) → Step 3.1/3.3; Deliverable 4 → Step 1; Deliverable 5 → Step 4. AC1.1 → Step 3.1 (`/claude-tweaks:capture` lists open PRs before `gh issue create`); AC2.1 → Step 3.3 (exactly one comment, never blocks); AC3.1/AC3.2 → Step 1; AC4.1 → Step 3.1/3.3 fail-open wording; AC5.1 → Common Step 5 full `npm test`.
- **Placeholders:** none.

Waived AC1.1: skill-prose behavior (ordering inside capture's filing step) — verified by the task review reading Step 3.1's prose, not a unit test; the spec names no prose conformance test.
Waived AC2.1: skill-prose behavior (one comment after filing) — verified by task review of Step 3.3; the threshold half is unit-tested by AC3.1.
Waived AC2.2: skill-prose behavior (never blocks/absorbs) — verified by task review of Step 3.3.
Waived AC4.1: skill-prose fail-open wording — verified by task review of Steps 3.1/3.3; the function's own null-on-unusable-input is unit-tested in Step 1.
Waived AC5.1: the full `npm test` run is `/claude-tweaks:build` Common Step 5's verification, not a task step.
