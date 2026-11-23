# Implementer Tier From the Record Rule, With One Escalation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/build`'s subagent procedure takes every per-task implementer's default profile from `plugin/bin/implementer-tier.js` instead of a prose `size:` mapping, and, under `implementer-tier: record`, escalates a stuck task's implementer one profile up, once.

**Architecture:** Prose-only change to the skill payload plus pins. `plugin/skills/build/dispatch.md`'s **subagent** paragraph calls the #5996 CLI once per record build and forwards its `profile`; a new escalation instruction (gated on the CLI's `rule`) is folded into the text `/build` hands `/superpowers:subagent-driven-development`. Satellite docs stop naming the `size:`-derived mapping, and the `implementer-tier` policy key loses its `Not yet used` marker because this record wires its first consumer.

**Tech Stack:** Markdown skill files, Node 18+ `node --test` conformance suites, `plugin/bin/implementer-tier.js` (read only).

**Spec:** `.claude-tweaks/pipelines/2026-11-23T115413-record-5999/work/5999-spec.md` (record #5999; resumed 2026-11-23 — the 2026-11-22 run merged only its bookkeeping, no implementation)

Scope keywords: size:`-derived, corresponding model profile, size-based profile selection, Not yet used. Picks an implementer, no build calls it yet, No build calls the CLI yet

## Global Constraints

- Every bin path inside skill instruction text is spelled `${CLAUDE_PLUGIN_ROOT}/bin/...`; a skill reference inside an instruction uses the fully-qualified `/claude-tweaks:{skill}` form (SDD is `/superpowers:subagent-driven-development`).
- Read `docs/skill-authoring.md` before editing any `plugin/skills/**/*.md` file, and `.claude/skills/skill-prose-conformance-tests/SKILL.md` before writing the conformance test.
- `RAIL_BYTES` = 52,500 (`plugin/bin/lib/skill-audit/budgets.js`) is the only blocking size limit. Measured on the merge base `b8811c277a`: `dispatch.md` 45,636 B (6,864 B headroom); `materialize.md` 41,888 B; `build-options.md` 12,315 B; `handoff-template.md` 6,339 B; `plan-authoring-checks.md` **52,497 B (3 B headroom)** — its edit must add zero net bytes (`wc -c` after ≤ 52,497). Target net growth of `dispatch.md` ≤ 1,000 B (spec Gotcha); never trade a pinned literal below for bytes.
- Many open records edit `dispatch.md` (#5434, #5439, #5668): edit by anchor text, never by line number.
- Copy each prescribed `decisions.md` line verbatim, status word included — both are `AUTO` lines:
  - `AUTO {time} — implementer profile {profile} (rule: {rule}, size: {size}, key files: {count}). Reversibility: n/a.`
  - `AUTO {time} — task {k} implementer escalated {from} → {to} ({trigger}). Reversibility: n/a.` with `{trigger}` being `blocked` or `fix-round-failed`.
- The escalated dispatch is a fresh implementer, never a `SendMessage` resume (a resume keeps the first agent's model).
- Spec Decisions (binding): **Q1 Reading A** — after this record's one escalation, SDD's own fix-loop schedule (rounds 1-3 resume, round-4 fresh agent one profile up) runs unchanged; add no instruction overriding it. **Q2 Reading B** — escalation is off whenever the `profile=` token is given (the token sets every dispatch, "it always wins"); "steps up from that profile" applies to a `**Role:**` marker's profile only, never the token's.
- Under `implementer-tier: lane` (the default) behaviour is unchanged: the CLI's `lane` answer equals the old prose mapping, `effort:` fallback included.
- Spec-path correction (premise reversed, logged in `decisions.md`): the spec's `--spec-file "{run-dir}/work/{n}-spec.md"` is written in `dispatch.md` as `--spec-file "{spec-file}"`, `{spec-file}` being the materialized spec Common Step 1.5 passes as `--spec` — in worktree mode the worktree's copy, since `$PIPELINE_RUN_DIR` (the main checkout's run dir) holds no `work/` (verified: this run's main-checkout run dir has no `work/`).
- Governing-skill quotes (verbatim):
  - skill-prose-conformance-tests: "Read governed markdown through `tests/helpers/read-skill.js`'s `readText()`, never a private `fs.readFileSync(p, 'utf8')`."
  - skill-prose-conformance-tests: "Prove each assertion on a mutated copy of the live text instead: delete or alter only the pinned clause, then assert the shared assertion helper throws **with that assertion's own message** — `assert.throws(() => assertBlock(mutated), { message }, …)` — preceded by `assert.notEqual(mutated, original)` so a replace that matched nothing cannot pass as a control."
  - skill-prose-conformance-tests: "Write the assertion as a predicate that returns the facts whose pattern no longer matches (`missingFactsOf(patterns)`), and assert it returns `[]` on the live region. Then, per pattern, strip only that pattern's match from the live text and assert the same predicate returns exactly `[fact]`. `tests/helpers/conformance-asserts.js` (`missingFactsOf`, `assertEachPatternGoesRed`) is the home of both"
  - skill-prose-conformance-tests: "When the assertion and the prose it pins are authored in the same change … copy the pinned literal out of the edit's own replacement text, never from memory of what that edit says."
  - skill-prose-conformance-tests: "**Retargeting existing pins: diff the assertion inventory, not the plan's prose anchor list.** … enumerate every assertion literal in the *replaced* tests and give each one an explicit verdict — moved, retargeted (naming the new literal), or retired (with its own stated reason)."
  - policy-key-addition rule 7: "A key that lands before its consumer opens its `summary` with `Not yet used. ` or `Not yet used; ` and joins `NOT_YET_USED` in `tests/resolve-policy-control-mode.test.js`. That file pins both directions: every listed key carries the marker, and no unlisted key does. The record that wires a key's first consumer drops the marker and the list entry in the same commit."
  - prose-code-twin-pin: none apply — this change removes `dispatch.md`'s and `materialize.md`'s prose copies of the `lane` table instead of adding one.

The public-contract risk proof sits in Task 3 Step 4 (the step that re-runs the reader grep).

Check B scope sweep: `docs/superpowers/plans/2026-11-21-implementer-tier.md` (#5996) and `docs/superpowers/plans/2026-11-22-driver-implementer-relaunch.md` (#5997) match the `Not yet used. Picks an implementer` / `no build calls it yet` keywords — both are other records' historical plans, append-only history: no change.

## Review Focus

1. A pre-rename header carrying only `effort: high` must still dispatch on Capable under `lane` — the prose fallback is deleted, so only the CLI carries it (Task 1 test `AC7.3`).
2. A `transcription`-marked (Fast) task in a Standard build escalates to Standard, not Capable — the step-up base is the task's own profile, not the build's (Task 1 test `AC5.2`, both the prose clause and the CLI's `--from fast` answer).
3. A context handoff mid-build must not re-arm escalation — the once-per-task check reads `decisions.md`, not conversation memory (Task 1 test `AC5.1`).
4. The initial task review asking for a fix is not a trigger; only the first fix round's failed re-review is (Task 1 test `AC4.3`).
5. A missing spec file must stop the build, never silently fall back to a mapping (Task 1 test `AC7.1`).

## Spec coverage map

| AC clause | Covered by |
|---|---|
| AC1.1 (record, `size: high` → Standard) | Task 1 test `AC1.1` (CLI `--rule record` answer) + `AC9.1` (dispatch.md forwards the CLI's profile) |
| AC1.2 (unset → Capable) | Task 1 test `AC1.2` |
| AC2.1 / AC2.2 | Task 1 tests `AC2.1`, `AC2.2` |
| AC3.1 / AC3.2 | Task 1 test `AC3.1 AC3.2` (precedence clause in dispatch.md; marker mapping pinned by `plan-task-markers-conformance.test.js`) |
| AC4.1 / AC4.2 / AC4.3 | Task 1 tests `AC4.1`, `AC4.2`, `AC4.3` (instruction pinned; run-level proof is a real run's `decisions.md`, spec Gotcha) |
| AC5.1 / AC5.2 / AC5.3 | Task 1 tests `AC5.1`, `AC5.2`, `AC5.3` |
| AC6.1 | Task 1 test `AC6.1` |
| AC7.1 / AC7.2 / AC7.3 | Task 1 tests `AC7.1`, `AC7.2`, `AC7.3` |
| AC8.1 | Task 1 test `AC8.1` + Task 1 Step 6's grep (baseline match recorded below) |
| AC8.2 | Task 2 test `AC8.2` |
| AC9.1 | Task 1 test `AC9.1` (message-matched go-red control removing the CLI call) |

AC8.1 absence-grep control (per plan-authoring-checks' Absence-grep control check): `git grep -n -c -F "low\` → Fast, \`medium\` → Standard, \`high\` → Capable" -- plugin/skills/build/dispatch.md` run at base `b8811c277a` prints `plugin/skills/build/dispatch.md:1` — the search matches its own target. No exclusion pathspec needed: it is scoped to one named path outside `.claude-tweaks/`.

---

### Task 1: dispatch.md calls the CLI and carries the escalation instruction

**Role:** judgment
**Review risk:** high

**Files:**
- Modify: `plugin/skills/build/dispatch.md` — the **subagent** paragraph's opening (anchor: from `**subagent** (default): Check the materialized header's` through `with no profile override.`), the `**\`profile=<fast|standard|capable|frontier>\` token:**` sentence (anchor: `it always wins over the \`size:\`-derived profile`), and the Per-task tier forwarding parenthesis (anchor: `an untagged task keeps today's \`size:\`-derived mapping above`)
- Create: `tests/build-implementer-tier-conformance.test.js`
- Modify: `tests/plan-task-markers-conformance.test.js:76` (retarget)
- Modify: `tests/dispatch-no-stash-conformance.test.js:219-238` (retarget AC9.1)

**Interfaces:**
- Consumes: `plugin/bin/implementer-tier.js` — `--spec-file <path> [--rule lane|record] [--run <dir>] [--from <profile>]`, prints `{"profile","stepUp","rule","size","keyFileCount"}`; `tests/helpers/run-cli.js`'s `runCliSync(cli, args, {env, cwd})` → `{code, stdout, stderr}`; `tests/helpers/conformance-asserts.js`'s `missingFactsOf`, `assertEachPatternGoesRed`; `tests/helpers/read-skill.js`'s `readText`.
- Produces: `tests/build-implementer-tier-conformance.test.js` exporting nothing; Task 2 appends one test to it. Its top defines `const DISPATCH = readText(<dispatch.md>)` and `const ROOT`.

- [ ] **Step 1: Write the failing conformance test** `tests/build-implementer-tier-conformance.test.js`

  Structure: one `PATTERNS` list of `[regex, fact]` pairs (non-global, each matching exactly once in `DISPATCH`), `const missing = missingFactsOf(PATTERNS)`, a positive test asserting `missing(DISPATCH)` deep-equals `[]`, and a control test calling `assertEachPatternGoesRed(DISPATCH, PATTERNS, missing)`. Name each fact with its AC id. Facts (copy the literals from Step 3's replacement text, not from this list, if they diverge):

  | Fact | Pattern must match |
  |---|---|
  | `AC9.1: names the CLI call` | `` node "${CLAUDE_PLUGIN_ROOT}/bin/implementer-tier.js" --spec-file `` |
  | `AC6.1: one implementer profile line` | the verbatim profile line (Global Constraints) |
  | `AC7.1: non-zero exit stops before the first dispatch` | `non-zero exit` … `stops the build before the first dispatch` … `CLI's message` |
  | `AC7.2: design-doc build runs no CLI` | `design-doc build runs no CLI` |
  | `AC4.1: BLOCKED trigger` | `` `STATUS: BLOCKED` `` |
  | `AC4.2: failed first fix-round re-review trigger` | `re-review of the task's first fix round fails` |
  | `AC4.3: initial review is not a trigger` | `initial task review asking for a fix` … `not triggers` |
  | `fresh dispatch, never SendMessage` | `fresh implementer, never a \`SendMessage\` resume` |
  | `AC5.2: step-up from the task's own profile` | `--from {task's profile}` |
  | `AC5.1: once-per-task check reads decisions.md` | `` `task {k} implementer escalated` `` and `decisions.md` in the same sentence |
  | `AC5.3: escalation gated on rule: record` | `` Only when the CLI printed `rule: record` `` |
  | `AC3.2: no escalation under the profile= token` | `` and no `profile=` token was given `` |
  | `escalation line` | the verbatim escalation line (Global Constraints) |
  | `AC3.1 AC3.2: precedence` | `` precedence is `profile=` token, then marker, then the CLI's profile `` |
  | `AC8.1: no prose size mapping` | negative fact: implement as a pattern-free check in its own test — `assert.ok(!DISPATCH.includes('`low` → Fast, `medium` → Standard, `high` → Capable'))` plus a go-red control that appends that literal to a copy and asserts the same check function throws with its own message |

  The `AC9.1` fact's control (from `assertEachPatternGoesRed`) is the spec's "goes red when the CLI call is removed". Add one extra explicit test `AC9.1: removing the CLI call turns the suite red` that replaces the CLI-call literal in a copy of `DISPATCH`, asserts `notEqual`, and asserts `missing(copy)` deep-equals `['AC9.1: names the CLI call']`.

  CLI-answer block (same file, `runCliSync` against `plugin/bin/implementer-tier.js` with a tmp spec built like `tests/bin-lib/model-profiles/implementer-tier-cli.test.js`'s `spec()` helper — copy that helper; `env` = `{ PATH, SystemRoot? }` as that file's `ENV`; tmp dirs removed in `afterEach`):
  - `AC1.1: under record a size: high spec gets standard` — `--rule record`, header `size: high\n`, 3 Key Files → `profile === 'standard'`.
  - `AC1.2: under lane a size: high spec gets capable` — `--rule lane` → `'capable'`.
  - `AC2.1: under record size: low with two Key Files gets fast` → `'fast'`.
  - `AC2.2: under record size: low with three Key Files gets standard` → `'standard'`.
  - `AC5.2: --from fast steps up to standard, not capable` — `--rule record --from fast` → `stepUp === 'standard'`.
  - `AC7.3: an effort: high header under lane gets capable` — header `effort: high\n` → `'capable'`.

- [ ] **Step 2: Run it to verify it fails**

  Run: `node --test tests/build-implementer-tier-conformance.test.js`
  Expected: FAIL — the `dispatch.md` facts are missing (the CLI-answer block passes already; that is expected, it pins #5996's answers this build now depends on).

- [ ] **Step 3: Rewrite the subagent paragraph's opening in `plugin/skills/build/dispatch.md`**

  Replace the anchored span (old text: `**subagent** (default): Check the materialized header's \`size:\` field … invoke \`/superpowers:subagent-driven-development\` with no profile override.`) with text carrying, in this order, every fact below. Keep the existing `No floor raises git-running implementers to Standard (#4559): …re-propose it only with new evidence.` sentence byte-identical (pinned AC9.2 in `tests/dispatch-no-stash-conformance.test.js`). Reference draft (tighten freely; every pinned literal must survive):

  > **subagent** (default): **Implementer profile (#5999).** A record build (Spec Mode) runs `node "${CLAUDE_PLUGIN_ROOT}/bin/implementer-tier.js" --spec-file "{spec-file}"` once, adding `--run "$PIPELINE_RUN_DIR"` when it is set (`{spec-file}`: the materialized spec Common Step 1.5 passes as `--spec`). Invoke `/superpowers:subagent-driven-development` with an explicit instruction to default every per-task implementer dispatch in this spec to its `profile`, overriding that skill's own per-task complexity heuristic for this spec's tasks; a `null` profile means no override. A non-zero exit, a missing spec file included, stops the build before the first dispatch with the CLI's message — never a fallback mapping. A design-doc build runs no CLI and gets no override. Log once per record build, via `log-decision.js --status AUTO --section "/build"`: `AUTO {time} — implementer profile {profile} (rule: {rule}, size: {size}, key files: {count}). Reversibility: n/a.` No floor raises git-running implementers to Standard (#4559): … (unchanged). **One escalation per task (#5999).** Only when the CLI printed `rule: record` and no `profile=` token was given, in the same invocation instruction, also direct it that a task's next implementer dispatch is a fresh implementer, never a `SendMessage` resume (a resume keeps the first agent's model), one profile up, on exactly two triggers: its implementer replies `STATUS: BLOCKED`, or the re-review of the task's first fix round fails. An initial task review asking for a fix, `NEEDS_CONTEXT` and `DONE_WITH_CONCERNS` are not triggers. The profile is the same CLI call's `stepUp` with `--from {task's profile}` (the `**Role:**` marker's profile when one set the task's), resolved through `resolve-profile.js` as every dispatch is; its brief carries the task text, the review findings or `BLOCKED` reason, and the task's current diff. Once per task: a task whose `task {k} implementer escalated` line is already in `decisions.md` (no run dir: SDD's `progress.md`), so the count survives a context handoff, a `null` `stepUp`, or a step-up resolving to the same model gets SDD's own handling, unchanged. Log each the same way: `AUTO {time} — task {k} implementer escalated {from} → {to} ({trigger}). Reversibility: n/a.`, `{trigger}` being `blocked` or `fix-round-failed`. With no run dir, the Step 7 handoff lists both lines.

- [ ] **Step 4: Re-point the two precedence mentions in the same file**

  - `it always wins over the \`size:\`-derived profile (or the no-override default)` → `it always wins over the CLI's profile (or the no-override default)`.
  - `(an untagged task keeps today's \`size:\`-derived mapping above; … regardless of marker or \`size:\` — precedence is \`profile=\` token, then marker, then \`size:\`)` → `(an untagged task keeps the CLI's profile above; … regardless of marker or CLI profile — precedence is \`profile=\` token, then marker, then the CLI's profile)`. The marker mapping (`implementer — \`transcription\` → Fast, \`integration\` → Standard, \`judgment\` → Capable`) and the Frontier guard paragraph stay byte-identical.

- [ ] **Step 5: Retarget the two existing pins** (assertion inventory, each with its verdict)

  - `tests/plan-task-markers-conformance.test.js:76` `/default every per-task implementer dispatch in this spec to the corresponding model profile — \`low\` → Fast, …/` — **retargeted** to `/default every per-task implementer dispatch in this spec to its `profile`/` (copy the exact literal from Step 3's final text). Its four sibling asserts in that test are unchanged.
  - `tests/dispatch-no-stash-conformance.test.js` AC9.1 claim `/\`low\` → Fast, \`medium\` → Standard, \`high\` → Capable/` and its mutation row — **retargeted**: the claim becomes the CLI-call literal `` node "${CLAUDE_PLUGIN_ROOT}/bin/implementer-tier.js" --spec-file `` (the `low` → Fast decision now lives in the CLI's `lane` table, pinned by `tests/bin-lib/model-profiles/implementer-tier-cli.test.js` AC6.2); the mutation row's `from` is that literal (occurs exactly once) and `to` is `''`. Rename the test to `'AC9.1/AC9.2: build/dispatch.md takes the profile from implementer-tier.js and records the no-profile-floor decision'`. AC9.2 row unchanged.

- [ ] **Step 6: Run the tests and the AC8 grep**

  Run: `node --test tests/build-implementer-tier-conformance.test.js tests/plan-task-markers-conformance.test.js tests/dispatch-no-stash-conformance.test.js`
  Expected: PASS, 0 failures.
  Run: `git grep -n -F "low\` → Fast, \`medium\` → Standard, \`high\` → Capable" -- plugin/skills/build/dispatch.md`
  Expected: no output, exit 1 (baseline matched 1 line — see the AC8.1 control above).
  Run: `wc -c plugin/skills/build/dispatch.md` — Expected: < 52,500; report net growth vs 45,430.
  Also run the affected set per the dispatch instruction (`verify.js --scope … --local --no-stamp`).

- [ ] **Step 7: Commit**

  ```bash
  git add plugin/skills/build/dispatch.md tests/build-implementer-tier-conformance.test.js tests/plan-task-markers-conformance.test.js tests/dispatch-no-stash-conformance.test.js
  git commit -m "Take the build's implementer profile from implementer-tier.js and escalate once — refs #5999"
  ```

### Task 2: Satellite docs name the CLI's profile

**Role:** integration

**Files:**
- Modify: `plugin/skills/flow/materialize.md:87` (`size` reader-table row)
- Modify: `plugin/skills/build/build-options.md:47` (`profile=` row)
- Modify: `plugin/skills/build/plan-authoring-checks.md:99` (Per-task markers paragraph, in place)
- Modify: `plugin/skills/build/handoff-template.md` (standalone lines)
- Modify: `tests/build-implementer-tier-conformance.test.js` (one appended test)

**Interfaces:**
- Consumes: Task 1's test file (`ROOT`, `readText`, `missingFactsOf`, `assertEachPatternGoesRed` already imported).
- Produces: nothing later tasks use.

- [ ] **Step 1: Append the failing test** `AC8.2: materialize.md's size row names implementer-tier.js, not the prose mapping`

  Slice the row with `lineStartingWith(text, '| \`size\` |')` (assert the row is non-empty first). Facts: `AC8.2: names the CLI` → `/bin\/implementer-tier\.js/` in the row; `AC8.2: no prose mapping` → a negative check that the row does not contain `` `low`→Fast `` — each with a message-matched go-red control (mutate the row copy: strip the CLI name; insert the old literal).

- [ ] **Step 2: Run it to verify it fails**

  Run: `node --test tests/build-implementer-tier-conformance.test.js`
  Expected: FAIL on `AC8.2` only.

- [ ] **Step 3: Edit the four files, one sentence each**

  - `materialize.md` `size` row: replace `` `/build` size-based profile selection — caps at Capable (`low`→Fast / `medium`→Standard / `high`→Capable, `skills/build/SKILL.md` Common Step 2). `` with `` `/build`'s implementer profile — `bin/implementer-tier.js` reads it with the `### Key Files` count (`build/dispatch.md`, read from Common Step 2) and caps at Capable. `` Rest of the row unchanged.
  - `build-options.md:47`: `Overrides the \`size:\`-derived per-task implementer profile` → `Overrides the per-task implementer profile \`bin/implementer-tier.js\` picks`.
  - `plan-authoring-checks.md:99`, in place, zero net bytes: `An unmarked task keeps the \`size:\`-derived mapping (` → `An unmarked task keeps the CLI's profile (` and `A marker overrides the header's \`size:\` mapping for its own task` → `A marker overrides the CLI's profile for its own task`. Measure `wc -c` ≤ 52,497.
  - `handoff-template.md`: add after the `### Plan review amendments (standalone build, if any)` block, before `### Manual Steps Required`:

    ```markdown
    ### Implementer profile (standalone build)
    - implementer profile {profile} (rule: {rule}, size: {size}, key files: {count})
    - task {k} implementer escalated {from} → {to} ({trigger})
    (or omit this section: a run directory exists — `decisions.md` carries both as `AUTO` entries — or the build was design mode; omit the escalation line when no task escalated.)
    ```

- [ ] **Step 4: Run the tests**

  Run: `node --test tests/build-implementer-tier-conformance.test.js`
  Expected: PASS. Then grep `tests/` for each file basename changed here (`git grep -n -l -e materialize.md -e build-options.md -e plan-authoring-checks.md -e handoff-template.md -- tests`) and run every hit; expected PASS. Run `wc -c` on all four files; all < 52,500 and `plan-authoring-checks.md` ≤ 52,497.

- [ ] **Step 5: Commit**

  ```bash
  git add plugin/skills/flow/materialize.md plugin/skills/build/build-options.md plugin/skills/build/plan-authoring-checks.md plugin/skills/build/handoff-template.md tests/build-implementer-tier-conformance.test.js
  git commit -m "Name the implementer-tier CLI's profile in /build's satellite docs — refs #5999"
  ```

### Task 3: Drop the implementer-tier key's Not-yet-used marker

**Role:** transcription

**Files:**
- Modify: `plugin/bin/lib/policy-schema.js:284-285`
- Modify: `tests/resolve-policy-control-mode.test.js:313`
- Modify: `plugin/skills/_shared/policy-schema-model-profiles.md:15`
- Modify: `docs/plugin-structure.md:405`

**Interfaces:**
- Consumes: Task 1's `dispatch.md` (the first consumer).
- Produces: nothing.

- [ ] **Step 1: Remove `'implementer-tier'` from `NOT_YET_USED`** in `tests/resolve-policy-control-mode.test.js:313`.

- [ ] **Step 2: Run it to verify it fails**

  Run: `node --test tests/resolve-policy-control-mode.test.js`
  Expected: FAIL in `no key outside NOT_YET_USED opens its summary with "Not yet used" (#4816)` (implementer-tier still carries the marker).

- [ ] **Step 3: Edit the schema row, its comment and the two doc rows**

  - `policy-schema.js:285` summary: `"Not yet used. Picks an implementer's work profile …"` → `"Picks an implementer's work profile from the record's size and Key File count, or from size alone as today."`
  - `policy-schema.js:284` comment: replace `No build calls the CLI yet; #5997 (driver) and #5999 (standard lane) wire the first consumers and drop the \`Not yet used\` marker and the NOT_YET_USED entry.` with `First consumer: build/dispatch.md's subagent procedure (#5999); the driver's is #5997.`
  - `policy-schema-model-profiles.md:15`: `— no build calls it yet (#5997 driver, #5999 standard lane)` → `— called by \`/build\`'s subagent procedure (\`build/dispatch.md\`, #5999); the driver's call is #5997`.
  - `docs/plugin-structure.md:405`: `no build calls it yet (#5997, #5999)` → `called once per record build by \`/build\`'s \`dispatch.md\` (#5999; the driver, #5997)`.

- [ ] **Step 4: Run the tests and the reader grep**

  Run: `node --test tests/resolve-policy-control-mode.test.js tests/policy-schema-metadata.test.js tests/bin-lib/model-profiles/policy-keys-registration.test.js tests/policy-key-naming.test.js`
  Expected: PASS.
  Run: `git grep -n -i -e "no build calls" -e "Not yet used. Picks an implementer" -- plugin docs tests ':!docs/superpowers/plans' ':!docs/plans'` — Expected: no output.
  Run: `git grep -n -F -e "implementer escalated" -e "implementer profile" -- plugin tests tools` — Expected: hits only in prose/tests (dispatch.md, handoff-template.md, build-options.md, `_shared/policy-schema.md`, the new test), no parser under `plugin/bin`; paste the output into the commit message body for the PR.

  Proof(public-contract): the two new `decisions.md` line shapes are `AUTO` lines already covered by `_shared/auto-decision-log.md`'s entry schema, and no reader parses them — `git grep -n -F -e "implementer escalated" -e "implementer profile" -- plugin tests tools` at base `b8811c277a` hits only prose (`_shared/policy-schema.md:186`, `build-options.md:47`), no parser, and this step re-runs it after the change. The `lane` default keeps every build's profiles: `tests/bin-lib/model-profiles/implementer-tier-cli.test.js` AC6.2/AC6.3/AC11.1 pin `lane` = `low`→fast, `high`→capable and the `effort:` fallback, and Task 1's test pins that `dispatch.md` forwards that answer.

- [ ] **Step 5: Commit**

  ```bash
  git add plugin/bin/lib/policy-schema.js tests/resolve-policy-control-mode.test.js plugin/skills/_shared/policy-schema-model-profiles.md docs/plugin-structure.md
  git commit -m "Drop implementer-tier's Not-yet-used marker now /build consumes it — refs #5999"
  ```
