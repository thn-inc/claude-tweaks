# Learned-skills PR scan + tidy drain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `github-pr-scan.md` item 9 offers a `<!-- wrap-up-skills-pr -->` PR as a `[pr-unarmed]` candidate only when `learned-skills-auto-merge` resolves `true`, and `/claude-tweaks:tidy` Step 6 gets one row that runs `learned-skills-pr.js drain` for those candidates.

**Architecture:** Prose-as-implementation. The scan stays read-only: its first `node -e` filter admits a marker PR only on the literal `true` key value (fail closed), and its classifier grants a marker PR through the key alone, before the housekeeping and record-grant branches. Tidy's new Step 6 row and a new `## Drain learned-skills PRs` action in `tidy/actions-github-issues.md` call the existing `drain` verb, which re-reads the lever and re-checks green/gate itself. Both governed files sit at the read rail, so rationale moves out to new appendix sub-files first.

**Tech Stack:** Markdown skill files, `node --test` conformance suites.

**Spec:** `.claude-tweaks/pipelines/2026-11-24T085629-record-6114/work/6114-spec.md`

Scope keywords: wrap-up-skills-pr, never a candidate, learned-skills-auto-merge

## Global Constraints

- Rail: `RAIL_BYTES` = 52,500 (`plugin/bin/lib/skill-audit/budgets.js`). `plugin/skills/_shared/github-pr-scan.md` and `plugin/skills/tidy/step-6-auto.md` each end ≤ 52,200 B (≥ 300 B margin) with the new text in.
- The key is read exactly as `HOUSEKEEPING_GRANT` is: `LEARNED_SKILLS_GRANT=$(node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" --values learned-skills-auto-merge)`; only the literal string `true` grants. Unset, empty, or anything else → not a candidate.
- A marker PR is never granted by `housekeeping-auto-merge` or by a linked record's `auto:build`/`auto:merge`.
- Tidy command, verbatim: `node "${CLAUDE_PLUGIN_ROOT}/bin/learned-skills-pr.js" drain --run "{run-dir}" --integration-branch {integration-branch}` (the CLI requires `--run`; tidy always has a run dir — pipeline or Standalone auto fallback).
- Moved rationale is moved verbatim, never deleted; the source file cites the appendix where the text was.
- Skill-graph edges live once, in `docs/skill-graph.md`.
- Commit style: `{Verb} {what} — {detail}`, body ends `refs #6114` and the session trailer.

## Review Focus

- A marker PR that also carries `<!-- wrap-up-residue-pr -->` with `housekeeping-auto-merge=true` and the key `false` — must not be a candidate (Task 1 test).
- A marker PR that also carries a run marker and links an `auto:build`+`auto:merge` record with the key unset (`''`) — must not be a candidate, and the classifier must not print "granted" (Task 1 tests).
- Key value `TRUE`/`yes`/`1` — not the literal `true`, so not a candidate (Task 1 test, one non-literal value).
- A marker PR still draft, armed, too young or red with the key `true` — still excluded by the existing gates (Task 1 test: one draft marker PR).
- A generic Arm ready PR row picking up a marker PR — fenced out in prose, pinned by Task 2's row test.

---

### Task 1: Scan item 9 admits marker PRs only through `learned-skills-auto-merge`

**Files:**
- Create: `plugin/skills/_shared/github-pr-scan-rationale.md`
- Modify: `plugin/skills/_shared/github-pr-scan.md`
- Modify: `docs/skill-graph.md`
- Modify: `plugin/skills/_shared/policy-schema.md`
- Modify: `docs/journeys/review-a-runs-learned-skill-edits-on-their-own-pr-5290.md`
- Modify: `docs/plugin-structure.md`
- Test: `tests/sweep-backstop.test.js`
- Test: `tests/wrap-up-learned-skills-pr.test.js`

**Interfaces:**
- Produces: env var `LEARNED_SKILLS_GRANT` read by item 9's first filter script and its classifier script; the classifier's granted line for a marker PR: `'[pr-unarmed] PR #' + pr.number + ': ' + pr.title + ' — green, learned-skills-auto-merge on — drain per tidy/actions-github-issues.md'` (Task 2's action resolves these).
- Produces: item 9 prose sentence (replaces line 154's never-a-candidate sentence): ``A `<!-- wrap-up-skills-pr -->` PR (`wrap-up/learned-skills-pr.md`) is a candidate only when `learned-skills-auto-merge` resolves `true` — never under `housekeeping-auto-merge` or a linked record's `auto:merge` grant; an unset or unreadable key is not `true`, so the PR is not a candidate (fail closed). `/claude-tweaks:tidy` drains it (`tidy/actions-github-issues.md`'s `## Drain learned-skills PRs`); it is never armed.``

- [ ] **Step 1: Replace the never-a-candidate test in `tests/sweep-backstop.test.js` (AC1.1, AC2.1)**

Replace test `"item 9's filter never offers a wrap-up-skills-pr PR, even with a run marker and a granted record"` (keep its fixtures 3001/3002; never delete the pin) with:
- `"item 9's filter offers a wrap-up-skills-pr PR only through learned-skills-auto-merge"`: `assert.match(ITEM9, /<!-- wrap-up-skills-pr -->[^\n]*candidate only when `learned-skills-auto-merge` resolves `true`/)`; `assert.match(ITEM9, /resolve-policy\.js" --values learned-skills-auto-merge/)`. Run the filter script (index 0) once per env: `LEARNED_SKILLS_GRANT='true'` → candidates include 3001 and 3002; `'false'` → neither; `''` (unset) → neither; `'TRUE'` → neither. Add fixture 3003: marker PR with `isDraft: true` → excluded under `'true'`. Pass `HOUSEKEEPING_GRANT: 'true'` in every env so the housekeeping lever is proven irrelevant.
- `"item 9's classifier grants a wrap-up-skills-pr PR through the key alone, never housekeeping or a record grant"`: extract the classifier script (the one containing `labelsByIssue`), substitute `$PR_SCAN_UNARMED_CANDIDATES`/`$PR_SCAN_UNARMED_LINKS` with temp paths (same `toPosix` splice as `isolateItem9`), candidate = fixture 3002 (run marker + skills marker, `closingIssuesReferences: [{number: 5290}]`), links file = `{"number":5290,"labels":["auto:build","auto:merge"]}`. With `LEARNED_SKILLS_GRANT='false'`, `HOUSEKEEPING_GRANT='true'` → stdout matches `/green but ungranted/` and not `/green and granted|drain per/`. With `LEARNED_SKILLS_GRANT='true'` → stdout matches `/learned-skills-auto-merge on — drain per tidy\/actions-github-issues\.md/` and not `/arm per/`.

In `tests/wrap-up-learned-skills-pr.test.js` add `test('github-pr-scan.md item 9 pins the learned-skills-auto-merge rule, not the never-armed wording (AC3.1)')`: read `plugin/skills/_shared/github-pr-scan.md`; `assert.doesNotMatch(scan, /wrap-up-skills-pr -->` PR[^\n]*is never a candidate/)`; `assert.match(scan, /is a candidate only when `learned-skills-auto-merge` resolves `true` — never under `housekeeping-auto-merge` or a linked record's `auto:merge` grant/)`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/sweep-backstop.test.js tests/wrap-up-learned-skills-pr.test.js`
Expected: FAIL after Step 1 (item 9 still refuses the marker)

- [ ] **Step 3: Make rail room in `github-pr-scan.md`**

Create `plugin/skills/_shared/github-pr-scan-rationale.md` (title `# GitHub PR Scan — Rationale Appendix`, one-line preamble: cited from `github-pr-scan.md`; holds the why behind rules stated there, never a rule an agent must follow). Move verbatim, each under a heading naming its source item, leaving a short cite (``(why: `github-pr-scan-rationale.md`)``) at the cut:
1. Item 1's ` but "informational" describes the *severity* … not a deliberate no-command finding.` sentence span (line 88).
2. Item 9's ``The `bot:blocked`/`bot:parked` exclusion is what keeps this sweep from un-parking a parked run: … a later-green rollup does not retract the park.`` (line 224).
3. Item 11's text after the bold lead `**Flag-only, never auto-rebase.**` (line 411) — the lead stays (pinned by `tests/close-out-pr-state-contract-conformance.test.js`).
4. The `**Anti-pattern: a self-scheduled per-PR check-in loop.**` body after its first sentence (line 435).
Grep `tests/` and `tools/` for each moved span's distinctive phrase before moving; if one is pinned, keep it and pick another rationale span instead. Add the new file to `docs/plugin-structure.md`'s `_shared` listing beside the other `github-pr-scan-*.md` siblings.

- [ ] **Step 4: Implement the item 9 rule**

In `github-pr-scan.md` item 9: replace the never-a-candidate sentence with the Interfaces sentence. In the first fence add `LEARNED_SKILLS_GRANT=$(node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" --values learned-skills-auto-merge)` beside `HOUSEKEEPING_GRANT=`; prefix the filter's `node -e` with `LEARNED_SKILLS_GRANT="$LEARNED_SKILLS_GRANT"`; replace `if (/<!-- wrap-up-skills-pr -->/.test(pr.body || '')) return false;` with `const isSkills = /<!-- wrap-up-skills-pr -->/.test(pr.body || ''); if (isSkills && process.env.LEARNED_SKILLS_GRANT !== 'true') return false;` and make the final return `isSkills || RUN_MARKER.test(...) || HOUSEKEEPING_MARKER.test(...)`. In the classifier fence prefix `LEARNED_SKILLS_GRANT="$LEARNED_SKILLS_GRANT"`, and branch first on the skills marker: granted iff `process.env.LEARNED_SKILLS_GRANT === 'true'`, printing the Interfaces drain line; otherwise the existing housekeeping/record branches unchanged. Add one row to item 9's findings table area only if the Output Contract's `[pr-unarmed]` line needs the drain recommendation named (keep it to one clause).
Update `docs/skill-graph.md`'s `_shared/github-pr-scan.md` row (currently "Item 9 never arms a `<!-- wrap-up-skills-pr -->` PR …") to: item 9 offers it only when `learned-skills-auto-merge` is `true`, never via `housekeeping-auto-merge` or a record grant, and `/tidy` drains it. Update `policy-schema.md`'s `learned-skills-auto-merge` row ("item 9 is wired by a sibling") to say item 9 and tidy Step 6 read it. Update the journey's line 47 sentence the same way.

Proof(irreversible-side-effect): the only irreversible write is a merge, and the scan never merges — it reports; tidy's drain row runs `learned-skills-pr.js drain`, which re-reads `learned-skills-auto-merge` itself (`{disabled:true}` on anything but `true`) and re-checks green and scope per PR before its one `gh pr merge`, while the scan's filter fails closed on every non-literal-`true` key value, pinned by Task 1's false/unset/`TRUE` cases.

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test tests/sweep-backstop.test.js tests/wrap-up-learned-skills-pr.test.js tests/close-out-pr-state-contract-conformance.test.js`
Expected: PASS. Then `wc -c plugin/skills/_shared/github-pr-scan.md` → ≤ 52200.

- [ ] **Step 6: Commit**

```bash
git add plugin/skills/_shared/github-pr-scan.md plugin/skills/_shared/github-pr-scan-rationale.md plugin/skills/_shared/policy-schema.md docs/skill-graph.md docs/journeys/review-a-runs-learned-skill-edits-on-their-own-pr-5290.md docs/plugin-structure.md tests/sweep-backstop.test.js tests/wrap-up-learned-skills-pr.test.js
git commit -m "Let item 9 offer learned-skills PRs under learned-skills-auto-merge — fail closed on any other key value"
```

### Task 2: Tidy Step 6 drain row and action

**Files:**
- Create: `plugin/skills/tidy/step-6-rationale.md`
- Modify: `plugin/skills/tidy/step-6-auto.md`
- Modify: `plugin/skills/tidy/actions-github-issues.md`
- Modify: `plugin/skills/tidy/SKILL.md`
- Modify: `docs/plugin-structure.md`
- Test: `tests/sweep-backstop.test.js`

**Interfaces:**
- Consumes: Task 1's classifier drain line and item 9 sentence.
- Produces: Step 6 row starting `| **Drain learned-skills PR** (`; action heading `## Drain learned-skills PRs` in `actions-github-issues.md`.

- [ ] **Step 1: Write the failing tests in `tests/sweep-backstop.test.js` (AC1.1)**

- `'step-6-auto.md: the Drain learned-skills PR row auto-applies at the arm row\'s tiers only under learned-skills-auto-merge, and names its carve-out'`: `row = STEP6.match(/\| \*\*Drain learned-skills PR\*\*[^\n]*\n/)`; assert it; `assert.match(row[0], /\| Stage \| Auto-apply — only under `learned-skills-auto-merge`[^|]*\| Auto-apply — same gate as `moderate`/)`; `assert.match(row[0], /resolves `false`, the row Stages at every tier/)`; `assert.match(row[0], /never satisfied by `housekeeping-auto-merge`/)`; `assert.match(row[0], /learned-skills-pr\.js" drain --run "\{run-dir\}" --integration-branch \{integration-branch\}/)`; carve-out: `assert.match(row[0], /`learned-skills-auto-merge` is this row's carve-out from the `outward GitHub write, never auto per reversibility floor` rule: the policy key is the human's standing grant/)`.
- `'step-6-auto.md: the housekeeping Arm ready PR row names its carve-out in the same form and is fenced to non-marker PRs'`: housekeeping row (same regex as the existing housekeeping-row test) matches `/`housekeeping-auto-merge` is this row's carve-out from the `outward GitHub write, never auto per reversibility floor` rule: the policy key is the human's standing grant/` and `/never a `<!-- wrap-up-skills-pr -->` PR/`; record-linked row matches `/never a `<!-- wrap-up-skills-pr -->` PR/`.
- `'actions-github-issues.md: Drain learned-skills PRs runs the drain verb and trusts its own re-checks'`: `assert.match(ACTIONS_GH, /## Drain learned-skills PRs/)`; `assert.match(ACTIONS_GH, /learned-skills-pr\.js" drain --run "\{run-dir\}" --integration-branch \{integration-branch\}/)`; `assert.match(ACTIONS_GH, /re-checks green and gate-passed itself/)`; `assert.doesNotMatch` the section slice for `/gh pr merge/`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/sweep-backstop.test.js`
Expected: FAIL after Step 1 (no Drain row yet)

- [ ] **Step 3: Make rail room in `step-6-auto.md`**

Create `plugin/skills/tidy/step-6-rationale.md` (title `# Tidy — Step 6 Rationale Appendix`, one-line preamble as in Task 1). Move verbatim, leaving ``(why: `step-6-rationale.md`)`` at each cut: (1) the paragraph `Nothing enforces that the sidecar's fields stay in sync …` (lines 109-113); (2) the paragraph `These two rules cover …` (line 126); (3) the sentences from `This matters most on` to the end of that paragraph (lines 14-18). Grep `tests/`/`tools/` for each span first; swap a pinned span for another rationale span. Add the file to `docs/plugin-structure.md`'s tidy sub-file listing.

- [ ] **Step 4: Implement the row, the fences, and the action**

In `step-6-auto.md`: insert after the record-linked Arm row: `| **Drain learned-skills PR** (a green, gate-passed `[pr-unarmed]` `<!-- wrap-up-skills-pr -->` PR, offered by item 9 only under `learned-skills-auto-merge`; runs `node "${CLAUDE_PLUGIN_ROOT}/bin/learned-skills-pr.js" drain --run "{run-dir}" --integration-branch {integration-branch}` once for all such candidates — `actions-github-issues.md`'s `## Drain learned-skills PRs`) | Stage | Auto-apply — only under `learned-skills-auto-merge`, never satisfied by `housekeeping-auto-merge`; when it resolves `false`, the row Stages at every tier | Auto-apply — same gate as `moderate`. `learned-skills-auto-merge` is this row's carve-out from the `outward GitHub write, never auto per reversibility floor` rule: the policy key is the human's standing grant. The only row that sees marker PRs |`. Append to the housekeeping Arm row's `moderate` cell: ``. `housekeeping-auto-merge` is this row's carve-out from the `outward GitHub write, never auto per reversibility floor` rule: the policy key is the human's standing grant`` and to both Arm rows' description parentheses `; never a `<!-- wrap-up-skills-pr -->` PR`. In the preamble's "bar that contract's one named carve-out" sentence, add that the two policy-key carve-outs are named in their rows.
In `actions-github-issues.md`, add `## Drain learned-skills PRs` before `## Release claim`: one `[pr-unarmed]` drain finding set from item 9 → run the command once (Bash timeout `1200000` ms, per `wrap-up/learned-skills-pr.md`'s drain watch); the CLI resolves the lever and re-checks green and gate-passed itself, so the scan's candidate status is never trusted; it logs its own `decisions.md` lines (hand-log nothing); report `merged`/`armed`/`leftOpen`/`conflicting` from its JSON; `{disabled:true}` is a silent no-op; exit 1 → report the read failure, merge nothing. Never `gh pr merge` here. In `tidy/SKILL.md`'s action table add a `**Drain learned-skills PRs**` row after `**Arm ready PR**` in the same column shape (outward: yes — merges).

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test tests/sweep-backstop.test.js tests/tidy-report-rules.test.js`
Expected: PASS. Then `wc -c plugin/skills/tidy/step-6-auto.md` → ≤ 52200.

- [ ] **Step 6: Commit**

```bash
git add plugin/skills/tidy/step-6-auto.md plugin/skills/tidy/step-6-rationale.md plugin/skills/tidy/actions-github-issues.md plugin/skills/tidy/SKILL.md docs/plugin-structure.md tests/sweep-backstop.test.js
git commit -m "Add tidy Step 6 drain row for learned-skills PRs — gated on learned-skills-auto-merge alone"
```

### Task 3: Rail and full-suite verification (folded into Common Step 5)

**Files:**
- Test: (none new)

- [ ] **Step 1: Verify rail (AC4.1)**

Run: `node plugin/bin/context-cost-report.js --plugin-root plugin`
Expected: both `_shared/github-pr-scan.md` and `tidy/step-6-auto.md` under 52,500 B, each ≤ 52,200 B.

- [ ] **Step 2: Full suite (AC5.1)**

Run: `npm test -- --full` through `/claude-tweaks:test` / `verify.js` (Common Step 5).
Expected: PASS.
