# Skill-Load Outside-Closure Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `skill-load-report.js` report, per skill, the files of its own root that real sessions read but its static closure never reaches (`outsideClosure`), make that the harness-health filing trigger, and let project-local `.claude/skills` reach the harness-health command.

**Architecture:** The closure index in `plugin/bin/skill-load-report.js` grows from bytes-only to `{ closure, files, rootFiles }` per entry. Each transcript row's `readPaths` (already recorded by `transcript-load.js`) are aggregated per folded skill, normalized to the closure's root-relative `skills/...` form, and compared as sets. A new `--optional-plugin-root <dir>` flag adds a root only when it has `skills/`, so the harness-health command can name `.claude` unconditionally. harness-health's Skill-load paragraph and its prose pins move from `overClosure` to `outsideClosure`.

**Tech Stack:** Node 18+ CommonJS, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-21T055733-record-3460/work/3460-spec.md`

Scope keywords: overClosure, skill-load-report

Plan-audit Check B (2026-10-21): the unplanned keyword hits are comment-only mentions that stay accurate after this change — `plugin/bin/lib/skill-audit/{plugin-root-reader,citable-readdir,transcript-load}.js`, `plugin/bin/lib/timing/transcript.js:14`, `tests/bin-lib/path-guard/is-path-contained-characterization.test.js:8`, and six historical plans under `docs/superpowers/plans/`. None is modified.

Waived AC2.1: a real-data observation over machine-local transcripts, which cannot be a committed test; Task 3 (controller) runs it with an independent count and states the result on PR #3861.

## Global Constraints

- The CLI keeps exit codes: 0 success (incl. `no-data`), 2 malformed invocation or an explicit `--plugin-root` with no `skills/`, 1 unexpected error. `--optional-plugin-root` never causes exit 2 for a missing `skills/`.
- Output stays one JSON line `{ status, transcriptDir, sessions, unreadable, rows }`; row keys become `{ skill, invocations, median, max, closure, outsideClosure }` — `overClosure` is removed (its only consumer is the harness-health paragraph rewritten in Task 2, shipped in the same plugin version; `gh issue list --search '"Skill load exceeds its static closure" in:title' --state all` returned `[]`, so no filed record carries the old title).
- `outsideClosure` is a sorted, de-duplicated array of root-relative POSIX paths when `closure` is non-null, and `null` when `closure` is `null`.
- No transcript text in any filed issue body — only skill names, root-relative paths, counts.
- `plugin/skills/harness-health/SKILL.md` is 48,689 B against `RAIL_BYTES` 52,500 B (`plugin/bin/lib/skill-audit/budgets.js`) — 92.7%. Task 2 must leave it ≤ 48,900 B (`wc -c`), i.e. the rewritten paragraph is near byte-neutral; cut wording inside the same paragraph rather than content from elsewhere.
- The paragraph must still begin with the literal `**Skill-load check (#3309` (the CRLF test at `tests/skill-load-report-cli.test.js:274-285` anchors on it).

## Decisions (made at authoring, from a real-transcript probe)

A scratch probe over this repo's 20 newest main transcripts + subagents (`$CLAUDE_CONFIG_DIR` = `~/.claude-accounts/lipht-thn`, closure from the installed 6.145.0 root) normalized every read by its last `/skills/` segment. It showed cross-root reads mis-labelled as the plugin's own files: `claude-tweaks:capture` reading superpowers' `skills/subagent-driven-development/re-review-prompt.md`, `claude-tweaks:reflect` reading project-local `.claude/skills/prose-code-twin-pin/SKILL.md`. A citation can never reach another root, so such a read is not a missing citation. **Rule:** a read counts toward `outsideClosure` only when its normalized path is a citable file of the matched root (`pluginRootReader(rootAbs).listFiles()` — `skills/**` and `agents/**` `.md`) and is not in the entry's closure `files`. Reads that normalize to nothing the root holds are not comparable and are dropped. Known limitation, kept from `transcript-load.js`'s header: the attribution cursor never expires, so in a session editing this repo an edit-Read of a `plugin/skills/**` file is attributed to the last-invoked skill.

### As built (architecture alignment, Common Step 4.5)

All three deviations from the spec's literal wording are classified Beneficial:
- **Origin anchoring.** This tightens the root-file rule above. It comes from the final whole-branch review, ruling 2, and landed in 7c3460e50. A read counts only when the text before its final `skills/` segment is the matched root's absolute path, or, for a named plugin root, `/plugins/cache/{marketplace}/{name}/{version}/`. Reads that share a relative path with a file in another root no longer count, and neither do edit-Reads of this repo's `plugin/skills/**` while the installed cache is the matched root.
- **Honest auto-close.** The spec is silent on auto-close. The close comment now states only what was observed (`No outside reads observed over the last {sessions} sessions`). Re-filing reopens a closed issue with the same title rather than creating a duplicate, and an open record's body is not refreshed. This is final-review ruling 1.
- **Count.** The spec's "count and list" is the length of `outsideClosure`. harness-health's SUMMARIZE reports it next to the paths, so there is no separate JSON field.

## Review Focus

1. A read of another plugin's or the project-local root's skill file during a plugin skill must not appear in that plugin skill's `outsideClosure` (Task 1, test `cross-root reads are not comparable`).
2. The same outside file read in two invocations, or twice in one, must appear once (Task 1, test `outsideClosure is distinct and sorted`).
3. A project-local skill invoked under its worktree path form (`.claude/worktrees/wt:alpha`) must join the `.claude` root's closure and files (Task 2, AC3 test).
4. A project with no `.claude/skills/` must still run the harness-health command to exit 0 (Task 2, guard test).
5. Unattributed rows and other plugins' skills (closure `null`) must report `outsideClosure: null`, never `[]` — `[]` would auto-close a record (Task 1, test `null closure gives null outsideClosure`).

---

### Task 1: `outsideClosure` and `--optional-plugin-root` in the CLI

**Files:**
- Modify: `plugin/bin/skill-load-report.js` (header comment lines 1-35, `parseArgs`, `closureIndex`, `closureOf`, `run`)
- Test: `tests/skill-load-report-cli.test.js`

Return-shape widening check: the row shape changes. Existing deep-equality pins at `tests/skill-load-report-cli.test.js:150-153`, `:166-169`, and the `overClosure is false when max equals the closure exactly` test (`:172-178`) assert `overClosure`; this task rewrites them to `outsideClosure` (`[]` for the demo rows with no reads, `null` for null-closure rows) and deletes the `max equals the closure` test (the byte comparison no longer exists).

**Interfaces:**
- Produces: CLI flag `--optional-plugin-root <dir>` (repeatable; resolved against `--cwd`/process cwd like `--plugin-root`; a root without a `skills/` directory is skipped silently). Row key `outsideClosure: string[] | null`. Module export unchanged: `{ run, parseArgs }`; `parseArgs` result gains `optionalRoots: string[]`.

- [ ] **Step 1: Write the failing tests** in `tests/skill-load-report-cli.test.js`. Add a helper `withFile(root, rel, text)` writing `path.join(root, rel)`. Fixture read path prefix for the demo plugin: `CACHE = '/home/u/.claude/plugins/cache/m/demo/1.0.0'`. Tests (all build `pluginRoot()` and run with `['--plugin-root', root]` unless stated):
  - `AC1.1: a read of a root file outside the closure is listed in outsideClosure` — add `skills/alpha/extra.md` (uncited); transcript: `invocation('demo:alpha','t1',100)`, `readUse(CACHE + '/skills/alpha/extra.md','r1')`, `readResult('r1',40)`. Assert the `demo:alpha` row's `outsideClosure` deep-equals `['skills/alpha/extra.md']`.
  - `AC1.2: reading only closure files leaves outsideClosure empty` — same root plus `extra.md`; the read is `CACHE + '/skills/alpha/SKILL.md'`. Assert `outsideClosure` deep-equals `[]`.
  - `cross-root reads are not comparable` — reads `'/repo/.claude/skills/other/SKILL.md'` and `'/home/u/.claude/plugins/cache/m2/other/2.0.0/skills/beta/SKILL.md'` (root holds neither `skills/other/SKILL.md` nor `skills/beta/SKILL.md`). Assert `outsideClosure` is `[]`.
  - `outsideClosure is distinct and sorted` — root holds uncited `skills/alpha/z.md` and `skills/alpha/b.md`; two `demo:alpha` invocations, the first reading `z.md` then `b.md`, the second reading `z.md` again (distinct tool_use ids). Assert `['skills/alpha/b.md','skills/alpha/z.md']`.
  - `null closure gives null outsideClosure` — `other:alpha` invocation reading `CACHE + '/skills/alpha/extra.md'`, plus a subagent-free orphan read before any invocation (lands in `(main, unattributed)`). Assert both rows have `closure: null, outsideClosure: null`.
  - `--optional-plugin-root without skills/ is skipped, not exit 2` — `run(['--plugin-root', root, '--optional-plugin-root', tmp('slr-noskills-')], deps)` returns 0 and stdout parses with `status` `ok`; `--optional-plugin-root` with no value exits 2 (add `['--optional-plugin-root']` to the malformed-invocations list).
  - `--optional-plugin-root with skills/ joins its closure` — copy `pluginRoot()` minus `.claude-plugin` into `{cwd}/.claude`; `run(['--optional-plugin-root', '.claude'], deps)` with an `alpha` invocation: the `alpha` row's `closure` is a number and `outsideClosure` is `[]`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/skill-load-report-cli.test.js`
Expected: FAIL — the new tests fail on `outsideClosure` being `undefined` and `--optional-plugin-root` being an unknown argument (exit 2).

- [ ] **Step 3: Implement in `plugin/bin/skill-load-report.js`**
  - `parseArgs`: accept `--optional-plugin-root <v>` into `o.optionalRoots` (same missing-value rule as `--plugin-root`); update `USAGE` and the header comment's Usage/Output/Exit text (`overClosure` → `outsideClosure`, describe the root-file rule and the optional-root skip).
  - `run`: after the explicit-root `skills/` check, append each optional root (resolved against `cwd`) whose `path.join(r,'skills')` is a directory; dedupe resolved roots (a `Set`) before indexing.
  - `closureIndex(rootsAbs)`: build one `pluginRootReader(rootAbs)` per root, take `rootFiles = new Set(reader.listFiles())`, and store `{ closure: e.closure, files: new Set(e.files), rootFiles }` per key. `closureOf` returns that entry or `null`.
  - `closureRelative(readPath) -> string | null`: the suffix from the last `/skills/` segment (`'skills/…'`), or the path itself when it starts with `skills/`, else `null`. (No nested `skills/` directory exists under `plugin/skills` or `.claude/skills` — `find … -mindepth 2 -type d -name skills` returned nothing.)
  - Before `summarizeLoads`, collect `readsBySkill: Map<foldedSkill, Set<readPath>>` from every row's `readPaths`. For each summarized row: `entry = closureOf(index, skill)`; `closure = entry ? entry.closure : null`; `outsideClosure = entry ? [...distinct normalized paths p where entry.rootFiles.has(p) && !entry.files.has(p)].sort() : null`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/skill-load-report-cli.test.js tests/bin-lib/skill-audit/transcript-load.test.js`
Expected: PASS (all tests, 0 failures)

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/skill-load-report.js tests/skill-load-report-cli.test.js
git commit -m "Compare skill reads against closure files in skill-load-report — outsideClosure replaces overClosure, refs #3460"
```

### Task 2: harness-health Skill-load check prose, its pins, and docs

**Files:**
- Modify: `plugin/skills/harness-health/SKILL.md:116-122` (the Skill-load check paragraph only)
- Modify: `docs/plugin-structure.md:141` (the `skill-load-report.js` CLI line)
- Modify: `docs/journeys/read-a-transcript-measured-skill-load-3309.md` (title literal, Step 2/3 wording)
- Test: `tests/skill-load-report-cli.test.js` (prose-pin test at `:253-272`; new AC3 + guard tests)

**Interfaces:**
- Consumes: Task 1's `--optional-plugin-root` flag and `outsideClosure` row key.

- [ ] **Step 1: Write the failing tests** in `tests/skill-load-report-cli.test.js`:
  - Update the prose-pin test's needle list to exactly: `'node "${CLAUDE_PLUGIN_ROOT}/bin/skill-load-report.js" --plugin-root "${CLAUDE_PLUGIN_ROOT}" --optional-plugin-root .claude'`, `'top 10'`, `'non-empty `outsideClosure`'`, `'"Skill reads files outside its static closure: {skill}"'`, `'open `by:harness-health` issue already carries that exact title'`, `'`status: "ok"`'`, `'empty `outsideClosure`'`, `'Back within its static closure: no outside reads over {sessions} sessions'`, `'never closes anything'`, `'`--dry-run`'`. Factor the paragraph extraction into `skillLoadParagraph(text)` shared with the CRLF test.
  - `AC3.1: a project-local skill invoked from a worktree joins its .claude/skills closure under the harness-health command as written` — extract the paragraph's ```bash line, replace `${CLAUDE_PLUGIN_ROOT}` with a fixture plugin root from `pluginRoot()`, split on spaces outside double quotes, drop the first two tokens (`node`, the script path), and strip quotes. Fixture project: `deps.cwd` holds `.claude/skills/alpha/SKILL.md` (no plugin.json) plus uncited `.claude/skills/alpha/notes.md`. Transcript: `invocation('.claude/worktrees/wt:alpha','t1',100)`, a read of `path.join(cwd,'.claude/skills/alpha/notes.md')`. Assert `run(argv, deps)` is 0 and the `alpha` row has a numeric `closure` and `outsideClosure` deep-equal `['skills/alpha/notes.md']`.
  - `the harness-health command runs in a project with no .claude/skills` — same argv extraction, `deps.cwd` with no `.claude`; assert exit 0.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/skill-load-report-cli.test.js`
Expected: FAIL — the prose-pin test reports the missing `--optional-plugin-root .claude` command, and the AC3 test's `alpha` row has `closure: null`.

- [ ] **Step 3: Rewrite the Skill-load check paragraph** (`plugin/skills/harness-health/SKILL.md`), keeping its lead-in literal `**Skill-load check (#3309, runs every firing).**`, the one ```bash block, and one following paragraph. Required content: the measurement sentence now says the check lists, per skill, files of its own root that sessions read but its citations never reach; the command becomes `node "${CLAUDE_PLUGIN_ROOT}/bin/skill-load-report.js" --plugin-root "${CLAUDE_PLUGIN_ROOT}" --optional-plugin-root .claude`, with one clause that the optional root joins project-local skills and is skipped when `.claude/skills/` is absent; SUMMARIZE includes each top-10 row's `outsideClosure` count and paths; filing is "for each row with a non-empty `outsideClosure`", title `"Skill reads files outside its static closure: {skill}"`, body carrying the skill name, its `outsideClosure` paths, `invocations` and `sessions` (never transcript text); dedup sentence unchanged; auto-close is "whose `{skill}` is in `rows` with an empty `outsideClosure`" with comment `Back within its static closure: no outside reads over {sessions} sessions`; "a `no-data` firing, a skill absent from `rows`, or a `null` `outsideClosure` never closes anything"; `--dry-run` sentence unchanged. Then `wc -c plugin/skills/harness-health/SKILL.md` must print ≤ 48900 — trim wording inside this paragraph if it does not.
  - `docs/plugin-structure.md:141`: add `[--optional-plugin-root <dir>]...` to the usage, say rows carry `outsideClosure` (root files read but outside the closure), and that an optional root without `skills/` is skipped.
  - Journey doc: replace the old title with `"Skill reads files outside its static closure: {skill}"`; Step 2 says the record lists the outside paths (drop the "no CLI lists closure files today" sentence); Step 3's close condition becomes an empty `outsideClosure` with the new comment text.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/skill-load-report-cli.test.js`
Expected: PASS (0 failures)

Run: `git grep -n -F -e overClosure -e "Skill load exceeds its static closure" -- plugin tests docs/plugin-structure.md docs/journeys`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/harness-health/SKILL.md docs/plugin-structure.md docs/journeys/read-a-transcript-measured-skill-load-3309.md tests/skill-load-report-cli.test.js
git commit -m "File harness-health skill-load records on reads outside the closure — project-local roots via --optional-plugin-root, refs #3460"
```

### Task 3 (controller, not dispatched): AC2 real-transcript probe

- [ ] **Step 1:** From the worktree, run the new CLI against this repo's real transcripts the way harness-health would from the main checkout: `node plugin/bin/skill-load-report.js --cwd "/Users/thomasholknielsen/Code Workspaces/claude-tweaks" --plugin-root "/Users/thomasholknielsen/.claude/plugins/cache/claude-tweaks-marketplace/claude-tweaks/6.145.0" --optional-plugin-root .claude > {scratchpad}/ac2-report.json`. Record every row whose `outsideClosure` is non-empty.
- [ ] **Step 2 (independent count):** re-run the scratch probe (`{scratchpad}/probe-outside.js`, its own transcript walk and normalization, extended with the same root-file filter) over the same transcripts and reconcile its per-skill outside lists with Step 1's exactly; any difference is a defect to investigate before review.
- [ ] **Step 3:** `AC2.1`: post the reconciled list (skill → outside paths, sessions count) as a PR #3861 comment and log it to the run's `decisions.md`; if no row is non-empty, the comment states why.
