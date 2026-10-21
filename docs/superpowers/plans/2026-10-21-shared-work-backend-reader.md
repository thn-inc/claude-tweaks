# Shared work-backend reader Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One shared, read-only `work-backend` reader under `plugin/bin/lib/`. Every bin copy of the CLAUDE.md regex migrates to it, and the session-start re-entry banner prints bare record ids under `work-backend: local-files`.

**Architecture:** A new single-file module, `plugin/bin/lib/work-backend.js`, owns `WORK_BACKEND_RE` and exposes a pure text parser plus an fs reader that never throws. The three current copies (`hooks/pre-tool-use.js`, `wrap-up/pack.js`, `reconcile/archive-merged.js`) delegate to it and lose their local regex. `hooks/session-residue.js`'s `collectStaleRuns` reads the main checkout's backend once per call and drops the `#` sigil only for `local-files`.

**Tech Stack:** Node 18+, CommonJS, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-21T055740-record-3554/work/3554-spec.md` (record #3554)

## Global Constraints

- The reader is read-only: CLAUDE.md `work-backend:` line → value or `null`, **never throws**.
- Under `local-files` the re-entry suffix lists bare ids (`11,12`). Under any other backend, or an unreadable one, it keeps `#11,#12`.
- Commit subjects: `{Verb} {what} — {detail}`, with `refs #3554` in the body. Never `closes`/`fixes`.

## Premise corrections (verified at authoring time)

- The spec says the regex "already exist[s] twice". `git grep -nF 'work-backend:\s' -- plugin/bin` finds **three** copies:
  ```
  plugin/bin/lib/hooks/pre-tool-use.js:80:const WORK_BACKEND_RE = /^work-backend:\s*(\S+)\s*$/m;
  plugin/bin/lib/reconcile/archive-merged.js:1801:const WORK_BACKEND_RE = /^work-backend:\s*(\S+)\s*$/m;
  plugin/bin/lib/wrap-up/pack.js:71:const WORK_BACKEND_RE = /^work-backend:\s*(\S+)\s*$/m;
  ```
  `archive-merged.js` (added by #3503 after the record was filed) migrates too. Otherwise AC2.1's "only in the new shared reader" cannot hold.
- AC2's grep as written (`git grep -n 'work-backend:\s'`, BRE) treats `\s` as whitespace. On this tree it matches nine prose comments (e.g. `materialize.js:5`) and none of the regex literals. The plan verifies AC2.1 with the fixed-string form `git grep -nF 'work-backend:\s' -- plugin/bin`, which is the AC's evident intent, and pins that form as a committed guard test.
- Not migrated: `plugin/bin/lib/compose-context/resolve-conditions.js:78` reads `work-backend` through its generic `parseFlatLines` key map, not a dedicated regex copy. It is out of scope and the AC grep does not see it.

## Review Focus

1. A CLAUDE.md with `work-backend:   local-files   ` (padded), or the line inside a larger body: it must still resolve `local-files`, as today's regex does. This is pinned in Task 1's parser test.
2. A CLAUDE.md that is a directory, unreadable, or absent: the reader returns `null` and the banner keeps `#`. This is pinned in Task 1 (absent, directory) and Task 2 (absent).
3. The banner reads the **main checkout's** CLAUDE.md, never the run's worktree. The suffix belongs to the project, and `cwd` may be a worktree. Pinned in Task 2: the fixture writes CLAUDE.md at the main root only.
4. An unknown backend value (`work-backend: jira`) keeps `#`. Pinned in Task 2.
5. The existing consumer semantics stay unchanged. `pack.js` still reports `{value, source: 'unconfigured'}` on a missing line. `pre-tool-use` still exempts `local-files` and unconfigured. `archive-merged` still disables the record check only for `local-files`. These are pinned by the existing suites run in Task 1, Step 6.

---

### Task 1: Shared reader + migrate the three regex copies

**Files:**
- Create: `plugin/bin/lib/work-backend.js`
- Test: `tests/bin-lib/work-backend.test.js`
- Modify: `plugin/bin/lib/hooks/pre-tool-use.js` (remove `WORK_BACKEND_RE` at :76-80 and `readWorkBackendValue` at :1450-1462; call site :1912)
- Modify: `plugin/bin/lib/wrap-up/pack.js` (remove `WORK_BACKEND_RE` + its comment at :63-71; `resolveWorkBackend` (formerly `readWorkBackend`) at :144 parses via the shared parser)
- Modify: `plugin/bin/lib/reconcile/archive-merged.js` (remove `WORK_BACKEND_RE` + local `readWorkBackend` at :1796-1810; call site :1899)
- Modify: `docs/hooks.md:37` ("mirroring `bin/lib/wrap-up/pack.js`'s own `readWorkBackend`" → names `bin/lib/work-backend.js`'s shared reader)

**Interfaces:**
- Produces:
  - `parseWorkBackend(text: unknown) -> string | null`: the `work-backend:` line's value from CLAUDE.md text. A non-string or empty input, or no matching line, gives `null`.
  - `readWorkBackend(root: string, { readFile = fs.readFileSync } = {}) -> string | null`: reads `path.join(root, 'CLAUDE.md')`. Any read error gives `null`. Never throws.
  - `WORK_BACKEND_RE`, exported for the guard test only. The value is unchanged: `/^work-backend:\s*(\S+)\s*$/m`.

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/work-backend.test.js`:
  - `parseWorkBackend: value from a work-records block`: `'# P\n\n## Work records\n\nwork-backend: local-files\nwork-types: labels\n'` → `'local-files'`.
  - `parseWorkBackend: padded value`: `'work-backend:   github-issues   \n'` → `'github-issues'`.
  - `parseWorkBackend: no line / non-string → null`: `'# P\n'`, `''`, `undefined`, `null` → each `null`.
  - `readWorkBackend: reads root/CLAUDE.md` (tmpdir with CLAUDE.md `work-backend: local-files\n`) → `'local-files'`.
  - `readWorkBackend: absent CLAUDE.md → null`, and `CLAUDE.md is a directory → null` (does not throw).
  - `readWorkBackend: injected readFile that throws → null`.
  - `AC2.1: the work-backend regex source appears only in plugin/bin/lib/work-backend.js`: walk every `*.js` under `plugin/bin` (skip `node_modules`, dot-dirs). Collect repo-relative paths whose text includes the fixed string `work-backend:\s`, then assert a deep equality with `['plugin/bin/lib/work-backend.js']`.

- [ ] **Step 2: Run to verify it fails**

  Run: `node --test tests/bin-lib/work-backend.test.js`
  Expected: FAIL with `Cannot find module '../../plugin/bin/lib/work-backend'`

- [ ] **Step 3: Implement `plugin/bin/lib/work-backend.js`** with the Interfaces above. A header comment states that it is the one CLAUDE.md `work-backend:` reader (#3554). The key lives in CLAUDE.md, not `policy.yml` (`_shared/work-record-config.md`), and an absent line is *unconfigured*, so the reader returns `null` and never applies a default. Then migrate:
  - `pre-tool-use.js`: `const { readWorkBackend } = require('../work-backend');`. The call site becomes `readWorkBackend(wtRoot)`. Delete the local regex, `readWorkBackendValue`, and the "#2526: … mirrors" comment block (fold its one useful sentence, "`local-files` has no claim infrastructure, only `github-issues` arms the check", into the call-site comment that already says this).
  - `pack.js`: `const { parseWorkBackend } = require('../work-backend');`. `resolveWorkBackend(deps, worktree)` (renamed from `readWorkBackend` to avoid clashing with the shared reader) keeps its `{value, source}` shape and its `deps.readText` seam, calling `parseWorkBackend(readText(...))`. Delete the local regex and the stale "No reader for this key exists anywhere in bin/lib" comment, keeping the "not in policy.yml" rationale in one line next to `POLICY_KEYS`.
  - `archive-merged.js`: `const { readWorkBackend } = require('../work-backend');`. Delete the local regex and function. The call site stays `readWorkBackend(root) !== 'local-files'`, and the #3503 comment is kept.
  - `docs/hooks.md:37`: point the parenthetical at `bin/lib/work-backend.js`'s shared `readWorkBackend`.

- [ ] **Step 4: Run to verify it passes**

  Run: `node --test tests/bin-lib/work-backend.test.js`
  Expected: PASS (all tests)

- [ ] **Step 5: AC2.1 grep**

  Run: `git grep -nF 'work-backend:\s' -- plugin/bin`
  Expected: exactly one line, `plugin/bin/lib/work-backend.js:…:const WORK_BACKEND_RE = …`

- [ ] **Step 6: The consumer suites still pass (AC2.1's second half)**

  Run: `node --test tests/hooks-bookkeeping-stamps-gate.test.js tests/bin-lib/wrap-up/pack.test.js tests/bin-lib/wrap-up/pack-cli.test.js tests/bin-lib/reconcile/archive-merged.test.js`
  Expected: PASS, 0 fail

- [ ] **Step 7: Commit**

  ```bash
  git add plugin/bin/lib/work-backend.js tests/bin-lib/work-backend.test.js plugin/bin/lib/hooks/pre-tool-use.js plugin/bin/lib/wrap-up/pack.js plugin/bin/lib/reconcile/archive-merged.js docs/hooks.md
  git commit -m "Extract one shared work-backend reader — migrate pre-tool-use, wrap-up pack, archive-merged" -m "refs #3554"
  ```

### Task 2: Re-entry banner drops the `#` sigil under local-files

**Files:**
- Modify: `plugin/bin/lib/hooks/session-residue.js:55-103` (`collectStaleRuns`)
- Test: `tests/bin-lib/hooks/session-residue.test.js` (after the AC5.1 block, around :357-365)

**Interfaces:**
- Consumes: `readWorkBackend(root)` from Task 1 (`require('../work-backend')`), and `wtDetect.mainCheckoutRoot(cwd)` (already imported).
- Produces: no signature change. `collectStaleRuns(cwd, opts)`'s re-entry suffix ids are `'11,12'` when the main checkout's CLAUDE.md says `local-files`, otherwise `'#11,#12'`.

- [ ] **Step 1: Write the failing tests.** Each uses `reentryFixture()` and then writes `CLAUDE.md` at the fixture's `root` (the main checkout) before calling `residue.collectStaleRuns(root, { pluginRoot: '/plugins/claude-tweaks' })`:
  - `AC1.1 local-files CLAUDE.md -> suffix lists bare ids`: CLAUDE.md `'# P\n\nwork-backend: local-files\n'`. Assert `entries[0].line.endsWith(\` — consolidated pass never ran: PIPELINE_RUN_DIR="${runDir}" /claude-tweaks:flow 11,12 review-console\`)`.
  - `AC1.2 github-issues CLAUDE.md keeps the # ids`: CLAUDE.md `'# P\n\nwork-backend: github-issues\n'`. Assert `endsWith(reentrySuffix(runDir))` (the existing `#11,#12` helper).
  - `#3554 unknown backend keeps the # ids`: `'work-backend: jira\n'` → `endsWith(reentrySuffix(runDir))`.
  - `#3554 reads the main checkout, not the worktree`: write `local-files` CLAUDE.md into the fixture's `wt` only, with none at `root`. Then call `collectStaleRuns(wt, …)` → `endsWith(reentrySuffix(runDir))`, because the main root has no CLAUDE.md and the result is unconfigured.
  - The existing `AC5.1 eligible…` test (no CLAUDE.md, unreadable) keeps `#11,#12` unchanged and covers the absent case.

- [ ] **Step 2: Run to verify it fails**

  Run: `node --test tests/bin-lib/hooks/session-residue.test.js`
  Expected: FAIL. `AC1.1` reports a line ending `/claude-tweaks:flow #11,#12 review-console`. The other new tests pass.

- [ ] **Step 3: Implement.** In `collectStaleRuns`, resolve `const sigil = readWorkBackend(wtDetect.mainCheckoutRoot(cwd) || cwd) === 'local-files' ? '' : '#';` once, before the `map`. The ids line becomes `pass.specIds.map((id) => sigil + id).join(',')`. Extend the #3497 comment by one sentence: the record-reference grammar drops the sigil under `local-files` (`_shared/record-batch-input.md`), and an unreadable or unknown backend keeps `#`.

- [ ] **Step 4: Run to verify it passes**

  Run: `node --test tests/bin-lib/hooks/session-residue.test.js tests/hooks-session-start.test.js`
  Expected: PASS, 0 fail. `AC6.1` in hooks-session-start still sees `#11,#12`, because its fixture has no CLAUDE.md.

- [ ] **Step 5: Commit**

  ```bash
  git add plugin/bin/lib/hooks/session-residue.js tests/bin-lib/hooks/session-residue.test.js
  git commit -m "Print bare record ids in the re-entry banner under local-files — shared work-backend reader" -m "refs #3554"
  ```
