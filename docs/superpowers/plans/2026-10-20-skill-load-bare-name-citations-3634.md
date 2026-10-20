# Skill Load Bare-Name Citations (#3634) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the skill load model resolve backticked `.md` citations that name a real plugin file by bare name or sub-path, so `plugin:flow`'s closure stops undercounting. Fix the citation form in prose where a same-name token is ambiguous.

**Architecture:** Add rule (f) to `extractCitations` in `plugin/bin/lib/skill-audit/load.js`. When rules (a)–(e) all miss, a token resolves to the one citable file whose path ends in that token. Citable files are the `.md` files under `{pluginRoot}/skills/` and `{pluginRoot}/agents/`. A token matching zero or several files stays unresolved. `entryPointLoads` gains an optional `listFiles` dep that feeds the name index, and both CLIs (`load-delta.js`, `skill-load-report.js`) supply it. The rule runs last, so first-existing-wins is unchanged and a previously resolved token can never change target. Ambiguous same-name tokens whose owner is clear from context get rewritten in prose to a form that rules (a) or (e) already resolve.

**Tech Stack:** Node 18+, `node --test`, plain CommonJS.

**Spec:** `.claude-tweaks/pipelines/2026-10-20T175956-record-3634/work/3634-spec.md`

Scope keywords: extractCitations, entryPointLoads

## Global Constraints

- Additions only: no previously resolved (citing line, token) pair may change or lose its resolved path (spec AC2).
- First-existing-wins order of rules (a)–(e) is unchanged; rule (f) is appended after them (spec Deliverables 3).
- `load.js` stays pure — no `fs`/`child_process` require; filesystem access is injected by the CLIs.
- Rule (f) searches `.md` files under `{pluginRoot}/skills/` and `{pluginRoot}/agents/` only. A `.claude` root must never walk `.claude/worktrees/` (it holds whole repo copies).
- `entryPointLoads` callers that do not pass `listFiles` behave exactly as today (rule (f) inert).

## Review Focus

- A bare name that exists in two skills (`SKILL.md`, `filing.md`, `mcp-transport.md`, `summary-template.md`): must stay unresolved, never pick one (Task 1 test "ambiguous name").
- A token with a `.`/`..` segment or an absolute path: must never be matched by name (Task 1 test "dot segments").
- A `.md` file inside the root but outside `skills/`/`agents/` (e.g. `plugin/docs/x.md`): never a rule (f) target (Task 1 test "only citable dirs").
- A `.claude` plugin root whose directory holds `worktrees/`: the head walker visits only `skills/` and `agents/` (Task 2 walker test).
- An entry point with no `listFiles` (a third caller, or an old fixture): identical output to before (Task 1 test "inert without listFiles").

---

### Task 1: Rule (f) in `load.js`

**Files:**
- Modify: `plugin/bin/lib/skill-audit/load.js` (header comment lines 9-17, `extractCitations` lines 67-105, `entryPointLoads` lines 127-176, `module.exports`)
- Test: `tests/bin-lib/skill-audit/load.test.js`

**Interfaces:**
- Produces:
  - `CITABLE_DIRS: string[]` = `['skills', 'agents']`
  - `citableNameIndex(pluginRoot: string, paths: string[]) => (token: string) => string | null`: keeps only `paths` ending `.md` under `{pluginRoot}/{dir}/` for each `CITABLE_DIRS` entry (`{dir}/` when `pluginRoot === '.'`). It returns a memoised lookup. A token is eligible only if it is not absolute and every `/`-segment is non-empty and is neither `.` nor `..`. A file matches when `('/' + file).endsWith('/' + token)`. The lookup returns the file only when exactly one matches, otherwise `null`.
  - `walkCitable(pluginRoot: string, readdir: (relDir: string) => Array<{name: string, isDirectory: boolean}>) => string[]`: recursively lists repo-relative POSIX `.md` paths under each `{pluginRoot}/{dir}` in `CITABLE_DIRS`, with `readdir` returning `[]` for a missing directory. It only descends into entries with `isDirectory: true`. The output is sorted.
  - `extractCitations(text, citingFile, pluginRoot, { exists, byName })`: `byName` is optional. Rule (f) is `byName(token)`, tried only when no (a)–(e) candidate exists, and its result must still pass `withinRoot`.
  - `entryPointLoads(pluginRoot, { readFile, listSkillMds, listFiles })`: `listFiles` is optional `() => string[]`. When present, build `byName = citableNameIndex(pluginRoot, listFiles())` once per call and pass it to every `extractCitations`.

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/skill-audit/load.test.js`, after the existing rule (e) tests (before `extractCitations: an unresolvable token is recorded…`):
  - `extractCitations rule (f): a bare name naming exactly one citable file resolves to it (AC1.1)`: line ``see `cleanup-procedures.md` `` cited from `plugin/skills/flow/SKILL.md`, root `plugin`, `exists` = existsIn(['plugin/skills/wrap-up/cleanup-procedures.md']), `byName` = `load.citableNameIndex('plugin', ['plugin/skills/wrap-up/cleanup-procedures.md', 'plugin/skills/flow/SKILL.md'])` → `resolved` deep-equals `['plugin/skills/wrap-up/cleanup-procedures.md']`, `unresolved` `[]`.
  - `extractCitations rule (f): a sub-path resolves by trailing segments, and agents/ is citable`: tokens `modes/review.md` and `agents/qa-agent.md`, index over `['plugin/skills/design-wrapper/modes/review.md', 'plugin/agents/qa-agent.md']` → both resolve to those paths.
  - `extractCitations rule (f): an ambiguous name stays unresolved`: token `filing.md`, index over `['plugin/skills/code-health/filing.md', 'plugin/skills/harness-health/filing.md']` → `resolved` `[]`, `unresolved.length === 1`.
  - `extractCitations rule (f): only skills/ and agents/ are citable`: `citableNameIndex('plugin', ['plugin/docs/x.md', 'plugin/bin/y.md'])('x.md')` is `null` and `('y.md')` is `null`.
  - `extractCitations rule (f): dot segments and absolute tokens never match by name`: with index over `['plugin/skills/a/x.md']`, the lookup returns `null` for `./x.md`, `../x.md`, `a/../x.md`, `/x.md`, `a//x.md`.
  - `extractCitations rule (f) runs last: first-existing-wins order (a)–(e) is unchanged (AC2.1)`: citing `plugin/skills/flow/SKILL.md`, token `x.md`, `exists` = existsIn(['plugin/skills/flow/x.md', 'plugin/skills/_shared/x.md']), `byName` returning `'plugin/skills/other/x.md'` → resolved `['plugin/skills/flow/x.md']`. A second assertion with only `plugin/skills/_shared/x.md` existing → `['plugin/skills/_shared/x.md']` (rule (b) still beats (f)).
  - `extractCitations rule (f): absent byName keeps the token unresolved`: same as the first test without `byName` → `resolved` `[]`.
  - `entryPointLoads rule (f): listFiles feeds the index and the hit is walked transitively`: tree `{ 'plugin/skills/flow/SKILL.md': 'see \`helper.md\`\n', 'plugin/skills/wrap-up/SKILL.md': 'w\n', 'plugin/skills/wrap-up/helper.md': 'then \`leaf.md\`\n', 'plugin/skills/wrap-up/leaf.md': 'leaf\n' }` with `listFiles: () => Object.keys(files)` → the `plugin:flow` row's `files` includes `plugin/skills/wrap-up/helper.md` and `plugin/skills/wrap-up/leaf.md` (the leaf via rule (a) from helper's directory).
  - `entryPointLoads rule (f) is inert without listFiles`: the same tree via the existing `tree()` helper (no `listFiles`) → the `plugin:flow` row's `files` is `['plugin/skills/flow/SKILL.md']` and `unresolved` tokens are `['helper.md']`.
  - `walkCitable lists .md under skills/ and agents/ only, never other top-level dirs`: an injected `readdir` over the map `{ 'plugin/skills': [{name:'s',isDirectory:true}], 'plugin/skills/s': [{name:'SKILL.md',isDirectory:false},{name:'a.txt',isDirectory:false}], 'plugin/agents': [{name:'q.md',isDirectory:false}], 'plugin/worktrees': [{name:'z.md',isDirectory:false}] }` (missing keys → `[]`) → `['plugin/agents/q.md', 'plugin/skills/s/SKILL.md']`. Under root `.` with keys `skills`/`agents` → paths without a `plugin/` prefix.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/skill-audit/load.test.js`
Expected: FAIL — `load.citableNameIndex is not a function` / `load.walkCitable is not a function`, and the rule (f) resolution assertions fail.

- [ ] **Step 3: Implement** `CITABLE_DIRS`, `citableNameIndex`, `walkCitable`, the `byName` option in `extractCitations` (change `const hit` to try `byName(token)` only when the (a)–(e) `find` returned nothing, then the same `withinRoot` check), and the optional `listFiles` in `entryPointLoads`. Export all four new or changed names. Extend the header comment's closure definition to name rule (f): "a token naming exactly one `.md` under the root's `skills/`/`agents/`".

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/skill-audit/load.test.js`
Expected: PASS, every test in the file (existing ones unchanged).

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/skill-audit/load.js tests/bin-lib/skill-audit/load.test.js
git commit -m "Add rule (f) to the skill load citation grammar — unique bare-name resolution over citable files, refs #3634"
```

### Task 2: Wire `listFiles` into both CLIs

**Files:**
- Modify: `plugin/bin/load-delta.js` (`headSide` lines 154-192, `baseSide` lines 194-211)
- Modify: `plugin/bin/skill-load-report.js` (`closureIndex`, around lines 123-148)
- Modify: `docs/journeys/read-a-skill-load-delta-at-review-3307.md` (the step that lists the resolved citation forms, where #3457 added rule (e)'s two forms)
- Test: `tests/load-delta-cli.test.js`, `tests/skill-load-report-cli.test.js`
- Review (no change): `docs/superpowers/plans/2026-10-19-load-citation-grammar.md` — #3457's completed plan, which matches the scope keywords as history. Leave it untouched.

**Interfaces:**
- Consumes: `walkCitable(pluginRoot, readdir)` and the `listFiles` option of `entryPointLoads` (Task 1).
- Produces: `headSide(repoRoot, root)` returns `{ readFile, listSkillMds, listFiles }`. `listFiles` is `walkCitable(root, readdir)` with `readdir(rel)` = `fs.readdirSync(path.join(repoRoot, rel), { withFileTypes: true })` mapped to `{ name, isDirectory: d.isDirectory() }`, with ENOENT/ENOTDIR mapped to `[]`. `baseSide(...)` returns `listFiles: () => [...baseFiles]` (`citableNameIndex` filters). `closureIndex` passes the same walker rooted at `rootAbs` with root `'.'`.

- [ ] **Step 1: Write the failing tests**
  - `tests/load-delta-cli.test.js`, after `ok: a committed move-not-cut split…`: `rule (f): a bare-name citation of another skill's file joins the closure at head and base`. `makeRepo` has `plugin/skills/s/SKILL.md` = `'see \`other-part.md\`\n'`, `plugin/skills/t/SKILL.md` = `'t\n'` and `plugin/skills/t/other-part.md` = `'x'.repeat(100) + '\n'`. Then append one line to `plugin/skills/t/other-part.md` at head and commit. `call(['--json'], dir)` exits 0, and the `plugin:s` entry's `dClosure` equals the appended line's byte length. Without rule (f) `plugin:s` would not move and would be absent from `entries`.
  - `tests/skill-load-report-cli.test.js`, after `overClosure is false when max equals…`: `closure counts a bare-name citation of another skill's file`. Build `pluginRoot()`, then rewrite `skills/alpha/SKILL.md` to cite `` `beta-notes.md` `` and add `skills/beta/SKILL.md` plus `skills/beta/beta-notes.md` (500 `b`s + `\n`). One `demo:alpha` invocation with a max of 1 byte. The row's `closure` equals the measured bytes of alpha's SKILL.md plus 501.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/load-delta-cli.test.js tests/skill-load-report-cli.test.js`
Expected: FAIL — `plugin:s` missing from entries; closure short by 501.

- [ ] **Step 3: Implement** `listFiles` in `headSide`, `baseSide` and `closureIndex` per the Interfaces block. In the journey doc, add rule (f) as one more listed form next to rule (e)'s: a bare name or sub-path naming exactly one file under the root's `skills/` or `agents/`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/load-delta-cli.test.js tests/skill-load-report-cli.test.js tests/bin-lib/skill-audit/load.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/load-delta.js plugin/bin/skill-load-report.js tests/load-delta-cli.test.js tests/skill-load-report-cli.test.js docs/journeys/read-a-skill-load-delta-at-review-3307.md
git commit -m "Feed the citable-file listing to the load model from load-delta and skill-load-report, refs #3634"
```

### Task 3 [batch]: Fix ambiguous same-name citation forms in prose

**Files:**
- Modify (line 3 of each of the 13 Optional Enhancement step files below): in `*Optional Enhancement step — see \`SKILL.md\`'s \`## Input\``, `` `SKILL.md` `` → `` `../SKILL.md` ``. The same line already cites `` `../bootstrap-steps.md` ``.
  - `plugin/skills/init/bootstrap/step-09-establish-github-remote.md`
  - `plugin/skills/init/bootstrap/step-10-github-issue-form.md`
  - `plugin/skills/init/bootstrap/step-11-impeccable-design-integration.md`
  - `plugin/skills/init/bootstrap/step-12-diagram-suggestions.md`
  - `plugin/skills/init/bootstrap/step-13-shadcn-bootstrap.md`
  - `plugin/skills/init/bootstrap/step-14-cloud-routine-parity.md`
  - `plugin/skills/init/bootstrap/step-15-routine-installation.md`
  - `plugin/skills/init/bootstrap/step-16-non-default-branch-issue-tracking.md`
  - `plugin/skills/init/bootstrap/step-17-work-record-backend.md`
  - `plugin/skills/init/bootstrap/step-18-autonomy-level.md`
  - `plugin/skills/init/bootstrap/step-19-emil-skills.md`
  - `plugin/skills/init/bootstrap/step-20-integration-model.md`
  - `plugin/skills/init/bootstrap/step-21-release.md`
- Modify: `plugin/skills/init/bootstrap/step-06-worktree-configuration.md:32`: both `` `SKILL.md` `` → `` `../SKILL.md` ``.
- Modify: `plugin/skills/init/bootstrap/version-check.md:5`: `` `SKILL.md` `` → `` `../SKILL.md` ``.
- Modify: `plugin/skills/_shared/integration-model.md:52`: `` (`SKILL.md` Step 7.5 `` → `` (`tidy/SKILL.md` Step 7.5 ``.
- Modify: `plugin/skills/_shared/headless-self-report.md:101`: ``dispatch's `SKILL.md` and `mcp-transport.md` `` → `` `dispatch/SKILL.md` and `dispatch/mcp-transport.md` ``.
- Modify: `plugin/skills/_shared/design-wrapper-handling.md:45`: ``the wrapper's `SKILL.md` (~40KB)`` → `` `design-wrapper/SKILL.md` (~40KB)``.
- Modify: `plugin/skills/_shared/scratch-worktree.md:7`: ``(`SKILL.md`'s Phase 9`` → ``(`init/SKILL.md`'s Phase 9``.
- Modify: `plugin/skills/_shared/harness-health-analysis.md:63`: ``per its own `SKILL.md` Step 7`` → ``per its own `harness-health/SKILL.md` Step 7``.
- Modify: `plugin/skills/_shared/health-recent-commit-check.md:3`: ``code-health's `filing.md`, harness-health's `filing.md`, docs-health's `SKILL.md`, journey-health's `SKILL.md`, and capture's `SKILL.md` `` → `` `code-health/filing.md`, `harness-health/filing.md`, `docs-health/SKILL.md`, `journey-health/SKILL.md`, and `capture/SKILL.md` ``.
- Modify: `plugin/skills/_shared/auto-decision-log.md:65`: ``the shape `summary-template.md` parses`` → ``the shape `wrap-up/summary-template.md` parses`` (wrap-up's template owns the Leftover routing row and the `defer-reason` parse; `flow/summary-template.md` has neither).
- Test: `tests/init-release-bootstrap-conformance.test.js:42`: the pinned substring becomes `` '*Optional Enhancement step — see `../SKILL.md`' ``.

Left as is, deliberately: these name no single plugin file (a generic "each skill's" or an external skill's `SKILL.md`). `_shared/fast-lane-digest.md:14`, `_shared/design-craft.md:44`, `_shared/routine-template-schema.md:156`, `design-wrapper/modes/review.md:230` (a critic's own `SKILL.md`), `design-wrapper/modes/pre-build.md:32` (Impeccable's).

Byte headroom: every edited file grows ≤ 30 B. The largest, `_shared/harness-health-analysis.md`, is 45,274 B against `RAIL_BYTES` 52,500.

- [ ] **Step 1: Update the pinned test assertion** (line 42) first, then run `node --test tests/init-release-bootstrap-conformance.test.js`. Expected: FAIL (step-21 still says `` `SKILL.md` ``).
- [ ] **Step 2: Apply every prose edit above.** Verify with `git grep -n -F "Optional Enhancement step — see \`SKILL.md\`" -- plugin`, expected no output, and `git grep -c -F "see \`../SKILL.md\`'s \`## Input\`" -- plugin/skills/init/bootstrap`, expected 13 files.
- [ ] **Step 3: Run** `node --test tests/init-release-bootstrap-conformance.test.js tests/bin-lib/skill-audit/` (the rail and context-cost suites included). Expected: PASS.
- [ ] **Step 4: Commit**

```bash
git add plugin/skills/init/bootstrap plugin/skills/_shared/integration-model.md plugin/skills/_shared/headless-self-report.md plugin/skills/_shared/design-wrapper-handling.md plugin/skills/_shared/scratch-worktree.md plugin/skills/_shared/harness-health-analysis.md plugin/skills/_shared/health-recent-commit-check.md plugin/skills/_shared/auto-decision-log.md tests/init-release-bootstrap-conformance.test.js
git commit -m "Name the owning skill in ambiguous same-name citations so the load model resolves them, refs #3634"
```

### Task 4: Real-corpus classification and additions-only proof (AC1.1, AC1.2, AC2.1)

Not a code task. The orchestrator runs it centrally after Tasks 1-3. It is the real-input probe for this change.

- [ ] Run the scratch measurement (`measure.js` in the session scratchpad: base = `git show {merge-base}:plugin/bin/lib/skill-audit/load.js` into scratch, head = the worktree's `load.js`, real corpus, `listCitableFiles` from `walkCitable`). Record:
  - `plugin:flow` closure files, closure bytes, and unique unresolved (citing file, token) pairs, before vs after.
  - Additions-only over every citing line in `plugin/**/*.md`: lines gaining a resolution, prior targets lost (must be 0), prior targets changed (must be 0).
  - The residual per-class counts: placeholder/glob, outside the plugin, `skills/` token with no target, genuinely names nothing (including generic `SKILL.md` mentions), and real plugin file (must be 0).
  - Authoring-time prototype (rule (f) only, before Task 3): base 1119 pairs over 463 files → 861 pairs over 465 files, 0 lost/changed. Residual real-file pairs: 29, all the same-name tokens Task 3 addresses or deliberately leaves.
- [ ] Put the before/after and per-class counts in the PR's Spec summary (spec AC1.2).

Waived AC1.2: a statement in the PR body, not a code property a test can pin. This task produces the counts and the PR summary carries them.
