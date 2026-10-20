# Load-Model Citation Grammar Rule (e) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `extractCitations` resolve plugin-root-relative (`skills/build/SKILL.md`) and skills-dir-relative (`wrap-up/cleanup-procedures.md`) backticked `.md` tokens, so skill load closures stop undercounting.

**Architecture:** Add one rule (e) to `extractCitations`'s candidate list in `plugin/bin/lib/skill-audit/load.js`. It is appended after rules (a)–(d), and the existing `candidates.find(...)` keeps first-existing-wins, so a token that already resolved can never change target.

**Tech Stack:** Node 18+, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-19T185533-record-3457/work/3457-spec.md` (record #3457)

Scope keywords: extractCitations, citation grammar

## Global Constraints

- Rule order stays first-existing-wins; the new rule runs after (a)–(d).
- No previously resolved token changes its resolved path (additions only).
- `load.js` stays pure over the injected `exists` predicate (no real filesystem access).

## Review Focus

- A token whose first segment is not a skill (`docs/skill-graph.md`) must stay unresolved. Pinned by the existing "unresolvable token" test plus a new non-skill-segment assertion.
- A `skills/…` or `{skill}/…` token that climbs out of the root (`skills/../../README.md`) must stay unresolved: `withinRoot` still applies to the (e) candidates.
- A first segment of `.` or `..` is never treated as a skill name, even when `exists` answers true for everything. The existing `../../../README.md` test keeps passing.
- A `{skill}/…` token for an existing skill whose file is missing stays unresolved.
- Under a repo-root plugin root (`.`), both shapes resolve to `skills/...` paths.

---

### Task 1: Rule (e) in `extractCitations`

**Files:**
- Modify: `plugin/bin/lib/skill-audit/load.js` (`extractCitations`, around lines 65–93, plus the module header comment if it lists the rules)
- Test: `tests/bin-lib/skill-audit/load.test.js`
- Modify: `docs/journeys/read-a-skill-load-delta-at-review-3307.md:43` (the grammar enumeration gains the two new forms)

**Interfaces:**
- Consumes: the existing `extractCitations(text, citingFile, pluginRoot, { exists })` signature and the `withinRoot` helper. Both are unchanged.
- Produces: the same `{ resolved, unresolved }` return shape. No new exports.

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/skill-audit/load.test.js`, after the rule (d) tests:
  - `extractCitations rule (e): a skills/ token resolves against the plugin root`. Line `` see `skills/build/SKILL.md` `` cited from `plugin/skills/flow/SKILL.md`, root `plugin`, exists `['plugin/skills/build/SKILL.md']` → `resolved` deep-equals `['plugin/skills/build/SKILL.md']`.
  - `extractCitations rule (e): a {skill}/{file}.md token resolves under skills/ when the first segment names an existing skill`. Token `wrap-up/cleanup-procedures.md`, exists `['plugin/skills/wrap-up/SKILL.md', 'plugin/skills/wrap-up/cleanup-procedures.md']` → `['plugin/skills/wrap-up/cleanup-procedures.md']`. Also a nested `design-wrapper/modes/review.md` with that skill's SKILL.md present → resolves.
  - `extractCitations rule (e): a first segment that is not a skill directory stays unresolved`. Token `docs/x.md` with exists `['plugin/skills/docs/x.md']` (no `plugin/skills/docs/SKILL.md`) → `resolved` is `[]` and `unresolved.length === 1`. Token `wrap-up/missing.md` with only the SKILL.md present → unresolved.
  - `extractCitations rule (a) still wins over (e) for a same-named relative sibling`. Citing file `plugin/skills/flow/SKILL.md`, token `wrap-up/x.md`, exists `['plugin/skills/flow/wrap-up/x.md', 'plugin/skills/wrap-up/SKILL.md', 'plugin/skills/wrap-up/x.md']` → `['plugin/skills/flow/wrap-up/x.md']`.
  - `extractCitations rule (e): a token climbing out of the root stays unresolved`. Token `skills/../../README.md` with `exists: () => true` → `resolved` `[]`.
  - `extractCitations rule (e) works under a repo-root plugin root (".")`. Citing `skills/flow/SKILL.md`, root `.`, tokens `skills/build/SKILL.md` and `wrap-up/a.md`, exists `['skills/build/SKILL.md', 'skills/wrap-up/SKILL.md', 'skills/wrap-up/a.md']` → both resolve.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/bin-lib/skill-audit/load.test.js`
Expected: FAIL. The new rule (e) tests report `resolved` as `[]`, where the `skills/`, skill-dir and repo-root cases expect a path. The sibling-wins, non-skill and climb-out cases already pass.

- [ ] **Step 3: Implement rule (e)** in `extractCitations`. Push the (e) candidates after the (d) push:
  - if `token.startsWith('skills/')` → `posix.join(pluginRoot, token)`;
  - else if the token's first segment matches `^([^/.][^/]*)\/.` and `exists(posix.join(pluginRoot, 'skills', seg, 'SKILL.md'))` → `posix.join(pluginRoot, 'skills', token)`.

  The existing `withinRoot && exists` filter and `find` order handle the rest. Add `// (e)` labels, matching the (a)–(d) comment style.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/skill-audit/load.test.js`
Expected: PASS, all tests.

- [ ] **Step 5: Measure the acceptance-criteria evidence.** Use the scratch script (not committed) to compare base against head. Record two things:
  - `plugin:flow` unique unresolved (citingFile, token) pairs. The baseline is 1021; the record said 982 before the corpus grew.
  - The per-line resolved lists. Every base list must be a subsequence of its head list (additions only).

  Record both numbers in the PR description.

- [ ] **Step 6: Update the journey line** `docs/journeys/read-a-skill-load-delta-at-review-3307.md:43`. Its grammar list (relative to the citing file, `_shared/`, `${CLAUDE_PLUGIN_ROOT}/`, "in that skill's directory") gains `` `skills/…` `` (plugin-root-relative) and `` `{skill}/…` `` (skills-dir-relative).

- [ ] **Step 7: Commit**

```bash
git add plugin/bin/lib/skill-audit/load.js tests/bin-lib/skill-audit/load.test.js docs/journeys/read-a-skill-load-delta-at-review-3307.md
git commit -m "Extend extractCitations with rule (e) — plugin-root- and skills-dir-relative tokens, refs #3457"
```
