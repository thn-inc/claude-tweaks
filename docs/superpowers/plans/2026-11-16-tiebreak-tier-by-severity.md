# Tiebreak Judge Tier by Severity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Step 3.7's tiebreak judges an `info` finding at the Standard tier and every other finding at Capable, with chunks that never mix tiers, and re-judges at Capable any finding a Standard judge raises to `medium` or higher.

**Architecture:** The tier rule lives in code: `plugin/bin/lib/tiebreak.js` gains `judgeTier`, `planChunks` and an escalation check, exposed through two `review-coordination.js` changes (a new `plan-chunks` verb and a `--tier` flag on `resolve-tiebreak`). `plugin/skills/review/step3-tiebreak.md` stops grouping chunks by hand and cites the verb, names the tier per severity, and resolves each tier with `resolve-profile.js`.

**Tech Stack:** Node 18+ CommonJS, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-11-16T063159-record-5541/work/5541-spec.md` (record #5541). Replay result (Deliverables 1-2, already run, logged in the run's `decisions.md`): low Capable 80.9% vs Standard 68.8% (fails); info Capable 69.0% vs Standard 64.3% (4.7 points, passes the 5-point bound); no-judge info 19.0% (fails). Decision: `info` → Standard; `low`, `medium`+, null/unknown → Capable. AC5 (no-judge path) does not apply.

## Global Constraints

- Tier per finding: `standard` only when the finding's severity (`reporterSeverityOf`: a contested finding's higher known position severity, else `reporterSeverity`) is `info`; `capable` for `low`, `medium`, `high`, `critical`, null, or any unknown value. A contested finding with any position whose severity is null or unknown is `capable` even when its known positions are all `info` (spec `## Plan Review Clarifications`).
- Inline verdicts (a dispatched reviewer's inline rung) always resolve with `--tier capable`, so they never escalate.
- `CHUNK_MAX` stays 8; a chunk holds findings of one tier only.
- A finding a `standard` judge gives severity `medium` or higher (`severityRank(s) >= severityRank('medium')`, `plugin/bin/lib/coordination.js`) is re-judged at `capable`; that second verdict is the one settled, and the standard reply is never logged.
- Backward compatibility (a run on the previous release reads the old prose): `resolve-tiebreak` without `--tier` behaves exactly as today (tier `capable`, never escalates); the chunk form's existing output keys keep their meaning, `escalated` is added beside them.
- Do not add text to `plugin/skills/review/code-mode-steps.md` (#5076).
- Commit subjects: `{Verb} {what} — {detail}`, body line `refs #5541` (never closes/fixes).

## Controller steps (not dispatched)

Done by the build controller, outside the tasks: the PR body carries the replay table (tokens and per-class agreement per arm), the harness commit, the script hashes, the model id per tier, the review set and the date, the transport choice and the accepted-risk note (Deliverables 1-2, AC1-AC2); the controller also posts Deliverable 4's comment on #5148 and corrects the record's Release Note to the shipped decision.

## Review Focus

1. A contested entry whose positions are `info` and `medium` must take the `capable` tier (higher position wins) — Task 1 test.
2. A repeated entry (same finding id) must appear in exactly one chunk, once — Task 1 test.
3. A `standard` judge's block that does not parse, or carries a non-`DONE` status, is not escalated even if it names `Severity: high`; it resolves as today — Task 1 test.
4. `--tier standard` on a chunk or finding whose tier is `capable` exits 2 and appends nothing under `--run` — Task 2 test.
5. A `capable` re-judge that again says `Severity: high` is settled, never escalated again (no loop) — Task 1 and Task 2 tests.

---

### Task 1: Tier rule, chunk plan and escalation in `tiebreak.js`

**Role:** integration
**Review risk:** high — decision logic: tier from severity, the escalation condition, dedupe and tier partitioning, the tier-mismatch refusal.

**Files:**
- Modify: `plugin/bin/lib/tiebreak.js` (header comment block for the chunk section; new functions beside `resolveTiebreakChunk`; `module.exports`)
- Test: `tests/bin-lib/tiebreak.test.js`

**Interfaces:**
- Produces:
  - `TIERS = ['capable', 'standard']`
  - `judgeTier(finding) -> 'capable' | 'standard'` — for a contested finding with a `positions` array, `'standard'` only when every position's severity is known and the highest is `info`; otherwise `reporterSeverityOf(finding) === 'info'`.
  - `planChunks(findings: Finding[]) -> Array<{ tier: 'capable'|'standard', indexes: number[] }>` — throws `TypeError` for a non-array or an entry `buildFindingsArtifact` refuses; a repeated finding id keeps its first index only; tiers in `TIERS` order, entry order within a tier, at most `CHUNK_MAX` indexes per chunk; `[]` for `[]`.
  - `escalation(finding, replyText, tier) -> null | { reason: 'raised', severity }` — non-null only when `tier === 'standard'`, the reply parses (`parse === 'ok'`), its status is `DONE`, and its severity ranks `medium` or higher.
  - `resolveTiebreakChunk(findings, replyText, opts)` — `opts.tier` (default `'capable'`): a value outside `TIERS` throws `TypeError`; `'standard'` with any finding whose `judgeTier` is `'capable'` throws `TypeError`. Returns `{ results, unsettled, escalated }`; `escalated` is `[{ id, index, reason: 'raised', severity }]`, those findings get no result; always `[]` at `capable`.

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/tiebreak.test.js` (reuse the file's `reader`, `NOW`, `CHUNK_F1`/`CHUNK_F2` style fixtures):
  - `judgeTier: info is standard, every other severity capable` — `info` → `'standard'`; `low`, `medium`, `high`, `critical`, `null`, `undefined`, `'bogus'` → `'capable'`; contested `{kind:'contested', positions:[{severity:'info'},{severity:'medium'}]}` → `'capable'`; contested with two `info` positions → `'standard'`; contested `[{severity:'info'},{severity:null}]` and `[{severity:'info'},{severity:'bogus'}]` → `'capable'`.
  - `planChunks: a chunk never mixes tiers` — 10 `low` + 3 `info` entries interleaved → chunks `[{tier:'capable', indexes:[first 8 low]}, {tier:'capable', indexes:[last 2 low]}, {tier:'standard', indexes:[3 info]}]` with exact indexes; every chunk's indexes share `judgeTier === chunk.tier`.
  - `planChunks: a repeated entry goes in once` — entries `[A, B, A]` → the index `2` appears in no chunk.
  - `planChunks: [] gives []; a malformed entry throws TypeError`.
  - `resolveTiebreakChunk at standard: a raised finding is escalated, not settled` — two `info` findings; reply blocks: first `Severity: medium` confirmed with verified evidence, second `Severity: info` confirmed → `escalated` = `[{id: id1, index: 0, reason: 'raised', severity: 'medium'}]`, `results` holds only index 1.
  - `resolveTiebreakChunk at standard: an unparsed or non-DONE block is not escalated` — a block with `Severity: high` but no `Verdict:` line, and a whole reply ending `STATUS: BLOCKED` → `escalated` `[]`.
  - `resolveTiebreakChunk: capable never escalates; default tier is capable` — a `low` finding with `Severity: high` at `{tier:'capable'}` and with no `tier` → settled in `results`, `escalated` `[]`.
  - `resolveTiebreakChunk at standard refuses a capable-tier finding; an unknown tier throws` — `assert.throws(..., TypeError)` for a `low` finding at `standard`, and for `tier: 'fast'`.
  - `escalation: one-finding check` — `(info finding, 'Severity: high' DONE reply, 'standard')` → `{reason:'raised', severity:'high'}`; same at `'capable'` → `null`; `Severity: low` at `'standard'` → `null`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/tiebreak.test.js`
Expected: FAIL — `judgeTier is not a function` (and the other new names undefined).

- [ ] **Step 3: Implement** `TIERS`, `judgeTier`, `planChunks`, `escalation` and the `opts.tier` branch of `resolveTiebreakChunk` in `plugin/bin/lib/tiebreak.js`; export the four new names. `judgeTier` uses `reporterSeverityOf`; `planChunks` validates with `buildFindingsArtifact` (its ids give the dedupe key); `escalation` uses `parseTiebreakReply(replyText, { findingPath: finding.path })` and `severityRank`. In `resolveTiebreakChunk`, check the escalation on the block text after the vacuity rewrite and before `resolveTiebreak`. Extend the `// ---- chunked replies (#5540) ----` comment with the tier rule, citing #5541.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/tiebreak.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/tiebreak.js tests/bin-lib/tiebreak.test.js
git commit -m "Add tiebreak judge tiers — info findings take the Standard tier, chunks never mix tiers, raised findings escalate"
```

### Task 2: `plan-chunks` verb and `--tier` flag in `review-coordination.js`

**Role:** integration
**Review risk:** high — decision logic: whether a finding may be judged at a tier, whether the one-finding form escalates, which results are appended under `--run`.

**Files:**
- Modify: `plugin/bin/review-coordination.js` (header comment lines 11-48, `USAGE`, `resolveTiebreakChunkCommand`, the `resolve-tiebreak` branch, a new `plan-chunks` branch beside `finding-ids`)
- Modify: `docs/plugin-structure.md:367` (the review-coordination CLI row: add `plan-chunks`, `--tier`, `escalated`)
- Test: `tests/bin-lib/review-coordination/cli.test.js`

**Interfaces:**
- Consumes: Task 1's `planChunks`, `judgeTier`, `escalation`, `TIERS`, `resolveTiebreakChunk(…, { tier })`.
- Produces (CLI contract the prose in Task 3 cites):
  - `review-coordination.js plan-chunks <entries.json>` → stdout `{"chunks":[{"chunk":1,"tier":"capable","indexes":[0,2]},…]}` (`chunk` numbered from 1 in output order); no writes; exit 2 on an unreadable file, a non-array, or a malformed entry (stderr names the cause); `[]` prints `{"chunks":[]}` exit 0.
  - `resolve-tiebreak <finding.json> <reply> [--root <dir>] [--run <dir>] [--tier capable|standard]` — absent `--tier` = `capable`; a missing or unknown value exits 2. Chunk form prints `{chunk:true, results, unsettled, escalated}` and appends verdict lines for `results` only; a tier mismatch exits 2 before reading the reply or appending. One-finding form at `standard`: a finding whose `judgeTier` is `capable` exits 2; a raised reply prints `{"escalated":true,"id":…,"reason":"raised","severity":…}`, exit 0, nothing appended under `--run`.

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/review-coordination/cli.test.js` (use `cli()`/`writeFixture`; for `--run` cases reuse the file's existing anchored run-dir fixture helper):
  - `plan-chunks prints one tier per chunk` — 9 `low` + 1 `info` entries → `{chunks:[{chunk:1,tier:'capable',indexes:[0..7]},{chunk:2,tier:'capable',indexes:[8]},{chunk:3,tier:'standard',indexes:[9]}]}` (adjust indexes to the fixture order), exit 0.
  - `plan-chunks exits 2 on a malformed entry or a non-array`.
  - `resolve-tiebreak --tier standard escalates a raised finding and logs nothing` — `info` finding, reply `Severity: medium` confirmed, `--run` → stdout `escalated: true`, `decisions.md` unchanged.
  - `resolve-tiebreak --tier standard on a capable-tier finding exits 2` — one-finding form and chunk form (chunk holding one `low` entry), `--run` given; `decisions.md` unchanged.
  - `resolve-tiebreak --tier capable settles a raised finding` — same `info` finding and `Severity: medium` reply at `--tier capable` → a normal result (`outcome` present), verdict line appended.
  - `resolve-tiebreak --tier with no or an unknown value exits 2`.
  - `chunk form adds escalated beside results and unsettled` — two `info` entries at `--tier standard`, one raised → `escalated` length 1, `results` length 1, `unsettled` `[]`; without `--tier` on a `low` chunk the output carries `escalated: []`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/review-coordination/cli.test.js`
Expected: FAIL — `plan-chunks` unknown command (exit 2 where 0 expected) and `--tier` read as a positional.

- [ ] **Step 3: Implement** the `plan-chunks` branch, the `--tier` option parse (same loop as `--root`/`--run`), the tier checks, and `escalated` in both forms of `plugin/bin/review-coordination.js`; update its header comment and `USAGE`; update the `docs/plugin-structure.md:367` row (one clause each for `plan-chunks`, `--tier`, `escalated`, citing #5541).

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/review-coordination/cli.test.js tests/bin-lib/tiebreak.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/review-coordination.js tests/bin-lib/review-coordination/cli.test.js docs/plugin-structure.md
git commit -m "Add plan-chunks and --tier to review-coordination.js — the tiebreak's chunk plan and judge tier come from code"
```

### Task 3: Step 3.7 prose names the tier per severity

**Role:** integration

**Files:**
- Modify: `plugin/skills/review/step3-tiebreak.md` (`## Dispatch` chunk sentence, `{n}` definition, `Model:` line, the `[Use: …]` line of both templates; `## Resolve and act` chunk call, step 2 commands, escalation sentence, attempt count)
- Modify: `tests/review-tiebreak-step-conformance.test.js` (new AC3 tests; update the pins at lines 152, 1459, 1442 and 1491)
- Modify: `docs/skill-graph.md:550`, `docs/plugin-structure.md:174`, `docs/journeys/get-a-verdict-on-every-unverified-review-finding-3947.md:39` (name `plan-chunks` and the per-severity tier where they say every judge is `[Use: Capable]`)

**Interfaces:**
- Consumes: Task 2's CLI contract (verbatim names: `plan-chunks`, `--tier`, `escalated`, reason `raised`).

- [ ] **Step 1: Write the failing tests** in `tests/review-tiebreak-step-conformance.test.js`, each with a go-red proof (the file's `missingFactsOf` / `assertEachPatternGoesRed` style):
  - `AC3: the prose routes only info to the Standard tier` — in `## Dispatch`, the set of backticked severities in the sentence matching ``/((?:`[a-z]+`(?:, | and )?)+) findings take the `standard` tier/`` is exactly `['info']`, and the text carries `` every other severity, a null or unknown one included, the `capable` tier ``. Go-red: `` `info` findings `` → `` `info` and `medium` findings `` fails the set check; dropping `a null or unknown one included` fails the second.
  - `AC3: a chunk holds findings of one tier only` — `## Dispatch` carries `a chunk never mixes tiers` and the call `` `node "${CLAUDE_PLUGIN_ROOT}/bin/review-coordination.js" plan-chunks "{path-E}"` ``; and, in code, `planChunks` over a mixed fixture (6 `low`, 2 `info`, 1 contested `info`/`high`, 1 null-severity) returns chunks whose indexes all share `judgeTier === chunk.tier`, with the contested and null entries in a `capable` chunk. Go-red for the prose facts.
  - `AC3: the Model line resolves each tier with resolve-profile.js` — `## Dispatch` carries both `resolve-profile.js" capable --run-dir` and `resolve-profile.js" standard --run-dir`, and `an escalation re-judge` … `is always \`capable\``.
  - `AC2: a raised finding is re-judged at Capable` — `## Resolve and act` carries `Every id in its \`escalated\` list (reason \`raised\`` and `one \`capable\` single-finding re-judge` and `the \`standard\` judge's reply is never logged`.
- Update existing pins so they hold the new text: line 152 and 1459 `[Use: Capable` → `/\[Use: \{Capable \| Standard\}/`; line 1442 anchor `"Group the entry set's distinct ids"` → `"Plan the chunks in code"`; line 1491's fact → `/one number per finding, since no chunk holds more than 8/` (keep line 1492's stride fact and `nDefinitionProblems` unchanged).

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/review-tiebreak-step-conformance.test.js`
Expected: FAIL — the new AC3/AC2 facts are missing from `step3-tiebreak.md`.

- [ ] **Step 3: Edit `plugin/skills/review/step3-tiebreak.md`:**
  - `## Dispatch`: replace the sentence starting `Group the entry set's distinct ids` up to `dispatch one fresh agent per chunk, in parallel waves of **8** chunk agents:` with: `Plan the chunks in code: \`Write\` the entry set (as written to the artifact, \`positions\` included for a contested one) to \`E=review-{ctx-id}-tiebreak-entries.json\` — resolved with the same session-tmp call as the chunk files, in a pipeline run and standalone alike — and run \`node "${CLAUDE_PLUGIN_ROOT}/bin/review-coordination.js" plan-chunks "{path-E}"\`. It groups the entry set's distinct ids into chunks of at most **8** findings, in entry order within each tier — never by lens or file; a repeated entry goes in once — and a chunk never mixes tiers: \`info\` findings take the \`standard\` tier and every other severity, a null or unknown one included, the \`capable\` tier (\`tiebreak.js\`'s \`judgeTier\`). Dispatch one fresh agent per chunk, in parallel waves of **8** chunk agents:` (the rest of the sentence unchanged). On a `plan-chunks` exit 2, fix the entry stderr names and re-run once; a second failure sends every finding to the per-finding path at the `capable` tier.
  - `{n}`: `A finding's \`{n}\`, everywhere in this step, is \`(c − 1) × 8 + i + 1\` for index \`i\` (from 0) in chunk \`c\` (from 1) of the \`plan-chunks\` output — one number per finding, since no chunk holds more than 8.`
  - `Model:` line: `Model: each chunk's \`tier\` from \`plan-chunks\` — \`[Use: Capable]\` for \`capable\`, resolved with \`node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-profile.js" capable --run-dir "$PIPELINE_RUN_DIR"\`; \`[Use: Standard]\` for \`standard\`, resolved with \`node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-profile.js" standard --run-dir "$PIPELINE_RUN_DIR"\` (drop \`--run-dir\` when no run directory exists). A single-finding follow-up takes its chunk's tier; an escalation re-judge (\`## Resolve and act\`) is always \`capable\`.`
  - Both templates' last line: `[Use: {Capable | Standard} — tiebreak agent, at the tier the Model line gives this agent. Independent run; fresh file read, not the reporting lens's context. Resolve via \`node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-profile.js" {capable | standard} --run-dir "$PIPELINE_RUN_DIR"\` (contract § Model Selection).]`
  - `## Resolve and act`: the chunk call and both step-2 commands carry `--tier {tier}` (the agent's tier: its chunk's, or `capable` for an escalation re-judge); the chunk call's printed object gains `"escalated": [...]`; after the `unsettled` sentence add: `Every id in its \`escalated\` list (reason \`raised\`: a \`standard\` judge gave it severity \`medium\` or higher) gets one \`capable\` single-finding re-judge after that call, in waves of **8** as single-finding follow-ups go, settled by steps 1–4 with \`--tier capable\`: that verdict is the one settled, and the \`standard\` judge's reply is never logged. A one-finding call at \`--tier standard\` that prints \`escalated: true\` is re-judged the same way.`; extend the attempt sentence to `A finding gets at most three judge attempts — its chunk agent, that chunk's one re-dispatch, one single-finding agent — plus one \`capable\` re-judge when a \`standard\` judge raised it, and \`check-coverage\` stays the backstop …` (keep the rest).
  - `## Resolve and act`, the inline-verdict paragraph: an inline fallback verdict always resolves with `--tier capable` (it never escalates). `## Dispatched reviewer` ladder item 2: add a failed or timed-out escalation re-judge to the cases the reviewer reads inline.
  - Then update the three doc lines listed under **Files** to match.
- Add to Step 1's tests: `AC2: inline verdicts resolve at --tier capable` — the inline paragraph carries `` always resolves with `--tier capable` ``, and the Dispatched reviewer ladder item 2 names the escalation re-judge; each with a go-red proof.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/review-tiebreak-step-conformance.test.js tests/resolve-profile-invocation-conformance.test.js tests/bin-lib/tiebreak.test.js tests/bin-lib/review-coordination/cli.test.js`
Expected: PASS, 0 failures (AC4: the resolve-profile suite passes with the new invocation lines).

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/review/step3-tiebreak.md tests/review-tiebreak-step-conformance.test.js docs/skill-graph.md docs/plugin-structure.md docs/journeys/get-a-verdict-on-every-unverified-review-finding-3947.md
git commit -m "Name the tiebreak judge tier per severity in Step 3.7 — info findings take Standard, raised findings re-judged at Capable"
```
