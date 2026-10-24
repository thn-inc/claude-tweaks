# Release Run-Dir Lifecycle (#3898) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A finished standalone `/claude-tweaks:release` run never leaves a run directory that the next release adopts, and every finding its Step 3 review staged ends filed, digested or declined before the run closes.

**Architecture:** Two release-local fixes, both prose in `plugin/skills/release/` and pinned by one new conformance test. Step 0 refuses to adopt a step-2-resolved release directory whose `run-state.json` status is terminal, and mints a fresh one instead. Step 8 first disposes of every staged review finding through a new lazily read sub-file, `disposition.md`, which reuses `review/step3-routing.md`'s Defer branch and `_shared/materiality-floor.md`. Then, after `close-run`, it archives its own **created** directory with `hooks.js archive-run`. A release run directory is fully gitignored (no `work/`), so `archiveRunDir` moves it with plain fs renames and makes no commit.

**Tech Stack:** Markdown skill prose, bash/`node -e` snippets, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-24T103516-spec-3898-4012-4041/spec-3898/work/3898-spec.md`

## Global Constraints

- Do not touch `plugin/bin/lib/hooks/run-dir-resolve.js` (decision 2026-10-24: release-local only, because #3979 is rewriting that resolver).
- An **inherited** run directory keeps today's behavior: release never closes, archives or disposes of it.
- Every skill reference in actionable text uses `/claude-tweaks:{skill}`. `tests/release-skill-reference-form.test.js` scans every `plugin/skills/release/*.md` sub-file whole, minus its H1 preamble and `## Anti-Patterns`.
- Log lines go through `bin/log-decision.js --section "/release"`. The only exception is the `FAILED` line, which is hand-composed exactly as `bookkeeping.md` does, because `FAILED` is not a `log-decision.js` status.
- Size: `release/SKILL.md` is 39013 B against `RAIL_BYTES` 52500. The disposition procedure goes in its own sub-file, not into `SKILL.md`.
- Sibling records #4012 (Step 3 review-tree check) and #4041 (Step 5 reviewed-tip gate) build after this one in the same worktree. Do not edit Step 3's review-tree paragraph or `execute.md`.

## Review Focus

1. A step-2-resolved directory whose `run-state.json` is missing or unparseable is still adopted. Unknown is not terminal; today's behavior holds. Covered by Task 1's fixture rows.
2. A run-dir path containing `'` or a space must not break the Step 0 guard. Covered by Task 1's `o'brien run` fixture.
3. A **terminal** directory reached through `$PIPELINE_RUN_DIR` (a parent pipeline's) is still inherited, never refused. The guard keys on `[ -z "$PIPELINE_RUN_DIR" ]`, pinned in Task 1.
4. `archive-run` refusing (`tiebreak-coverage-missing`, `console-unresolved`, `archive-destination-exists`) is logged verbatim and is not a failed release. Step 0's refusal already keeps a closed, unarchived directory from being adopted. Pinned in Task 2.
5. A filing or digest write that fails leaves its staged file in place, writes a `FAILED` line, and skips archival for that run. Pinned in Task 2.

## Spec Coverage and Authoring Checks

- Waived AC5.1: `npm test` is the build's full-suite gate (Common Step 5, `plugin/bin/verify.js`), not a task test step.
- Waived wrap-up/cleanup-procedures-execution.md: cited only as prior art for the `archive-run` verb; not edited.
- Waived plugin/skills/release/console.md: the Review row stays a count. Disposition runs at Step 8, after the console, so the console has nothing new to show.
- Waived docs/hooks.md: cited for its Ownership rule, which this plan preserves; not edited.
- **Gate over producers:** the inventory covers every `review-*` staged prefix with a producer. That is `review-{n}`, including KEPT-PROMPT criticals, which stage a patch too (`review/step3-routing.md`), plus `review-unconfirmed-`, `review-contested-` and `review-debate-`. `review-followup-` is in `console/resolve.js`'s CANONICAL_PREFIXES, but `git grep review-followup -- plugin` finds no producer, so it falls under the fail-closed "unrecognised" rule.
- **Moved-prose pins:** `git grep -F "a prior standalone release run's directory counts" -- tests plugin docs` → only `plugin/skills/release/SKILL.md:68`. No test pins the deleted clause.
- **Byte-pin:** `release/SKILL.md` 39013 B; Task 1 adds about 700 B and Task 2 about 900 B, leaving about 11.8 KB of headroom under `RAIL_BYTES` 52500.
- **Behavioral claims:**
  - `archiveRunDir` commits only tracked `work/`/audit files (`plugin/bin/lib/reconcile/archive-merged.js:1041`), so a gitignored release directory moves without a commit.
  - `NON_TERMINAL` is exported by `plugin/bin/lib/hooks/run-integrity.js`.

---

### Task 1: Step 0 refuses a finished release run directory

**Files:**
- Modify: `plugin/skills/release/SKILL.md` (Step 0: the resolve/mint `bash` fence and the "Determine inherited-vs-created here, once." paragraph)
- Create: `tests/release-run-dir-lifecycle-conformance.test.js`

**Interfaces:**
- Produces: the Step 0 fence echoes `refused: {dir}` on a second stdout line when a terminal directory was skipped. The log line that Step 0 writes once the new directory exists is: `AUTO {HH:MM:SS} — Step 0: {refused-dir} is a finished release run (status {status}) — not adopted; minted {run-dir}. Reversibility: n/a.`

- [ ] **Step 1: Write the failing tests** in `tests/release-run-dir-lifecycle-conformance.test.js`. Follow `.claude/skills/skill-prose-conformance-tests/executable-snippet-pins.md`'s extract-and-run form.
  - **Extraction:** read `SKILL.md` with `readText` (`tests/helpers/read-skill`). Slice the `## Step 0` section and take the `bash` fence containing `resolve-run-dir --spec-slug release`. From that fence, take the guard command: the text between `&& ` and `; then` on the line starting `if [ -n "$RUN_DIR" ] && [ -z "$PIPELINE_RUN_DIR" ] &&`. Assert loudly (`extraction pattern is out of sync`) when the line or fence is missing.
  - `test('AC1.1: Step 0 guard classifies run-state status')`: build one fixture directory per row, each with its own `run-state.json`. Run the extracted guard under `spawnSync('bash', ['-c', guard], { env: { ...process.env, RUN_DIR: dir, CLAUDE_PLUGIN_ROOT: <checkout>/plugin with forward slashes } })` and assert the exit status:

    | `run-state.json` | expected exit |
    |---|---|
    | `{"status":"clean"}` | `0` (refuse) |
    | `{"status":"closed"}` | `0` |
    | `{"status":"active"}` | `1` (adopt) |
    | `{"status":"interrupted"}` | `1` |
    | file absent | `1` |
    | `not json` | `1` |
    | `{"status":"clean"}` in a dir named `o'brien run` | `0` |
  - `test('AC2.1: Step 0 guard go-red: a flipped predicate adopts a clean dir')`: replace `!NON_TERMINAL.has(s)` with `NON_TERMINAL.has(s)` in the extracted guard. Assert the replacement changed the string, then assert the `clean` row now exits `1`.
  - `test('AC1.1/AC2.1: Step 0 prose: terminal step-2 dir is refused, run is created')`: a `missingFactsOf(stepZero)` predicate over these patterns must return `[]`:
    - `/\[ -z "\$PIPELINE_RUN_DIR" \]/`
    - `/finished release run \(status \{status\}\) — not adopted; minted \{run-dir\}/`
    - a sentence naming both `terminal` and **created** for the refused case, e.g. `/terminal[\s\S]{0,200}\*\*created\*\*/`
  - Prove each fact returns exactly `[fact]` when only its match is stripped from the live section (`foreground-execution-instruction.test.js`'s `assertEachPatternGoesRed` shape).
  - `test('AC2.1: Step 0 prose: the "prior standalone release run counts" clause is gone')`: a frozen `PRE_CHANGE_STEP0` excerpt carries `(whatever its \`createdBy\` — a prior standalone release run's directory counts)`. Assert the pattern `/a prior standalone release run's directory counts/` matches the excerpt and does not match the live Step 0.
- [ ] **Step 2: Run the tests to verify they fail**
Run: `node --test tests/release-run-dir-lifecycle-conformance.test.js`
Expected: FAIL. The extraction throws `extraction pattern is out of sync`, because no guard line exists yet.
- [ ] **Step 3: Edit Step 0 in `plugin/skills/release/SKILL.md`.**
  - **The fence:** right after the `RUN_DIR=$(… resolve-run-dir --spec-slug release 2>/dev/null)` line, add `REFUSED_DIR=` and an `if [ -n "$RUN_DIR" ] && [ -z "$PIPELINE_RUN_DIR" ] && PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT}" node -e '…' "$RUN_DIR" 2>/dev/null; then REFUSED_DIR=$RUN_DIR; RUN_DIR=; fi` block, ahead of the existing `if [ -z "$RUN_DIR" ]` mint block.
  - **The `node -e` program:** single-quoted JS, its path taken as `process.argv[1]` and the plugin root from `process.env.PLUGIN_ROOT`, never interpolated. It reads `{dir}/run-state.json` and exits `0` only when `.status` is a string and `!require(PLUGIN_ROOT + "/bin/lib/hooks/run-integrity.js").NON_TERMINAL.has(status)`. Any throw (absent file, bad JSON) exits non-zero.
  - **The end of the fence:** after `echo "$RUN_DIR"`, add `[ -n "$REFUSED_DIR" ] && echo "refused: $REFUSED_DIR"`.
  - **The inherited-vs-created paragraph:** delete the "(whatever its `createdBy` — a prior standalone release run's directory counts)" clause. State that a step-2 directory is inherited only while its status is non-terminal. A terminal one (#3898: a finished release run, which a later release must never reuse) is refused, the fallback mints a fresh directory, and the run is **created**. Add the log line from the Interfaces block, written once the new directory exists. State that a `$PIPELINE_RUN_DIR`-supplied directory is never subject to this check.
- [ ] **Step 4: Run the tests to verify they pass**
  Run: `node --test tests/release-run-dir-lifecycle-conformance.test.js tests/release-skill-reference-form.test.js`
  Expected: PASS, 0 failures.
- [ ] **Step 5: Commit**
  ```bash
  git add plugin/skills/release/SKILL.md tests/release-run-dir-lifecycle-conformance.test.js
  git commit -m "Refuse a finished release run dir at Step 0 — mint fresh instead of inheriting it (refs #3898)"
  ```

### Task 2: Step 8 disposes of staged findings, then archives its created directory

**Files:**
- Create: `plugin/skills/release/disposition.md`
- Modify: `plugin/skills/release/SKILL.md` (Step 8: the read-and-dispose instruction before the summary, a `findings:` summary line, and archival after `close-run`; plus one `## Anti-Patterns` row)
- Modify: `docs/skill-graph.md` (`## release` table: three rows)
- Test: `tests/release-run-dir-lifecycle-conformance.test.js` (add tests)

**Interfaces:**
- Consumes: Task 1's created/inherited fact (Step 0, carried, never re-read).
- Produces:
  - The per-finding log line `AUTO {HH:MM:SS} — Step 8 disposition: {staged path}{#entry} → {filed #{n} | digest ({comment url}) | declined ({reason})}. Reversibility: high.`
  - The summary log line `AUTO {HH:MM:SS} — Step 8 disposition: {f} filed, {d} digest, {x} declined, {k} failed. Reversibility: n/a.`
  - The Step 8 summary line `findings: {f} filed, {d} digest, {x} declined{, k failed}`.

- [ ] **Step 1: Write the failing tests.** Read `disposition.md` with `readText`, and a missing file fails with a clear message. Each fact set uses `missingFactsOf` plus per-fact strip-to-`[fact]` proofs. Because the prose is new, prove go-red by mutating the live text in memory, not with a frozen excerpt.
  - **`test('AC3.1: disposition.md states the scope and inventory')`**:
    - `/\*\*created\*\* run director/` and `/inherited[\s\S]{0,200}parent's Review Console/`
    - `/staged\/review-\{n\}\.\{md,patch\}/`, `/staged\/review-unconfirmed-\{n\}\.md/`, `/staged\/review-contested-\{n\}\.md/` and `/staged\/review-debate-\{n\}\.md/`
    - `/unrecognised[\s\S]{0,200}not archived/` (an unknown `review-*` file fails closed)
    - `/release-held\.md[\s\S]{0,160}not a finding/`
  - **`test('AC3.1: disposition.md routing table')`**:
    - `/review\/step3-routing\.md[\s\S]{0,120}Defer/`
    - `/pre-existing-outside-diff/`
    - `/_shared\/materiality-floor\.md/` and `/Digest — below floor/`
    - `/unconfirmed[\s\S]{0,80}critical\/high[\s\S]{0,80}Defer/`
    - `/declined \(unconfirmed: one reproduction agent of the pair\)/` and `/declined \(contested: \{verdicts\}\)/`
    - `/covered by #\{n\}/`
  - **`test('AC3.1: disposition.md approval and logging')`**:
    - `/AskUserQuestion/` and `/Apply all \(Recommended\)/`
    - `/unattended[\s\S]{0,200}AUTO-RESOLVED/` and `/consoleAutoResolve/`
    - `/Step 8 disposition: \{staged path\}/` and `/exactly one/`
    - `/FAILED \{HH:MM:SS\} — Step 8 disposition:/` and `/skip[\s\S]{0,60}archiv/`
    - `/--dry-run[\s\S]{0,160}still runs/`
  - **`test('AC2.1/AC3.1: Step 8 wires disposition, summary line, and archival in order')`**, over SKILL.md's `## Step 8` section:
    - `/disposition\.md/` and `/findings: \{f\} filed, \{d\} digest, \{x\} declined/`
    - `/hooks\.js" archive-run --run "\{run-dir\}"/`
    - `/archive-run refused[\s\S]{0,200}not adopted|Step 0/`, which names why a refusal is non-fatal
  - **`test('AC4.1: an inherited run directory is never closed, archived or disposed')`**: a `missingFactsOf` over Step 8 for `/An \*\*inherited\*\* directory is never closed/` and `/inherited[\s\S]{0,120}never archived/`, and over `disposition.md` for `/condition: inherited run directory → fallback: the parent's Review Console owns staged\//`, each with its strip-to-`[fact]` proof.
  - An ordering check on SKILL.md's Step 8 section: `indexOf('disposition.md')` < `indexOf('close-run --run')` < `indexOf('archive-run --run')`. Prove it with a permutation control: splice the `archive-run` paragraph above the `close-run` paragraph, then `assert.throws` on the same `requireOrder` helper (the skill's "ordering claim" rule).
- [ ] **Step 2: Run the tests to verify they fail**
Run: `node --test tests/release-run-dir-lifecycle-conformance.test.js`
Expected: FAIL. `disposition.md` is missing, and Step 8 lacks `archive-run`.
- [ ] **Step 3: Write `plugin/skills/release/disposition.md`.** It has an H1, a one-line "Step 8 of `/claude-tweaks:release`" framing, and these sections:
  - **When this runs:** every outcome, `--dry-run` included, because the review's findings are real whether or not anything ships. Created run directories only. An inherited one writes `SKIP` (`condition: inherited run directory → fallback: the parent's Review Console owns staged/`) and does nothing else.
  - **Inventory:** each `staged/review-{n}.{md,patch}` (confirmed, one finding each, severity from its `Finding: {severity} {category} — …` line; critical findings land here too, since `review/step3-routing.md`'s KEPT-PROMPT stages a patch as well), each entry line of `staged/review-unconfirmed-{n}.md`, and each `staged/review-contested-{n}.md` / `staged/review-debate-{n}.md` (`review/step3-debate-and-refutation.md`, `_shared/multi-agent-coordination.md`). Any other `staged/review-*` file is unrecognised: it counts as a failure (below), so the run is not archived with a finding nobody read. `release-held.md` is not a finding; it stays and is archived with the run. No findings: `SCANNED` line, nothing else.
  - **Routing table (Recommended column):**

    | Finding | Recommended disposition |
    |---|---|
    | Confirmed, any severity | Defer per `review/step3-routing.md`'s Defer bullet: `specShapedBody`, `recordPayload`, born-ready, including that bullet's materiality-floor test → `Digest — below floor`. Use `Defer-reason: pre-existing-outside-diff` (release reviews already-merged history and has no diff of its own) and `provenance.origin: /claude-tweaks:release v{version} release-gate review (run {run-id})`. |
    | Unconfirmed critical/high | The same Defer |
    | Unconfirmed medium/low/info | `declined (unconfirmed: one reproduction agent of the pair)` |
    | Contested or debate, critical/high in either verdict | The same Defer, both verdicts quoted in the body |
    | Contested or debate, otherwise | `declined (contested: {verdicts})` |
    | An open record already covering the same file and defect, found by searching open records for the finding's path | `declined (covered by #{n})` |
  - **Approval:**
    - When a human is present: render the batch table, then one `AskUserQuestion` with `Apply all (Recommended)` and `Override` (the Interaction style directive).
    - When `autonomy` resolves `unattended` (always the case under `--train`, by its own refusal rule): zero clicks, never zero render. The full table still renders, each row stamped `AUTO-RESOLVED`, in the same shape as `_shared/autonomy-ceiling.md`'s `consoleAutoResolve`.
  - **Logging:** exactly one per-finding line (Interfaces), then the summary line. Surface the digest comment URL and count per `_shared/materiality-floor.md`'s "Digest URL and count surfacing".
  - **Failure:** a filing or digest write that fails writes `FAILED {HH:MM:SS} — Step 8 disposition: {staged path} — {file|digest} failed: {message}. Reversibility: n/a (write did not land).` and leaves that staged file in place. Any failure means Step 8 skips archival for this run and names the failed paths in its summary.
  - **`## Anti-Patterns`:** two rows. Archiving with a finding still undisposed. Re-reading the created/inherited fact from disk.
- [ ] **Step 4: Edit `SKILL.md` Step 8.**
  - **Before the summary block,** for a **created** run directory: read `disposition.md` and run it, then add the `findings:` line to the summary block. That line renders whenever any finding was inventoried.
  - **After the existing `close-run` paragraph,** add an archival paragraph for a **created** directory whose disposition reported `0 failed`: `node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" archive-run --run "{run-dir}"`.
    - A refusal is logged verbatim as `AUTO {HH:MM:SS} — Step 8: archive-run refused — {reason line}. Reversibility: n/a.` and is not an error. The closed, unarchived directory is safe because Step 0 never adopts a terminal one.
    - An inherited directory is never archived. Keep the existing inherited wording.
    - A gitignored release directory archives with plain moves and no commit (`archiveRunDir` commits only tracked `work/`).
  - **Add one `## Anti-Patterns` row:** "Leaving a finished release's directory in place". The next release adopted it, along with its `## /review` marker and its ceiling pin (#3898).
- [ ] **Step 5: Edit `docs/skill-graph.md` `## release`.** Add three rows:
  - `review/step3-routing.md` (Step 8's disposition files confirmed findings through its Defer branch).
  - `_shared/materiality-floor.md` (the below-floor digest route).
  - `bin/hooks.js archive-run` (Step 8 archives its own created directory; Step 0 refuses a terminal one, #3898).
- [ ] **Step 6: Run the tests to verify they pass**
  Run: `node --test tests/release-run-dir-lifecycle-conformance.test.js tests/release-skill-reference-form.test.js tests/release-routine-template.test.js`
  Expected: PASS, 0 failures.
- [ ] **Step 7: Commit**
  ```bash
  git add plugin/skills/release/disposition.md plugin/skills/release/SKILL.md docs/skill-graph.md tests/release-run-dir-lifecycle-conformance.test.js
  git commit -m "Dispose of every staged release-review finding, then archive the created run dir at Step 8 (refs #3898)"
  ```
