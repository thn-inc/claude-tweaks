# Guard-Accepted Command Forms Implementation Plan (#4028)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut Claude Code worktree-guard refusals in pipeline runs. Classify them from transcripts, rewrite every refused-shape fence under `plugin/skills/**` into a guard-accepted form, pin that with a conformance scan, and add a PreToolUse `updatedInput` normalizer for the residual model-composed shapes.

**Architecture:** One maintainer-side detector module (`tools/guard-refusals/shapes.js`) is bound row-by-row to `_shared/scratch-worktree.md` §7. It backs both the transcript classifier CLI (`tools/guard-refusals.js`) and the fence conformance scan (`tests/skill-fence-guard-shapes.test.js`). Fence migration runs in three batches by shape. A shipped, require-light module, `plugin/bin/lib/hooks/guard-rewrite.js`, applies semantics-preserving rewrites through PreToolUse `updatedInput`, from both the prefilter fast path and the full `pre-tool-use` handler.

**Tech Stack:** Node 18+ (CommonJS), `node --test`, no new dependencies.

**Spec:** `.claude-tweaks/pipelines/2026-10-24T193452-record-4028/work/4028-spec.md` (record #4028)

## Global Constraints

- Commit messages: `{Verb} {what} — {detail}`, ending with `refs #4028` (never `closes`/`fixes`), plus the line `Claude-Session: https://claude.ai/code/session_013gZE1ubMNfJg4P88BQs8HW`.
- Everything under `tools/` and `tests/` is maintainer-side; only `plugin/` ships (decision 0015). The detectors live in `tools/guard-refusals/`, never in `plugin/`.
- Skill `.md` files stay under `RAIL_BYTES` (52,500 B, `plugin/bin/lib/skill-audit/budgets.js`). Measured headroom after the `eval` rewrite (prototype codemod, this plan's authoring): `_shared/github-pr-scan.md` 49,891 B (2,609 left), `harness-health/SKILL.md` 49,347 B (3,153 left); every other touched file has more than 8 KB.
- **Premise probe result (Deliverable 4, measured 2026-10-24, Claude Code 2.1.302, `claude -p -w`, haiku, scratch PreToolUse hook):** (a) `updatedInput` is applied **before** the isolation guard: a refused `echo complete PROBE_MARKER` rewritten to `echo REWRITTEN_BY_HOOK` ran. (b) The guard re-checks the **rewritten** command: a plain `echo hello …` rewritten into `echo complete …` was refused. (c) `updatedInput` applies with **no** `permissionDecision` field. Consequence: a rewrite can normalize, never bypass. The plugin must never emit `permissionDecision: 'allow'` alongside a rewrite.
- New live-verified §7 shapes (this session, 2026-10-24, a guard-isolated worktree session): `cd "<wt>" && pwd && pwd` **passes**; `cd "<wt>" && cat > f <<'EOF'` and `echo start && cat > f <<'EOF'` are **refused** ("is too complex to verify…"); `cd "<wt>" && node <<'EOF'` passes. `node -e '<s>' "$HOME"` is **refused** ("runs node with a value computed at runtime (the variable HOME) (a computed argument goes after the script or --)…"), and so is `A="$(node /lit/x.js …)"` followed by `node -e '<s>' "$A"`. `node -e '<s>' -- "$A"` **passes**, with `process.argv.slice(1)` identical to the form without `--` (probed: `["a","--flag","-x"]` both ways). `A="$(node "/lit/bin/session-tmp-resolve.js" A=a.json)"` followed by `gh issue list … > "$A"` and `echo …` in one call **passes**. `ls /Users/…/Code\ Workspaces/…` is **refused** (reconfirms the existing row).
- Governing project skills (quoted verbatim, applicable rules):
  - `skill-prose-conformance-tests`: "Sweeping a derived region set for a banned literal without asserting the set is non-empty — The extractor becomes part of the assertion, silently: a regex matching no region reports zero offenders and certifies a convention it never checked." / "open every fence shape (a blockquote-prefixed `> ```bash`, an indented one and an unlabelled one were all missed by the first extractor); report an unbalanced fence that mentions a target as an offender instead of letting the tracker pass it" / "Anchoring a fence or line extraction regex on a bare `\n` … Write `\r?\n`, and add a CRLF input built with `.replace(/\n/g, '\r\n')` that asserts the extractor still finds the block" / "Read governed markdown through `tests/helpers/read-skill.js`'s `readText()`, never a private `fs.readFileSync(p, 'utf8')`." / "Take the sweep root as a parameter, so the go-red control proves the walker as well as the matcher." / "An allowlist entry owes a stale-check of its own".
  - `pre-tool-use-gate-exemptions`: "Every new exemption needs a regression test proven to go red on revert." (applies to every rewrite rule) / "A containment check calls `shared-primitives.js`'s `isPathContained(candidate, root, { orEqual })`" / "keeps the module's `fs.realpathSync.native` default when it compares the resolved path against a root or an exclusion" (route path comparisons through `plugin/bin/lib/path-guard`'s `canonicalRealpath()`).
  - `parse-signal-discipline` item 9 (skill-prose probe): "Each Bash tool call starts a fresh shell, so a variable an earlier call set is unset in the probe's call … Resolve every path inside the snippet itself." / item 11: "`fs.readdirSync` throwing `ENOENT` … and throwing anything else … are not the same signal".
  - `transcript-payload-verification`: "a worker fork's transcript opens with its parent's whole history up to a `<fork-boilerplate>` user entry" and "a 2.1.302 `api-request-blob` entry echoes the request and repeats notifications": dedupe by `tool_use_id`.
- `docs/hooks.md` must be read before touching `plugin/bin/hooks.js`, `plugin/bin/lib/hooks/`, or `plugin/hooks/hooks.json` (CLAUDE.md).
- Waived AC1.1: "Guard refusals per pipeline fall by at least 90% from the ~34 baseline over 10 runs" is a post-merge measurement over ten future pipelines and cannot be observed inside this build. Task 2's CLI is its instrument, and Task 9 files the measurement follow-up record.

## Review Focus

1. A rewrite whose meaning differs between bash and zsh (an unquoted `$P` whose literal value contains a space: bash splits it, zsh does not). The normalizer must leave such a command untouched. Pinned in Task 8.
2. A transcript store mutating mid-walk (a subagent `.jsonl` deleted between `readdir` and `stat` hit ENOENT live during authoring), plus truncated JSONL lines. The classifier counts these as `unreadable` and never crashes. Pinned in Task 2.
3. Fork and `api-request-blob` transcripts that replay parent tool calls. Refusals are counted once per `tool_use_id`, or the per-pipeline number inflates. Pinned in Task 2.
4. A malformed fence (unterminated, blockquoted, indented, CRLF). The scan reports it, never passes it silently. Pinned in Task 1.
5. Any throw inside the normalizer on the prefilter fast path. The process still exits 0 with no stdout (never break a session). Pinned in Task 8.

---

### Task 1: Shape detectors bound to §7, plus the new §7 rows

**Role:** judgment

**Files:**
- Create: `tools/guard-refusals/shapes.js`
- Create: `tools/guard-refusals/fences.js`
- Modify: `plugin/skills/_shared/scratch-worktree.md` (§7 table: new rows only)
- Test: `tests/guard-refusals/shapes.test.js`, `tests/guard-refusals/fences.test.js`
- Re-run (pins the §7 table shape): `tests/scratch-worktree-shell-constraint-table.test.js`

**Interfaces:**
- Produces `shapes.js`:
  - `DETECTORS: Array<{ id: string, row: string, test(text: string): boolean }>`. `row` is the **exact Example cell text** of the §7 row it covers.
  - `UNDETECTED_ROWS: Record<string, string>`: refused-row Example cell → reason it has no static detector.
  - `normalizePlaceholders(text: string): string` replaces `${CLAUDE_PLUGIN_ROOT}`/`$CLAUDE_PLUGIN_ROOT` with `/plugin-root`. Basis: `_shared/worktree-setup.md`'s "Resolve plugin-supplied values to literals once"; the agent substitutes a literal root.
  - `detectShapes(text: string, { placeholders = true } = {}): string[]` returns the ids of detectors whose `test` fires, after `normalizePlaceholders` when `placeholders` is true.
- Produces `fences.js`:
  - `shellFences(text: string): Array<{ line: number, lang: string, body: string }>` returns every fenced block whose info string is `bash|sh|shell|zsh|console`. Recognize backtick and tilde fences of 3+ chars, blockquote-prefixed (`> `) and indented fences, and CRLF input. `line` is 1-based, at the opening fence.
  - `malformedFences(text: string): number[]` returns the opening line of any fence never closed.
  - `walkMarkdown(root: string): string[]` returns the sorted absolute `*.md` paths under `root`. ENOENT on a vanished entry is skipped; any other error throws.

Detector ids, one per refused §7 row (bind each by its row's exact Example cell). Name in `UNDETECTED_ROWS` any refused row a static regex genuinely cannot decide, with its reason: `complete-token`, `git-env-var-subst`, `github-url-with-var`, `gh-jq-pipe-chained`, `git-text-redirect-var`, `git-in-substitution`, `git-var-operand` (Task 6b), `node-eval-script-var-with-git`, `node-git-text` (Task 6b), `sed-var-path`, `node-var-script`, `graphql-multivar-mutation`, `eval-token`, `gh-computed-input`, `chained-heredoc-write`, `test-string-compare`, `backslash-space`, `node-eval-computed-arg` (new row). Task 6b renamed `json-git-redirect-var` to `git-text-redirect-var` and `heredoc-gh-body-file-var` to `gh-computed-input` when it widened their rows. The `permission-rule` row is out of scope (not a guard refusal).

New §7 rows, in the table's existing 6-cell format with verdict vocabulary and `Last verified` cell `2026-10-24 (#4028)`. Copy the Example and wording literals from Global Constraints:
1. `node -e` with a runtime-computed argument and no `--` → `refused`; Workaround: insert `--` after the script (argv unchanged), or assign the value literally in the same command.
2. Any command chained (`&&`/`;`) ahead of a redirecting heredoc write; generalizes the `mkdir -p` row; `cd dir && node <<'EOF'` passes → `refused`; Workaround: the `Write` tool, or a standalone heredoc call.
3. `cd dir && cmd && cmd`, a 3-command chain of simple commands → `passes`.
4. `VAR="$(node /literal/script.js …)"`, then `cmd > "$VAR"` in one call → `passes` (the replacement for `eval "$(…)"`).

- [ ] **Step 1: Write the failing tests**

`tests/guard-refusals/shapes.test.js` parses §7's table with its own row splitter (split on unescaped `|`, as `tests/scratch-worktree-shell-constraint-table.test.js` does). Each row's Example backtick spans are extracted, joined with `\n` as one extra candidate, and passed to `detectShapes(…, { placeholders: false })`:
- `test('every refused §7 row is flagged by its bound detector or listed in UNDETECTED_ROWS', …)`. A row bound by `DETECTORS[].row` must have its own detector fire on at least one candidate.
- `test('no detector fires on any passes-row example', …)`: the false-positive control.
- `test('every DETECTORS[].row and UNDETECTED_ROWS key still names a live refused row (shrink the list when it goes stale)', …)`.
- `test('normalizePlaceholders makes a ${CLAUDE_PLUGIN_ROOT} script operand clean and leaves $B flagged', …)`: `detectShapes('node "${CLAUDE_PLUGIN_ROOT}/bin/x.js"')` → `[]`; `detectShapes('B=$(pwd)\nnode "$B/x.js"')` includes `node-var-script`.
- `test('AC2.1: a fixture holding each banned shape fails the scan', …)`: a frozen fixture `tests/fixtures/guard-refusals/banned-shapes.md`, one `bash` fence per detector id. Assert `detectShapes` returns that id for its fence (exactly the expected id set per fence).
- `test('node-eval-computed-arg: -- separator clears it', …)`: `node -e 'x' "$A"` flagged; `node -e 'x' -- "$A"` not.

`tests/guard-refusals/fences.test.js`:
- `test('shellFences finds backtick, tilde, blockquoted, indented and CRLF fences', …)` with exact `line` values.
- `test('shellFences skips non-shell info strings (markdown, yaml, js, unlabelled)', …)`.
- `test('malformedFences reports an unterminated fence', …)`.
- `test('walkMarkdown skips an entry that vanishes (ENOENT) and throws on ENOTDIR', …)`, using a temp tree.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/guard-refusals/shapes.test.js tests/guard-refusals/fences.test.js`
Expected: FAIL (`Cannot find module '../../tools/guard-refusals/shapes'`)

- [ ] **Step 3: Implement `shapes.js`, `fences.js`, and add the four §7 rows**

Each detector is a small regex/token predicate. Strip single-quoted spans before keyword detectors (`complete-token`, `eval-token`), so `echo 'evaluate'` and prose inside quotes do not fire. `git-in-substitution` keys on `$(` followed by optional whitespace and `git` plus a space. `node-eval-computed-arg` fires on `node` + `-e|-p|--eval|--print` + one quoted script + a next word that starts with `"$`/`$` and is not `--`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/guard-refusals/shapes.test.js tests/guard-refusals/fences.test.js tests/scratch-worktree-shell-constraint-table.test.js`
Expected: PASS

- [ ] **Step 5: Prove discrimination**

Revert one detector's regex to `() => false` in memory (a test-local copy, never the tree): the bound-row test must go red naming that row. Record the probe in the commit body.

- [ ] **Step 6: Commit**

`git add tools/guard-refusals/shapes.js tools/guard-refusals/fences.js tests/guard-refusals/shapes.test.js tests/guard-refusals/fences.test.js tests/fixtures/guard-refusals/banned-shapes.md plugin/skills/_shared/scratch-worktree.md`
Message: `Add guard-shape detectors bound to scratch-worktree §7 — four live-verified rows`

### Task 2: Transcript refusal classifier CLI

**Role:** integration

**Files:**
- Create: `tools/guard-refusals/transcripts.js`, `tools/guard-refusals/trace.js`, `tools/guard-refusals.js`
- Test: `tests/guard-refusals/transcripts.test.js`, `tests/guard-refusals/trace.test.js`, `tests/guard-refusals/cli.test.js`
- Fixtures: `tests/fixtures/guard-refusals/store/` (built from real lines; see Step 1)

**Interfaces:**
- Consumes: `detectShapes`, `shellFences`, `walkMarkdown` (Task 1); `ISOLATION_CLAUSE`, `REFUSAL_SIGNATURE` from `plugin/bin/lib/hooks/harness-refusal.js`. A call is a refusal when its result text contains `ISOLATION_CLAUSE` and, after it, `'Refusing to run'` (the prefix `REFUSAL_SIGNATURE` shares with the "there" variant). This deliberately covers both the `This session` and `This agent` nouns (#3819).
- Produces `transcripts.js`: `scanStore({ projectsDir, match = null, since, until }) → { files, unreadable, calls, refusals: Array<{ toolUseId, file, line, tool, command, refusalText, reason, runId }> }`. Includes main transcripts and `{session}/subagents/*.jsonl`; keeps a file when `since <= mtime < until`; unique by `toolUseId` (first occurrence wins); `calls` counts unique Bash+Write `tool_use` ids. `runId` is the nearest preceding pipeline run id referenced in the same file (`/\.claude-tweaks\/pipelines\/(\d{4}-\d{2}-\d{2}T\d{6}-[a-z0-9][a-z0-9-]*)/` over tool_use inputs), else `null`.
- Produces `trace.js`: `classifyReason(refusalText) → string`, an ordered table mapping the refusal clause to one of `too-complex | names-git | git-redirect-shared | cd-shared | git-C-runtime | glob-git | runs-eval | runs-complete | sed-runtime | node-runtime-operand | node-program-runtime | gh-runtime | gh-text | bash-construct | other`. Also `buildFenceIndex(skillsRoot) → Index` and `traceFence(command, index) → string[]` (`file:line`, sorted; `[]` when none). Matching: normalize both sides (absolute `…/claude-tweaks/<ver>/` or `…/plugin/` prefixes and `${CLAUDE_PLUGIN_ROOT}` → `<ROOT>/`; `{placeholder}` and fence-side `$VAR`/`"$VAR"` tokens → wildcards; whitespace collapsed). A fence matches when at least one normalized command line of 20+ chars equals one of its lines. Return every fence tied for the most matched lines.
- Produces CLI `tools/guard-refusals.js [--projects-dir <dir>] [--match <slug-substring>] [--since-days <n>=14] [--until <iso>=now] [--skills-root <dir>=plugin/skills] [--json] [--help]`. `--projects-dir` defaults to `$CLAUDE_CONFIG_DIR/projects`, else `~/.claude/projects`. The output object is `{ window, files, unreadable, calls, refusals, perPipeline: { runs, attributedRefusals, mean }, byReason, byShape, byFence, top }`. `byShape` maps detector ids, plus `unclassified` for none, to counts; `byFence` maps `file:line` to counts; `top` holds 20 sample commands per reason, truncated to 300 chars. `--json` prints that object; otherwise it prints a short text table. Exit 0 on success, 2 on a malformed invocation or a missing `--projects-dir`.

- [ ] **Step 1: Write the failing tests**

Build fixtures from **real** transcript lines; never hand-type a shape. Copy a handful of lines verbatim from the local store (main, subagent, a fork with `<fork-boilerplate>`, an `api-request-blob` echo), truncating long values with `…`, and name each source file in a fixture README. Tests:
- `test('scanStore counts a refusal once across a fork replay and an api-request-blob echo', …)`: exactly 1.
- `test('scanStore counts This agent and This session refusals, and the Refusing to run there variant', …)`.
- `test('scanStore treats a vanished file (ENOENT) and a truncated JSON line as unreadable, never throws', …)`.
- `test('scanStore attributes a refusal to the nearest preceding run id in its file', …)`.
- `test('classifyReason maps each live refusal clause from §7 wording', …)`: one case per reason id, each with the verbatim refusal clause.
- `test('traceFence finds the fence a command was copied from with the plugin root and placeholders filled', …)`: build `index` from a temp skills root holding two fences. A command derived from fence A (the root replaced by `/Users/x/.claude/plugins/cache/m/claude-tweaks/6.145.0`, `{n}` → `4028`) traces to `['A.md:3']`; an unrelated command → `[]`.
- `test('CLI exits 2 on a missing --projects-dir and prints JSON with --json', …)`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/guard-refusals/transcripts.test.js tests/guard-refusals/trace.test.js tests/guard-refusals/cli.test.js`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement the three modules and the CLI**

Stream files line by line, skipping a line that lacks `tool_`. Classify an ENOENT on stat/read as `unreadable`; let any other errno increment `unreadable` and continue (report-only tool).

- [ ] **Step 4: Run tests to verify they pass**

Run: same as Step 2. Expected: PASS.

- [ ] **Step 5: Real-input probe + independent count**

Run: `node tools/guard-refusals.js --projects-dir "/Users/thomasholknielsen/.claude-accounts/djoef-thn/projects" --until 2026-10-24T19:00:00Z --json > "$PIPELINE_RUN_DIR/evidence/guard-refusals-baseline.json"` (`mkdir -p` the evidence dir first, as its own call; substitute the literal run-dir path). Back to back, run the independent counter, which shares no code with the CLI: `node "$PIPELINE_RUN_DIR/evidence/independent-count.js" "/Users/thomasholknielsen/.claude-accounts/djoef-thn/projects" 2026-10-24T19:00:00Z`. At plan authoring it printed `{"files":7752,"uniqueCalls":278803,"uniqueRefusedCalls":6301}`; the store keeps changing, so reconcile only against a fresh run. Expected: the CLI's `calls` equals `uniqueCalls` and `refusals.length` equals `uniqueRefusedCalls`. A mismatch is a defect to fix, not a tolerance. Log one `AC evidence` entry via `log-decision.js --text-file` naming both numbers and the evidence path.

- [ ] **Step 6: Commit**

Message: `Add tools/guard-refusals.js transcript classifier — reason, shape, fence and per-pipeline counts`

### Task 3: `session-tmp-resolve.js --value` and the canonical pattern

**Role:** integration

**Files:**
- Modify: `plugin/bin/session-tmp-resolve.js` (add `--value <filename>`; update the header comment's "eval-ready" description)
- Modify: `plugin/skills/_shared/session-tmp-root.md` (the "Several paths in one fence" form becomes one `VAR="$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value file)"` line per variable; state why: `eval` is refused by the worktree guard, `_shared/scratch-worktree.md` §7)
- Test: `tests/session-tmp-resolve-cli.test.js` (extend; its line-2 header comment says "eval-ready" and must be updated)

**Interfaces:**
- Produces: `session-tmp-resolve.js --value <filename>` prints exactly the resolved path (`formatPrintedPath` applied) plus `\n`. Exit 1 with a usage line when `--value` has no operand or is combined with `VAR=` args. The existing `VAR=filename …` form is unchanged and supported: expand-contract, since the installed build's prose still uses it.

- [ ] **Step 1: Write the failing tests:** `test('--value prints only the path', …)` (stdout `${tmp}/ct-session-<id>/a.json\n` with `CLAUDE_CODE_SESSION_ID` set; `os.tmpdir()` fallback without it); `test('--value with no operand exits 1', …)`; `test('--value combined with VAR=file exits 1', …)`.
- [ ] **Step 2: Run** `node --test tests/session-tmp-resolve-cli.test.js`. Expected: FAIL on the three new cases.
- [ ] **Step 3: Implement.** Edit `session-tmp-root.md`'s canonical block and its surrounding sentence ("Both forms resolve … prefer the shorter CLI form") so the per-var `--value` line is the documented multi-path form.
- [ ] **Step 4: Run** `node --test tests/session-tmp-resolve-cli.test.js tests/session-tmp-root-migration.test.js tests/session-tmp-placeholder-quoting-conformance.test.js`. Expected: PASS.
- [ ] **Step 5: Commit.** Message: `Add session-tmp-resolve.js --value — eval-free per-variable resolution`

### Task 4: Migrate every `eval` fence and inline span [batch]

**Role:** integration

**Files (Modify; from `git grep -n -E '(^|[^a-zA-Z_-])eval[ "]' -- plugin/skills`):** `_shared/{github-pr-scan-acceptance,github-pr-scan,headless-self-report,label-bootstrap,pr-early-run-lifecycle,trust-table}.md`, `activity/SKILL.md`, `backlog/{attention-mode,grant-lane-decision,machine-grant-outlook,overview-mode,refine-headless,refine-lanes,refine-mode,trust-signal}.md`, `capture/SKILL.md`, `code-health/{SKILL,filing,focus-mode}.md`, `dispatch/{next-ranking,queue-pull-script,mcp-transport,settle-and-merge}.md`, `docs-health/SKILL.md`, `feedback/upstream-draft.md`, `harness-health/{SKILL,filing}.md`, `help/status-scan.md`, `intake/SKILL.md`, `journey-health/SKILL.md`, `specify/{decomposition-mode-closeout,next-mode-shape,next-mode,shaping-mode-stamping,shaping-mode}.md`, `tidy/step-1-records.md`, `wrap-up/{docs-health-integration,leftover-routing,unblocked-records,verification-brief-parent-gate,verification-brief}.md`, `flow/summary-template.md`. Exclude the prose-only hits `_shared/issue-claims.md:426`, `_shared/autonomy-ceiling.md:347` and `sweep/SKILL.md:121` (no command; classify as no-change).

**Test pins to re-point (grep `tests/` for each moved literal before editing):** `tests/backlog-overview-foldin-no-truncation.test.js` and `tests/backlog-refine-foldin-no-truncation.test.js` (their fence-extraction regexes anchor on the `eval` line; re-anchor on the first new `--value` line and re-run the extracted fence), `tests/specify-staged-for-caller.test.js:31`, the `tests/sweep-backstop.test.js:112` comment, `tests/merge-subject-composer-conformance.test.js:87`, `tests/console-shadow-dup-outcomes-conformance.test.js:274`.

Rewrite rules:
1. `eval "$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" A=a.json B=b.json)"` becomes one line per variable: `A="$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value a.json)"`. Keep quoting of `${ISSUE}`-style suffixes: `--value "backlog-refine-body-${ISSUE}.md"`. Keep the original indentation and blockquote prefix. A multi-line (`\`-continued) form becomes the same one-line-per-variable block.
2. The inline-resolver forms (`eval "$(node -e "…sessionTmpPath…")"` in `backlog/attention-mode.md` ×3, `backlog/refine-headless.md` ×2, `dispatch/settle-and-merge.md` ×3, `_shared/headless-self-report.md` ×1) and `eval "$(node … node-eval-file.js <<NODE_EVAL_EOF … )"` (`dispatch/queue-pull-script.md:16`, `dispatch/next-ranking.md:30`) become the same per-variable `--value` lines. Filenames are copied verbatim from each `files` object (`'dispatch-comments-' + issue + '.json'` → `--value "dispatch-comments-${ISSUE}.json"`). The degrade (`os.tmpdir()` without a session id) is unchanged because `session-tmp-resolve.js` applies it.
3. A variable whose name contains `GIT`, assigned from `$(…)`, is refused (§7, env-var row): rename it. `capture/SKILL.md`'s `CAPTURE_TRUST_GIT_LOG` → `CAPTURE_TRUST_COMMIT_LOG`, at every use in that file.
4. Inline-span mentions of the eval form (docs-health `SKILL.md:102`, `intake/SKILL.md:103`, `help/status-scan.md:51`, `tidy/step-1-records.md:24`, `specify/shaping-mode.md:110`, `flow/summary-template.md:9`, `dispatch/mcp-transport.md:122`) are reworded to the `--value` form in place.

- [ ] **Step 1: Codemod.** Apply rules 1-4. A scratch node script for rule 1 is fine; it stays uncommitted. Hand-edit rules 2-4.
- [ ] **Step 2: Retirement sweep.** `git grep -n -e 'eval "$(node' -e 'eval-ready' -e "eval \"\$(" -- plugin docs README.md tests` must print only test lines that freeze a pre-change excerpt on purpose. List each survivor in the commit body with its reason.
- [ ] **Step 3: Byte check.** `wc -c` every touched file. Each must stay under 52,500 (`_shared/github-pr-scan.md` and `harness-health/SKILL.md` are the near ones).
- [ ] **Step 4: Run** `node --test tests/backlog-overview-foldin-no-truncation.test.js tests/backlog-refine-foldin-no-truncation.test.js tests/specify-staged-for-caller.test.js tests/sweep-backstop.test.js tests/merge-subject-composer-conformance.test.js tests/console-shadow-dup-outcomes-conformance.test.js tests/session-tmp-placeholder-quoting-conformance.test.js tests/node-eval-file-heredoc-syntax.test.js tests/dispatch-mcp-timestamp-alias.test.js tests/dispatch-neighbour-in-flight-mcp.test.js tests/bin-lib/skill-audit/context-cost.test.js`. Expected: PASS. Then `npm test > "$PIPELINE_RUN_DIR/evidence/task4-npm-test.txt" 2>&1` (literal path); fix every newly red prose pin.
- [ ] **Step 5: Commit.** Message: `Replace eval session-tmp resolution with per-variable --value lines — guard-refused eval token`

### Task 5: Insert `--` before computed `node -e` arguments [batch]

**Role:** transcription

**Files (Modify):** the 51 fences `detectShapes` flags `node-eval-computed-arg` after Task 4. At authoring the files were `_shared/{github-pr-scan-acceptance,github-pr-scan,issue-claims,record-queue-fetch,trust-table}.md`, `assess-agent-autonomy/grant-check.md`, `backlog/{attention-mode,refine-mode}.md`, `capture/SKILL.md`, `dispatch/{queue-pull-script,settle-and-merge}.md`, `harness-health/SKILL.md`, `help/policy.md`, `init/bootstrap/{step-14-cloud-routine-parity,step-17-work-record-backend,version-check}.md`, `release/SKILL.md`, `routine/status.md`, `specify/{next-mode,record-creation,record-creation-subissues,shaping-mode-stamping,shaping-mode}.md`, `tidy/{issue-claims-backstops,step-1-records}.md`, `wrap-up/{auto-merge-short-circuit,cleanup-procedures-execution,leftover-routing}.md`. Regenerate the list from the detector, never this snapshot.

Rule: in `node -e|-p <script> <args…>`, insert `-- ` before the first positional argument when that argument is a `$` expansion and no `--` is already present. Change nothing else. Argv is identical (probed; Global Constraints).

- [ ] **Step 1:** List offenders with a scratch call to `detectShapes` over `shellFences` of every file.
- [ ] **Step 2:** Apply the insertion.
- [ ] **Step 3: Run** `node --test tests/node-e-snippet-syntax.test.js`, then `npm test > "$PIPELINE_RUN_DIR/evidence/task5-npm-test.txt" 2>&1` (literal path). Fix any prose pin that byte-pins an edited fence; `git grep -n -F` a distinctive substring of each edited line over `tests/`.
- [ ] **Step 4: Commit.** Message: `Insert -- before computed node -e arguments in skill fences — guard reads them as the program`

### Task 6: Rewrite the remaining refused-shape fences

**Role:** judgment

**Files (Modify):** every fence still flagged after Tasks 4-5, by detector. At authoring:
- `git-in-substitution` (23): `_shared/{dev-url-detection:101,local-merge-auto-finish:99,159,pipeline-run-dir:48,run-dir-resolution:42,scratch-worktree:144,worktree-setup:276}.md`, `build/{adopted-branch-collision-check:35,worktree-setup:51}.md`, `dispatch/{queue-pull-script,settle-and-merge:389,411}.md`, `flow/{multispec-batch-curation:40,worktree-merge:72,99,133}.md`, `help/policy.md:15`, `release/{SKILL:47,156,execute:173}.md`, `wrap-up/{auto-merge-short-circuit:294,329,cleanup-procedures-execution-appendix:32}.md`.
- `graphql-multivar-mutation` (3): `_shared/pr-run-comments.md:190`, `backlog/refine-record.md:164`, `specify/shaping-mode-stamping.md:118`.
- `sed-var-path`, `test-string-compare`: `dispatch/queue-pull-script.md`, `research/SKILL.md:73`. Confirm each is a true positive first. A false positive is a detector-precision defect: fix the detector in `shapes.js`, add the case to its test, and leave the fence alone.

Rewrite forms, in this order of preference:
1. **`git` in `$(…)`** — run the git command as its own plain call and use its printed value literally in the next call. The fence becomes two fences (or one fence plus a `{placeholder}` the prose defines), e.g. `[ "$(git branch --show-current)" = "{integration-branch}" ] && git merge --ff-only <sha>` → step 1 `git branch --show-current`; step 2, only when it printed `{integration-branch}`: `git merge --ff-only <sha>`. Where a shipped CLI already returns the value (run dir anchoring: `node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" resolve-run-dir`), cite it rather than adding a new one. Keep `_shared/pipeline-run-dir.md` and `_shared/run-dir-resolution.md`'s anchoring rule's meaning exact: `$RUN_ROOT` is the main checkout, never the cwd worktree `[IL-127]`.
2. **GraphQL mutation with 2+ `$var` and a nested input** — write the query to a session-tmp file and pass `-F query=@{file}` (§7's workaround).
3. **`build/adopted-branch-collision-check.md`** — `tests/adopted-branch-collision-snippet-fixture.test.js` extracts and runs that fence. Pass the branch and repo as plain-call results (literal args) and keep the test's extract-and-run working; re-point its extraction anchor if the fence's first line changes.

**Test pins:** run `git grep -n -F '{distinctive phrase}' -- tests plugin` for two or three phrases from each rewritten fence before editing. The known extract-and-run pins are `tests/adopted-branch-collision-snippet-fixture.test.js`, `tests/local-merge-auto-finish.test.js`, `tests/scratch-worktree-remote-branch-delete.test.js`, `tests/pipeline-run-dir-adoption-anchoring.test.js`, `tests/run-dir-timestamp-utc.test.js`, `tests/release-review-tree-check-conformance.test.js`, `tests/dev-url-detection-lease-conformance.test.js`, `tests/worktree-setup-plugin-root-literal.test.js`, `tests/multispec-boundary-freshness.test.js`, `tests/pr-run-comments.test.js`.

- [ ] **Step 1:** Regenerate the offender list, then classify each hit as a true positive or a detector-precision defect.
- [ ] **Step 2:** Rewrite each true positive; fix each precision defect in `shapes.js` with a test case.
- [ ] **Step 3: Run** the pinned suites above, then `npm test > "$PIPELINE_RUN_DIR/evidence/task6-npm-test.txt" 2>&1` (literal path).
- [ ] **Step 4: Commit.** Message: `Rewrite git-in-substitution and inline-GraphQL fences into plain calls — guard-refused shapes`

### Task 7: Fence conformance scan over the shipped corpus

**Role:** integration

**Files:**
- Create: `tests/skill-fence-guard-shapes.test.js`

**Interfaces:**
- Consumes: `shellFences`, `malformedFences`, `walkMarkdown`, `detectShapes` (Task 1).
- Produces: `scanRoot(root: string) → { fences: number, offenders: string[] }`, test-local. An offender is `relPath:line detectorId`, or `relPath:line malformed-fence`.

- [ ] **Step 1: Write the tests.** `test('AC2.2: no shell fence under plugin/skills carries a known-refused shape', …)` asserts `offenders` deepEqual `[]` **and** `fences >= 400` (a floor below the live count, measured when writing the test, so an extractor regression cannot pass on an empty haystack). `test('the scan sees a planted offender in a nested, blockquoted, CRLF fence (walker + extractor + matcher)', …)` builds a temp tree under `os.tmpdir()`, removed in `finally`, and expects exactly the planted offender. `test('an inline code span carrying eval "$( is an offender', …)`: the retirement ban on the eval form in inline spans. Sweep inline spans over fence-stripped text, per `skill-prose-conformance-tests`' code-regions rule.
- [ ] **Step 2: Run** `node --test tests/skill-fence-guard-shapes.test.js`. Expected: PASS on the migrated corpus. If it is red, the red lines are unmigrated sites; fix the site, never the scan.
- [ ] **Step 3: Go-red proof.** Run the same scan with `git show {base}:plugin/skills/_shared/session-tmp-root.md`'s text injected as a file in the temp tree; it must report `eval-token`. No tree mutation.
- [ ] **Step 4: Commit.** Message: `Add skill-fence guard-shape conformance scan — known-refused shapes stay out of shipped fences`

### Task 8: PreToolUse guard normalizer (`updatedInput`)

**Role:** judgment
**Review risk:** high

**Files:**
- Create: `plugin/bin/lib/hooks/guard-rewrite.js`
- Modify: `plugin/bin/lib/hooks/bash-prefilter.js` (`earlyGate`), `plugin/bin/hooks.js` (early-exit path, lines 29-35), `plugin/bin/lib/hooks/pre-tool-use.js` (`run()`)
- Test: `tests/bin-lib/hooks/guard-rewrite.test.js`, `tests/hooks-bash-prefilter.test.js` (extend), `tests/hooks-pre-tool-use.test.js` (extend), `tests/hooks-dispatcher.test.js` (extend: spawn case)
- Re-run: `tests/path-guard-conformance.test.js`, `tests/windows-hide-spawn-conformance.test.js`, `tests/bin-lib/exit-code-conformance.test.js`, `tests/hooks-gate-coverage.test.js`

**Interfaces:**
- Produces: `rewriteForGuard({ command, cwd, pluginRoot, deps = {} }) → { command: string, applied: string[] } | null`. Returns `null` when nothing applies, when `cwd` is not inside a linked git worktree, or on any parse doubt or throw. Never throws. `deps.isLinkedWorktree(cwd) → boolean` defaults to walking up from `cwd` with `plugin/bin/lib/path-guard`'s `lstatType` until a `.git` entry; `'file'` means linked, anything else means not.
- `pluginRoot` default: `path.resolve(__dirname, '..', '..', '..')`, the running plugin's own root.
- Rules (ids appear in `applied`), each semantics-preserving:
  1. `inline-literal-assignment` — leading top-level `NAME=value` / `NAME="value"` / `export NAME=value`, separated by `;`, `&&` or a newline, where `value` matches `/^[A-Za-z0-9_.\/:@%+,=-][A-Za-z0-9_.\/:@%+,= -]*$/` and contains no space unless double-quoted. Plain `$NAME`/`${NAME}` references after the assignment are replaced; references in single quotes are left alone. The assignment stays. Bail (null for this rule) when the command contains `<<`, a backtick, any other `${NAME` form (`${NAME:-…}`, `${#NAME}`, …), a later reassignment of NAME, or an **unquoted** reference while the value contains a space (bash/zsh word-splitting differ, Review Focus 1).
  2. `plugin-root-placeholder` — `${CLAUDE_PLUGIN_ROOT}`/`$CLAUDE_PLUGIN_ROOT` outside single quotes → `pluginRoot`. Skipped when the command assigns `CLAUDE_PLUGIN_ROOT` itself, or when the reference is unquoted and `pluginRoot` contains a space.
  3. `node-eval-separator` — `node -e|-p|--eval|--print <one quoted script> <first arg starting with $ or "$>` with no `--` → insert `-- ` before that argument.
  4. `quote-escaped-space` — an unquoted word containing `\ ` and otherwise only `[A-Za-z0-9_./:@%+,=~-]` (no `~` in first position) → the same word double-quoted with `\ ` → space.
  5. `drop-redundant-cd` — a leading `cd <literal path> && ` whose `canonicalRealpath` equals `canonicalRealpath(cwd)` → dropped. Only `&&`, only the first segment, never `~`/`$` in the path.
- Wiring:
  - `bash-prefilter.js`'s `earlyGate('pre-tool-use')`, where it would return `skip: true` for a Bash call, computes `rewriteForGuard`. On non-null it returns `{ raw, skip: true, json: { hookSpecificOutput: { hookEventName: 'PreToolUse', updatedInput: { ...tool_input, command } } } }`. `guard-rewrite.js` may require only `fs`, `path` and `./../path-guard` (it is loaded on every Bash call; the prefilter's require-light posture).
  - `hooks.js` early path: when `EARLY.skip && EARLY.json`, `fs.writeSync(1, JSON.stringify(EARLY.json))` before `process.exit(0)`.
  - `pre-tool-use.js`'s `run()`: after `runInner`, when the tool is Bash and `out.json` carries no `hookSpecificOutput` (no deny or other decision), merge the same `hookSpecificOutput` with any existing `systemMessage` kept. Never add `permissionDecision`.

- [ ] **Step 1: Write the failing tests.** In `tests/bin-lib/hooks/guard-rewrite.test.js`, one positive and at least one bail case per rule:
  - `test('inline-literal-assignment: P=/x/y; node $P/z.js → P=/x/y; node /x/y/z.js', …)`
  - `test('inline-literal-assignment bails on an unquoted ref to a value with a space', …)`
  - `test('inline-literal-assignment leaves a single-quoted $P alone', …)`
  - `test('plugin-root-placeholder substitutes the injected root and skips when the command assigns it', …)`
  - `test("node-eval-separator inserts -- before \"$A\" and leaves an existing -- alone", …)`
  - `test('quote-escaped-space double-quotes ls /a/Code\\ Workspaces/b', …)`
  - `test('drop-redundant-cd drops cd "<cwd>" && only when it resolves to cwd', …)`
  - `test('returns null outside a linked worktree', …)`
  - `test('returns null and does not throw on a malformed command', …)`
  - **Equivalence:** `test('every positive case is argv-identical under bash and zsh', …)` runs the original and the rewrite with `spawnSync('bash', ['-c', cmd], { cwd, env, windowsHide: true })` (and `zsh` when present; skip that half otherwise) against a stub `node`/`ls`/`echo` on `PATH` that prints its argv as JSON. Stdout must be equal. For `plugin-root-placeholder` the original runs with `CLAUDE_PLUGIN_ROOT` set to the same root.
  - `tests/hooks-bash-prefilter.test.js`: `test('earlyGate returns json with updatedInput for a rewritable skip-path Bash call and no json otherwise', …)`; `test('earlyGate keeps skip true and returns no json when rewriteForGuard throws', …)`. Inject a throwing rewrite via the module's test seam.
  - `tests/hooks-pre-tool-use.test.js`: `test('run() merges updatedInput on an allow path and never on a deny', …)`.
  - `tests/hooks-dispatcher.test.js`: spawn `node plugin/bin/hooks.js pre-tool-use` with a `P=…; node $P/x.js` payload whose `cwd` is a `linkedWorktreeOf` fixture (`tests/helpers/git-fixtures.js`). Assert exit 0 and stdout JSON `hookSpecificOutput.updatedInput.command` equal to the rewrite, with no `permissionDecision` key.
- [ ] **Step 2: Run** `node --test tests/bin-lib/hooks/guard-rewrite.test.js tests/hooks-bash-prefilter.test.js tests/hooks-pre-tool-use.test.js tests/hooks-dispatcher.test.js`. Expected: FAIL (module not found / new cases).
- [ ] **Step 3: Implement** `guard-rewrite.js` as one quote-aware single-pass walker (state: plain, single-quoted, double-quoted, `$(` depth) shared by rules 1-2, plus the three narrow rules. Then add the wiring.
- [ ] **Step 4: Run** Step 2's command plus `tests/path-guard-conformance.test.js tests/windows-hide-spawn-conformance.test.js tests/bin-lib/exit-code-conformance.test.js tests/hooks-gate-coverage.test.js`. Expected: PASS.
- [ ] **Step 5: Revert proof per rule.** For each rule, disable it in a scratch copy, run its positive test against the copy, and confirm red (`pre-tool-use-gate-exemptions`: "proven to go red on revert"; drive it from a scratch script, never `git stash`). Record the five outcomes in the commit body.
- [ ] **Step 6: Live probe.** Repeat the premise probe with the plugin's own hook: `claude -p -w probe --plugin-dir "<worktree>/plugin" --model haiku --dangerously-skip-permissions --setting-sources local …`, asking the model to run `P=/bin; $P/echo ok` and `node -e 'console.log(process.argv[1])' "$HOME"` verbatim. Both must run unrefused. Save the stream-json output to `$PIPELINE_RUN_DIR/evidence/guard-rewrite-live-probe.jsonl` and log an `AC evidence` line.
- [ ] **Step 7: Commit.** Message: `Add PreToolUse guard normalizer via updatedInput — semantics-preserving rewrites of refused shapes`

### Task 9: Probe record, docs and follow-up

**Role:** integration

**Files:**
- Create: `docs/reference/pretooluse-updatedinput-worktree-guard.md` (AC3.1)
- Modify: `docs/hooks.md` (line 58's "nothing here can alter it" becomes the measured ordering; add a bullet for the guard normalizer under the pre-tool-use description, naming `guard-rewrite.js`, the five rule ids, the linked-worktree gate and the no-`permissionDecision` rule), `docs/plugin-structure.md` (`tools/` line: add `guard-refusals.js` + `guard-refusals/`, with the CLI's flags and exit codes), `plugin/skills/_shared/scratch-worktree.md` (one sentence after the §7 table: the plugin's PreToolUse normalizer rewrites five shapes before the guard reads them, citing the reference doc; byte check after)
- Test: `tests/guard-refusals/probe-doc.test.js`

The reference doc's content: the probe procedure (scratch repo, `claude -p -w`, scratch hook settings, the four variants and their commands), each variant's observed result verbatim (control refused / rewrite ran / rewritten-into-refused refused / no-decision rewrite ran), the version (2.1.302) and date (2026-10-24), the implications (normalize, never bypass; no `permissionDecision`), and what was not measured (interactive mode; a non-bypass permission mode's prompt evaluating the rewritten input).

- [ ] **Step 1: Write the test.** `test('AC3.1: the probe outcome doc records each variant result, the version and the date', …)` pins literal lines from the doc you write (copy them from your own edit, never from memory), each with a stripped-doc control that goes red.
- [ ] **Step 2: Write the docs; run** `node --test tests/guard-refusals/probe-doc.test.js tests/scratch-worktree-shell-constraint-table.test.js`. Expected: PASS.
- [ ] **Step 3: Behavior-change sweep.** `git grep -n -i -e 'nothing here can alter' -e 'cannot alter' -e 'harness code, not a module' -- docs plugin README.md` must show no surviving stale claim.
- [ ] **Step 4: Follow-up record.** Invoke `/claude-tweaks:capture` for "Measure guard refusals per pipeline over 10 runs after #4028". The body must be spec-shaped (Current State: the Task 2 baseline numbers and evidence path; Deliverables: run `tools/guard-refusals.js` after 10 pipelines and compare per-pipeline mean to the baseline; Acceptance Criteria: ≥90% drop or a filed cause), with `Defer-reason:` set per `_shared/deferral-gate.md`.
- [ ] **Step 5: Commit.** Message: `Record PreToolUse updatedInput vs worktree-guard probe — docs and normalizer pointer`

## Spec coverage map

| Spec item | Task |
|---|---|
| Deliverable 1 (tools/ classifier by shape and fence) | 1, 2 |
| Deliverable 2 (rewrite refusing fences) | 3, 4, 5, 6 |
| Deliverable 3 (conformance scan) | 1, 7 |
| Deliverable 4 (probe; rewrites if yes) | 8, 9 (probe already run; Global Constraints) |
| AC1.1 | Waived (post-merge measurement; Task 9 Step 4 files it) |
| AC2.1 (fails on a fixture with each banned shape) | 1 (`AC2.1:` test) |
| AC2.2 (passes on the migrated corpus) | 7 (`AC2.2:` test) |
| AC3.1 (probe outcome in docs/) | 9 (`AC3.1:` test) |
