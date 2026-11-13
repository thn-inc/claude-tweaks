# Dispatch Queue-Pull Cutover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/claude-tweaks:dispatch` Step 2 and Step 3 call `plugin/bin/queue-pull.js` instead of reading and running `queue-pull-script.md` / `next-ranking.md`, with outputs, paths and readers unchanged, after a live-queue comparison proves both paths identical.

**Architecture:** Compare first (scratch harness, both orders, before any edit that switches the path). Then a prose cutover of `SKILL.md`, `firing-exclusion.md` and `mcp-transport.md` (the scripts stay, unmodified, as the one-edit revert path), and a test repoint so no test outside #5227's parity suite reads script text. The parity oracle's two `mcp-transport.md` fences are frozen into the oracle first, so the parity suite survives the MCP rewrite.

**Tech Stack:** Markdown skill prose, Node 18+ CLIs, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-11-13T021643-spec-5230/work/5230-spec.md` (record #5230)

Scope keywords: run its script verbatim, run it verbatim, next-ranking.md` verbatim, script verbatim, run the script as written, alias_mcp_timestamps

The keywords name the mechanism this unit changes: an instruction to run a script. They do not name the scripts, whose descriptive citations the Non-Goals assign to the removal unit. Check B classification (no change): the `queue-pull-script`/`next-ranking` citations under `plugin/bin/lib/**`, `plugin/bin/queue-pull.js`, `plugin/skills/_shared/{issue-claims,policy-schema,session-tmp-root}.md`, `plugin/skills/build/already-shipped-assessment.md`, `plugin/skills/specify/next-mode.md` and `plugin/skills/tidy/scan-procedures.md` describe the script and never instruct running it. They belong to the removal unit's sweep (Non-Goals). In the dispatch sub-files, only `SKILL.md` L132/L181/L189, `firing-exclusion.md` L59 and `mcp-transport.md` Step 2 instruct a run; the other dispatch citations (`*-report.md`, `reporting.md`, `task-prompt.md`, `settle-and-merge.md`, `drain-pr-overlap.md`, `near-duplicate-pairs.md`, `exclusions-unreadable-report.md`, `design-notes.md`) describe outputs and stay.

Waived plugin/skills/dispatch/queue-pull-script.md: read-only — Task 1 runs its fence; Global Constraints keep it unmodified.
Check B residue (no change): `plugin/bin/lib/dispatch/queue-pull.js` names `alias_mcp_timestamps` in a comment as the script twin it reproduces, and stays. `plugin/skills/dispatch/queue-pull-script.md` is unmodified by Global Constraints.

Waived plugin/bin/queue-pull.js: read-only — Tasks 4 and 5 read its usage text (`--help`) and header for the call shapes.

## AC coverage map

| AC clause | Covered by |
|---|---|
| AC1.1, AC1.3, AC1.4, AC1.5, AC1.6, AC1.7, AC1.8, AC1.9, AC1.12, AC1.13 | Task 1 Steps 1–4 |
| AC1.10, AC1.11 | Task 1 Step 5 |
| AC1.2, AC6.5, AC8.1 | Task 7 Step 2 (closing-comment draft), posted at wrap-up |
| AC2.1, AC2.2 | Task 4 Step 1 (`AC2` tests in `dispatch-queue-pull-cutover-prose.test.js`), Step 6 grep |
| AC3.1, AC3.2 | Task 4 Steps 3 and 6 (`wc -c`, `plan-audit.js --bytes` `headroom.composed`, skill-audit suites), re-measured after every `origin/main` merge |
| AC3.3, AC3.4 | Task 4 Step 3 (citation drop rule; `queue-pull-notes.md` untouched — `git diff origin/main -- plugin/skills/dispatch/queue-pull-notes.md` empty) |
| AC4.1 | Global Constraints diff check, run in every task's verification |
| AC5.1, AC5.2 | Task 5 Step 1 (`#5230 AC5` test) |
| AC6.1 | Tasks 3, 4 Step 5, 5 Step 4 |
| AC6.3 | Task 4 Step 5 (`REMOVING_REASONS` from `PASSES`) |
| AC6.4 | Tasks 4 and 5 (prose pins repointed or dropped with reason in `test-mapping.md`) |
| AC6.6, AC6.7 | Global Constraints (group-4 rule); Task 4 Step 6 runs `session-tmp-root-migration` |
| AC6.8 | Common Step 5 full `npm test` (central) |
| AC7.1, AC7.2 | Task 6 Step 1 |
| AC8.2 | Task 7 Step 1 (parity suite green on the reverted scratch tree) |

## Global Constraints

- `plugin/skills/dispatch/queue-pull-script.md` and `plugin/skills/dispatch/next-ranking.md`: present and unmodified — `git diff origin/main -- plugin/skills/dispatch/queue-pull-script.md plugin/skills/dispatch/next-ranking.md` prints nothing at the end of every task.
- `plugin/skills/dispatch/SKILL.md` ends at or below **52,000 bytes** (`wc -c`, after merging `origin/main`); today it is 52,469. `RAIL_BYTES` is 52,500 (`plugin/bin/lib/skill-audit/budgets.js`). Every composed bundle it sources stays at or below `RAIL_BYTES` (`plan-audit.js --bytes` `headroom.composed`).
- The CLI's usage text is the source for every call shape written into prose: `node plugin/bin/queue-pull.js --help`. Modes: `--transport gh|files [--queue-raw <p>] [--dep-freshness <p>] [--open-numbers <p>] [--verified-open-deps <p>] [--in-flight-raw <p>] [--in-flight-claims <p>] [--foreign-states <p>]`, `--rank [--priority high|medium|low]`. Exit 0 ok, 1 malformed, 2 `--transport gh` without gh (names `--transport files`), 3 reserved, 4 the pull stopped.
- The CLI never falls back from `gh` to `files`; prose must name the transport. Preflight "`gh` absent or GraphQL-blocked" selects `files` (`mcp-transport.md` Preflight).
- On the MCP path the agent still fetches with MCP tools and writes the raw JSON; never describe the MCP path as "one call".
- Skill prose in actionable text uses `${CLAUDE_PLUGIN_ROOT}` paths, as the surrounding SKILL.md does.
- Scope: Non-Goals hold — no change to selection or order, no output shape/path/reader change, no edit to the report sub-files beyond what the cutover forces, no `drive.js --budget`.
- Group-4 sweep tests (`node-eval-file-heredoc-syntax`, `skill-fence-guard-shapes`, `session-tmp-root-migration`, `node-e-snippet-syntax`, `hooks-dispatcher`, `policy-schema`, `bin-lib/dispatch/exclusions`) are not edited unless the cutover legitimately changes their expectation; any such edit carries its reason in a comment beside it. `session-tmp-root-migration.test.js` requires SKILL.md to keep citing `session-tmp-root.md` (line 147 does today).
- Commit messages: `{Verb} {what} — {detail}`, ending with `Claude-Session: https://claude.ai/code/session_016yg3znynTg1o8YNhrTGgW7`. Stage files by explicit path.
- Run per-task targeted suites only; the full `npm test` runs centrally at Common Step 5. CI runs Node 20.
- **Upstream merges (spec Gotchas).** After any merge of `origin/main` into this branch: re-run `node --test tests/bin-lib/dispatch/queue-pull.test.js` and re-measure `wc -c plugin/skills/dispatch/SKILL.md`. If the merge changed `queue-pull-script.md`, `next-ranking.md` or `plugin/bin/lib/dispatch/queue-pull.js` (`git diff {pre-merge}..HEAD --stat -- …`), re-run Task 1 before going on.
- **Moved-prose pins.** Before editing any sentence in `SKILL.md`, `firing-exclusion.md` or `mcp-transport.md`, `git grep -n -F` two or three distinctive phrases from it over `tests` and `plugin`. List every test hit (and every `plugin/` hit whose file a test reads) in that task's mapping rows, as a pin to re-point.
- Governing skills, quoted verbatim:
  - `.claude/skills/skill-prose-conformance-tests` (Decision Framework): "| Content a future migration is expected to delete or rewrite | Freeze the bytes as a fixture under `tests/fixtures/` |". Also: "| A shell or `node -e` snippet the reader is told to run, where the full command matters | Extract the fence from the doc with a structurally-anchored regex and execute exactly that string; byte-pin the fence instead only when the probe needs fixture-specific surroundings |".
  - The same skill's Anti-Patterns: "| Reading live skill prose you intend to change | The test becomes a scheduled failure timed to the migration, so it is gone exactly when the change is riskiest `[IL-80]` |" and "| Anchoring a snippet-extraction regex on a prose sentence | The sentence is the part of the doc most likely to be reworded, so the suite goes red on its own anchor instead of on the procedure — and the tempting fix is to loosen the regex, which quietly stops pinning the fence at all |".
  - The same skill's Project Conventions: "**Retargeting existing pins: diff the assertion inventory, not the plan's prose anchor list.** When a migration moves pinned prose from one file to another, enumerate every assertion literal in the *replaced* tests and give each one an explicit verdict — moved, retargeted (naming the new literal), or retired (with its own stated reason)."
  - `.claude/skills/dispatch-queue-exclusion-addition` (registration row 10): "`tests/bin-lib/dispatch/queue-pull.test.js`: AC11.1 derives the reason set, `removes` and `bypass` from site 1's bullets; the parity tests run the fence and the module on the same fixtures". Task 6 rewrites this skill. Until the removal unit lands, the parity suite keeps deriving from the retained script's bullets, so those bullets stay unmodified.

## Review Focus

1. **A `gh`-absent firing** reading Step 2 must reach `--transport files` from the Preflight result; it must never run `--transport gh`, see exit 2, and stop. Pinned in Task 4's prose test (Step 2 names both transports and the Preflight selector).
2. **A stopped pull (exit 4)** must stop the firing and run Step 1's close-out; it must never rank a stale `dispatch-groups.json`. Exit 1 is a malformed call. Pinned in Task 4's prose test, which reads Step 2's exit routing and checks that Step 1's close-out list names the queue-pull stop.
3. **A continuation re-entering the Loop** must pick through `queue-pull.js --rank` (which reads the `firing` entries), never from raw `dispatch-groups.json`. Pinned in Task 4's prose test over `firing-exclusion.md`.
4. **No priority filter set:** the prose must omit `--priority`, because an empty value exits 1. Pinned in Task 4's prose test.
5. **MCP claims coverage:** the files-transport claims file must hold the claim of every record in the in-flight pool, not a `neighbourClaimTargets` subset. A missing number reads as a failed claim read and silently misses a neighbour. Pinned in Task 5's AC5 test and its prose assertion.

---

### Task 1: Live-queue comparison (gate — no repository edit)
**Role:** judgment
**Review risk:** high

**Files:**
- Create (scratch, never committed): `/private/tmp/claude-501/-Users-thomasholknielsen-Code-Workspaces-claude-tweaks/8c857930-e046-4764-a1df-96687638febc/scratchpad/livecmp/` (harness script + raw outputs)
- Create (gitignored run-dir file): `/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-11-13T021643-spec-5230/live-comparison.md`

**Interfaces:**
- Produces: `live-comparison.md` with sections `## Verdict` (`identical` | `blocked: {condition}`), `## Stripped fields`, `## Exercised` (exclusion reasons and informational files that were non-empty), `## Not exercised` (each reason plus the `tests/bin-lib/dispatch/queue-pull.test.js` test name that stands in for it), and `## Raw` (per-file per-order equal/differ, any diff). Task 7 quotes it.

- [ ] **Step 1: Write the harness** (Node script under the scratch dir, run with `node`). For one ordered pair `(first, second)`, each path gets its own scratch session id (`qp-livecmp-{order}-{path}`) and its own scratch run dir, minted with `node {plugin}/bin/hooks.js resolve-run-dir --spec-slug livecmp-{order}-{path} --create` and passed as `PIPELINE_RUN_DIR`. The CLI plugin root is the worktree's `plugin/` (`/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude/worktrees/record-5230/plugin`).
  - **Script path:** extract the single bash fence of `plugin/skills/dispatch/queue-pull-script.md` (`extractFence` from `tests/bin-lib/dispatch/queue-pull-oracle.js` may be required, or read the first fence directly). Run it with `/opt/homebrew/bin/bash` under env `CLAUDE_PLUGIN_ROOT`, `CLAUDE_CODE_SESSION_ID`, `PIPELINE_RUN_DIR` and `RUN_ID` (= that run dir), cwd = worktree root.
  - **CLI path:** `node {plugin}/bin/queue-pull.js --transport gh` under the same env shape.
  - **Ranking:** after each pull, run up to five picks on that path's own session. Script path: `next-ranking.md`'s fence. CLI path: `queue-pull.js --rank`. Both run with `PRIORITY_FILTER` unset and no `--priority`. After each non-null pick, append `{reason:'firing', records: pick members}` with `appendExclusion` from `plugin/bin/lib/dispatch/exclusions.js` to that session's `dispatch-exclusions.json`. Stop at `null`. Record the pick sequence.
  - **Quiet check:** before the first run and after the second run of each pair, record the open `bot:in-progress` count (`gh issue list --label bot:in-progress --state open --json number --jq length`) and the newest `updatedAt` over `gh issue list --label auto:build --state open --json updatedAt --limit 500`. If either changed, the pair is not quiet.
- [ ] **Step 2: Compare** the six files `dispatch-groups.json`, `dispatch-exclusions.json`, `dispatch-fastlane-bundles.json`, `dispatch-near-dup-pairs.json`, `dispatch-crosspr-overlap.json` and `dispatch-next-pick.json` (the pick sequence) between the two paths of the pair.
  - Both files must parse. Compare deeply: arrays ordered, object keys unordered.
  - Before comparing, strip only the by-construction differences: replace each path's session-tmp root, session id and scratch run-dir path or basename with a placeholder. List every stripped field.
- [ ] **Step 3: Run order A (script then CLI), then order B (CLI then script)**, back to back, with no claim written in between. Run when no drain is claiming (check `ListAgents`/the quiet check first).
  - A pair that differs is re-run once.
  - A difference between orders is itself a finding.
- [ ] **Step 4: Apply the blocking conditions.** Write `blocked: {condition}` and STOP the build (no edit, no wait) when any of these holds:
  - the queue held no candidates
  - either path exited non-zero
  - an output file is missing, unreadable or not valid JSON
  - a pair was not quiet
  - no exclusion reason was exercised
  - a difference reproduces on the re-run

  A difference reproduces → STOP and report it. The fix is a new fixture in `tests/bin-lib/dispatch/queue-pull.test.js` plus the module change, a plan amendment, not part of this task.
- [ ] **Step 5: Write `live-comparison.md`** with the sections from Interfaces. Name each reason not exercised with its #5227 stand-in test (`git grep -n "AC2.1 {reason}\|#5227 {reason}" tests/bin-lib/dispatch/queue-pull.test.js`).
- [ ] **Step 6: Persist the AC evidence.**
  - `mkdir -p "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-11-13T021643-spec-5230/evidence"`.
  - Redirect the harness's full output there as `live-comparison.txt` (plain Bash redirect).
  - Write one `decisions.md` entry: `node "/Users/thomasholknielsen/.claude/plugins/cache/claude-tweaks-marketplace/claude-tweaks/6.166.0/bin/log-decision.js" --run "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-11-13T021643-spec-5230" --section "/build" --status AUTO --step "AC evidence" --text-file "{text-file}"`. `{text-file}` (written with the Write tool) holds one line: `AC1: live-queue comparison {verdict}, orders A and B, {n} files compared, {k} picks per path; harness {command shape}; evidence/live-comparison.txt`.
- [ ] **Step 7: Close the four scratch run dirs**, each with `node {plugin}/bin/hooks.js close-run --run "{dir}"`. Remove the scratch session-tmp directories.

Verification: `cat ".../live-comparison.md"` shows `## Verdict` → `identical`. No commit (nothing tracked changes); `git status --porcelain` in the worktree is empty.

---

### Task 2: Freeze the parity oracle's MCP fences

**Role:** integration

**Files:**
- Create: `tests/fixtures/dispatch/mcp-transport-step2-pre-cutover-5230.md` (byte-frozen copy of today's `mcp-transport.md` "## Step 2 — neighbour-in-flight pool (#3278, #3392)" section, which holds both fences the oracle reads)
- Modify: `tests/bin-lib/dispatch/queue-pull-oracle.js` (L83-85 `MCP_MD` and the two fence first lines; L113-141 `filesOracleScript`)
- Test: `tests/bin-lib/dispatch/queue-pull.test.js`

**Interfaces:**
- Produces: `MCP_MD` in the oracle points at the frozen fixture. `filesOracleScript` keeps its signature and reads the same two fences, by the same first-line anchors, from the fixture.

- [ ] **Step 1: Write the test** `'#5230 oracle: the frozen MCP section equals mcp-transport.md at the pre-cutover commit'` in `queue-pull.test.js`. It asserts that the two fences `extractFence` reads from the fixture equal the fences it reads from `git show 61ec59285c112cbd8c5953855af108d63a03883b:plugin/skills/dispatch/mcp-transport.md` (the pre-cutover tip, via `execFileSync('git', ['show', …])`, cwd = repo root).
- [ ] **Step 2: Run** `node --test --test-name-pattern "frozen MCP section" tests/bin-lib/dispatch/queue-pull.test.js`
  Expected: FAIL (ENOENT on the fixture path).
- [ ] **Step 3: Implement.** Create the fixture with `git show 61ec5928…:plugin/skills/dispatch/mcp-transport.md`, cut to that section (a header line naming #5230, the sha and why it is frozen). Repoint `MCP_MD` at it.
- [ ] **Step 4: Run** `node --test tests/bin-lib/dispatch/queue-pull.test.js`
  Expected: PASS, with the same pass count as before the change (record both counts).
- [ ] **Step 5: Commit** `Freeze the parity oracle's MCP fences — #5230 cutover rewrites mcp-transport.md Step 2`.

---

### Task 3: Repoint the script-text tests (groups 1 and 3)
**Role:** judgment

AC6. Each test below stops extracting `queue-pull-script.md` or `next-ranking.md` text and takes the module (`plugin/bin/lib/dispatch/queue-pull.js`) or CLI as its subject. An assertion `queue-pull.test.js` already covers is dropped from the old file only after that fixture is proven to discriminate: revert the module behavior it names (scratch edit) and see red, then restore it. An uncovered assertion gets a new fixture in `queue-pull.test.js` first. Drive fixtures through the existing helpers (`pull4`, the `inOwnTmp`/sandbox helpers, `RANK_CASES`); never through bash.

**Files:**
- Modify: `tests/dispatch-not-spec-shaped-exclusion-fixture.test.js`
- Modify: `tests/dispatch-named-target-exclusion-fixture.test.js`
- Modify: `tests/dispatch-unlanded-blocker-exclusion-fixture.test.js`
- Modify: `tests/dispatch-cross-repo-blocker-exclusion-fixture.test.js`
- Modify: `tests/dispatch-near-dup-pairs-script.test.js`
- Modify: `tests/bin-lib/dispatch/near-dup-pairs.test.js` (comment at L27 only: the reference is now the module's near-dup pass)
- Modify: `tests/dispatch-firing-exclusion.test.js`
- Modify: `tests/dispatch-near-dup-neighbour-prose.test.js`
- Modify: `tests/flow-claim-preflight.test.js` (L451-461)
- Modify: `tests/bin-lib/dispatch/queue-pull.test.js` (new fixtures)
- Create: `/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-11-13T021643-spec-5230/test-mapping.md` (gitignored; one row per test file: old assertion → new subject | dropped + reason). Tasks 4–5 append to it.

**New fixtures** (in `queue-pull.test.js`, named `#5230 …`), for assertions no #5227 test covers today:
- not-spec-shaped: a TODO placeholder is flagged; a placeholder inside a code span or under `Original request` is exempt; a mixed group keeps its conforming member and an all-bad group drops out.
- blocked, native: `crossRepoBlockers` OPEN excludes `owner/name#N`, `null` excludes `owner/name#N (state unreadable)`, CLOSED keeps the record; a foreign-states key in another case (`OTHER/REPO#6`) matches.
- near-dup pairs: a stale `dispatch-near-dup-pairs.json` from an earlier pull is rewritten to `[]` when no strong pair remains.
- neighbour-in-flight: a strong near-duplicate neighbour's detail carries `sharedAnchors`.

**Per-file repoint:**
- `dispatch-firing-exclusion.test.js` runs `queue-pull.js --rank` (spawned with `CLAUDE_CODE_SESSION_ID` set) over the same scenarios: firing, oversized and neighbour exclusions, a bundle dropped when any member is excluded, all excluded → `null`. The CRLF extraction case is dropped (no text extracted).
- `dispatch-near-dup-neighbour-prose.test.js` keeps its SKILL.md assertions. The `next-ranking.md` prose assertion becomes: `rankNext` skips a group whose `neighbour-in-flight` entry names a strong near-duplicate neighbour (reuse the RANK_CASES neighbour case).
- `flow-claim-preflight.test.js` L451: drop `next-ranking.md` from the file list. Reason: the claim-permission stop is agent-side, stated in `firing-exclusion.md`, which stays pinned.
- The script-order assertions (pass A before pass B) become `PASSES` index comparisons.

- [ ] **Step 1: Write the new fixtures**, then run `node --test --test-name-pattern "#5230" tests/bin-lib/dispatch/queue-pull.test.js`
  Expected: PASS. They exercise existing module behavior; prove each one discriminates by a scratch revert of the behavior it names and see it go red, then restore.
- [ ] **Step 2: Rewrite each listed test file** as above. Add one `test-mapping.md` row per file.
- [ ] **Step 3: Run** `git grep -l -E "queue-pull-script|next-ranking" -- tests ':!tests/bin-lib/dispatch/queue-pull.test.js' ':!tests/bin-lib/dispatch/queue-pull-oracle.js' ':!tests/bin-lib/dispatch/queue-pull-mcp-fences.js'`
  Expected: only Task 4's group-2 files, Task 5's MCP files and the group-4 sweeps remain.
- [ ] **Step 4: Run** every touched suite: `node --test tests/dispatch-not-spec-shaped-exclusion-fixture.test.js tests/dispatch-named-target-exclusion-fixture.test.js tests/dispatch-unlanded-blocker-exclusion-fixture.test.js tests/dispatch-cross-repo-blocker-exclusion-fixture.test.js tests/dispatch-near-dup-pairs-script.test.js tests/bin-lib/dispatch/near-dup-pairs.test.js tests/dispatch-firing-exclusion.test.js tests/dispatch-near-dup-neighbour-prose.test.js tests/flow-claim-preflight.test.js tests/bin-lib/dispatch/queue-pull.test.js`
  Expected: PASS.
- [ ] **Step 5: Commit** `Repoint the dispatch script-text tests to the queue-pull module — #5230 groups 1 and 3`.

---

### Task 4: Cut SKILL.md Steps 2–3 and firing-exclusion.md over to the CLI
**Role:** judgment
**Review risk:** high

**Files:**
- Modify: `plugin/skills/dispatch/SKILL.md` — L107 (close-out list: "a queue-pull `exit 1`" → the CLI's stop, exit 4), L132 (Step 2 pull), L181 (Loop), L189 (`next` alias), and the citations at L121, L149, L153, L156, L168, L191, L225
- Modify: `plugin/skills/dispatch/firing-exclusion.md` (L51, L59)
- Modify: `tests/dispatch-named-form-exclusion-reasons.test.js`
- Modify: `tests/dispatch-shipped-candidate-prose.test.js`
- Modify: `tests/dispatch-tidy-named-target-coordination.test.js`
- Modify: `tests/dispatch-per-record-groups-prose.test.js`
- Modify: `tests/specify-near-duplicate-prose.test.js`
- Modify: `tests/bin-lib/express/queue.test.js` (L102-110)
- Modify: `tests/bin-lib/stage-item/cli.test.js` (L292-307)
- Modify: `tests/bin-lib/dispatch/reporting-fastlane-bundle-citation.test.js`
- Create: `tests/dispatch-queue-pull-cutover-prose.test.js`

**Interfaces:**
- Consumes: CLI usage text (`queue-pull.js --help`), `PASSES` from `plugin/bin/lib/dispatch/queue-pull.js`.

- [ ] **Step 1: Write `tests/dispatch-queue-pull-cutover-prose.test.js`**, reading live SKILL.md and firing-exclusion.md text:
  - Step 2 (`### Step 2` → `### Step 3`) contains `bin/queue-pull.js" --transport gh` and `--transport files`. It names the Preflight result that selects `files` (`gh` absent or GraphQL-blocked), routes exit 2 to `files`, and routes exit 4 to stopping the firing.
  - Step 1's close-out list names the queue-pull stop.
  - Step 3's `Loop: run the \`next\` ranking below` line contains `queue-pull.js" --rank` and `neighbour-in-flight`, and the `next` bullet contains `--rank`.
  - No `--priority` with an empty value anywhere: the `next` bullet says to omit `--priority` when no band is set.
  - `firing-exclusion.md`'s continuation paragraph names `queue-pull.js" --rank` and does not contain `next-ranking.md`'s script verbatim.
  - Every `--flag` token in a `queue-pull.js` call in SKILL.md is in the CLI's usage text (spawn `--help`).
  - The AC2 negative: `run its script verbatim`, `run it verbatim` and `next-ranking.md` are absent from SKILL.md.
- [ ] **Step 2: Run** `node --test tests/dispatch-queue-pull-cutover-prose.test.js`
  Expected: FAIL (the AC2 negative lists L132, L181 and L189; the CLI call strings are absent).
- [ ] **Step 3: Edit SKILL.md.**
  - L132 becomes one paragraph: the `--transport gh` call, the `files` switch on the Preflight result (writing `mcp-transport.md` Step 2's inputs first), what it writes (`dispatch-groups.json` plus the exclusion/report files, `_shared/session-tmp-root.md`), and the exit routing: 2 → `files`; 4 → stop the firing, quoting stderr (Step 1's close-out runs); 1 → a malformed call, fix and re-run.
  - L181 replaces "`next-ranking.md` verbatim" with the `--rank` call, keeping the line's prefix and the word "neighbour-in-flight".
  - L189 replaces "Read `next-ranking.md` and run it verbatim" with `queue-pull.js --rank [--priority <band>]` (omit `--priority` when no band is set).
  - Repoint each citation to "the queue pull" / `bin/lib/dispatch/queue-pull.js`, or drop it where the sentence only described the script's mechanics (the near-duplicate paragraph's mechanics may shrink, keeping its heading, `#3520`, `near-duplicate-pairs.md`, "strong" and "weak").
  - Keep L147's `session-tmp-root.md` citation. Keep every phrase `dispatch-shipped-candidate-prose.test.js` and `dispatch-named-form-exclusion-reasons.test.js` pin.
  - After each edit, `wc -c plugin/skills/dispatch/SKILL.md`, down to ≤ 52,000.
- [ ] **Step 4: Edit firing-exclusion.md.** L51 names the ranking as `queue-pull.js --rank` (module `rankNext`). L59 says a continuation runs `node "${CLAUDE_PLUGIN_ROOT}/bin/queue-pull.js" --rank` for its first pick.
- [ ] **Step 5: Repoint the group-2 tests** (AC6), each with a `test-mapping.md` row:
  - `dispatch-named-form-exclusion-reasons.test.js`: `REMOVING_REASONS = [...new Set(PASSES.filter((p) => p.kind === 'exclusion' && p.removes).map((p) => p.reason))]`; the SKILL.md bullet loop is unchanged.
  - `dispatch-shipped-candidate-prose.test.js`, `dispatch-tidy-named-target-coordination.test.js`, `specify-near-duplicate-prose.test.js`, `dispatch-per-record-groups-prose.test.js`, `reporting-fastlane-bundle-citation.test.js`: their script-text halves become module assertions — `PASSES` order, an existing `queue-pull.test.js` fixture (named in the mapping, proven by a scratch revert), or `SESSION_FILES` membership. Their SKILL.md halves stay.
  - `bin-lib/express/queue.test.js`: assert, through a recording `expressQueuePolicy` dep injected into `queuePull`, that the cache check, `buildDispatchGroups` and the write-back blob each consume it (`.grouping`/`.keepSingleton`). Add that fixture.
  - `bin-lib/stage-item/cli.test.js`: assert through the module that the shipped `stage-item.js` call's stderr is forwarded (a stub spawn writing stderr reaches `deps.stderr`). Add that fixture.
- [ ] **Step 6: Run** `node --test tests/dispatch-queue-pull-cutover-prose.test.js tests/dispatch-named-form-exclusion-reasons.test.js tests/dispatch-shipped-candidate-prose.test.js tests/dispatch-tidy-named-target-coordination.test.js tests/dispatch-per-record-groups-prose.test.js tests/specify-near-duplicate-prose.test.js tests/bin-lib/express/queue.test.js tests/bin-lib/stage-item/cli.test.js tests/bin-lib/dispatch/reporting-fastlane-bundle-citation.test.js tests/session-tmp-root-migration.test.js tests/dispatch-unlanded-blocker-exclusion-fixture.test.js tests/bin-lib/dispatch/queue-pull.test.js` plus every `tests/**/*skill-audit*`/`*budget*` suite (`git ls-files tests | grep -i -E "skill-audit|budget|rail"`)
  Expected: PASS. `git grep -n -F -e "run its script verbatim" -e "run it verbatim" -e "next-ranking.md" -- plugin/skills/dispatch/SKILL.md` prints nothing; `wc -c plugin/skills/dispatch/SKILL.md` ≤ 52000.
- [ ] **Step 7: Commit** `Cut /dispatch Steps 2-3 over to bin/queue-pull.js — #5230, scripts kept off the default path`.

---

### Task 5: Cut mcp-transport.md Step 2 over to `--transport files`
**Role:** judgment
**Review risk:** high

**Files:**
- Modify: `plugin/skills/dispatch/mcp-transport.md`:
  - L79: the queue pull paragraph
  - L114: the #3691 workaround (the CLI aliases timestamps itself)
  - L118: the cross-PR `[]` posture, now the CLI's
  - L120-152: the neighbour-in-flight section
  - L156: the unlanded-blocker paragraph
  - L195-205: foreign states, passed as `--foreign-states <p>`

  The section headings stay.
- Modify: `docs/journeys/dispatch-the-oldest-record-from-a-gh-absent-sandbox-3691.md` (Check B scope-creep add: it describes the `alias_mcp_timestamps` re-run on the MCP path; restate it as the CLI aliasing on `--transport files`)
- Modify: `tests/dispatch-neighbour-in-flight-mcp.test.js`
- Modify: `tests/dispatch-mcp-timestamp-alias.test.js`
- Modify: `tests/dispatch-cross-repo-blocker-exclusion-fixture.test.js` (`MCP_FACTS` L222-230)
- Modify: `tests/dispatch-unlanded-blocker-consumers-conformance.test.js` (`MCP_FACTS` L115-122)
- Modify: `tests/dispatch-queue-pull-cutover-prose.test.js` (AC5 test)

**Interfaces:**
- Consumes: Task 2's frozen oracle; Task 4's prose test file; the #5227 `files` fixtures (`S1-files-miss`, `S1-files-hit`, `S2-files-miss` in `tests/bin-lib/dispatch/queue-pull.test.js` / `queue-pull-fixtures.js`).

- [ ] **Step 1: Write the AC5 test** `'#5230 AC5: the mcp-transport.md files call, gh absent, reproduces the #5227 files fixture outputs'`:
  - Extract the single `queue-pull.js --transport files` call from mcp-transport.md Step 2.
  - Write the S1 files-fixture inputs to the paths it names.
  - Spawn it with a `PATH` that holds no `gh` (symlink-only bin dir: node, git and the system tools).
  - Assert each output file deep-equals what the #5227 files fixture expects: `dispatch-groups.json`, `dispatch-exclusions.json`, `dispatch-fastlane-bundles.json`, `dispatch-near-dup-pairs.json`, `dispatch-crosspr-overlap.json` = `[]`, and `dispatch-next-pick.json` via a following `--rank`.

  Add prose assertions:
  - Step 2 (L77-L205 region) contains no `run the script as written`, `alias_mcp_timestamps` or `NEIGHBOUR_RC`.
  - Each `--queue-raw`/`--dep-freshness`/`--open-numbers`/`--verified-open-deps`/`--in-flight-raw`/`--in-flight-claims`/`--foreign-states` flag is named together with its file shape.
  - The claims paragraph says every record in the pool file.
- [ ] **Step 2: Run** `node --test --test-name-pattern "AC5" tests/dispatch-queue-pull-cutover-prose.test.js`
  Expected: FAIL (no `--transport files` call in mcp-transport.md).
- [ ] **Step 3: Rewrite the sections.**
  - Keep every agent fetch-and-Write step (queue via `list_issues`, dependency states via `issue_read`, the in-flight pool, claim reads, foreign states).
  - The claim reads cover every record in the pool file (the CLI header's rule), not a printed target list.
  - End in one `node "${CLAUDE_PLUGIN_ROOT}/bin/queue-pull.js" --transport files …` call. Name each input file and its JSON shape, copied from the merged CLI's usage text and module (`runFetch`, `agentQueueRaw`, `agentDepFreshness`, the neighbour pass's claims reader, `foreignStates` input) — read them, don't guess.
  - The `alias_mcp_timestamps` instructions and the substitute neighbour steps 2 and 4 go: the CLI aliases timestamps and computes claim targets and exclusions itself.
  - The unlanded-blocker paragraph states that the CLI still runs the pass on `files` and that its landing call fails open with one `Warning:` line.
- [ ] **Step 4: Repoint the four MCP-reading tests** (rows in `test-mapping.md`):
  - `dispatch-neighbour-in-flight-mcp.test.js`: its fence runs become module subjects (claims via `--in-flight-claims` over the files transport; existing L2002/L2027/L2055 fixtures plus Task 3's `sharedAnchors` fixture). Its token list follows the new prose (pool shape `[{number, title, body, labels}]`, `claims/issue-{n}.json`, #3137, `extractKeyFiles`, the 200-cap text).
  - `dispatch-mcp-timestamp-alias.test.js`: the alias-function extraction becomes the files-transport aliasing fixture (L1115). The ranking heredoc becomes `rankNext` (AC6.2). The `REDEFINE` and token pins become the new prose's statement that the CLI aliases on `files`.
  - `cross-repo` `MCP_FACTS` L228-229 follow `--foreign-states`.
  - `unlanded consumers` `MCP_FACTS` L116 follows the new sentence.
- [ ] **Step 5: Run** `node --test tests/dispatch-queue-pull-cutover-prose.test.js tests/dispatch-neighbour-in-flight-mcp.test.js tests/dispatch-mcp-timestamp-alias.test.js tests/dispatch-cross-repo-blocker-exclusion-fixture.test.js tests/dispatch-unlanded-blocker-consumers-conformance.test.js tests/dispatch-graphql-blocked-preflight.test.js tests/bin-lib/dispatch/queue-pull.test.js`
  Expected: PASS. `git grep -n -E "run the script as written|alias_mcp_timestamps" -- plugin/skills/dispatch/mcp-transport.md` prints nothing.
- [ ] **Step 6: Commit** `Cut mcp-transport.md Step 2 over to queue-pull.js --transport files — #5230`.

---

### Task 6: Registration docs and the exclusion-addition skill
**Role:** integration

**Files:**
- Modify: `.claude/skills/dispatch-queue-exclusion-addition/SKILL.md` (description, Overview, registration table rows 1, 2 and 10, Common Operations, Anti-Patterns)
- Modify: `docs/plugin-structure.md:237` (drop "No skill calls it before the cutover unit"; name `/dispatch` Step 2 / Step 3 / `mcp-transport.md` as its consumers)
- Modify: `docs/skill-graph.md` (the `/dispatch` → `bin/queue-pull.js` edge; existing rows naming `queue-pull-script.md` as the live caller of a CLI, e.g. L274 `bin/express-lane.js` and L276 `bin/dispatch-unlanded-blockers.js`, name the module instead)

- [ ] **Step 1: Edit the skill.** The home of a pass is `plugin/bin/lib/dispatch/queue-pull.js`: a `PASSES` row plus a `RUNNERS` entry. `REMOVING_REASONS` derives from `PASSES` (`removes`). The script rows leave the live path. Add a line stating that until the removal unit lands, a pass change is made in the module and mirrored in the retained `queue-pull-script.md`, so #5227's parity test stays green.
- [ ] **Step 2: Edit the two docs.**
- [ ] **Step 3: Run** `node --test tests/dispatch-unlanded-blocker-consumers-conformance.test.js tests/dispatch-named-form-exclusion-reasons.test.js` plus any suite that greps these docs (`git grep -l -F "skill-graph.md" -- tests | head`, run those that read the edited rows)
  Expected: PASS. `git grep -n -F "queue-pull-script.md" -- .claude/skills/dispatch-queue-exclusion-addition/SKILL.md` lists only the mirroring line.
- [ ] **Step 4: Commit** `Name the queue-pull module as the pass home — #5230 docs and exclusion-addition skill`.

---

### Task 7: Revert proof and closing-comment draft
**Role:** integration

**Files:**
- Create (gitignored): `/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-11-13T021643-spec-5230/closing-comment.md`

- [ ] **Step 1: Prove the revert (AC8)** in a scratch copy (`git worktree add --detach` under the scratchpad, never this worktree):
  - Run `git -C {scratch} diff origin/main..HEAD -- plugin/skills/dispatch/SKILL.md plugin/skills/dispatch/mcp-transport.md plugin/skills/dispatch/firing-exclusion.md | git -C {scratch} apply -R`.
  - Confirm that Step 2 reads `Read \`queue-pull-script.md\` … run its script verbatim`, and that `git diff origin/main -- plugin/skills/dispatch/queue-pull-script.md plugin/skills/dispatch/next-ranking.md` is empty.
  - Run `node --test tests/bin-lib/dispatch/queue-pull.test.js` there.

  Expected: PASS. Remove the scratch worktree.
- [ ] **Step 2: Write `closing-comment.md`.** It holds:
  - `live-comparison.md`'s verdict, stripped-field list and exercised/not-exercised lists (quoted)
  - `test-mapping.md`'s table
  - the one-command revert (`git diff {merge-base}..{merge-commit} -- plugin/skills/dispatch/SKILL.md plugin/skills/dispatch/mcp-transport.md plugin/skills/dispatch/firing-exclusion.md | git apply -R`)
  - the AC2 control: the pre-change grep printed L132, L181 and L189; the post-change grep prints nothing
  - the final `wc -c` of SKILL.md.
- [ ] **Step 3: Persist the AC8 evidence.**
  - Write the revert run's output to `evidence/revert-proof.txt` under the run dir (plain Bash redirect).
  - Add one `decisions.md` `AC evidence` entry: `AC8: reverting SKILL.md, mcp-transport.md and firing-exclusion.md restores Step 2's script path; parity suite {pass}/{total}; evidence/revert-proof.txt`. Use the same `log-decision.js --text-file` shape as Task 1 Step 6.
- [ ] **Step 4: Verify** `test -s ".../closing-comment.md"`. No commit (gitignored).
