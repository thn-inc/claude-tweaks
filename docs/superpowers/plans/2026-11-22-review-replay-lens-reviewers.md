# Replay Archived Lens Reviewers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `extract-reviews` and `score-reviews` to `tools/review-replay.js`. Together they replay archived lens reviewers against a clean two-commit repository under chosen arms, and score each arm against the review's confirmed findings and against a control arm.

**Architecture:** Pure prompt rewriting goes in `tools/review-replay/reviews-rewrite.js`. Selection, repository building (behind a `deps.writeRepo` seam) and outputs go in `tools/review-replay/reviews-extract.js`. Scoring goes in `tools/review-replay/reviews-score.js`. The new modules reuse the existing parsers (`parseLensReport`, `counterfactual.js` `parseFindings`/`near`/`lastAssistantText`/`indexTranscripts`) and the existing identity/cost/effort readers (`score.js`). The tiebreak commands are unchanged apart from added exports and CLI wiring.

**Tech Stack:** Node 18+ CommonJS, `node:test`, git CLI.

**Spec:** `.claude-tweaks/pipelines/2026-11-22T104506-spec-5991/work/5991-spec.md` (record #5991)

Scope keywords: extractReviews, scoreReviews, REVIEWS_MANIFEST_FILE, makeWriteRepo

Waived tools/pipeline-cost-report/reviews.js: read only — Task 4 and Task 5 import its `parseLensReport` and `lensIdOf` unchanged (premise correction 1)

## Global Constraints

- Exit codes: 0 ok; 1 runtime failure; 2 malformed invocation; 3 not a clean result. An unmet `--min-reviews` and any `notJudged` both exit 3. Exclusions alone never change the exit code.
- `--out` must be new or empty, as `extract` requires.
- Never write the archived reply text or a `decisions.md` verdict line into a clean repository, a prompt, or a copied file. `archived-reports.json` carries only `sev`/`path`/`line` per row, never row text.
- Every commit the tool makes passes an explicit identity and date, and never inherits `GIT_*` env: name `review-replay`, email `review-replay@localhost`, date `2000-01-01T00:00:00Z`. CI exports `GIT_AUTHOR_*`. Tests also build their history with an explicit committer and a filtered env.
- Import the parsers; never copy them. `parseLensReport` comes from `tools/pipeline-cost-report/reviews.js`. `parseFindings`, `near`, `NEAR_LINES`, `lastAssistantText` and `indexTranscripts` come from `tools/review-replay/counterfactual.js`. `agentIdentity`, `transcriptCost`, `transcriptEffort`, `readJournal`, `identifyAgents` and `stripTree` come from `tools/review-replay/score.js`.
- Nothing under `plugin/` names a new file (`tests/review-replay/no-plugin-reference.test.js`).
- `replay.workflow.js` is not modified. `reviews-manifest.json` arms carry exactly the keys the workflow reads, plus `profile`.
- Fixed literals: manifest `kind: "reviews"`; files `reviews-manifest.json`, `reviews-fixture.json`, `archived-reports.json`; reserved arm name `control`.

## Premise corrections (probed 2026-11-22 against the 2,970 archived lens dispatches, 2,884 with transcripts)

These override the spec's Current State where the two disagree. Each is logged as a `premise reversed:` decision line.

1. `parseLensReport` returns **severity counts** (`{critical, high, medium, low, info, overflow}` or null), not located rows. The located rows used for recall, `near` and `new` come from `counterfactual.js` `parseFindings` (`{rows:[{sev,path,line,text}], skipped}` or null). A reply is **parsed** exactly when `parseLensReport(text) !== null`. Its rows are `parseFindings(text)?.rows ?? []`.
2. Only 132 prompts carry a `git diff X...Y` or `base X ... HEAD Y` range. 776 use `{base}...HEAD` with the head named separately as `HEAD {sha}`, `reviewed HEAD {sha}` or `HEAD at {sha}`, and 1,132 name no sha at all (`origin/main...HEAD`). `rangeOf` (Task 2) reads each side separately and falls back per side to `readRun`'s recorded base and review head. The clean repository also carries `refs/remotes/origin/{name}` at the replay base for every `origin/{name}` the prompt names, so `origin/main...HEAD` resolves in it.
3. Run-directory files named by prompts: `review-ctx/agent-scratch/*` 2,320 (+484 under `spec-N/`), `review-ctx/context.md` 2,170 (+414), `work/N-spec.md` 2,003 (+340), and `context/lens-child.md` 74 (+62). That last is a procedure bundle, holding no verdicts, which the spec did not list. `delta-ctx/context.md` and `delta-ctx/agent-scratch/*` appear 14 each. The copyable kinds are therefore: context bundle (`review-ctx/context.md`, `delta-ctx/context.md`), spec (`work/{name}.md`), procedure bundle (`context/{name}.md`), and scratch (`review-ctx/agent-scratch/{name}`, `delta-ctx/agent-scratch/{name}`). Everything else (`decisions.md`, `staged/`, `evidence/`, `sdd-final-review.md`, `review-ctx/own-work-files.txt`, a bare `work/`) is `unknown-run-input`.
4. A run's lens dispatches carry different archived tiers and efforts, and `replay.workflow.js` reads model and effort per arm. So the control is one arm per distinct (tier, effort). The arm is named `control` when there is a single group, else `control.{tier}.{effort|none}`. A user arm named `control`, or starting `control.`, exits 2. `fidelity` aggregates every control arm.
5. Prompts carry absolute paths (main checkout, worktree) that only exist on the machine that built the fixture. So the fixture is a **test-time builder** (`tests/review-replay/reviews-fixture.js`), not a static `tests/fixtures/review-replay/reviews/` directory.

## Review Focus

1. A main-checkout path with a space in it (this repository's own `Code Workspaces`): path matching is prefix-based, never whitespace tokenizing. Pinned in Task 2 (`rewrite handles a main-checkout path containing a space`).
2. A run-directory path named inside a copied context bundle or spec. If it is absolute (under the main checkout or a worktree) or names the archived run's own directory, it is rewritten to the slot's copy when one exists, else replaced by `[run-directory path removed]`, and it is never left live. A relative mention of another run in diff text is left unchanged, so the replayed diff is the archived diff (plan-review decision 2). Neither case is a reason to exclude. Pinned in Task 4 (AC4 test, with a generic mention in the fixture bundle).
3. An abbreviated archived sha that is also a prefix of an unrelated hex token, such as a blob id in the bundle's `index abc1234..def5678` lines: only word-bounded tokens of 7+ hex characters that prefix a mapped archived sha are rewritten. Pinned in Task 2 (`sha rewrite leaves unrelated hex tokens`).
4. The same lens/side dispatched twice in one run (a fix-wave re-review): the second slot is named `{lens}-{side}.2`, never colliding or overwriting. Pinned in Task 4 (`a repeated lens/side dispatch gets its own slot`).
5. A replay agent that cites the clean repository's absolute path in its rows: `stripTree(text, repoPath)` runs before parsing, so its rows match archived repo-relative paths. Pinned in Task 5 (`rows citing the absolute repo path still score`).

---

### Task 1: Shared contract — schema keys, validator and the exports the new modules reuse

**Role:** integration

**Files:**
- Modify: `tools/review-replay/schema.js`
- Modify: `tools/review-replay/counterfactual.js` (exports only)
- Modify: `tools/review-replay/score.js` (exports only)
- Modify: `tools/review-replay/extract.js` (export `parseArm`)
- Modify: `tools/review-replay/archive.js` (export `LENS_RE`, `SIDE_RE`)
- Test: `tests/review-replay/reviews-schema.test.js`

**Interfaces:**
- Produces, from `schema.js`:
  - `REVIEWS_MANIFEST_FILE = 'reviews-manifest.json'`, `REVIEWS_FIXTURE_FILE = 'reviews-fixture.json'`, `REPORTS_FILE = 'archived-reports.json'`
  - `REVIEWS_KIND = 'reviews'`, `CONTROL_ARM = 'control'`, `isControlArm(name) -> boolean` (true for `control` and `control.*`)
  - `REVIEWS_MANIFEST_KEYS = ['schemaVersion','kind','arms']`, `REVIEWS_ARM_KEYS = ['name','profile','model','effort','repeat','prompts']`, `REVIEWS_PROMPT_KEYS = ['file','name','run','lens','side','repo']`
  - `REVIEW_EXCLUSION_REASONS = ['no-decisions','decisions-unreadable','no-review','unlabelled-dispatch','no-archived-tier','no-transcript','no-sha-range','commit-not-in-clone','run-input-gone','unknown-run-input','unrewritten-path','report-unparsed']`
  - `validateReviewsManifest(obj) -> string[]`
- Produces, as new exports:
  - `counterfactual.js`: `parseFindings`, `near`, `NEAR_LINES`, `lastAssistantText`, `indexTranscripts`
  - `score.js`: `transcriptCost`, `readJournal`, `identifyAgents`
  - `extract.js`: `parseArm`
  - `archive.js`: `LENS_RE`, `SIDE_RE`

- [ ] **Step 1: Write the failing test** `tests/review-replay/reviews-schema.test.js`:
  - `validateReviewsManifest` returns `[]` for `{schemaVersion:1, kind:'reviews', arms:[{name:'a',profile:'fast',model:'haiku',effort:null,repeat:1,prompts:[{file:'/x.md',name:'r/3a-a',run:'r',lens:'3a',side:'a',repo:'/repo'}]}]}`.
  - It names `kind must be "reviews"` for `kind:'tiebreak'`, `missing key lens` for a prompt with no `lens`, and `repeat must be a positive integer` for `repeat:0`.
  - `isControlArm('control') === true`, `isControlArm('control.standard.medium') === true`, `isControlArm('controls') === false`.
  - Every new export listed in Interfaces is a function or value (`typeof … !== 'undefined'`).
- [ ] **Step 2: Run test to verify it fails**
Run: `node --test tests/review-replay/reviews-schema.test.js`
Expected: FAIL — `validateReviewsManifest is not a function`.
- [ ] **Step 3: Implement.** `validateReviewsManifest` mirrors `validateManifest`'s `keyProblems` walk over the three key lists. It adds the `kind` check, the `repeat` positive-integer check, and `prompts must be an array`. The other files only gain names in `module.exports`, with no logic changes.
- [ ] **Step 4: Run tests to verify they pass**
Run: `node --test tests/review-replay/reviews-schema.test.js tests/review-replay/counterfactual.test.js tests/review-replay/score.test.js tests/review-replay/extract.test.js`
Expected: PASS, 0 failures.
- [ ] **Step 5: Commit** — `Add the reviews manifest schema and export the parsers the lens replay reuses` with `refs #5991`.

### Task 2: Prompt rewriting — `reviews-rewrite.js` (pure)

**Role:** integration
**Review risk:** high

**Files:**
- Create: `tools/review-replay/reviews-rewrite.js`
- Test: `tests/review-replay/reviews-rewrite.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks (pure string functions).
- Produces:
  - `rangeOf(text) -> { base: string|null, head: string|null }`. `base`: group 1 of `/\b([0-9a-f]{7,40})\.\.\.(?:HEAD\b|[0-9a-f]{7,40}\b)/`, else `/\bbase\s+([0-9a-f]{7,40})\b/i`. `head`: `/\.\.\.([0-9a-f]{7,40})\b/`, else `/\bHEAD(?:\s+at)?\s+([0-9a-f]{7,40})\b/`. First match wins.
  - `originRefsOf(text) -> string[]`: distinct `origin/{name}` names (`/\borigin\/([A-Za-z0-9._\/-]+?)(?=\.\.\.|[\s`'"),]|$)/g`).
  - `runInputsOf(text, { mainRoot, runName, copy = false }) -> { inputs: [{ match, member: string|null, rel, kind }], unknown: string[] }`. It finds every occurrence of `.claude-tweaks/pipelines/{seg}/{rest}`, optionally prefixed by `mainRoot` or by a worktree path under `{mainRoot}/.claude/worktrees/{name}`. `rest` runs up to the first character in `` \s"'`) ``, with trailing `.,;:` stripped. `seg` must equal `runName`, else the path goes in `unknown`. The exception is `copy: true`, used for context bundles and spec copies: there a relative occurrence (no `mainRoot` or worktree prefix) whose `seg` is not `runName` is skipped, landing in neither list (plan-review decision 2). A leading `spec-{N}/` in `rest` becomes `member`. `kind` is `bundle` (`review-ctx/context.md`, `delta-ctx/context.md`), `spec` (`work/{name}.md`), `procedure` (`context/{name}.md`), `scratch` (`review-ctx/agent-scratch/{name}[/…]`, `delta-ctx/agent-scratch/{name}[/…]`), or goes in `unknown`.
  - `stripEffortLines(text) -> string`: removes lines matching `/^\[Effort: (low|medium|high|xhigh|max) — [^\]]*\]\s*$/m` (global).
  - `rewriteShas(text, map) -> string`. `map` is `{ archivedSha40: replaySha40 }`. A word-bounded `[0-9a-f]{7,40}` token that is a prefix of a key becomes the mapped sha cut to the token's length. Any other token is unchanged.
  - `rewriteText(text, { mainRoot, runName, repoPath, replacements, shaMap }) -> string`:
    - every `inputs[].match` becomes `replacements[match]`;
    - every `{mainRoot}/.claude/worktrees/{name}` becomes `repoPath`, where `{name}` is `[A-Za-z0-9._+-]+`;
    - then `rewriteShas`.
  - `unrewrittenPaths(text, { mainRoot, runName, outDir }) -> string[]`: the substrings still naming `{mainRoot}/` (worktrees sit under it) or `.claude-tweaks/pipelines/{runName}/`. Occurrences inside `{outDir}/` are not counted, since the output directory may itself sit under the main checkout. This is the spec's `unrewritten-path` as clarified (plan-review decision 2).

- [ ] **Step 1: Write the failing tests** `tests/review-replay/reviews-rewrite.test.js`, one `test()` each:
  - `rangeOf reads git diff X...Y`: `rangeOf('SCOPE: git diff ' + B + '...' + H)` deepEquals `{ base: B, head: H }`.
  - `rangeOf reads base X ... HEAD Y`: `'Diff scope: base ' + B + ' (merge-base) ... HEAD ' + H` gives `{base:B, head:H}`.
  - `rangeOf reads X...HEAD with HEAD named apart`: `` '`git diff ' + B + '...HEAD` (HEAD ' + H + ')' `` gives `{base:B, head:H}`.
  - `rangeOf returns nulls for a symbolic range`: `'git diff origin/main...HEAD'` gives `{base:null, head:null}`. `originRefsOf` of the same text deepEquals `['main']`.
  - `runInputsOf classifies the four kinds`, with `mainRoot = '/m/Code Workspaces/repo'`, run `R`, and the text naming: `{main}/.claude-tweaks/pipelines/R/review-ctx/context.md`; `{main}/.claude/worktrees/w/.claude-tweaks/pipelines/R/work/9-spec.md`; `{main}/.claude-tweaks/pipelines/R/context/lens-child.md`; `{main}/.claude-tweaks/pipelines/R/spec-2/review-ctx/agent-scratch/3b-a`. Kinds are `bundle`, `spec`, `procedure`, `scratch`, the last with `member === 'spec-2'`, and `unknown` is `[]`.
  - `runInputsOf reports decisions.md and another run as unknown`: `…/pipelines/R/decisions.md` and `…/pipelines/OTHER/review-ctx/context.md` both land in `unknown`.
  - `rewrite handles a main-checkout path containing a space`: `rewriteText` on `git -C "{main}/.claude/worktrees/w" diff` gives `git -C "/out/repos/k/repo" diff`, and `unrewrittenPaths(result, { mainRoot, runName: 'R', outDir: '/out' })` is `[]`.
  - `copy mode skips another run's relative mention`: `runInputsOf('see .claude-tweaks/pipelines/OTHER/decisions.md', { mainRoot, runName: 'R', copy: true })` deepEquals `{ inputs: [], unknown: [] }`. The same text without `copy` lands in `unknown`, and `{mainRoot}/.claude-tweaks/pipelines/OTHER/x.md` lands in `unknown` in both modes.
  - `unrewrittenPaths ignores the output directory`: with `outDir = mainRoot + '/out'`, the text `mainRoot + '/out/repos/k/repo'` gives `[]`, and `mainRoot + '/src/a.js'` gives one entry.
  - `sha rewrite maps full and abbreviated shas`: with map `{[B]: RB, [H]: RH}`, `'x ' + B + ' y ' + H.slice(0,7)` gives `'x ' + RB + ' y ' + RH.slice(0,7)`.
  - `sha rewrite leaves unrelated hex tokens`: `'index ' + B.slice(0,6) + 'f..deadbeef1'` is unchanged, when `B.slice(0,6)+'f'` is not a prefix of `B`.
  - `stripEffortLines removes only the resolver line`: `'a\n[Effort: high — apply high-level reasoning depth to this task.]\nb'` gives `'a\nb'`, and `'see [Effort: high] above'` is unchanged.
- [ ] **Step 2: Run test to verify it fails**
Run: `node --test tests/review-replay/reviews-rewrite.test.js`
Expected: FAIL — `Cannot find module '../../tools/review-replay/reviews-rewrite'`.
- [ ] **Step 3: Implement** the six functions with the signatures above. Escape `mainRoot` for regex use (`/[.*+?^${}()|[\]\\]/g`). Match on the forward-slash spelling (`toPosix` from `schema.js`).
- [ ] **Step 4: Run test to verify it passes**
Run: `node --test tests/review-replay/reviews-rewrite.test.js`
Expected: PASS, 0 failures.
- [ ] **Step 5: Commit** — `Add review-replay prompt rewriting for archived lens prompts` with `refs #5991`.

### Task 3: The clean-repository builder — `deps.writeRepo`

**Role:** integration

**Files:**
- Modify: `tools/review-replay.js` (add `makeWriteRepo`, wire `writeRepo` into `defaultDeps`)
- Test: `tests/review-replay/write-repo.test.js`

**Interfaces:**
- Produces:
  - `makeWriteRepo(sourceCwd) -> writeRepo`.
  - `writeRepo(base, head, dest, { originRefs = [] } = {}) -> { base: string, head: string }`, the replay shas. `dest` gets:
    - `git init -q -b replay`;
    - base's tree (via `git archive {base} -- . ':(exclude).claude-tweaks/pipelines'` from `sourceCwd`, extracted with `tar` as `writeTree` does), committed with message `base`;
    - every tracked file removed (`git rm -rq --cached .` then delete everything but `.git`), head's tree extracted the same way and committed with message `head`;
    - `git update-ref refs/remotes/origin/{name} {replay base}` for each `originRefs` entry.
  - Every git call in `dest` runs with an env stripped of `GIT_*` and set to `GIT_AUTHOR_NAME=review-replay`, `GIT_AUTHOR_EMAIL=review-replay@localhost`, `GIT_COMMITTER_NAME`/`EMAIL` the same, `GIT_AUTHOR_DATE=GIT_COMMITTER_DATE=2000-01-01T00:00:00Z`, plus `-c commit.gpgsign=false`.
  - Exported from `tools/review-replay.js` beside `run`, `parseArgs`, `defaultDeps`.

- [ ] **Step 1: Write the failing test** `tests/review-replay/write-repo.test.js`. It builds a throwaway source repo in `scratchDir('rr-wr-')` with explicit `-c user.name=t -c user.email=t@t` and a filtered env. Commit B adds `src/a.js` and `.claude-tweaks/pipelines/p/work/9-spec.md`; commit H changes `src/a.js` and adds `src/b.js`. Then, with `process.env.GIT_AUTHOR_NAME = 'ci-bot'` set for the test and restored in `finally`:
  - `writeRepo(B, H, d1, {originRefs:['main']})`: `git -C d1 log --format=%s` is `head\nbase`; `git -C d1 diff {base}...{head} --name-only` is `src/a.js\nsrc/b.js`; `git -C d1 log -1 --format=%an` is `review-replay`; `d1/.claude-tweaks/pipelines` does not exist; `git -C d1 rev-parse origin/main` equals the returned `base`.
  - `writeRepo(B, H, d2)` returns the same `{base, head}` as for d1 (reproducible shas).
- [ ] **Step 2: Run test to verify it fails**
Run: `node --test tests/review-replay/write-repo.test.js`
Expected: FAIL — `makeWriteRepo is not a function`.
- [ ] **Step 3: Implement** `makeWriteRepo` in `tools/review-replay.js` with `execFileSync` (`windowsHide: true`, `cwd` never `-C` for `tar`, as `writeTree`'s comment explains). In `defaultDeps`, set `writeRepo: makeWriteRepo(cwd)`.
- [ ] **Step 4: Run tests to verify they pass**
Run: `node --test tests/review-replay/write-repo.test.js tests/review-replay/write-tree.test.js`
Expected: PASS, 0 failures.
- [ ] **Step 5: Commit** — `Add the review-replay clean-repository builder for lens replays` with `refs #5991`.

### Task 4: `extract-reviews` — selection, repositories, prompts, outputs, control arm

**Role:** judgment
**Review risk:** high

**Files:**
- Create: `tools/review-replay/reviews-extract.js`
- Modify: `tools/review-replay.js` (command `extract-reviews`; flags `--runs --out --role --arm --select --lens --max-per-lens --min-reviews --transcripts`; required `runs`, `out`, `role`, `transcripts`)
- Create: `tests/review-replay/reviews-fixture.js` (test-time builder)
- Test: `tests/review-replay/reviews-extract.test.js`

**Interfaces:**
- Consumes:
  - Task 1: schema constants and `validateReviewsManifest`; `parseArm`; `LENS_RE`/`SIDE_RE`; `parseFindings`, `lastAssistantText`, `indexTranscripts`; `transcriptEffort`.
  - Task 2: all rewrite functions.
  - Task 3: `deps.writeRepo`.
  - Existing: `readRun`, `selectRuns`, `parseDecisions` (`archive.js`), `parseLensReport` and `lensIdOf` (`tools/pipeline-cost-report/reviews.js`), `PROFILES`/`EFFORT_SCALE` (`plugin/bin/lib/model-profiles/profiles.js` via `deps.pluginRoot`).
- Produces:
  - `extractReviews(opts, deps) -> exitCode`.
  - `ROLES = { lens: { isDispatch(item), slotOf(item) -> { lens, side } | null } }`. Only `lens` is filled. `isDispatch` is `item.role === 'lens reviewer'`. `slotOf` takes the lens id via `LENS_RE` on `item.description`, normalised by `lensIdOf`, and the side via `SIDE_RE`, lowercased. Either one missing gives `null`, which excludes the dispatch as `unlabelled-dispatch`. An unknown `--role` exits 2.
  - The output layout under `--out`:
    - `repos/{run}--{archivedBase.slice(0,7)}-{archivedHead.slice(0,7)}/repo` (one per distinct run, base and head);
    - beside that repo, the slot copies `{lens}-{side}[.k]--context.md`, `{lens}-{side}[.k]--{basename}` (spec, procedure);
    - `scratch/{arm}/{run}/{lens}-{side}[.k]/{original scratch basename}` (empty directories);
    - `prompts/{arm}/{run}/{lens}-{side}[.k].md`;
    - `reviews-manifest.json`, `reviews-fixture.json`, `archived-reports.json`.
  - The manifest arm is `{name, profile, model: PROFILES[profile].model, effort: arm.effort ?? PROFILES[profile].effort, repeat, prompts}`.
  - A prompt entry is `{file, name: '{run}/{lens}-{side}[.k]', run, lens, side, repo}`.
  - `archived-reports.json` holds `{ schemaVersion, reports, confirmed, runRows }`:
    - `reports`: `{ [slotName]: { lens, side, run, unitKey, counts, rows: [{sev,path,line}] } }`;
    - `confirmed`: `{ [unitKey]: { [lens]: { findings: [{path,line,how}], unlocated } } }`, where `unitKey` is the run name, or `{run}/spec-{N}` for a member unit. Confirmed findings belong to the lens as a pair, not to one side, so both sides' slots share one entry;
    - `runRows`: `{ [run]: [{lens,path,line}] }`, the archived rows of every lens dispatch in that run whose archived reply parses (check 4 passed). This holds whatever happens to the dispatch afterwards: a later exclusion, `--lens` or `--max-per-lens` does not remove its rows. `new` is "near no archived row of any lens in that run".
  - Archived rows (in `reports` and `runRows`) are parsed after `stripTree` removes every worktree path the prompt names (`{mainRoot}/.claude/worktrees/{name}`) and then `mainRoot`, so a row the archived reviewer cited by absolute path is stored repo-relative, as replay rows are.
  - `reviews-fixture.json` holds `{ schemaVersion, role, requested, totals: { reviews, byLens }, excluded: [{run, agentId?, lens?, side?, reason}], repos: [{key, run, path, archivedBase, archivedHead, replayBase, replayHead}], slots: [{name, run, unit, lens, side, agentId, repoKey, archivedTier, archivedEffort, controlArm}] }`.

**Rules the implementer cannot infer:**
- Runs come from `selectRuns(opts.runs, opts.select)`, **newest first** (reverse of its order). A run with `readRun(...).excluded` is one `excluded` entry with that reason. The dispatches are the `timing.json` `dispatches.items` of the run dir plus every `spec-*/timing.json`, deduplicated by `agentId`, taken in file order.
- `mainRoot` is `path.resolve(opts.runs, '..', '..')` (the runs root is `{main}/.claude-tweaks/pipelines`).
- Per dispatch, in this order, the first failing check is its exclusion reason:
  1. role/slot (`unlabelled-dispatch`)
  2. `archivedTier = item.tier` must be a `PROFILES` key (`no-archived-tier`)
  3. the transcript via `indexTranscripts(opts.transcripts)` (`no-transcript`)
  4. the archived reply: `lastAssistantText` must satisfy `parseLensReport(...) !== null` (`report-unparsed`)
  5. the prompt is the first `user` message's text. `rangeOf(prompt)` is filled per side from `readRun`'s `base`/`head`, then each side goes through `git rev-parse --verify {sha}^{commit}` via `deps.git` (`no-sha-range` when a side is still null; `commit-not-in-clone` when rev-parse throws)
  6. `runInputsOf` `unknown` non-empty (`unknown-run-input`)
  7. every input's source file must exist, read from `{runDir}/{member ? member + '/' : ''}{rel}`, scratch excepted (`run-input-gone`)
  8. after rewriting, `unrewrittenPaths` non-empty (`unrewritten-path`).
  A dispatch that passes all eight is a slot. `--lens` filters slots, and `--max-per-lens` caps slots per lens in run order. Both apply after the checks, and neither one produces an exclusion.
- `unit`: the slot's run-directory paths all naming one `spec-{N}` member make the unit that member dir. Otherwise the unit is the run dir. The confirmed findings for (unit, lens) are `parseDecisions` of `{unit}/decisions.md`, keeping:
  - `pairConfirmed` entries whose `lensIdOf(lens)` is the lens id (`how: 'pair'`);
  - `verdicts` with `verdict === 'confirmed'` and the same lens (`how: 'tiebreak'`).
  A finding whose `line` is not finite counts in `unlocated`.
- A second dispatch of the same (run, lens, side) is named with suffix `.2`, a third `.3`.
- Copies:
  - A `bundle` copy is the source text through `rewriteText`, where each run-directory path is mapped to this slot's copy of that kind when one exists, else to the literal `[run-directory path removed]`.
  - `spec` and `procedure` copies go through the same rewrite.
  - A copy's run-directory paths come from `runInputsOf(copyText, { mainRoot, runName, copy: true })`. Prompts use the default `copy: false`. Every `unrewrittenPaths` call passes `{ mainRoot, runName, outDir: opts.out }`.
  - Every copy and every prompt passes `unrewrittenPaths` after rewriting, or the slot is excluded `unrewritten-path`.
- Prompt per arm: `stripEffortLines`, then `rewriteText` with the arm's scratch dir as the `scratch` replacement.
- `--arm`: `parseArm` with the profile table. A `chunk` other than 1 is exit 2 (`--arm: chunk does not apply to extract-reviews`). An `isControlArm` name is exit 2. Duplicate names are exit 2.
- Control: group the slots by (`archivedTier`, `archivedEffort`):
  - `archivedEffort` is `transcriptEffort(archived transcript).effort` when it is an `EFFORT_SCALE` level, else `PROFILES[archivedTier].effort`.
  - One group gives the arm `control`. Several give `control.{tier}.{effort ?? 'none'}`.
  - Each control arm has `profile: archivedTier`, `model: PROFILES[tier].model`, `effort`, `repeat: 1`, and only that group's slots.
- `--min-reviews` counts selected slots. Unmet, or zero slots, means exit 3: print `{shortfall:{requested, available}, excluded}` to stderr and write nothing.
- A write failure after selection: exit 1 with the "is now partial" message, exactly as `extract` does.

- [ ] **Step 1: Write the fixture builder and the failing tests.** The fixture builder `tests/review-replay/reviews-fixture.js` exports `buildReviewsFixture(root) -> { mainRoot, runsRoot, transcripts, runName, B, H, worktree }`. It creates:
  - A git repo at `{root}/main checkout/repo` (the space is deliberate) with explicit identity and a filtered env. Commit B is `src/a.js` 20 lines. Commit H is `src/a.js` changed and `src/b.js` added.
  - Run dir `{repo}/.claude-tweaks/pipelines/2026-11-01T000000-spec-9`:
    - `decisions.md` with one `Reproduction: lens "3a correctness" finding src/a.js:10 reproduced` line and one `lens "3b security" finding src/b.js:4 confirmed by tiebreak:abcdefabcdef` line;
    - `timing.json`, whose `dispatches.items` holds four `role:'lens reviewer'` items, `Review lens 3a correctness A`, `… B`, `Review lens 3b security A`, `Review lens 3b security B`, all with `tier:'standard'` and agentIds `l3a-a`, `l3a-b`, `l3b-a`, `l3b-b`;
    - `review-ctx/context.md`, whose text names H, the run's `work/9-spec.md` path, and one diff line `+see .claude-tweaks/pipelines/2025-01-01T000000-spec-1/decisions.md` (another run, relative: a generic mention);
    - `work/9-spec.md`;
    - `packet-inputs/manifest.json` `{mergeBase: B}`.
  - Transcripts under `{root}/projects/slug/sess/subagents/agent-{id}.jsonl`. Each holds a `user` prompt in the shape of the 2026-11-21 lens prompt: worktree `{repo}/.claude/worktrees/flow-spec-9` inside `git -C "…"`, `Diff scope: base {B} ... HEAD {H}`, the context bundle path, the spec path under the worktree, a `SCRATCH:` agent-scratch path, and a `[Effort: medium — …]` line. Each also holds an assistant reply with `effort:'medium'`:
    - `l3a-a`: `| Severity | Path:Line | Finding | Evidence |` with `| high | src/a.js:10 | archived-row-alpha | e |`;
    - `l3a-b`: `No findings.`;
    - `l3b-a`: a row cited as `{worktree}/src/b.js:4` (absolute) with text `archived-row-beta`;
    - `l3b-b`: unparseable prose.
  - `variant` options to add:
    - a fifth dispatch whose prompt names `…/pipelines/{run}/decisions.md` (`l3c-a`);
    - a second run dir `2026-11-02T000000-spec-9`, with its own `decisions.md` holding one `Reproduction:` line (so `readRun` does not exclude it) and one dispatch (`l3d-a`) whose prompt names that run's `review-ctx/context.md`, a file the builder never writes;
    - a repeated `Review lens 3a correctness A` dispatch (`l3a-a2`).
    Every variant dispatch has `tier:'standard'` and an `effort:'medium'` reply.

  The tests go in `tests/review-replay/reviews-extract.test.js`. Each runs `run({argv:['extract-reviews','--runs',runsRoot,'--out',out,'--role','lens','--transcripts',transcripts,'--arm','name=haiku,profile=fast', …], deps})`, with deps holding the real `fs`, a `git` bound to the fixture repo, `writeRepo: makeWriteRepo(repo)` and `pluginRoot`. Repositories, copies and prompts are written only for slots that pass every check, so an excluded dispatch leaves no repository behind.
  - `AC1.1/AC1.2: one clean repository per review with two commits and the archived file list`: run with two arms (`name=haiku,profile=fast` and `name=sonnet,profile=standard`). There is exactly one `repos/*/repo` (both arms and every slot of the one run share it), its `git log --format=%s` is `head\nbase`, and its `git diff {replayBase}...{replayHead} --stat` lists the same file names as `git diff B...H --stat` in the fixture repo.
  - `AC2.1/AC2.2: no prompt names an archived sha or a fixture path`: no prompt file contains `B`, `H`, `B.slice(0,7)`, the worktree path or `mainRoot`. Each prompt contains its prompt entry's `repo` and the `replayBase`/`replayHead` of `reviews-fixture.json` `repos[0]`.
  - `AC3.1/AC3.2/AC3.3: decisions.md and a gone run input are excluded`: `excluded` has `{agentId:'l3c-a', reason:'unknown-run-input'}` and `{agentId:'l3d-a', reason:'run-input-gone'}`, and no prompt file under `prompts/` has a name containing `3c-a` or `2026-11-02T000000-spec-9`.
  - `AC4.1/AC4.2: no archived row text or tiebreak line reaches a prompt, repo or copy`: a recursive read of every file under `prompts/` and `repos/` (`.git` excluded) finds none of `archived-row-alpha`, `archived-row-beta` or `confirmed by tiebreak`. Every file matching `repos/*/*--*` (the copies) contains `mainRoot` 0 times and `.claude-tweaks/pipelines/2026-11-01T000000-spec-9` 0 times. The context copy still contains the generic line `+see .claude-tweaks/pipelines/2025-01-01T000000-spec-1/decisions.md` unchanged, and no slot is excluded `unrewritten-path`.
  - `archived rows are stored repo-relative`: the `archived-reports.json` `reports` entry for `3b-a` has `rows[0].path === 'src/b.js'`, and `runRows['2026-11-01T000000-spec-9']` includes the row of `l3c-a`, which is excluded `unknown-run-input` but whose reply parses (give `l3c-a` a one-row table reply at `src/b.js:7`).
  - `l3b-b is excluded as report-unparsed` (`reason:'report-unparsed'`).
  - `AC9.1: one --arm writes the user arm and control`: `reviews-manifest.json` `arms.map(a=>a.name)` deepEquals `['haiku','control']`, the control arm carries `model:'sonnet'`, `effort:'medium'` and `profile:'standard'`, and `validateReviewsManifest` returns `[]`.
  - `a repeated lens/side dispatch gets its own slot`: prompt names include `2026-11-01T000000-spec-9/3a-a` and `2026-11-01T000000-spec-9/3a-a.2`.
  - `AC7.1: the workflow launches one agent per arm × repeat × prompt`: the number of `runWorkflow(manifest)` (helpers.js) calls equals the sum of `prompts.length * repeat` over arms, and each call's `opts.model`/`effort` equals its arm's.
  - `the effort line is gone and the scratch is a new empty directory`: no prompt contains `[Effort:`, and the prompt's `SCRATCH:` path exists under `{out}/scratch/haiku/` and is empty.
  - `--arm name=control,profile=fast exits 2`; `--arm name=x,chunk=2,profile=fast exits 2`; `--min-reviews 99 exits 3 and writes no manifest`.
- [ ] **Step 2: Run tests to verify they fail**
Run: `node --test tests/review-replay/reviews-extract.test.js`
Expected: FAIL — `unknown command: extract-reviews`.
- [ ] **Step 3: Implement** `extractReviews` per the rules above, and wire the command in `tools/review-replay.js` (`COMMAND_FLAGS['extract-reviews']`, the required-flags table).
- [ ] **Step 4: Run tests to verify they pass**
Run: `node --test tests/review-replay/reviews-extract.test.js tests/review-replay/extract.test.js tests/review-replay/workflow.test.js tests/review-replay/no-plugin-reference.test.js`
Expected: PASS, 0 failures.
- [ ] **Step 5: Commit** — `Add review-replay extract-reviews: replay archived lens reviewers in clean repositories` with `refs #5991`.

### Task 5: `score-reviews`

**Role:** judgment
**Review risk:** high

**Files:**
- Create: `tools/review-replay/reviews-score.js`
- Modify: `tools/review-replay.js` (command `score-reviews`; flags `--out --transcripts --reference`; required `out`, `transcripts`)
- Test: `tests/review-replay/reviews-score.test.js`

**Interfaces:**
- Consumes: Task 1 exports; `parseLensReport`; Task 4's three output files and the prompt entry shape `{file,name,run,lens,side,repo}`.
- Produces: `scoreReviews(opts, deps) -> exitCode`. It prints one JSON object:
  `{ notes: [string, string, string], reference, fixture: { byLens: { [lens]: { selected, excludedByReason } } }, fidelity: { [lens]: {caught, of, share} }, unidentifiedAgents, unidentifiedCost, arms: { [arm]: { scored, notJudged, notJudgedByReason, lenses: { [lens]: { reviews, rowsBySeverity, confirmed: {caught, of, unlocated}, archived: {caught, of}, new, vsReference: {raised, of}|null, fidelity, byRepeat?: { [r]: {caught, of} } } }, cost, minutes, recordedEffort, effortFieldsDiffer } } }`
  - The three `notes` are, verbatim:
    - `Confirmed recall rewards an arm that behaves like the archive: the confirmed set comes from the archived tier's own output.`
    - `A new row is neither noise nor signal until sampled.`
    - `A clean repository holds two commits, so git log and git blame differ from the archived review.`
  - `share` is `of === 0 ? null : caught / of`.

**Rules:**
- Slots are built as in `score.js` (`armLabel` keys), and agents are identified with `readJournal` + `identifyAgents` on `--transcripts`. The unidentified-agent and no-reply assignment follows `score.js` exactly.
- Per slot, the first matching reason makes it notJudged:
  1. no reply string → `no-reply`/`unidentified-agent`
  2. `arm.effort !== null` and some recorded effort `!== arm.effort` → `effort-mismatch`
  3. `parseLensReport(text) === null` → `could-not-parse`, where `text = stripTree(reply, prompt.repo)`
  Otherwise the slot is scored. `rows = parseFindings(text)?.rows ?? []`, and `rowsBySeverity` adds `parseLensReport(text)` counts (overflow included).
- `confirmed` is per slot, summed (plan-review decision 1). Each scored slot is scored against `archived-reports.json` `confirmed[reports[slot].unitKey][lens]`. A located finding is caught when one of that slot's own rows is `near(row, f.path, f.line)`. The slot adds the located findings count to `of`, its caught count to `caught`, and the entry's `unlocated` to `unlocated`. The lens figure sums its scored slots and repeats, so a lens with two slots and one finding reads `of 2`. A notJudged slot adds nothing: a review that was not judged is never a found-nothing review.
- `archived`: the archived rows of this slot caught by some replay row (`near`).
- `new`: replay rows not `near` any `runRows[run]` entry.
- `fixture.byLens` is read from `reviews-fixture.json`. `selected` counts `slots` per lens. `excludedByReason` counts `excluded` entries per lens and reason, covering only entries that carry a `lens`, since run-level exclusions and `unlabelled-dispatch` have none. This is the spec's "scored and excluded counts per lens from the fixture".
- `vsReference`: for each repeat pair (every repeat of this arm × every repeat of the reference, as `score.js` pairs verdicts), the reference rows for the same prompt name that this arm's rows are `near`. It is `null` for the reference arm itself. `--reference` defaults to the first arm for which `isControlArm` is false, and an unknown name is exit 2.
- `byRepeat` appears only when `arm.repeat > 1`, holding `confirmed` per repeat.
- `fidelity[lens]` is `archived` summed over every control arm. Each arm's `lenses[lens].fidelity` copies it.
- `cost` comes from `identifyAgents`' costs (`emptyCost`/`addCost` shape), and `minutes` is `Math.round(cost.seconds / 60)`.
- Exit 3 when any arm has `notJudged > 0`, else 0. A validator problem is exit 1.

- [ ] **Step 1: Write the failing tests** `tests/review-replay/reviews-score.test.js`. They run `extract-reviews` on the Task 4 fixture with `--arm name=near,profile=fast --arm name=far,profile=fast`, then write a workflow dir (`journal.jsonl` + `agent-{id}.jsonl`, each first user message `Replay judge {label}.`, each assistant entry `effort` set to its arm's effort, with `null` arms omitting the field) and run `score-reviews`:
  - `AC5.1: a row 3 lines off is caught, a far row is not`: extract with `--lens 3a --max-per-lens 1`, so each arm has exactly one `3a` slot (`3a-a`, the first `3a` dispatch in file order). Arm `near`'s reply is `| high | src/a.js:13 | x | e |` and arm `far`'s is `| high | src/a.js:30 | x | e |`. The fixture's one confirmed `3a` finding is `src/a.js:10`, so `arms.near.lenses['3a'].confirmed` deepEquals `{caught:1, of:1, unlocated:0}` and `arms.far.lenses['3a'].confirmed` deepEquals `{caught:0, of:1, unlocated:0}`.
  - `AC5.2: the NEAR_LINES boundary`: on the same one-slot extraction, a row at line 15 is caught (`|15-10| = 5`) and a row at line 16 is not.
  - `per-slot recall sums the sides`: on a full extraction (slots `3a-a`, `3a-a.2` and `3a-b`), where every `3a` reply of arm `near` is `| high | src/a.js:13 | x | e |`, `arms.near.lenses['3a'].confirmed` deepEquals `{caught:3, of:3, unlocated:0}`.
  - `fixture counts per lens`: the output's `fixture.byLens['3b']` deepEquals `{ selected: 1, excludedByReason: { 'report-unparsed': 1 } }`.
  - `AC6.1: an unparseable reply is could-not-parse and exits 3`: one slot's reply is `I looked around.`, so `notJudgedByReason['could-not-parse'] === 1` and the exit code is 3.
  - `AC6.2: No findings is a scored review with zero rows`: every reply is a table or `No findings.`, and the one `3b` slot (`3b-a`; `l3b-b` was excluded at extract) replies `No findings.`. The exit code is 0, `lenses['3b'].reviews === 1`, and `rowsBySeverity` for `3b` sums to 0.
  - `effort-mismatch`: an `effort=low` arm whose agent recorded `medium` lands under `notJudgedByReason['effort-mismatch']`.
  - `AC9.2: fidelity per lens from the control arm`: the output has `fidelity['3a']` with `caught`/`of`, and every arm's `lenses['3a'].fidelity` deepEquals it.
  - `rows citing the absolute repo path still score`: a reply row `| high | {repoPath}/src/a.js:10 | x | e |` is caught.
  - `the output opens with the three notes`: `notes` deepEquals the three strings above.
- [ ] **Step 2: Run tests to verify they fail**
Run: `node --test tests/review-replay/reviews-score.test.js`
Expected: FAIL — `unknown command: score-reviews`.
- [ ] **Step 3: Implement** `scoreReviews` and wire the command.
- [ ] **Step 4: Run tests to verify they pass**
Run: `node --test tests/review-replay/reviews-score.test.js tests/review-replay/score.test.js tests/review-replay/no-plugin-reference.test.js`
Expected: PASS, 0 failures.
- [ ] **Step 5: Commit** — `Add review-replay score-reviews: recall against confirmed findings, fidelity from the control arm` with `refs #5991`.

### Task 6: Usage, header, journey and structure doc

**Role:** integration

**Files:**
- Modify: `tools/review-replay.js` (header comment and `USAGE`)
- Create: `docs/journeys/replay-archived-lens-reviews-across-tiers-5991.md`
- Modify: `docs/plugin-structure.md` (the `tools/review-replay.js` line: name the two new commands)
- Test: `tests/review-replay/reviews-extract.test.js` (one added test)

**Interfaces:**
- Consumes: the command names, flags and outputs of Tasks 4-5.

- [ ] **Step 1: Write the failing test** `USAGE names both new commands`: running with no argv gives an `err` that contains `extract-reviews --runs <root> --out <dir> --role lens` and `score-reviews --out <dir> --transcripts <workflow dir>`.
- [ ] **Step 2: Run test to verify it fails**
Run: `node --test tests/review-replay/reviews-extract.test.js`
Expected: FAIL — the USAGE assertion.
- [ ] **Step 3: Write.**
  - The header gets one paragraph per command, in the existing paragraphs' shape: what it reads, what it writes, the control arm and `fidelity`, and the two exit-3 cases.
  - `USAGE` gets the two lines, with every flag from Tasks 4-5.
  - The journey follows `docs/journeys/replay-archived-reviews-to-measure-a-tiebreak-change-5557.md`'s shape. Its frontmatter `files:` lists the four new tool modules, `tools/review-replay.js`, `replay.workflow.js` and `schema.js`. Its steps are 1 extract-reviews, 2 the Workflow run on `reviews-manifest.json`, and 3 score-reviews. Each step's Should understand states the exclusion reasons, that `notJudged` is never a found-nothing review, and that an arm's numbers are read against `control`'s fidelity. The two notes about recall and new rows, and the two-commit caveat, go in step 3. Origin is `Created during the build of #5991 (run 2026-11-22T104506-spec-5991)`.
  - `docs/plugin-structure.md`: extend the existing `tools/review-replay.js` bullet with `extract-reviews`/`score-reviews` in one clause.
- [ ] **Step 4: Run tests to verify they pass (AC8.1: `no-plugin-reference.test.js` still passes)**
Run: `node --test tests/review-replay/reviews-extract.test.js tests/review-replay/no-plugin-reference.test.js`
Expected: PASS, 0 failures.
- [ ] **Step 5: Commit** — `Document review-replay extract-reviews and score-reviews — usage, header, journey` with `refs #5991`.
