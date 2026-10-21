# scratch-worktree §7 Current-State Refusal Table Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `_shared/scratch-worktree.md` §7's chain of dated addenda with one current-state table, every row re-verified live in a worktree session during this build.

**Architecture:** Probe every shape §7 records, one plain command per Bash call, from inside the worktree-isolated session, and capture each verdict and verbatim refusal text in a scratch evidence file. Rewrite §7 as: intro, current-state table, practical workaround, maintenance note. The addenda fold into table rows, and each row's Last-verified cell keeps the originating record numbers as provenance. Repoint the two consumers that cite a specific addendum or the addenda scan. A `node --test` conformance suite pins the result.

**Tech Stack:** Markdown skill prose; `node --test` (built-in runner).

**Spec:** `.claude-tweaks/pipelines/2026-10-20T201429-record-3340/work/3340-spec.md`

**Scope keywords:** `addendum`, `Shell constraint`

## Global Constraints

- The table opens §7 and covers every shape any addendum records. Each row carries a last-verified date from a live run made during this build: `2026-10-20 (#3340)`.
- Verdict vocabulary is exactly `refused` / `passes` / `permission-rule`.
- No row's verdict contradicts another row's, and no addendum is left asserting a verdict the table reverses. This plan folds the addenda into rows, so no dated addendum paragraph remains in §7.
- `npm test` passes, including the byte-ceiling (`rail:`) suites. `scratch-worktree.md` is 32,329 B today against `RAIL_BYTES` 52,500. The rewrite must not grow it past ~36 KB, and should shrink it.
- A verdict comes only from a probe actually run in this build. Never copy one from an addendum. A probe that was not run is a blocking gap, never a row (Blocking-verification-downgrade check).

## Review Focus

- A probe run outside a worktree-isolated session gives "passes" for everything. The control probe S08 (a `for` loop) must come back refused, or the whole evidence set is invalid.
- Permission-rule denials ("Permission to use Bash with command … has been denied") misfiled as guard refusals, or the reverse. Classify by wording, never by outcome.
- Literal `|` inside a table cell (the pipeline example) breaks the column count. Write it as `\|`. The test's row parser splits on unescaped `|` only.
- `worktree-setup.md:142` cites "§7's runtime-computed-variable entries". Keep that phrase in the variable-path row's Shape cell, so the citation still resolves without editing that rail-bound composed file.
- A probe whose shape *passes* actually executes. Every probe below is chosen to be harmless if it runs: nonexistent PR 999999, undefined GraphQL field, unset variables, scratch paths outside the repo.

---

### Task 1: Re-verify every shape live and rewrite §7 as a current-state table

**Files:**
- Modify: `plugin/skills/_shared/scratch-worktree.md:235-283` (all of §7, which runs to end of file)
- Modify: `docs/journeys/work-around-a-refused-worktree-bash-command-2776.md:24-26` (step 2)
- Modify: `plugin/skills/flow/multispec-progress-banner.md:22` (citation "Section 7's 2026-08-30 addendum, #1651")
- Create: `tests/scratch-worktree-shell-constraint-table.test.js`
- Scratch (never committed): `/private/tmp/claude-501/-Users-thomasholknielsen-Code-Workspaces-claude-tweaks/5c28ef9e-a723-493c-9c70-294071dd8fe7/scratchpad/probe-3340/` (below: `SP`). The evidence file is `SP/evidence.md`.

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: §7's table header, exactly `| Shape | Example | Verdict | Refusal wording | Workaround | Last verified |`.

- [ ] **Step 1: Write the failing test** `tests/scratch-worktree-shell-constraint-table.test.js`

  Read `plugin/skills/_shared/scratch-worktree.md`. Slice §7 from `## 7. Shell constraint` to end of file. Parse the first markdown table in it: the header row, the separator, then consecutive `|` lines. Split cells on `/(?<!\\)\|/`. Tests:
  - `§7 opens with the current-state table`: the table header equals the Interfaces string above, and its index is before the index of `**Practical workaround`.
  - `every row carries a closed-vocabulary verdict and a #3340 last-verified date`: each row has 6 cells. Verdict (cell 3, trimmed) is in `['refused','passes','permission-rule']`. Last verified (cell 6) matches `/^2026-10-20 \(#3340\)/`.
  - `no dated addendum remains in §7`: `assert.doesNotMatch(s7, /\*\*\d{4}-\d{2}-\d{2} addendum/)`.
  - `shape cells are unique`: `new Set(shapes).size === shapes.length`.
  - `the table covers every shape an addendum recorded`: the joined table text includes each of `${VAR:-default}`, `complete`, `GIT`, `github.com`, `mv `, `-iname`, `if RAW=$(`, `sed -i`, `"$P/`, `mutation(`, `eval`, `$TMPDIR`, `.log`, `awk`, `mkdir -p`, `for `, `; `, `<<`, `runtime-computed-variable`.
  - `the #2776 journey points at the table`: step 2's `**Action:**` line in `docs/journeys/work-around-a-refused-worktree-bash-command-2776.md` matches `/table/` and does not match `/newest first/`.
  - `multispec-progress-banner cites the table row, not an addendum`: `plugin/skills/flow/multispec-progress-banner.md` does not include `2026-08-30 addendum`, and does include `scratch-worktree.md`.

- [ ] **Step 2: Run it to verify it fails**

  Run: `node --test tests/scratch-worktree-shell-constraint-table.test.js`
  Expected: FAIL (no table header in §7; dated addenda present)

- [ ] **Step 3: Run the live probes**

  First `pwd` and `git rev-parse --show-toplevel`. Both must print `/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude/worktrees/record-3340`, else STOP and report BLOCKED. Create `SP` with `mkdir -p {SP}` (one call). Use the `Write` tool to create `SP/h.sh` (`echo helper`), `SP/a.md` (`a`) and `SP/s05.txt` (`zz`). Then run each command below **exactly as written, one per Bash call**, from the worktree root, with `SP` replaced by the literal path. Never wrap, chain, or retry a probe in a different form. After each probe, use the `Edit`/`Write` tool to append one line to `SP/evidence.md`: `S{nn} | {refused|passes|permission-rule} | {verbatim refusal text, or "ran, exit N"}`.

  Classify by wording only:
  - `refused`: the harness guard wording (e.g. "This session is isolated in the worktree …", "too complex to verify", "computed at runtime", "runs a string through").
  - `permission-rule`: "Permission to use Bash with command … has been denied".
  - `passes`: it ran, whatever the exit code.

  **Control:** S08 must come back `refused`. If it passes, STOP and report NEEDS_CONTEXT, because the session is not guard-isolated and no verdict is valid.

  | ID | Command (one Bash call) | Recorded by |
  |---|---|---|
  | S01 | `echo plain` | 08-15 |
  | S02 | `echo $(pwd)` | 08-15 |
  | S03 | `ls \| head -1` | 08-15 |
  | S04 | `pwd && whoami` | 08-15, #1108 |
  | S05 | `cat > SP/s05b.txt <<'EOF'` / `x` / `EOF` (three lines, one call) | 08-15, #3519 |
  | S06 | `test "$(echo a)" = "$(echo b)"` | 08-15 |
  | S07 | `echo one; echo two` | 08-15 |
  | S08 | `for i in 1 2; do echo $i; done` | 08-15 (CONTROL) |
  | S09 | `while false; do echo x; done` | 08-15 |
  | S10 | `echo "${HOME:-/nope}"` | #1108 |
  | S10b | `echo "$HOME"` | #1108 |
  | S11 | `TESTVAR=hello && echo "$TESTVAR"` | #1108 |
  | S11b | `TESTVAR=hello` | #1108 |
  | S12 | `echo complete` | #1651 |
  | S12b | `echo running` | #1651 |
  | S13 | `CT_HOOKS_GIT_TIMEOUT_MS=60000 echo $(echo hi)` | #1876 |
  | S13b | `CT_HOOKS_TIMEOUT_MS=60000 echo $(echo hi)` | #1876 |
  | S14 | `printf '%s\n' '- one' '- two'` | #1876 |
  | S15 | `echo x > SP/s15.txt && mv SP/s15.txt SP/s15b.txt` | #1876 |
  | S16 | `echo "https://github.com/thn-inc/claude-tweaks/pull/1" --run "$RUN_DIR"` | #1876 |
  | S16b | `echo --run "$RUN_DIR"` | #1876, #2776 |
  | S16c | `echo https://github.com/thn-inc/claude-tweaks/pull/1` | #2776 |
  | S17 | `printf '%s' '[{"finding":"rollback leaves the git index staged"}]' > SP/s17.json` | #1785 |
  | S17b | `printf '%s' '[{"finding":"x"}]' > "$CTX/s17.json"` | #1785 |
  | S18 | `for f in SP/a.md; do sed -n '1p' "$f"; done` | #1785 |
  | S19 | `find plugin -maxdepth 2 -iname "*scratch*"` | #1785 |
  | S19b | `find plugin/skills/_shared -maxdepth 1 -name scratch-worktree.md` | #1785 |
  | S20 | `if RAW=$(gh api "repos/thn-inc/claude-tweaks/contents/claims/issue-3340.json?ref=claims-registry" -q .sha); then echo ok; fi` | #1785 |
  | S20b | `gh api "repos/thn-inc/claude-tweaks/contents/claims/issue-3340.json?ref=claims-registry" -q .sha` | #1785 |
  | S21 | `sed -i '' 's/zz/zz/' "$B"` | #1785 |
  | S21b | `sed -i '' 's/zz/zz/' SP/s05.txt` | #1785 |
  | S22 | `cat "$P/README.md"` | #1785 |
  | S22b | `cat "$TMPDIR/nonexistent-3340"` | #2776 |
  | S23 | `sed -n '1,2p' "$P/README.md"` | #1785 |
  | S24 | `gh api graphql -f query='mutation($a:ID!,$b:ID!){ doThing(input:{a:$a,b:$b}){ clientMutationId } }' -f a=1 -f b=2` | #2739 |
  | S24b | `gh api graphql -f query='mutation($a:ID!){ doThing(input:{a:$a}){ clientMutationId } }' -f a=1` | #2739 |
  | S24c | `gh api graphql -f query='mutation($a:ID!,$b:ID!){ __typename }' -f a=1 -f b=2` | #2739 |
  | S25 | `echo eval` | #2742 |
  | S25b | `echo "evaluate this"` | #2742 |
  | S26 | `A="x"; echo "$A"` | #2739 (did not reproduce) |
  | S27 | `cd plugin && node <<'EOF'` / `console.log(1)` / `EOF` | #2739 (did not reproduce) |
  | S28 | `git rev-parse --short HEAD && echo done` | #2739 (did not reproduce) |
  | S29 | `bash SP/h.sh && bash SP/h.sh` | #2739 (did not reproduce) |
  | S30 | `cat > "$TMPDIR/x3340.md" <<'EOF'` / `hi` / `EOF` / `gh pr comment 999999 --body-file "$TMPDIR/x3340.md"` (one call) | #2776 |
  | S30b | same as S30 with `SP/x3340.md` in place of both `"$TMPDIR/x3340.md"` | #2776 |
  | S31 | `tail -n 4 .git/worktrees/record-3340/claude-tweaks-verify/tests.log \| head -1` | #2776 |
  | S31b | `tail -n 1 "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.git/worktrees/record-3340/claude-tweaks-verify/tests.log"` | #2776 |
  | S32 | `grep -c "git" README.md && echo ok` | #2776 (did not reproduce) |
  | S33 | `sed -n '1,3p' .github/workflows/test.yml && echo done` | #2776 (did not reproduce) |
  | S34 | `awk 'NR==1{print $1}' README.md` | #2776 (did not reproduce) |
  | S35 | `bash SP/h.sh` | #2776 (did not reproduce) |
  | S36 | `ls -d .g*hub` | #2776 (did not reproduce) |
  | S37 | `mkdir -p SP/s37 && cat > SP/s37/p.js <<'EOF'` / `1` / `EOF` | #3519 |

  Expected: `SP/evidence.md` holds one line per ID above, with no ID missing.

- [ ] **Step 4: Rewrite §7** in `plugin/skills/_shared/scratch-worktree.md`

  Keep the opening paragraph (lines 237). Then write the table with the header from Interfaces: one row per distinct shape, with a probe's `b`/`c` control folded into its row's Shape or Example cell (e.g. "two independent `$(...)` in one command — one alone passes").
  - **Verdict** and **Refusal wording** come from `SP/evidence.md` only. Wording is a short verbatim excerpt, or `—` for `passes`.
  - **Workaround** comes from the addendum that recorded the shape, or `—` when it passes.
  - **Last verified** reads `2026-10-20 (#3340); first #{n}`.
  - The variable-path row's Shape names "runtime-computed-variable".
  - The `.log` row (`permission-rule`) keeps #2776's guidance: read `{git-dir}/claude-tweaks-verify/`, and honor a deny rule set on purpose.
  - Escape cell pipes as `\|`.

  After the table, keep the **Practical workaround** paragraph (line 246) and the `=`-led zsh note (line 248) verbatim. Add a two-sentence maintenance note: the table is "last observed, not a guarantee". A new or changed shape updates or adds a row with a live-verified date and record, never a dated addendum. Delete every dated addendum paragraph (lines 239-244, 250-283). Their content now lives in rows, and git history keeps the evidence trail. A shape that S-probes show reversed (e.g. a recorded refusal that now passes) gets the current verdict, with the earlier verdict noted in that row's Shape cell ("refused in #1785; passes now").

- [ ] **Step 5: Repoint the consumers**

  - Journey step 2: replace its `**Action:**` line with one that looks the shape up in §7's current-state table by shape. Keep the rest of the step. Update **Should understand** so "each entry" reads "each row", with its Last-verified date.
  - `multispec-progress-banner.md:22`: change "`_shared/scratch-worktree.md` Section 7's 2026-08-30 addendum, #1651" to "`_shared/scratch-worktree.md` §7's `complete`-token row, #1651". If S12 came back `passes`, also replace "triggers the harness's Bash-shape guard" with the table's verdict, so the sentence no longer asserts a reversed refusal. The `node -e` composition stays as a harmless fallback.

- [ ] **Step 6: Run the test to verify it passes**

  Run: `node --test tests/scratch-worktree-shell-constraint-table.test.js`
  Expected: PASS, all 7 tests

- [ ] **Step 7: Run the suites pinning the touched files**

  Run: `node --test tests/subagent-contract-clauses.test.js tests/feedback-harness-refusal-attribution-conformance.test.js tests/worktree-setup-plugin-root-literal.test.js tests/capture-native-branch-guard-shapes.test.js tests/context-cost.test.js`
  Expected: PASS. Also run `wc -c plugin/skills/_shared/scratch-worktree.md` and expect ≤ 36000.

- [ ] **Step 8: Commit** (separate calls; the message says `refs #3340`, never a closing keyword)

  `git add plugin/skills/_shared/scratch-worktree.md docs/journeys/work-around-a-refused-worktree-bash-command-2776.md plugin/skills/flow/multispec-progress-banner.md tests/scratch-worktree-shell-constraint-table.test.js`
  `git commit -m "Consolidate scratch-worktree §7 refusal addenda into a re-verified current-state table — refs #3340"`

  Report, as follow-ups (not fixes), any prose outside these three files that states a §7 verdict the table now reverses. Check `docs/donts.md:63`, `docs/hooks.md:55`, `docs/skill-authoring.md:178`, `plugin/skills/_shared/subagent-dispatch-core.md:39`.
