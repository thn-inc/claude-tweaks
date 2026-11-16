# Reproduction Lines In The CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/claude-tweaks:review`'s seven per-finding reproduction line forms move from skill prose into one pure composer, written to `decisions.md` by `review-coordination.js categorise-reproduction --run` and a new `log-reproduction-judgment` verb.

**Architecture:** A pure module `plugin/bin/lib/reproduction-log.js` returns `{ status, step, text, reversibility }` entries (the fields `formatEntry` takes) for each form, plus `pairEntries(result, opts)` that turns a `categoriseReproduction` result into entries. `review-coordination.js` gains `--lens/--run/--only/--hold` on `categorise-reproduction` and a `log-reproduction-judgment` verb, both appending through `appendEntries` under `## /review` with one `deps.now()`. The prose bullets in `step3-lens-dispatch.md` name the calls instead of carrying templates, and every test that read a template from prose reads it from the composer.

**Tech Stack:** Node 18+ CommonJS, `node --test`, no new dependencies.

**Spec:** `.claude-tweaks/pipelines/2026-11-16T155301-record-5595/work/5595-spec.md` (record #5595)

**Base commit:** `b1a0f20ef1` (after #5556, #5541, #4359). At this base the seven templates sit on `plugin/skills/review/step3-lens-dispatch.md` lines 103-108 (not 100-105 as the spec's 026e203f3 snapshot says), and the file is 49,953 bytes.

Scope keywords: `Reproduction: lens`, `categorise-reproduction`, `reproduced. Confirmed`, `not reproduced. Staged`, `share a location but not substance`, `refuted by ground-truth check`, `re-confirmed by executed run`

## Global Constraints

- Each composed line formatted by `formatEntry` is byte-identical to the base commit's template with its placeholders filled. From this change on, the composer is the only home of the forms (AC1).
- `categorise-reproduction <A> <B>` with no `--run` keeps its output, exit codes and argument check byte-identical (AC2).
- `reversibility` is `high` for all seven forms; `step` is `Reproduction` for all seven.
- `--run` requires `--only`; the CLI does not de-duplicate; one call writes all its lines or none (one `appendEntries` batch).
- The three judgment kinds (`absence-refuted`, `vacuity-downgraded`, `vacuity-reconfirmed`) are the complete set; any other kind exits 2 with one line naming the kind and the three accepted ones.
- `command`, `output`, `symbol` reach the judgment verb only in a file, never on the command line.
- Do not add text to `plugin/skills/review/code-mode-steps.md` (52,358 bytes, 142 under the rail). The partner-died line in `step3-tier-variants.md` and the two `Single-read (low tier)` lines stay hand-written.
- `RAIL_BYTES` is 52,500 (`plugin/bin/lib/skill-audit/budgets.js`). `step3-lens-dispatch.md` shrinks (≥1,500 bytes, AC10); `step3-cross-lens-corroboration.md` (5,172 B) and `release/SKILL.md` (50,161 B, 2,339 headroom) may grow by at most one sentence each.
- Scope and edit discipline (verbatim): "Commit tests only where the task asks for them or the repo already keeps tests for this kind of change, sized like the neighboring test files; scratch checks stay scratch. Touch only what the task requires — a pre-existing bug you notice is a follow-up to report, not a fix to fold in, unless the task cannot work without it. Don't reformat or "improve" adjacent code; edit in place rather than rewrite when the result is the same."
- Governing project skills, quoted verbatim:
  - `.claude/skills/gh-api-module-pattern/cli-wrapper-contract.md`: "**A CLI that reports a decision as data logs that entry itself; the skill hand-logs it only when the CLI reports the append failed.** … a new self-logging CLI joins it in the same change: `tests/phase-exit-call-sites-conformance.test.js` pins that list equal to its `SELF_LOGGING_SOURCES` map and checks that each CLI's comment-stripped source requires `log-decision/append` and calls `formatEntry(`. Report a failed append the way the siblings do, as `logged: false`, `logFailed: true` or a `logFailures` element in the envelope plus one stderr line naming the `decisions.md` append, never through the exit code."
  - Same file: "**Adding a verb to an existing multi-verb CLI needs the same sweep: every list of the CLI's verbs, and every list of the input files they read, must gain the new entry.** … Grep for an existing sibling instead: `git grep -n -F 'detect-overlap' -- plugin docs .claude/skills` finds every list of the verbs".
  - Same file: "**A value-taking flag given as the last argv element reads `undefined`, and a `!== null` presence check treats that as supplied.** … pin both the trailing bare flag and the empty-string value with their own test cases."
  - Same file: "An existence or type check goes through `plugin/bin/lib/path-guard`'s `lstatType`, never a bare `fs.existsSync` … A file the CLI is about to read is read directly with `ENOENT`/`ENOTDIR` caught as "absent", never checked for existence first".
  - `.claude/skills/prose-code-twin-pin/SKILL.md`: "Skipping the composer check because the prose side is one quoted line beside the command that writes it … call the exported composer with the invocation's own placeholders … and `assert.strictEqual` the two." (applies to `release/SKILL.md:196`'s quoted form 1).
  - `.claude/skills/windows-checkout-test-parity` (the cross-lens conformance test reads through a CRLF checkout): keep the existing `crlfCheckoutRead` case passing on whatever text the task leaves in `step3-lens-dispatch.md`.
  - `.claude/skills/skill-prose-conformance-tests`: every new prose pin gets a go-red control that runs the same assertion function against mutated text (factor the positive assertions into one function both tests call).

## Review Focus

1. A finding `path` holding `"`, `:` or spaces (e.g. `docs/a b.md`): composed lines must still parse in `classifyPairLine` and `findingKey`; Task 1's reader table includes a spaced path.
2. A coincidence pair where the hold names one side by a copy whose `text` was re-trimmed by the session: matching is exact on `source/path/line/text`, so a mismatch exits 2 rather than silently writing both sides; Task 2 pins the exit-2 case.
3. A `--run` call made twice for the same pair (resumed review): the CLI writes twice by design; Task 2 pins that the second call appends again (no de-dup), so nobody "fixes" it into a silent drop.
4. An unconfirmed finding with no numeric line: written as form 3 with `{path}` alone and listed under `unlocated`; Task 2 pins it.
5. A judgment file whose `output` is very long or holds `→`: written verbatim on one line; a line break in any field exits 2 (Task 3).

---

### Task 1: The composer

**Role:** integration

**Files:**
- Create: `plugin/bin/lib/reproduction-log.js`
- Test: `tests/bin-lib/reproduction-log.test.js`
- Read only (Waived — read by Step 1's reader table): `plugin/bin/lib/log-decision/aggregate-reproduction.js`, `plugin/bin/lib/console/finding-path.js`, `plugin/bin/lib/console/resolve.js`, `plugin/bin/lib/console/backfill.js`, `plugin/bin/lib/timing/pair-lines.js`

**Interfaces:**
- Produces (all pure, no I/O; every entry is `{ status, step: 'Reproduction', text, reversibility: 'high' }`):
  - `STEP = 'Reproduction'`, `JUDGMENT_KINDS = Object.freeze(['absence-refuted', 'vacuity-downgraded', 'vacuity-reconfirmed'])`
  - `location(path, line) -> string` — `${path}:${line}` when `line` is an integer, else `path`
  - `reproduced({ lens, path, line, severityContested })` → form 1, or form 2 when `severityContested === true`
  - `notReproduced({ lens, path, line })` → form 3
  - `coincidence({ lens, path, lineA, lineB })` → form 4
  - `absenceRefuted({ lens, path, symbol, command, foundAt: { path, line } })` → form 5
  - `vacuityDowngraded({ path, line })` → form 6 (prints `lens "3f"` literally, as the template does)
  - `vacuityReconfirmed({ path, line, command, output })` → form 7 (prints `lens "3f"` literally)
  - `pairEntries({ confirmed, unconfirmed }, { lens, only, hold = [] }) -> { entries, unlocated }` — `only: 'confirmed'` maps each confirmed finding in order to `reproduced`. `only: 'unconfirmed'` walks `unconfirmed` in order: a finding equal (by `holdKey`) to a hold entry gets no line; a coincidence (an entry with `nearLocation` whose partner is the next entry and points back) with neither side held is one `coincidence` entry (A side's line as `lineA`); with one side held the other gets `notReproduced`; any other entry gets `notReproduced`. `unlocated` is every `unconfirmed` entry with no integer `line` (in both modes). Throws `TypeError` on an `only` other than the two.
  - `holdKey(finding) -> string` — JSON of `[source, path, line ?? null, text ?? null]`, the match key the CLI uses.

Texts (each ends with `.`; `formatEntry` appends ` Reversibility: high.`):
1. `lens "{lens}" finding {loc} reproduced. Confirmed.` — AUTO
2. `lens "{lens}" finding {loc} reproduced, severity contested (took the lower of the two). Confirmed.` — AUTO
3. `lens "{lens}" finding {loc} not reproduced. Staged to Review Console as low-confidence.` — STAGED
4. `lens "{lens}" findings {path}:{lineA} / {path}:{lineB} share a location but not substance; both staged unconfirmed.` — STAGED
5. `lens "{lens}" absence claim {path}:{symbol} refuted by ground-truth check ({command} found it at {foundAt.path}:{foundAt.line}). Not staged.` — AUTO
6. `lens "3f" vacuity finding {path}:{line} downgraded to unconfirmed — reproduction agreement overridden, no execution evidence. Staged to Review Console as low-confidence.` — STAGED
7. `lens "3f" vacuity finding {path}:{line} re-confirmed by executed run: {command} → {output}. Confirmed.` — AUTO

Each text with `Reproduction: ` prefixed is the base template's action after `{STATUS} {HH:MM:SS} — `.

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/reproduction-log.test.js`, fixed clock `new Date(2026, 10, 16, 10, 0, 0)`:
  - `AC1.1 form 1` … `AC1.1 form 7`: one test per form; `formatEntry({ ...entry, now })` `strictEqual`s a literal expected string written out in the test, e.g. `- AUTO 10:00:00 — Reproduction: lens "3a" finding plugin/x.js:12 reproduced. Confirmed. Reversibility: high.` (copy each from the base templates at lines 103-108 with `{lens}=3a` (`3f` for 6/7), `{path}=plugin/x.js`, `{line}=12`, `{lineA}=12`, `{lineB}=14`, `{symbol}=foo`, `{command}=grep -n foo plugin/x.js`, `{foundAt}=plugin/x.js:40`, `{output}=1 failing`).
  - AC1.2 (the expected strings are copied from the base commit's templates) is proven by a scratch check, not a committed test, since Task 4 removes the templates: extract the seven backticked templates from `git show b1a0f20ef1:plugin/skills/review/step3-lens-dispatch.md`, fill them with the values above, and compare each to the composer's `formatEntry` line with `HH:MM:SS` swapped for `10:00:00`; record it per Step 4.
  - `pairEntries: confirmed order and severity`: a result with one plain and one `severityContested` confirmed gives forms 1, 2 in order.
  - `AC4.1/AC4.2/AC4.3 holds and coincidence`: from a real `categoriseReproduction` output (import it from `plugin/bin/lib/coordination.js`, fixture: A has `x.js:10` text "missing null check on input" and `x.js:30` "unused import", B has `x.js:11` "missing null check on input" and `x.js:31` "loop is quadratic in n" — gives one confirmed, one coincidence pair at 30/31), with `hold: []` → one form 4 line `findings x.js:30 / x.js:31`; holding the A side → one form 3 for `x.js:31`; holding both → no entries. Also a plain single-reviewer finding gives form 3.
  - `unlocated`: an unconfirmed finding with `path: 'x.js'` and no line → form 3 text `finding x.js not reproduced.` and listed in `unlocated`.
  - `AC7.1 every STAGED form passes aggregateReproductionProblem`: forms 3, 4, 6 each give `aggregateReproductionProblem({ status, step, text })` → `null`.
  - `AC7.3 reader table`: one table over the seven forms, with paths `plugin/x.js` and `docs/a b.md`, comparing the composed line to the hand-written line of the same form (the AC1 literal strings) through each reader: `classifyPairLine` (`plugin/bin/lib/timing/pair-lines.js`; same `form`, and each form id appears exactly once across the table), `parseCoincidence` and the finding-key reader in `plugin/bin/lib/console/finding-path.js` (`readsLocation`/`FINDING_LOCATION`, whatever `resolve.js` keys on), and `plugin/bin/lib/console/backfill.js`'s `analyseLine`. Each reader's result for the composed line `deepStrictEqual`s its result for the hand-written line. Form 5 produces no console item.
- [ ] **Step 2: Run** `node --test tests/bin-lib/reproduction-log.test.js` — Expected: FAIL (`Cannot find module '../../../plugin/bin/lib/reproduction-log'`).
- [ ] **Step 3: Implement** `plugin/bin/lib/reproduction-log.js` with the interface above; header comment names it the one home of the seven forms and lists the readers.
- [ ] **Step 4: Run** the test — Expected: PASS. Then the real-input probe: pick one archived `.claude-tweaks/pipelines/**/decisions.md` (main checkout) holding a `reproduced. Confirmed.` line and one `not reproduced.` line; for each, parse lens/path/line with `classifyPairLine`, recompose with the composer and `formatEntry` using that line's own clock, and confirm the two strings are equal. Record the archive path, the two lines and the result: write the output to `$PIPELINE_RUN_DIR/evidence/reproduction-log-probe.txt` (plain Bash redirect, absolute path, `mkdir -p` the dir first) and log one `log-decision.js --section "/build" --status AUTO --step "AC evidence" --text-file {file}` entry naming AC1 and the evidence path. Do the same for the Step 1 scratch base-template check (`evidence/reproduction-log-base-templates.txt`).
- [ ] **Step 5: Commit** — `git add plugin/bin/lib/reproduction-log.js tests/bin-lib/reproduction-log.test.js` then `git commit -m "Add the reproduction-line composer — seven forms in one module, refs #5595"`.

### Task 2: `categorise-reproduction --run`

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/review-coordination.js` (header comment, `USAGE`, the `categorise-reproduction` branch, `realDeps.appendDecisions = appendEntries`)
- Modify: `plugin/bin/lib/log-decision/append.js` (only if `appendEntries` is not already exported for this use — it is; Waived otherwise: read only)
- Modify: `plugin/skills/_shared/auto-decision-log.md` ("CLIs that log their own entries" roster) and `tests/phase-exit-call-sites-conformance.test.js`'s `SELF_LOGGING_SOURCES` only if that roster lists verbs per CLI (it lists `review-coordination.js resolve-tiebreak`; add `review-coordination.js categorise-reproduction --run` and `log-reproduction-judgment` the same way, in this task and Task 3)
- Test: `tests/bin-lib/review-coordination/cli.test.js`

**Interfaces:**
- Consumes: Task 1's `pairEntries`, `location`, `holdKey`; `formatEntry`, `appendEntries` (`plugin/bin/lib/log-decision/append.js`); `FINDING_LENS_CLASS` (`plugin/bin/lib/console/finding-path.js`); existing `anchorRunDir(runDir, deps, 3)`, `readJson`, `at`.
- Produces: `categorise-reproduction <A.json> <B.json> --lens <lens> --run <dir> --only confirmed|unconfirmed [--hold <file>]`. Stdout (one JSON line): `{ confirmed, unconfirmed, entries, unlocated, logged }` — `entries` are the composed entries (`log-decision.js --entries` shape), `logged` `true` when appended (also `true` for an empty batch), `false` with one stderr line `review-coordination.js: could not append the decisions.md entries (...)` when `deps.appendDecisions` threw; exit 0 either way. `deps.appendDecisions({ runDir, items })` is the injected seam (default `appendEntries`); each item is `{ section: '/review', entry: formatEntry({ ...e, now }) }` with one `now = deps.now()` for the batch.

Validation order (all exit 2, nothing written, before the run dir is anchored): flags parse (`--lens`, `--run`, `--only`, `--hold` each need a non-blank value; a trailing bare flag or empty string is exit 2); exactly 2 positionals; `--only`/`--hold` without `--run`; `--run` without `--lens` or `--only`; `--only` not `confirmed|unconfirmed`; `--hold` with `--only confirmed`; lens not matching `^[${FINDING_LENS_CLASS}]+[^"\r\n]*$` (decision: the lens token class plus an optional suffix such as ` (Security)`, never a `"` or line break — state this reading in the PR body); inputs unreadable/not arrays; hold file unreadable, not JSON, not an array, or an entry matching zero or more than one unconfirmed finding by `holdKey`; any finding this call would write whose `path` holds `\r` or `\n`. Then `anchorRunDir(runDir, deps, 3)` (missing or unanchored → exit 3). Without `--run`, the branch is byte-for-byte today's.

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/review-coordination/cli.test.js`, through the file's existing in-process helper and an anchored temp run dir (copy the `resolve-tiebreak --run` tests' fixture shape in the same file):
  - `AC2.1`: existing `categorise-reproduction` tests untouched, plus one asserting `--run`-less output is byte-identical for the AC3 fixture.
  - `AC3.1/AC3.2/AC3.3`: fixture pair with one same-severity pair, one severity-contested pair, one single-reviewer finding, one coincidence; `--only confirmed` adds exactly two lines under `## /review` (forms 1, 2) and `--only unconfirmed` two more (form 3, form 4); each call's `entries` lists what it added, `logged: true`; `decisions.md` text equals the four `formatEntry` lines in that order.
  - `AC4.1`: an empty hold file writes the same lines as no `--hold`. `AC4.2`: one coincidence side held → the other side gets form 3, and its JSON entry keeps `nearLocation`. `AC4.3`: both held → no line for them.
  - `AC5.1`–`AC5.13`: one case per refusal listed in Validation order above (hold matching none; hold matching two; unreadable hold; malformed hold; `--run` without `--lens`; without `--only`; `--only` without `--run`; `--hold` without `--run`; `--hold` with `--only confirmed`; `--only bogus`; blank `--run`; blank `--lens`; lens `bad"lens`; finding path with `\n`), each exit 2 and `decisions.md` absent; plus trailing bare `--lens` and `--run ""`. `AC5.14`: a missing run dir exits 3; an unanchored one (a dir with a `.git` file, or outside `mainRoot`) exits 3.
  - `AC6.1`: `appendDecisions` stubbed to throw → stdout has the composed `entries`, `logged: false`, exactly one stderr line, exit 0.
  - Review Focus 3: the same `--only confirmed` call twice appends the two lines twice.
  - Review Focus 4: an unconfirmed finding with no line → form 3 `finding x.js not reproduced.` and listed in `unlocated`.
  - A relative `--hold` path resolves against the injected `cwd` (cli-wrapper contract).
  - `AC7.2`: the `decisions.md` the CLI wrote for the AC3 fixture, and a copy where the same four lines are written by hand (the AC1 literal strings), give `deepStrictEqual` results from `plugin/bin/lib/console/resolve.js`'s exported run-reading entry point (the one its own tests use for a `## /review` section).
- [ ] **Step 2: Run** `node --test tests/bin-lib/review-coordination/cli.test.js` — Expected: FAIL on the new cases (unknown flags rejected as positionals: "takes exactly 2 JSON file paths").
- [ ] **Step 3: Implement** the flag parsing and `--run` path in the `categorise-reproduction` branch (hand-written loop in the style of `resolve-tiebreak`'s), plus header comment and `USAGE` lines. Read files directly with ENOENT caught; no `fs.existsSync`.
- [ ] **Step 4: Run** the test file and `node --test tests/phase-exit-call-sites-conformance.test.js tests/bin-lib/cli-entry-conformance.test.js tests/path-guard-conformance.test.js` — Expected: PASS.
- [ ] **Step 5: Commit** — `git add` the modified files; `git commit -m "Write reproduction pair lines from categorise-reproduction --run — refs #5595"`.

### Task 3: `log-reproduction-judgment`

**Role:** integration

**Files:**
- Modify: `plugin/bin/review-coordination.js` (new verb, header, `USAGE`)
- Test: `tests/bin-lib/review-coordination/cli.test.js`

**Interfaces:**
- Consumes: Task 1's `absenceRefuted`, `vacuityDowngraded`, `vacuityReconfirmed`, `JUDGMENT_KINDS`; `classifyPairLine` (`plugin/bin/lib/timing/pair-lines.js`) to find form 1/2 lines; `normalizeSection`/`parseEntry` as needed from `append.js`.
- Produces: `log-reproduction-judgment <judgment.json> --lens <lens> --run <dir>` → one JSON line `{ entries: [entry], logged }`, exit 0 (logged false + one stderr line on append failure); exit 2 for: wrong positional count; missing/blank `--lens` or `--run` (and trailing bare flag); lens failing Task 2's lens rule; a `vacuity-*` kind with a `--lens` whose leading token is not `3f`; unreadable/non-object judgment; unknown `kind` (stderr: `review-coordination.js: unknown judgment kind "{kind}" — expected one of absence-refuted, vacuity-downgraded, vacuity-reconfirmed`); a missing or non-string field, a blank one, or one holding `\r`/`\n`; `line` not a whole number ≥ 1; `foundAt` not `{ path, line }` with such a `line`; `vacuity-downgraded` when `decisions.md`'s `## /review` section holds no form 1 or form 2 line (by `classifyPairLine`: form `reproduced` or `reproduced-severity-contested`) whose lens token is `3f` and whose `path`/`line` equal the judgment's (a missing `decisions.md` counts as none). Exit 3: run dir missing or unanchored (anchored before the decisions.md read).
- The verb formats what the session reports; it does not check that the command ran or that the output is real. Say so in the header comment.

- [ ] **Step 1: Write the failing tests**:
  - `AC9.1` absence-refuted, `AC9.1` vacuity-downgraded (after a form 1 line for `3f` at the same location), `AC9.1` vacuity-reconfirmed: each writes the expected `formatEntry` line (the Task 1 literals) under `## /review`.
  - `AC9.2`: unknown kind exits 2 with the one stderr line above (assert the exact text); a missing field exits 2; a field with `\n` exits 2.
  - `AC9.3`: `foundAt` as a string, `foundAt.line` 0, 1.5 and `"40"` each exit 2.
  - `AC8.4`: `vacuity-downgraded` with no prior form 1/2 line for that lens and location exits 2 and writes nothing; a prior form 1 for lens `3a` at the same location still exits 2.
  - `AC8.1/AC8.2/AC8.3`: a run dir where the CLI wrote form 1 (via `categorise-reproduction --run --only confirmed`, lens `3f`) then this verb wrote form 6: `console/resolve.js` lists it as an open low-confidence item; appending a tiebreak verdict line after it (compose it with `resolve-tiebreak --run` on a fixture finding and reply, as the existing tests do) settles it; a second form 6 line is a second item and that one verdict settles both.
  - Review Focus 5: an `output` holding `→` and 500 characters is written verbatim.
- [ ] **Step 2: Run** the test file — Expected: FAIL (`unknown command: log-reproduction-judgment`).
- [ ] **Step 3: Implement** the verb.
- [ ] **Step 4: Run** the test file plus `tests/phase-exit-call-sites-conformance.test.js` — Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -m "Add log-reproduction-judgment for the three judged reproduction lines — refs #5595"`.

### Task 4: Prose, pins and docs follow the composer

**Role:** judgment
**Review risk:** high

**Files:**
- Modify: `plugin/skills/review/step3-lens-dispatch.md` (lines 95-108: the call block and the six bullets)
- Modify: `plugin/skills/review/step3-cross-lens-corroboration.md` (step 4)
- Modify: `plugin/skills/release/SKILL.md:196`
- Modify: `docs/plugin-structure.md` (the `review-coordination.js` command line at ~387 and the `log-decision/` row at ~55)
- Modify: `tests/bin-lib/timing/pair-lines.test.js` (AC3.3 block, lines 330-388)
- Modify: `tests/multi-agent-coordination.test.js` (178, 231-234, 1248-1252)
- Modify: `tests/review-tiebreak-step-conformance.test.js` (1262-1263 `documentedTemplate` / `nearLocationLine`, and 89)
- Modify: `tests/review-absence-claim-ground-truth-conformance.test.js` (24-63)
- Modify: `tests/review-vacuity-evidence-conformance.test.js` (48-70)
- Modify: `tests/review-cross-lens-corroboration-conformance.test.js` (52, 78, 111-133, 183-187)
- Create: `tests/review-reproduction-call-conformance.test.js` (AC11)
- Modify: `plugin/bin/lib/timing/pair-lines.js` (header comment lines 1-9 only: the producer of the seven forms is `plugin/bin/lib/reproduction-log.js`; its `PAIR_FORMS[].template` strings stay byte-identical, they are now pinned against the composer)
- Modify: `docs/reference/step-yield.md:156` (the pair lines are composed by `reproduction-log.js`, written by `categorise-reproduction --run` and `log-reproduction-judgment`; `pair-lines.test.js` pins every form to the composer)
- Test: `tests/review-coverage-anchor-conformance.test.js` (run only: reads `step3-lens-dispatch.md`'s anchor notes at lines 81-83, which this task does not edit; it must stay green)
- Waived `docs/journeys/confirm-a-finding-beside-a-second-issue-on-one-line-2907.md`: lists the file in `files:` frontmatter only, quotes no template.
- Waived `docs/journeys/confirm-coverage-findings-across-reproduction-pairs-3049.md`: same.
- Waived `docs/journeys/confirm-findings-split-across-a-multi-line-statement-2955.md`: same.
- Waived `docs/journeys/confirm-paraphrased-findings-across-reproduction-pairs-3418.md`: same.
- Waived `docs/superpowers/specs/2026-11-15-process-efficiency-design.md`: history document, not edited.
- Waived `docs/superpowers/plans/2026-11-16-step-yield-5556.md`: history document, not edited.

**Interfaces:**
- Consumes: Task 1's composer; the CLI shapes of Tasks 2 and 3.

New prose (write it in the file's existing voice; keep every reader-must-do clause, cut the restated pairing rules the code decides — #4801's trim dropped a warning that way):
- The call block becomes `categorise-reproduction "{path-A}" "{path-B}" --lens "{lens}" --run "$PIPELINE_RUN_DIR" --only confirmed` first; when the printed `unconfirmed` is empty the pair is done; otherwise run the absence check (below), and at `medium` wait for `step3-cross-lens-corroboration.md`'s pass, then the same call with `--only unconfirmed`, adding `--hold "{path-H}"` (a JSON array of whole `unconfirmed` entries copied from the first call's output, written with `Write` to a `session-tmp-resolve.js` path) when the absence check refuted or corroboration promoted a finding. On `logged: false` repeat the same call once, then write the printed `entries` with `log-decision.js --entries`. A review resumed in a new session reads `## /review` for the pair's lines before it calls. Standalone (no run dir): call without `--run` and log nothing (today's behavior for a standalone review — state it the way the file does now, without a template).
- Bullet content kept: `confirmed` with `severityContested` → surface the flag in the routing entry; `unconfirmed` → Step 3.7; the absence-claim ground-truth check (its whole procedure, every mode, before the `--only unconfirmed` call; a refuted claim → `log-reproduction-judgment` with `kind: "absence-refuted"` and goes in the hold file); the lens 3f vacuity downgrade (procedure, then `log-reproduction-judgment` `vacuity-downgraded` after the `--only confirmed` call; re-confirm only by an executed run → `vacuity-reconfirmed`); the coincidence routing-row clause "same location as {source} finding at {path}:{line}, different substance"; forms 3 and 4 wait at `medium`.
- `step3-cross-lens-corroboration.md` step 4: the deferred lines are written by the `--only unconfirmed --hold` call, the hold naming every promoted finding; keep its coincidence rule (the CLI implements it: one side held → plain `not reproduced` for the other).
- `release/SKILL.md:196`: keep the quoted form-1 line, add that its home is `plugin/bin/lib/reproduction-log.js`'s `reproduced`.

- [ ] **Step 1: Moved-prose pin discovery.** Run `git grep -n -F -e 'reproduced. Confirmed' -e 'not reproduced' -e 'share a location but not substance' -e 'absence claim' -e 'refuted by ground-truth' -e 'vacuity finding' -e 'downgraded to unconfirmed' -e 're-confirmed by executed run' -e 'severity contested' -e 'Reproduction: lens' -- tests plugin ':!plugin/bin/lib/reproduction-log.js'` and, for each `plugin/` hit outside the edited files, grep `tests/` for that file's basename. Every test hit not in this task's Files list is added to it before editing. Record the hit list in the task's report.
- [ ] **Step 2: Write the failing AC11 test** `tests/review-reproduction-call-conformance.test.js`: one `reproductionProblems(text)` function returning a list of problems; positive test asserts `[]` on the live file: the call line names `--lens`, `--run` and `--only`; the absence-check sentence appears before the first `--only unconfirmed` mention; the text states forms 3 and 4 wait at `medium` (pin the sentence's distinctive words); plus `AC10.1`: none of the seven distinctive phrases of the AC10 grep (Step 5) occurs in the file. Three go-red controls, each removing one of the three call/ordering/medium facts and asserting `reproductionProblems` returns that problem (same function).
- [ ] **Step 3: Run** `node --test tests/review-reproduction-call-conformance.test.js` — Expected: FAIL (call line lacks `--lens`).
- [ ] **Step 4: Rewrite the prose** in the three skill files and `docs/plugin-structure.md`; then migrate each listed test so its expected line comes from the composer (`formatEntry(composer(...))`), not the prose, keeping each test's other assertions about the prose's rules. `pair-lines.test.js`'s AC3.3 block (this is #5556's step yield reader test, AC1.5 and AC6 of the record: the composer is the only home): generate each of the seven forms from the composer (placeholders filled as in Task 1) and assert each matches exactly one `PAIR_FORMS` pattern, the seven ids equal the seven forms, and the composed action `strictEqual`s that form's `PAIR_FORMS[].template` filled with the same values (the composer↔`PAIR_FORMS` twin pin; `{observed output}` is the template's placeholder for `output`); keep the `step3-tier-variants.md` single-read-coverage template check reading that file; the go-red control mutates a composed line. Update its header comment's producer list.
- [ ] **Step 5: Verify AC10.** `git grep -n -F -e "reproduced. Confirmed. Reversibility" -e "not reproduced. Staged to Review Console" -e "share a location but not substance; both staged" -e "refuted by ground-truth check (" -e "downgraded to unconfirmed — reproduction agreement overridden" -e "re-confirmed by executed run:" -e "severity contested (took the lower of the two). Confirmed" -- plugin/skills/review/step3-lens-dispatch.md` — Expected: no output. (Control, run at plan time against `b1a0f20ef1`: each of the seven phrases matched exactly once, on lines 103-108.) `wc -c plugin/skills/review/step3-lens-dispatch.md` — Expected: ≤ 48,453 (49,953 − 1,500).
- [ ] **Step 6: Verb/flag sweep.** `git grep -n -F 'detect-overlap' -- plugin docs .claude/skills` and `git grep -n -F 'resolve-tiebreak --run' -- plugin docs .claude/skills`: every list of the CLI's verbs or self-logging callers gains `log-reproduction-judgment` / `categorise-reproduction --run`.
- [ ] **Step 7: Run** every test file in this task's Files list (named, no glob): `node --test tests/bin-lib/timing/pair-lines.test.js tests/bin-lib/timing/step-yield.test.js tests/multi-agent-coordination.test.js tests/review-tiebreak-step-conformance.test.js tests/review-absence-claim-ground-truth-conformance.test.js tests/review-vacuity-evidence-conformance.test.js tests/review-cross-lens-corroboration-conformance.test.js tests/review-reproduction-call-conformance.test.js` — Expected: PASS.
- [ ] **Step 8: Commit** — `git commit -m "Name the reproduction calls in review prose and pin the forms to the composer — refs #5595"`.

## Spec-named paths read, not edited

- Waived `plugin/bin/lib/log-decision/aggregate-reproduction.js`: read by Task 1's `AC7.1` test.
- Waived `plugin/bin/lib/console/finding-path.js`: read by Task 1's reader table and Task 2's lens rule (`FINDING_LENS_CLASS`).
- Waived `plugin/bin/lib/console/resolve.js`: read by Task 2's `AC7.2` and Task 3's `AC8.*` tests.
- Waived `docs/skill-authoring.md`: its "Untrusted text into a shell or paste command" rule is why Task 3 takes a file; read, not edited.
- Waived `plugin/skills/review/code-mode-steps.md`: Gotcha says do not add text to it; Task 4 leaves it untouched.
- `tests/multi-agent-coordination.test.js`, `tests/review-tiebreak-step-conformance.test.js`, `tests/review-absence-claim-ground-truth-conformance.test.js`, `tests/review-vacuity-evidence-conformance.test.js`, `tests/review-cross-lens-corroboration-conformance.test.js` are Task 4 `Modify:` files.

## AC coverage map

| AC clause | Task / test |
|---|---|
| AC1.1, AC1.2 | Task 1 `AC1.1 form 1..7`, scratch base-template evidence (Task 1 Step 4) |
| AC1.3, AC1.4 | Base commit is `b1a0f20ef1` (header); templates re-read there at lines 103-108, AC10 bytes re-measured there (49,953) |
| AC1.5 | Task 4 `pair-lines.test.js` composer↔`PAIR_FORMS` pin and Step 5's absence grep |
| AC4.5 | Task 2 `AC4.2` (JSON entry keeps `nearLocation`) |
| AC5.2, AC5.3 | Task 2 `AC5.1`–`AC5.13` (each refusal), `AC5.14` (missing/unanchored → 3) |
| AC8.5 | Task 3 `AC8.4` |
| AC8.7 | Task 3 `AC8.1/AC8.2/AC8.3` (second downgrade line, one verdict settles both) |
| AC2.1 | Task 2 `AC2.1` |
| AC3.1-AC3.3 | Task 2 `AC3.*` |
| AC4.1-AC4.4 | Task 1 `AC4.*` (composer), Task 2 `AC4.*` (CLI); AC4.4 (the form 3 line for the remaining side is intended) is AC4.2's assertion |
| AC5.1-AC5.14 | Task 2 `AC5.*` |
| AC6.1-AC6.2 | Task 2 `AC6.1` |
| AC7.1-AC7.4 | Task 1 `AC7.1`, `AC7.3`; Task 2 `AC7.2`; AC7.4 (form 5 makes no console item) in Task 1's reader table |
| AC8.1-AC8.6 | Task 3 `AC8.*` |
| AC9.1-AC9.3 | Task 3 `AC9.*` |
| AC10.1-AC10.2 | Task 4 Step 2 `AC10.1`, Step 5 |
| AC11.1-AC11.2 | Task 4 `review-reproduction-call-conformance.test.js` |
| AC12.1 | Common Step 5 full suite (`npm test -- --full`) |
