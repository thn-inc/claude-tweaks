# lib-module-split Project Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the maintainer-side project skill `.claude/skills/lib-module-split/SKILL.md`. It covers splitting a shared `plugin/bin/lib/` module behind a re-export facade, proving the split is a pure move, and sweeping stale location claims.

**Architecture:** One markdown skill file with YAML frontmatter (`name`, `description` with a `Keywords -` tail), in the same house shape as its siblings (e.g. `.claude/skills/merge-shape-landed-proof/SKILL.md`). The commands are copied verbatim from scratch scripts that were already run against PR #2822's real trees (see "Probes already run" below). The skill inlines them as runnable code. It ships no new committed script.

**Tech Stack:** Markdown; Node (`node:assert`, `node:fs`, `node:path`) for the inlined proof script; `git grep`, `git archive`.

**Spec:** `.claude-tweaks/pipelines/2026-10-24T213642-record-4010/work/4010-spec.md`

## Global Constraints

- Create exactly `.claude/skills/lib-module-split/SKILL.md`. This is a maintainer-side file and is not part of the `plugin/` payload, so no `docs/skill-graph.md` edge and no plugin-skill suites apply. New-skill suite-set check: N/A, because that check covers `plugin/skills/**` only.
- Cover: when a facade is preferred over migrating call sites; the pure-move proof (export-surface + function-source identity, verbatim top-level-declaration check, require-cycle check); the stale-location sweep (grep `{file}'s {symbol}`, "in {file}", "requires only", and journey `files:` entries naming the split file — keeping references that name the still-valid public import path); and updating `docs/plugin-structure.md`.
- Every command the skill prints must be one that ran in this plan's probes. No hand-typed variants.
- Worktree-session-safe shapes: write multi-line scripts to a scratch file and run `node {file}`. Never use a heredoc `node -e` or a compound command, because the worktree Bash guard refuses those (`_shared/scratch-worktree.md` §7).

## Probes already run (Verbatim-command run-once / Real-input probe / Independent-count)

Base `69bb514df^` vs head `69bb514df` (PR #2822's squash merge), each extracted with `git archive {rev} plugin/bin/lib/issues | tar -x`:

- Pure-move script output on the real trees: `check 1: 37 exports, same keys, same source/values` / `check 2: 60/60 top-level declarations verbatim` / `check 3: 0 cycles, 0 sub-modules requiring the facade`. Independent count: the PR's review verdict comment states "the facade exports the same 37 keys", and it counted 62 top-level declarations. The difference is 62 − 60 = the 2 `require` lines (`nodePath`, `facet-shape`), which the script excludes on purpose.
- Go-red controls on a scratch copy of the head tree:
  - Re-spacing `return null;` → check 1 red (`source differs: buildNativeDependencyQuery`).
  - Editing internal `DEP_RE` → check 1 still green, check 2 red (`59/60`, `MISSING: const DEP_RE`).
  - Planting `require('./record')` in `record-fingerprint.js` → checks 1 and 2 still green, check 3 red (1 cycle).
  - So each check catches a defect the others miss.
  - Before stripping `//` comment lines, check 3 false-positived on `record.js`'s header comment, which contains the text `require('./record')`. The stripping is load-bearing.
- Stale-pointer classifier on `31cf39c0e^` (pre-fix): 5 hits — `parseIssueNumbers` (materiality-digest.js:54), `DEP_RE` ×4 (ranking.js:77, dependency-narration-check.md:43, observation-plan.md:65, record-creation-linking.md:61). All 5 were fixed by 31cf39c0e. At HEAD it reports 1 hit, `record-creation-linking.md:61`. That is a line-level false positive: the line names `record.js` for `parseDependencyAssumptions` (import path, valid) and attributes `DEP_RE` correctly to `record-dependencies.js`. The output is a candidate list, not a verdict.
- `git grep -nE "requires (only|nothing)|imports only|depends only on"` on `31cf39c0e^`, then filtered by eye to the split file: gh-api-module-pattern/batching-failure-posture.md:4 and autonomy.js:17. Both were fixed by 31cf39c0e.
- Content-location grep on `31cf39c0e^` piped through `grep -F record.js`:
  - It surfaces the builder bullet (lines 4–5), 4× "verifiedAsOf doc in record.js", record.js:4 "lives here", and materialize.js:96 "record.js's own comment". All were fixed.
  - It also surfaces `TYPE_LABELS` "pairs live in `record.js`'s" lines. Those were kept, because they are the import-path class.
- `git grep -c -F plugin/bin/lib/issues/record.js 31cf39c0e^ -- docs/journeys`: 3 journeys. All 3 gained sub-module entries in 31cf39c0e.
- Fan-in: `git grep -lE "issues/record['\"]|issues/record\.js['\"]|require\(['\"]\./record['\"]\)" -- plugin tests | wc -l` = 75 files. 17 of them are under `plugin/skills/` (skill-prose `node -e` require lines).

## Review Focus

1. A reader treats a `{file}'s {exportedSymbol}` reference as stale and rewrites it to the sub-module. The skill must say to keep it, using the TYPE_LABELS / `parseDependencyAssumptions` lines as the example.
2. A reader runs check 1 alone and calls the split proven. The skill must state that the `DEP_RE` control shows an internal-constant edit passing check 1.
3. A journey `files:` entry for the facade gets deleted instead of supplemented. The facade still exists, so the entry stays and the sub-modules are added.
4. A future split whose base facade had `require` lines of its own. The script excludes `require(` lines from check 2, and the skill must say so.
5. A reader runs the proof scripts with a heredoc `node -e` inside a worktree session and the guard refuses it. The skill prescribes a scratch file.

---

### Task 1: Write `.claude/skills/lib-module-split/SKILL.md`

**Files:**
- Create: `.claude/skills/lib-module-split/SKILL.md`

**Interfaces:**
- Consumes: nothing.
- Produces: a skill named `lib-module-split`.

- [ ] **Step 1: Write the scratch AC check (scratch only — not committed)**

Grep assertions over the new file. Each must print a hit:
- AC1.1 (three proof checks + four stale shapes, each with its command):
  - `grep -c "export surface" SKILL.md`, `grep -c "verbatim" SKILL.md`, `grep -c "cycle" SKILL.md` ≥ 1.
  - The four shape headings — "code comment", "non-exported internal", "skill bullet", "journey `files:`" — each present.
  - Every shape and check carries a fenced command block.
- AC2.1 (import path vs definition location, one #2805 example each):
  - `grep -F "parseDependencyAssumptions"` (import-path example).
  - `grep -F "requires only ./facet-shape"` or `` grep -F "`DEP_RE`" `` (definition-location example).

- [ ] **Step 2: Run it before the file exists**

Run: `test -f .claude/skills/lib-module-split/SKILL.md && echo exists || echo absent`
Expected: `absent` (the grep checks fail).

- [ ] **Step 3: Write the skill**

Sections, in order:
1. Frontmatter. The description starts "Use when splitting a shared `plugin/bin/lib/` module…" and ends with `Keywords -` (facade, re-export, split, pure move, export surface, require cycle, stale location, journey files, plugin-structure).
2. When a facade beats migrating call sites. Use the 75-file / 17-skill-prose fan-in and expand-contract against the installed build. Migrate instead when the call sites are few, all code, and the point is a new consumer boundary.
3. The pure-move proof. Include the `git archive` extraction commands, the inlined script (the three checks), the #2822 outputs, and the go-red controls showing that each check catches what the others miss.
4. The stale-location sweep. Cover the four shapes, each with its command. Add the import-path vs definition-location distinction, with the #2805 examples (keep: `record.js`'s `parseDependencyAssumptions` / `TYPE_LABELS`; repoint: autonomy.js "record.js requires only ./facet-shape" and `record.js`'s `DEP_RE`).
5. Update the module family's line in `docs/plugin-structure.md`.

- [ ] **Step 4: Re-run the Step 1 checks**

Expected: every grep hits.

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/lib-module-split/SKILL.md
git commit -m "Add lib-module-split project skill — pure-move proof and stale-location sweep"
```

## Spec coverage map

| Spec item | Task |
|---|---|
| Deliverable: skill file with facade-vs-migrate, pure-move proof, stale-location sweep, plugin-structure update | Task 1 Step 3 |
| AC1.1 | Task 1 Steps 1/4 |
| AC2.1 | Task 1 Steps 1/4 |
