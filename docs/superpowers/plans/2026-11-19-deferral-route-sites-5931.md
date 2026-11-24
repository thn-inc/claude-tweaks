# Deferral Routing Sites Onto the Route Command Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every run-time site that chooses between filing a deferred item and digesting it runs `plugin/bin/deferral-route.js` and follows its verdict, instead of applying `_shared/materiality-floor.md`'s floor from prose, and every edited skill file ends at or below its starting size.

**Architecture:** `_shared/materiality-floor.md` gains an `## Applying the floor` section naming `bin/deferral-route.js` as the floor's code home and giving the one command form; its `## Consumers` section (a restatement of `docs/skill-graph.md`'s edges) goes. Each routing site swaps its prose restatement of the floor and overrides for that command plus its own `file` / `digest` / `refused`-or-other handling; the two pointer sites that need a local meaning of "open" (`release/disposition.md`, `wrap-up/review-console.md` step 10) state it. A live-corpus conformance test pins the command form and the absence of override restatements at each site. No code changes: the CLI landed in #5930 on this branch.

**Tech Stack:** Markdown skill prose, `node --test` conformance suites, Node 18+ CommonJS.

**Spec:** `.claude-tweaks/pipelines/2026-11-19T070031-spec-5930-5931-5932-5933/spec-5931/work/5931-spec.md` (re-materialized with `## Plan-review decisions`)

Scope keywords: deferral-route, materiality-floor, belowFloor, routeDeferral, floor test

Check B classification (plan-audit's keyword walk): each hit was read or grepped for a run-time floor application. The ones that apply the floor are in Tasks 1-6, `release/disposition.md` now included (Task 2). The rest are no-change: the five health sweeps (spec Non-Goal); `tidy/*`, `specify/*`, `review/step3-tiebreak.md`, `_shared/{deferral-gate,autonomy-ceiling,work-record,label-bootstrap,health-filing-digest,github-pr-scan-acceptance}.md` and `init/claude-md-template.md` cite the digest container, the autonomy floor (`clearsFloor`) or `belowFloorClose`, not the materiality verdict; `reflect/hindsight-mode.md` points at `full-mode.md`'s Defer and Capture bullets, which stay; `intake/SKILL.md` is human input; `plugin/bin/**` and their tests are the CLI and its consumers (no code change); `docs/journeys/*`, `docs/plans/*`, `docs/superpowers/*`, `CHANGELOG.md`, `CLAUDE.md`, `docs/skill-graph.md` (its edges say the sites "consult this floor", still true, and it is now the only list of them) and `docs/plugin-structure.md` (its `deferral-route.js` entry is unchanged) are history or descriptions that stay accurate.

## Global Constraints

- The CLI's real interface, read from `plugin/bin/deferral-route.js` and `plugin/bin/lib/deferral-route/route.js`: flags `--defer-reason <reason> (--agent-raised | --human) [--severity <critical|high|medium|low|info>] [--size <v>] [--priority <v>] [--risk <v>]`. An absent axis, or any value other than the exact string `low`, counts as not low and files (rule `not-low`). One JSON line on stdout: `{verdict: file|digest|refused, rule, reason (refused only), input}`. Exit 0 for `file`/`digest`, 2 for `refused`. There is no exit 1. `digest` is only ever rule `floor`.
- Severity is case-sensitive: `--severity High` exits 2 (`{"verdict":"refused","rule":"refused","reason":"--severity \"High\" is not one of: critical, high, medium, low, info",...}`). Every site passes the lowercase word.
- One command form, cited with the plugin-root placeholder (docs/skill-authoring.md, verbatim: "Skill prose that shells out to a plugin file writes `node "${CLAUDE_PLUGIN_ROOT}/bin/{cli}.js" …`"). The contract in `_shared/materiality-floor.md` documents the spec's form, origin flag included: `node "${CLAUDE_PLUGIN_ROOT}/bin/deferral-route.js" --defer-reason {reason} [--severity {severity}] --size {size} --priority {priority} --risk {risk} (--agent-raised | --human)`. Each site writes the instance it runs, with `--agent-raised` in place of the alternation. Never `node plugin/bin/…`, never `process.env.CLAUDE_PLUGIN_ROOT`.
- Every site passes `--agent-raised` (Deliverable 5); the contract says so in the sentence after the form. No site passes `--human`.
- Severity source for control mode (plan-review finding, resolution chosen by the orchestrator): a ledger row (`| # | Phase | Item | Status | Resolution |`) has no severity column, so every `review`-phase row `review/step3-routing.md` writes `open` carries `severity={severity}` (lowercase) in its Resolution, kept through each rewrite while the row stays `open` (Task 2). Control mode passes `--severity` from that token; a `review`-phase row without one passes `--severity high`, so a possibly-high finding files and never digests past release Step 3's `high-severity finding` gate; any other phase passes none (Task 6). Probed: `checkLedgerStatus('open', 'severity=high')` returns `{"refusal":null,"incompleteDeferral":false}`, and `appendLedgerRow` writes `| 1 | review | x | open | severity=high |`, so the `ledger-row` append accepts the token. Rows that lose the token (the refused-proposal reopen in `wrap-up/refused-proposals.md` writes its own note) fall to the `high` default, which fails safe.
- Verdict handling at every site: `file` → the site's existing filing path; `digest` → the site's existing digest path; `refused` or any other outcome (file missing, another non-zero exit, unparseable stdout) → the item stays open in the site's own sense, the site reports what the command printed, and it never falls back to judging the floor from prose. Per site, "open" is:
  - review Step 3 — the finding's ledger row stays `open`, its Resolution keeping `severity={severity}` and quoting the output;
  - reflect — the insight stays unactioned in the batch table;
  - residue sweep — the drill offers neither "Route to a record" nor "Digest — below floor";
  - leftover routing — the section becomes an `open` ledger item for Phase 2's drill;
  - control mode (`_shared/ledger-format.md`, and `wrap-up/review-console.md` step 10 for insight items) — `belowFloor: false`, so the item files or carries; an item with no `deferReason` gets no call and `belowFloor: false`; a `review`-phase row with no `severity=` token is routed with `--severity high`;
  - release Step 8 disposition (`release/disposition.md`, which routes through review's Defer bullet) — a `file` failure per its own Failure section: the staged file stays where it is, a `FAILED … — file failed: {what the command printed}` line is written, it counts toward `{k} failed`, and Step 8 skips archival, so the next release run never adopts the directory with the finding unread.
- No site restates the three-axis rule (`size:low` … `priority:low` … `risk:low`, the pattern at `tests/materiality-floor-conformance.test.js` line 198) or any override (`tangential`, severity). The command form uses `--size {size}`, never a `size:low` token.
- `## The floor` and `## Overrides` in `_shared/materiality-floor.md` are pinned byte-equal by `tests/bin-lib/deferral-route/route.test.js` (lines 135-162, `sectionOf`, which slices to the next `## `). Never edit inside those two sections; the new section is inserted directly after `## Overrides`, so `sectionOf`'s slice of `## Overrides` ends at `## Applying the floor` with unchanged bytes.
- `/claude-tweaks:capture` (`plugin/skills/capture/SKILL.md`) is not edited. The five health sweeps' floor paragraphs are not edited. `plugin/bin/**` is not edited.
- A skill reference inside instruction text uses `/claude-tweaks:{skill}`; bare `/{skill}` only in descriptive prose.
- **AC5 / Deliverable 8 (plan-review Decision 1): every edited skill file ends at or below its starting `wc -c`.** No growth allowance exists. Room comes from prose that restates how a site applies the floor, which the command now carries; never from `## The floor` or `## Overrides`. Where a file holds no other such prose (ledger-format.md, review-console.md), the offset comes from sentences that restate something the same file already says, each listed in the trim inventory below with why it is restatement rather than instruction; every negative rule they carry is kept verbatim or tighter (docs/skill-authoring.md, "Extracting to a sub-file under budget pressure").
- Sizes, measured: start = `wc -c` at plan time (HEAD 75322a921e; `git diff --stat 9820223283 75322a921e -- plugin tests` is empty). End = this plan's exact replacement text, scratch-applied by a script to a `git archive` extract of HEAD. Rail `RAIL_BYTES` = 52,500 (`plugin/bin/lib/skill-audit/budgets.js`).

  | File | Start | End | Delta |
  |---|---|---|---|
  | `plugin/skills/_shared/materiality-floor.md` | 15413 | 15408 | -5 |
  | `plugin/skills/review/step3-routing.md` | 39186 | 39104 | -82 |
  | `plugin/skills/release/disposition.md` | 15590 | 15559 | -31 |
  | `plugin/skills/reflect/full-mode.md` | 39771 | 39716 | -55 |
  | `plugin/skills/visual-review/browser-review.md` | 27796 | 27532 | -264 |
  | `plugin/skills/wrap-up/residue-sweep.md` | 17222 | 17219 | -3 |
  | `plugin/skills/wrap-up/leftover-routing.md` | 16717 | 16715 | -2 |
  | `plugin/skills/_shared/ledger-format.md` | 44944 | 44939 | -5 |
  | `plugin/skills/wrap-up/review-console.md` | 44011 | 43996 | -15 |

  Every file ends ≤ its start; the largest end size (ledger-format.md, 44939) leaves 7561 bytes under the rail. The margins on leftover-routing.md (-2), residue-sweep.md (-3), materiality-floor.md (-5) and ledger-format.md (-5) are thin: an implementer who rewords any replacement text re-measures before committing, and a file that ends above its start is a red step, not a PR note.
- Trim inventory (text removed beyond the floor restatement each task replaces, and why it is restatement):
  - `materiality-floor.md` `## Consumers` (heading + body, lines 204-212): a list of adopters, which `docs/skill-graph.md` states as edges (CLAUDE.md, "Every relationship between skills is stated once, in `docs/skill-graph.md`"); the health-sweep exception it implied moves into Applying the floor.
  - `materiality-floor.md` lines 8-9, ", and this file repeats that ordering deliberately because it is the predictable failure mode": rationale for the restatement itself, not an instruction; the operative rule before it (citing the file to skip a fix is a misuse; the hard gate still applies) stays verbatim.
  - `materiality-floor.md` line 151, "; `review/step3-routing.md` is the reference implementation": a per-adopter pointer; the instruction "Adopters cite this paragraph rather than restating it" stays.
  - `materiality-floor.md` lines 120-121, "Its routing comes from the resolver's severity and recommendation split, not from the three-axis floor above.": the split is the section's own first sentence (lines 113-115), and "not from the three-axis floor" is now stated once, as a named exception, in Applying the floor.
  - `release/disposition.md` line 58, "a `high` or `critical` finding clears it by that file's severity override": the Overrides section restated; the command applies it from `--severity`. Line 65, ", so the materiality floor routes a small one to the digest": the floor restated.
  - `ledger-format.md` lines 171-174, "Note what the reason is **not**: the console is no longer mode-gated — it runs in every mode, including interactive and standalone wrap-up. It is absent here because this is … invoked outside any `/flow` or `/wrap-up` run at all, so no wrap-up ever executes to render one.": history ("no longer"), kept as the tighter negative rule "as this … runs outside any `/flow` or `/wrap-up` run, never because of the mode". Line 177-178, ", since no run-dir log exists to write it to": restates line 169-170's "there is no `staged/` directory or `decisions.md` to write to". Line 174, "inline here instead": "instead" restates "in place of" later in the sentence. Lines 207-209, " exactly as today" (history) and "is true at `unattended` only; the fail-closed-to-asking rule stays correct wherever a human can actually answer." → "holds at `unattended` only.": the scope limit is kept verbatim in meaning, the rationale clause dropped. Not trimmed, though it looks like restatement: the `ledgerRouteRemainder` status-update parenthetical (lines 197-198) repeats the narrowing step's, but `tests/deferral-gate-conformance.test.js:388` counts at least 4 spec-qualified Defer/Keep path lines (scratch-run: trimming it fails that test, and AC6.1 keeps the file unmodified).
  - `review-console.md` step 10, "those two destinations resolve exclusively through this console's own separate `M#` (step 8) and `U#` (step 9) rows" → "only the `M#` (step 8) and `U#` (step 9) rows resolve them" (same rule, `only` for `exclusively`); "lives inside one staged file, not a console item" → "is not a console item" (the step's first sentence names the staged file); "(the call `_shared/ledger-format.md`'s control-mode paragraph gives)" → "per `_shared/ledger-format.md`'s control-mode paragraph (`console-resolve.js --converge`)".
  - `residue-sweep.md`: "in place of" → "instead of", "instead of a record" → "not a record", "for that item" dropped (the sentence's subject is that item). Its negative rule "never silently substituted after approval" is kept verbatim.
- Pins checked for every trimmed phrase (`git grep -n -F` over `tests plugin/bin tools .claude/skills`, plus `plugin docs` for prose-held pins): `## Consumers`, `independent of which adopters`, `These adopter files route below-floor`, `full per-skill relationship`, `routed below floor`, `Adopters cite this paragraph`, `reference implementation`, `predictable failure mode`, `repeats that ordering`, `hard gate still applies unchanged`, `no longer mode-gated`, `Note what the reason is`, `so no wrap-up ever executes`, `It is absent here because`, `no run-dir log exists`, `behavior inline here`, `control-mode paragraph gives`, `is not left refused`, `filingFailed: true`, `Reflection insights (#2547)`, `informational only`, `cannot reach it`, `resolve exclusively through`, `own separate`, `lives inside one staged file`, `severity override`, `materiality-floor test`, `fails the floor`, `Digest — below floor`, `after the dedup check`, `treated as medium`, `routes a small one to the digest`, `for that item. This sweep`, `never silently substituted after approval`, `fails to clear the materiality floor`, `always clears the materiality floor`, `deliberately not an adopter`, `recommend-only-path rule`, `Its routing comes from the resolver`, `not from the three-axis floor`, `recommendation split`, `Nothing stays unresolved`, `fail-closed-to-asking`, `exactly as today`, `Ledger first, then the patch` (pinned by `tests/staged-patch-contract.test.js:88` as a presence check; the heading stays), `status \`open\`, phase \`review\`` (kept verbatim). Hits that are pins, each retargeted with an inventory verdict in its task: `tests/release-run-dir-lifecycle-conformance.test.js:368` (Task 2), `tests/review-routing-line-prose-conformance.test.js:125,134` (Task 2), `tests/control-mode-console-prose.test.js:103` (Task 6). Hits kept untouched: `tests/reflect-wrap-up-insights-staging-conformance.test.js:77-78` (step 10's D4/D5 needles "D4 (Memory) and D5 (Upstream) rows in this table are informational only" and "approving this step never writes a memory file or files upstream feedback on its own" stay verbatim), `tests/materiality-floor-conformance.test.js:79-82,335-345` (Audit-line prefix, Digest URL section), `tests/release-run-dir-lifecycle-conformance.test.js:367,376` (`Digest — below floor`, `else treated as medium for the floor test` stay). No other hit is a pin: `## Consumers` hits are other `_shared` files; the remaining hits are the edited files themselves and the five health sweeps.
- Whole-change scratch run (plan time): all edits and test edits applied to a `git archive HEAD` extract, then `node tools/run-tests.js --files-from {list}` over every test file naming an edited file, the CLI or a skill-audit suite (8811 tests): 8778 pass, 9 fail. The same 6 files run on an unedited extract fail the same 9 tests (they need a `.git` the extract lacks: `first-call-artifact-check`, `demo-alias-conformance` ×2, `hooks-dispatch-prompt-gate`, `session-limit-degrade-conformance`, `untrusted-record-content-conformance`, `verify-scope-declaration` ×3), so the edits add no failure. The same test edits over unedited skill files: 23 tests fail in `tests/materiality-floor-conformance.test.js` (17 of them Task 1's), 27 in `tests/control-mode-console-prose.test.js`, 32 in `tests/review-routing-line-prose-conformance.test.js`, 1 in `tests/release-run-dir-lifecycle-conformance.test.js`.
- Commit messages: `{Verb} {what} — {detail} (#5931)`, then a blank line, then `Claude-Session: https://claude.ai/code/session_016yg3znZfdV181e3d4oRJ3T` (a second `-m`). Stage specific files by path only (never `git add -A` / `.`). Never `git reset`, never `git stash`, never force push.
- Tests: run targeted files with `node --test <file>` (one file), or `node tools/run-tests.js <files…>` for several (the repo's guard refuses a multi-file `node --test`). Never the full `npm test` suite.
- Governing skill `.claude/skills/skill-prose-conformance-tests/SKILL.md`, quoted verbatim:
  - Decision Framework row: "A documented convention this project wants enforced against every future addition — no fixed code structure to pin against, no bytes a migration will rewrite | Read the live corpus and pin the convention itself (a regex over `plugin/skills/**/*.md`, or wherever the convention applies); never freeze it — freezing would stop the suite from catching a new violation, which is the whole point".
  - "When the assertion and the prose it pins are authored in the same change — a plan that inserts both, a build that writes the test before the edit lands — copy the pinned literal out of the edit's own replacement text, never from memory of what that edit says."
  - "Apply the whitespace-collapsed control scan to **both** directions of a migration suite — absence assertions need it more than presence ones."
  - "Prove the assertion can go red before trusting its green: negate the prose and assert the regex *fails*, one claim per test."
  - "**A clause pinned to its row or paragraph owes a move-out control, not only a deletion.**"
  - "**Retargeting existing pins: diff the assertion inventory, not the plan's prose anchor list.** … give each one an explicit verdict — moved, retargeted (naming the new literal), or retired (with its own stated reason)."
  - Anti-pattern row: "Pinning a templated CLI invocation in skill prose up to a value-taking flag's name, not its value | … Pin the placeholder with the flag (`--require-verify \{base\}`)".
  - Anti-pattern row: "Scoping a command-form pin to the sites the spec enumerated, without first grepping the form repo-wide | … grep the old form over `plugin/`, `docs/` and `README.md`, then widen the haystack or name each restatement left unpinned".
- Governing rule from docs/skill-authoring.md, verbatim: "A byte cut keeps every negative rule and scope limit ("never", "no carve-out", "only when", "not for") verbatim or tighter, and the plan task that cuts lists each removed sentence with why it is restatement rather than instruction".
- Governing skill `.claude/skills/shared-contract-extraction/SKILL.md`, quoted verbatim: "Re-measure `wc -c` on every near-rail file this migration touches immediately after each upstream merge, not only before planning the additions."
- No other `.claude/skills/` rule names these files: `health-sweep-addition` concerns adding a sweep to `ADOPTERS`; `prose-code-twin-pin` concerns templates a `plugin/bin` detector parses (the Audit line has no parser: `git grep -n -F "routed below floor" -- tests plugin/bin tools` matches only `materiality-floor.md`); `review-console-section-addition` concerns adding a console section.

## Fact-check of the spec's Current State

Checked against the files at plan time:

- Line claims hold: `review/step3-routing.md` 69, 71, 110 (and also **111**, the Capture bullet, which applies the floor too); `reflect/full-mode.md` 397 (and **398**, Capture); `wrap-up/residue-sweep.md` 165-173; `wrap-up/leftover-routing.md` 27-32; `visual-review/browser-review.md` 247-253 (and **254**, Ideas Capture); `_shared/ledger-format.md` 211; `plugin/bin/lib/console/residue-convergence.js` 77; `tests/materiality-floor-conformance.test.js` `ADOPTERS` 172, no-restatement test 192 (its regex on 198). All byte sizes in the spec match `wc -c`.
- **Missed site:** `plugin/skills/wrap-up/review-console.md` line 123 (On approval step 10) builds control-mode insight items with "`belowFloor` judged per `_shared/materiality-floor.md`". Task 6 points it at the command and states the `refused`/other-outcome and no-`deferReason` cases. `tests/control-mode-console-prose.test.js` line 103 pins that literal and is retargeted.
- **Missed pointer site:** `plugin/skills/release/disposition.md` lines 58 and 65 apply "that bullet's materiality-floor test" through review's Defer bullet, whose "open" means a ledger row a release run does not keep. Task 2 gives it its own "open" (a `file` failure) and drops its override restatement; `tests/release-run-dir-lifecycle-conformance.test.js` line 368 pins that restatement and is retargeted.
- **Severity vocabulary (plan-review Decision 2):** visual-review's Issues carry `Critical`/`Major`/`Minor`/`Cosmetic` (`browser-review.md` lines 210-216's table; performance-budget misses are Major, lines 142-144), not the CLI's severities. Task 4 maps Critical → `critical`, Major → `medium`, Minor → `low`, Cosmetic → `info`, and passes no `--severity` for an Idea (its Impact column is not a severity). Only a Critical takes the CLI's `severity` rule; a Major goes through the three-axis floor like any other non-high item. Probed: `--severity medium` with all axes low prints `{"verdict":"digest","rule":"floor",…}`; `--severity critical` prints `{"verdict":"file","rule":"severity",…}`; `--severity info` prints `digest`/`floor`.
- **Stale prose found by the behavior-change sweep:** `residue-sweep.md` lines 181-183 say `_shared/ledger-format.md` "is deliberately not an adopter of the floor … tracked on #1279". Control mode has consulted it since #4620, and after this change runs the command; Task 5 corrects the sentence.
- `plugin/skills/reflect/hindsight-mode.md` line 53 points at `full-mode.md`'s Defer and Capture bullets, which stay where they are; no edit. `plugin/skills/intake/SKILL.md` line 71 is human input; not a site.
- `tests/review-routing-line-prose-conformance.test.js`'s two retargeted rows sit at lines **125** and **134** (not 124/135).
- **No severity on a ledger row:** the ledger table is `| # | Phase | Item | Status | Resolution |` (`plugin/bin/lib/stage-item/ledger.js`'s `appendLedgerRow`), so control mode cannot read a finding's severity today. `review/step3-routing.md` writes `review`-phase rows `open` at line 65 (High/Medium, before the patch), line 69 (a failed `stage-item.js`), line 73 (every staged finding) and line 122 (no valid reason, `auto`). Task 2 makes all of them carry `severity={severity}`; Task 6 reads it.
- **Floor scope:** the tiebreak can't-tell digest (`materiality-floor.md` lines 111-127), the console-backfill values (lines 129-141) and ledger narrowing (`clearsFloor`, `ledger-format.md` lines 154-209) route by their own rules (spec Non-Goals), so Applying the floor names them as exceptions beside the five health sweeps.
- Spec Data/API surface says "axis values `low`, `medium`, `high`": the CLI accepts any string for an axis (only `low` is low). Sites are told to pass `low`/`medium`/`high`; nothing breaks on other values.

## Prior plan reviewer's points (comment 7004714870)

- Point 1 (two files would grow against AC5): settled by Decision 1 — no growth allowance; every file ends ≤ start (size table above, trim inventory above).
- Point 2 (visual-review severity map): settled by Decision 2 — Critical `critical`, Major `medium`, Minor `low`, Cosmetic `info`; Task 4, its test literals and Review Focus 5 follow it.
- The comment raises no other point.
- Second plan review (on 93318c5b0), four findings: (1) control mode had no severity source for a ledger row — `severity={severity}` Resolution token written by every `open` review row (Task 2), read by control mode with a `review`-phase `high` default (Task 6); (2) Task 1 marked `Review risk: high`; (3) the contract documents `(--agent-raised | --human)` and says every routing site passes `--agent-raised` (Task 1); (4) Applying the floor is scoped to items carrying a gate `Defer-reason:`, naming the tiebreak can't-tell digest, the console-backfill values and ledger narrowing as exceptions beside the health sweeps (Task 1).

## Review Focus

1. A findings table renders severity capitalized (`High`, `Critical`); passed through as-is, the CLI refuses with exit 2. Expected: the site passes the lowercase word. Pinned by Task 1's contract test (`lowercase (`critical`, …)` needle) and Task 4's visual-review mapping test.
2. An axis the site cannot judge (an unstamped `priority`, an unscored item). Expected: passed as `medium`/`high`, never `low`, so the item files. Pinned by `## The floor`'s "counts as **not low**" sentence, byte-pinned by `tests/bin-lib/deferral-route/route.test.js`, and the CLI's `not-low` rule (its exhaustive test), which every site now reaches through the command.
3. The command is not runnable (plugin root not substituted: `Cannot find module '/bin/deferral-route.js'`), or prints nothing parseable. Expected: the item stays open in the site's sense, never a prose fallback. Pinned at every deferral site by Task 1's `any other outcome` assertion, at release by Task 2's retargeted fact, at step 10 by Task 6's `` `false` on `refused` or any other outcome `` row.
4. A control-mode item missing an input: no mapped `deferReason` (a ledger item, or an insight whose reason `refused-proposals.md` refused), or a `review`-phase ledger row with no `severity=` token (a row reopened by `wrap-up/refused-proposals.md`, or one written before this change). Expected: no call and `belowFloor: false` for the first; `--severity high`, so it files, for the second. Pinned by Task 6's `LEDGER_CLAIMS` and `STEP_10_CLAIMS` rows `` no `deferReason`: no call, `false` `` and the `LEDGER_CLAIMS` row `` else `high` for a `review`-phase row ``; Task 2's `SEVERITY_TOKEN_CLAUSES` pin the writer side.
5. A visual-review Issue whose three axes are all low. Expected: only a Critical always files (`--severity critical`, rule `severity`); a Major (`--severity medium`, performance-budget misses included) digests via rule `floor`. Pinned by Task 4's mapping test (the literals `Critical \`critical\`` and `Major \`medium\``) and the plan-time CLI probes in the Fact-check.

---

### Task 1: The floor contract names the command, and the conformance suite pins every site

**Role:** judgment
**Review risk:** high

**Files:**
- Modify: `plugin/skills/_shared/materiality-floor.md` (lines 8-9 intro tail; insert after line 32, the last line of `## Overrides`; lines 120-121 tiebreak sentence; line 151 Digest URL sentence; line 191 Audit line; lines 203-212 `## Consumers` removed)
- Test: `tests/materiality-floor-conformance.test.js` (one import after line 16; insert after line 202, the end of the no-restatement test)

**Interfaces:**
- Produces: the constants and helpers later tasks' tests call by name — `ROUTE_COMMAND`, `ROUTE_FORM`, `DEFERRAL_SITES`, `flexible(needle) -> RegExp`, `deferralSiteProblems(text) -> string[]`, `assertDeferralSite(text, rel)`; one test per site named `#5931 deferral site {rel} runs the deferral-route.js command and follows its verdict` (Tasks 2-6 turn each green).
- Produces: the section heading `## Applying the floor` in `materiality-floor.md`.

- [ ] **Step 1: Write the failing tests.** In `tests/materiality-floor-conformance.test.js`, add `const { sectionOf } = require('./helpers/conformance-asserts');` after line 16 (`const { readText } = …`), and insert after line 202:

```js
// --- #5931: every deferral routing site applies the floor through bin/deferral-route.js ---
// Live corpus on purpose (skill-prose-conformance-tests' "documented convention ... against every future
// addition" row): the claim is that each site's own prose carries the command, which no fixture can stand in for.
const ROUTE_COMMAND = 'node "${CLAUDE_PLUGIN_ROOT}/bin/deferral-route.js" --defer-reason {reason}';
const ROUTE_FORM = `${ROUTE_COMMAND} [--severity {severity}] --size {size} --priority {priority} --risk {risk} (--agent-raised | --human)`;
const DEFERRAL_SITES = [
  'plugin/skills/review/step3-routing.md',
  'plugin/skills/reflect/full-mode.md',
  'plugin/skills/wrap-up/residue-sweep.md',
  'plugin/skills/wrap-up/leftover-routing.md',
  'plugin/skills/visual-review/browser-review.md',
  'plugin/skills/_shared/ledger-format.md',
];
const OVERRIDE_RESTATEMENT = /always clears|override clears|other than `tangential`|non-`tangential`|is not `tangential`/;
// A needle as a regex whose spaces match any whitespace run, so a hard-wrapped copy is found (and stripped) too.
const flexible = (needle) => new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+'));

// The paragraph(s) holding the command must carry its value placeholders, the origin flag, the three
// verdicts and the any-other-outcome branch; the whole file must not restate an override.
function deferralSiteProblems(text) {
  const problems = [];
  const paragraphs = text.split(/\n[ \t]*\n/).map((p) => p.replace(/\s+/g, ' '));
  const holding = paragraphs.filter((p) => p.includes(ROUTE_COMMAND));
  if (holding.length === 0) problems.push('no paragraph holds the deferral-route.js command form');
  else {
    for (const flag of ['--size {size}', '--priority {priority}', '--risk {risk}', '--agent-raised']) {
      if (!holding.some((p) => p.includes(flag))) problems.push(`the command paragraph lacks ${flag}`);
    }
    if (!holding.some((p) => p.includes('any other outcome'))) problems.push('the command paragraph does not handle any other outcome');
    for (const word of ['`file`', '`digest`', '`refused`']) {
      if (!holding.some((p) => p.includes(word))) problems.push(`the command paragraph does not name the ${word} verdict`);
    }
  }
  if (OVERRIDE_RESTATEMENT.test(text.replace(/\s+/g, ' '))) problems.push('restates a floor override');
  return problems;
}
function assertDeferralSite(text, rel) {
  assert.deepStrictEqual(deferralSiteProblems(text), [], `${rel} must apply the floor through bin/deferral-route.js`);
}

for (const rel of DEFERRAL_SITES) {
  test(`#5931 deferral site ${rel} runs the deferral-route.js command and follows its verdict`, () => {
    assertDeferralSite(read(rel), rel);
  });
}

const SAMPLE_SITE = `Apply the floor with \`${ROUTE_COMMAND} --size {size} --priority {priority} --risk {risk} --agent-raised\`: \`digest\` digests, \`file\` files, \`refused\` or any other outcome stays open.`;
const SITE_MUTATIONS = [
  [ROUTE_COMMAND, 'no paragraph holds the deferral-route.js command form'],
  ['--size {size}', 'the command paragraph lacks --size {size}'],
  ['{priority}', 'the command paragraph lacks --priority {priority}'],
  ['--agent-raised', 'the command paragraph lacks --agent-raised'],
  ['any other outcome', 'the command paragraph does not handle any other outcome'],
  ['`file`', 'the command paragraph does not name the `file` verdict'],
  ['`digest`', 'the command paragraph does not name the `digest` verdict'],
  ['`refused`', 'the command paragraph does not name the `refused` verdict'],
];
test('#5931 go-red: the sample site passes the deferral-site check', () => assertDeferralSite(SAMPLE_SITE, 'sample'));
for (const [cut, expected] of SITE_MUTATIONS) {
  test(`#5931 go-red: removing ${cut} fails the deferral-site check`, () => {
    const mutated = SAMPLE_SITE.split(cut).join('');
    assert.notEqual(mutated, SAMPLE_SITE, `anchor ${cut} not in the sample`);
    assert.deepStrictEqual(deferralSiteProblems(mutated), [expected]);
    assert.throws(() => assertDeferralSite(mutated, 'sample'));
  });
}
test('#5931 go-red: the verdicts in another paragraph than the command fail the deferral-site check', () => {
  const split = `Apply the floor with \`${ROUTE_COMMAND} --size {size} --priority {priority} --risk {risk} --agent-raised\`.\n\n\`digest\` digests, \`file\` files, \`refused\` or any other outcome stays open.`;
  assert.deepStrictEqual(deferralSiteProblems(split), [
    'the command paragraph does not handle any other outcome',
    'the command paragraph does not name the `file` verdict',
    'the command paragraph does not name the `digest` verdict',
    'the command paragraph does not name the `refused` verdict',
  ]);
});
test('#5931 go-red: an override restated across a line wrap fails the deferral-site check', () => {
  const restated = `${SAMPLE_SITE}\nA \`tangential\` reason always\nclears the floor.`;
  assert.deepStrictEqual(deferralSiteProblems(restated), ['restates a floor override']);
  assert.throws(() => assertDeferralSite(restated, 'sample'));
});

const FLOOR_NEEDLES = [
  ROUTE_FORM,
  'its test pins the two sections above byte-equal',
  'Every site routing an item that carries a gate `Defer-reason:` runs it',
  'the five health sweeps, the tiebreak can\'t-tell digest, the console-backfill values and ledger narrowing follow their own rules',
  'lowercase (`critical`, `high`, `medium`, `low`, `info`)',
  'Every routing site passes `--agent-raised`',
  '`verdict` (`file`, `digest` or `refused`) and `rule`',
];
const AUDIT_RULE = /^AUTO \{time\} — materiality-floor: \{item\} routed below floor \(\{defer-reason\}, rule=\{rule\}\) → digest\./m;
function floorCommandProblems(text) {
  const section = sectionOf(text, '## Applying the floor').replace(/\s+/g, ' ');
  const problems = FLOOR_NEEDLES.filter((needle) => !section.includes(needle)).map((needle) => `Applying the floor lacks ${needle}`);
  if (!AUDIT_RULE.test(text)) problems.push('the Audit line does not carry rule={rule}');
  return problems;
}
test('#5931 materiality-floor.md names deferral-route.js as the code home and gives the one command form', () => {
  assert.deepStrictEqual(floorCommandProblems(FLOOR), []);
});
for (const needle of FLOOR_NEEDLES) {
  test(`#5931 go-red: dropping ${needle} fails the floor check`, () => {
    const mutated = FLOOR.replace(flexible(needle), '');
    assert.notEqual(mutated, FLOOR, `anchor ${needle} not in materiality-floor.md`);
    assert.deepStrictEqual(floorCommandProblems(mutated), [`Applying the floor lacks ${needle}`]);
  });
}
test('#5931 go-red: the command form moved out of Applying the floor fails the floor check', () => {
  const mutated = `${FLOOR.replace(flexible(ROUTE_FORM), '')}\n\`${ROUTE_FORM}\`\n`;
  assert.ok(mutated.includes(ROUTE_FORM));
  assert.deepStrictEqual(floorCommandProblems(mutated), [`Applying the floor lacks ${ROUTE_FORM}`]);
});
test('#5931 go-red: dropping the axis placeholders from the command form fails the floor check', () => {
  const mutated = FLOOR.split('--size {size} --priority {priority}').join('--size --priority');
  assert.notEqual(mutated, FLOOR);
  assert.deepStrictEqual(floorCommandProblems(mutated), [`Applying the floor lacks ${ROUTE_FORM}`]);
});
test('#5931 go-red: dropping rule={rule} from the Audit line fails the floor check', () => {
  const mutated = FLOOR.split(', rule={rule}').join('');
  assert.notEqual(mutated, FLOOR);
  assert.deepStrictEqual(floorCommandProblems(mutated), ['the Audit line does not carry rule={rule}']);
});
```

- [ ] **Step 2: Run against the pre-change tree and see it fail (AC2.2 evidence)**

Run: `git grep -n -F '## Applying the floor' -- plugin/skills/_shared/materiality-floor.md`
Expected: FAIL — exit 1, no match (probed at plan time: exit 1).
Run: `node --test tests/materiality-floor-conformance.test.js`
Expected: FAIL after Step 1 — 17 tests fail (scratch run of this exact block over the unedited skill files): the six `#5931 deferral site …` tests (five with `["no paragraph holds the deferral-route.js command form","restates a floor override"]`, ledger-format.md with the first only), the contract test and the move-out control with `heading not found: ## Applying the floor`, the seven needle go-red tests, the axis-placeholder control and the `rule={rule}` control on their missing anchor. (Task 4's block is not present yet; with it the scratch run counted 23.) The sample go-red tests pass. Every pre-existing test passes.
Write the full output to `$PIPELINE_RUN_DIR/evidence/5931-ac2-base-red.txt` (`mkdir -p "$PIPELINE_RUN_DIR/evidence"` first, the run dir's absolute path substituted, a plain Bash redirect) and log one entry: `node "${CLAUDE_PLUGIN_ROOT}/bin/log-decision.js" --run "$PIPELINE_RUN_DIR" --section "/build" --status AUTO --step "AC evidence" --text-file "{text-file}"`, the text file (written with the Write tool) holding one line: `AC2.2: node --test tests/materiality-floor-conformance.test.js before any site edit — 6 deferral-site tests fail, contract test fails; log at evidence/5931-ac2-base-red.txt`.

- [ ] **Step 3: Edit `plugin/skills/_shared/materiality-floor.md`** — six replacements (scratch-applied; file ends at 15408 bytes):

(a) Lines 8-9: `gate still applies unchanged, and this file repeats that ordering deliberately because it is the` + newline + `predictable failure mode.` becomes `gate still applies unchanged.`

(b) Insert after the `## Overrides` section's last line (`  never exhaust, and never routes to the digest.`) and its blank line, before `## Entry format`:

````text
## Applying the floor

`bin/deferral-route.js` is the floor's code home (its test pins the two sections above
byte-equal). Every site routing an item that carries a gate `Defer-reason:` runs it instead of
applying this prose; the five health sweeps, the tiebreak can't-tell digest, the console-backfill
values and ledger narrowing follow their own rules:

`node "${CLAUDE_PLUGIN_ROOT}/bin/deferral-route.js" --defer-reason {reason} [--severity {severity}] --size {size} --priority {priority} --risk {risk} (--agent-raised | --human)`

`--severity` only when the item has one, lowercase (`critical`, `high`, `medium`, `low`, `info`);
each axis `low`, `medium` or `high` as the site scores it. Every routing site passes
`--agent-raised`: no typed input reaches one. It prints `verdict` (`file`, `digest` or
`refused`) and `rule`.

````

(b2) Lines 120-121: `finding never failed fix-now, so no gate reason describes the digest entry. Its routing comes from` + newline + `the resolver's severity and recommendation split, not from the three-axis floor above. Every other` becomes `finding never failed fix-now, so no gate reason describes the digest entry. Every other` on one line (the tiebreak's exception is now named in Applying the floor; its split is the section's own first sentence).

(c) Lines 150-151: `Adopters cite this paragraph rather than restating` + newline + `it; \`review/step3-routing.md\` is the reference implementation. The five health sweeps additionally fold` becomes the same with `it. The five health sweeps additionally fold` on the second line.

(d) Audit line (line 191): `({defer-reason}) → digest.` becomes `({defer-reason}, rule={rule}) → digest.` — the rest of the line unchanged. `rule` is always `floor` for a `digest` verdict.

(e) Delete `## Consumers` (line 204), its blank lines and its body (lines 206-212), so the file ends with `the exact promotion and expiry procedures.` and one newline.

- [ ] **Step 4: Run and see the contract half pass**

Run: `node tools/run-tests.js tests/materiality-floor-conformance.test.js tests/bin-lib/deferral-route/route.test.js`
Expected: `route.test.js` PASS (both prose pins unchanged). In the conformance file every test passes except the six `#5931 deferral site …` tests, which still fail until Tasks 2-6. `wc -c plugin/skills/_shared/materiality-floor.md` prints 15408 (≤ 15413).

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/_shared/materiality-floor.md tests/materiality-floor-conformance.test.js
git commit -m "Name the deferral-route command in the materiality floor contract — one command form, sites pinned (#5931)" -m "Claude-Session: https://claude.ai/code/session_016yg3znZfdV181e3d4oRJ3T"
```

### Task 2: Review Step 3 routing runs the command, and release disposition says what open means

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/skills/review/step3-routing.md:65` (Ledger first, then the patch — the severity token), `:69` (staging paragraph), `:71` (digest paragraph), `:110` (Defer bullet), `:111` (Capture bullet)
- Modify: `plugin/skills/release/disposition.md:58` (confirmed row), `:65` (proposal row)
- Test: `tests/review-routing-line-prose-conformance.test.js` (`RECORD_PROPOSAL_CLAUSES`, lines 125 and 134, one new row; a new `SEVERITY_TOKEN_CLAUSES` block before `missingRecordProposalClauses`, line 144); `tests/release-run-dir-lifecycle-conformance.test.js` (`DISPOSITION_ROUTING`, line 368)

**Interfaces:**
- Consumes: Task 1's test `#5931 deferral site plugin/skills/review/step3-routing.md …`.

Pin inventory, `RECORD_PROPOSAL_CLAUSES` (every literal the paragraph edit touches): `Before composing, apply \`_shared/materiality-floor.md\`'s floor test` — kept; `other than \`tangential\` goes to the digest container` (line 125) — retargeted to ``['`digest` goes to the digest container', 'routes a digest verdict to the digest container']``; `A \`tangential\` finding, a \`high\` one, or one that clears the floor, is staged` (line 134) — retargeted to ``['A finding the command routes `file` is staged', 'stages a finding the command files']``; `A \`high\` finding never takes the digest branch` — kept (still true, now via the command's severity rule); one new row ``['its Resolution keeping `severity={severity}`', 'keeps the severity token when a refused floor call leaves the row open']``; every other row untouched. `recordProposalParagraph` holds lines 69 and 71, not line 65, so line 65's token rule gets its own block (Step 1).

Pin inventory, `DISPOSITION_ROUTING`: line 368 `` /a `high` or `critical` finding clears it by that file's severity override/ `` — retargeted to `` [/passing the finding's `--severity`/, 'a confirmed finding passes its own severity to the floor command'] `` (the override it named is the command's `severity` rule, which the finding's own `--severity` triggers), plus one new row `` [/`refused` or any other outcome is a `file` failure \(below\) naming what the command printed/, 'a refused or unreadable floor verdict is a file failure that leaves the file staged'] ``; line 367 `/Digest — below floor/`, line 376 `/else treated as medium for the floor test/` and line 377 `/A \`review-followup-\` file already holds a composed record, so after the floor test it is filed as written/` — kept (text unchanged); every other row untouched. `assertFactsAndGoRed` strips each pattern's first match and requires exactly that fact to go red, so each new pattern must match once (scratch run: it does).

- [ ] **Step 1: Retarget and add the rows** in `tests/review-routing-line-prose-conformance.test.js` and `tests/release-run-dir-lifecycle-conformance.test.js` as listed above, and insert before `function missingRecordProposalClauses(paragraph) {` (line 144):

```js
// #5931: control mode reads an open review row's severity from its Resolution (_shared/ledger-format.md),
// so the ledger-first paragraph must write the token and keep it while the row stays open.
const SEVERITY_TOKEN_CLAUSES = [
  ["`--resolution 'severity={severity}'`", 'appends a review row with its severity token'],
  ['kept through each rewrite while it stays `open`', 'keeps the severity token through every open rewrite'],
];
const ledgerFirstParagraph = (text) => text.split('\n').find((l) => l.startsWith('**Ledger first, then the patch.**')) || '';
const missingSeverityTokenClauses = (text) => {
  const paragraph = ledgerFirstParagraph(text);
  return SEVERITY_TOKEN_CLAUSES.filter(([literal]) => !paragraph.includes(literal)).map(([, fact]) => fact);
};
test('#5931: the ledger-first paragraph writes and keeps each open review row\'s severity token', () => {
  assert.ok(ledgerFirstParagraph(md), 'the "Ledger first, then the patch." paragraph is missing');
  assert.deepEqual(missingSeverityTokenClauses(md), []);
});
for (const [literal, fact] of SEVERITY_TOKEN_CLAUSES) {
  test(`#5931 go-red: removing the clause that ${fact} turns that clause red`, () => {
    const paragraph = ledgerFirstParagraph(md);
    const doctored = md.replace(paragraph, () => paragraph.split(literal).join(''));
    assert.notEqual(doctored, md, `anchor: "${literal}" not found — proof cannot discriminate`);
    assert.deepEqual(missingSeverityTokenClauses(doctored), [fact]);
  });
}
test('#5931 go-red: the severity clauses moved out of the ledger-first paragraph turn both red', () => {
  const paragraph = ledgerFirstParagraph(md);
  const stripped = SEVERITY_TOKEN_CLAUSES.reduce((p, [literal]) => p.split(literal).join(''), paragraph);
  const moved = `${md.replace(paragraph, () => stripped)}\n${SEVERITY_TOKEN_CLAUSES.map(([literal]) => literal).join(' ')}\n`;
  assert.deepEqual(missingSeverityTokenClauses(moved), SEVERITY_TOKEN_CLAUSES.map(([, fact]) => fact));
});
```

- [ ] **Step 2: Run and see it fail**

Run: `git grep -n -F 'bin/deferral-route.js' -- plugin/skills/review/step3-routing.md plugin/skills/release/disposition.md`
Expected: FAIL — exit 1, no match (probed at plan time: exit 1).
Run: `node --test tests/review-routing-line-prose-conformance.test.js`
Expected: FAIL after Step 1 — `the record-proposal paragraph is missing clauses` naming the three new or retargeted facts, the severity-token test and its two go-red tests, 32 tests in all (scratch run).
Run: `node --test tests/release-run-dir-lifecycle-conformance.test.js`
Expected: FAIL after Step 1 — `AC3.1: disposition.md routing table` reports `["a confirmed finding passes its own severity to the floor command","a refused or unreadable floor verdict is a file failure that leaves the file staged"]`; the other 49 tests pass (scratch run).

- [ ] **Step 3: Edit both files.** Each paragraph and table row stays one physical line.

`step3-routing.md` line 65, replace `(\`_shared/ledger-format.md\`'s Writer section; status \`open\`, phase \`review\`) before composing the staged patch — the verb's JSON \`row\` is the item number the patch's \`Ledger:\` field below points at, so the order matters: a patch composed first would have nothing to reference.` with:

````text
(`_shared/ledger-format.md`'s Writer section; status `open`, phase `review`, `--resolution 'severity={severity}'`) before composing the staged patch — the verb's JSON `row` is the item number the patch's `Ledger:` field below points at, so the order matters: a patch composed first would have nothing to reference. Every `review`-phase row this file writes `open` carries that `severity={severity}` token (the finding's lowercase severity) in its Resolution, kept through each rewrite while it stays `open`: control mode's floor call reads it (`_shared/ledger-format.md`).
````

(The rule covers line 69's failed-`stage-item.js` rewrite, line 73's staged-finding appends and line 122's no-valid-reason `open` item without editing those sentences.)

`step3-routing.md` line 69, replace `Before composing, apply \`_shared/materiality-floor.md\`'s floor test to a low or medium finding: … A \`tangential\` finding, a \`high\` one, or one that clears the floor, is staged as follows.` (the four sentences from "Before composing" through "is staged as follows.") with:

````text
Before composing, apply `_shared/materiality-floor.md`'s floor test with `node "${CLAUDE_PLUGIN_ROOT}/bin/deferral-route.js" --defer-reason {reason} --severity {severity} --size {size} --priority {priority} --risk {risk} --agent-raised`, the axes scored as the Defer bullet scores them: `digest` goes to the digest container instead, per the next paragraph; `refused` or any other outcome stages nothing and leaves the finding's ledger row `open`, its Resolution keeping `severity={severity}` and quoting what the command printed. A `high` finding never takes the digest branch: the command files it, so its composer line carries the `high-severity finding` token release Step 3 blocks on. A finding the command routes `file` is staged as follows.
````

Line 71, replace `A low or medium finding the floor test above routes here goes to the digest container` with `A finding the floor test above routes \`digest\` goes to the digest container`.

Line 110, replace the span from `Before composing, apply \`_shared/materiality-floor.md\`'s floor test to this item (judged` through `instead of \`"Defer — {reason}"\` —` with:

````text
Before composing, run the staging paragraph's `deferral-route.js` command for this item (`risk`/`size` as this bullet scores them for `recordPayload`, plus the unstamped `priority`, judged the same way): on `digest` the batch table's Recommended column shows `"Digest — below floor"` instead of `"Defer — {reason}"`, and on `refused` or any other outcome the finding stays `open` like one with no valid reason below, quoting what the command printed —
````

(the text after it, `the digest entry is written only once the human approves that row …, never silently substituted underneath an unchanged Defer label; …`, is unchanged; "below" resolves to line 122's "A finding that fails fix-now with **no** valid reason stays `open`").

Line 111, replace the span from `This branch's items usually carry \`Defer-reason: tangential\`` to the end of the line with:

````text
Before invoking capture, run the Defer bullet's `deferral-route.js` command and follow its verdict the same way. That is `_shared/materiality-floor.md`'s floor, not `_shared/deferral-gate.md`'s own "Floor mapping" section, a different, autonomy-ceiling floor with the opposite verdict for `tangential`.
````

`disposition.md` line 58, replace ` — a \`high\` or \`critical\` finding clears it by that file's severity override: a finding that fails the floor is \`Digest — below floor\`, appended only once the row is approved, after the dedup check.` (leading space-dash through the period) with:

````text
, passing the finding's `--severity`: `digest` is `Digest — below floor`, appended only once the row is approved, after the dedup check; `refused` or any other outcome is a `file` failure (below) naming what the command printed.
````

`disposition.md` line 65, replace `The same Defer path and Defer-reason, so the materiality floor routes a small one to the digest. Severity` with `The same Defer path and Defer-reason. Severity` (the proposal row inherits line 58's floor handling through "The same Defer path").

- [ ] **Step 4: Run and see it pass**

Run: `node tools/run-tests.js tests/materiality-floor-conformance.test.js tests/review-routing-line-prose-conformance.test.js tests/release-run-dir-lifecycle-conformance.test.js tests/deferral-gate-conformance.test.js`
Expected: the step3-routing deferral-site test PASS; `review-routing-line-prose-conformance` and `release-run-dir-lifecycle-conformance` PASS in full; `deferral-gate-conformance` PASS unmodified; the other deferral-site tests still FAIL. `wc -c` prints 39104 for step3-routing.md (≤ 39186) and 15559 for disposition.md (≤ 15590).

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/review/step3-routing.md plugin/skills/release/disposition.md tests/review-routing-line-prose-conformance.test.js tests/release-run-dir-lifecycle-conformance.test.js
git commit -m "Route review Step 3 deferrals through deferral-route.js — staging, Defer, Capture and release disposition follow its verdict (#5931)" -m "Claude-Session: https://claude.ai/code/session_016yg3znZfdV181e3d4oRJ3T"
```

### Task 3: Reflect's Defer and Capture run the command

**Role:** transcription
**Review risk:** high

**Files:**
- Modify: `plugin/skills/reflect/full-mode.md:397` (Defer), `:398` (Capture)
- Test: `tests/materiality-floor-conformance.test.js` (Task 1's test, no change)
- Waived `plugin/skills/reflect/hindsight-mode.md`: line 53 points at `full-mode.md`'s Defer and Capture bullets, which stay in place; Step 4 re-runs the hindsight pointer test that reads it.

- [ ] **Step 1: No new test** — Task 1's `#5931 deferral site plugin/skills/reflect/full-mode.md …` covers this task.

- [ ] **Step 2: Run and see it fail**

Run: `git grep -n -F 'bin/deferral-route.js' -- plugin/skills/reflect/full-mode.md`
Expected: FAIL — exit 1, no match (probed at plan time: exit 1).
Run: `node --test --test-name-pattern "deferral site plugin/skills/reflect/full-mode.md" tests/materiality-floor-conformance.test.js`
Expected: FAIL — `["no paragraph holds the deferral-route.js command form","restates a floor override"]`.

- [ ] **Step 3: Edit `full-mode.md`.**

Line 397, replace `Before this recommendation is rendered, apply … per the contract's recommend-only-path rule.` (from "Before this recommendation is rendered" through "recommend-only-path rule.") with:

````text
Before this recommendation is rendered, apply `_shared/materiality-floor.md`'s floor test with `node "${CLAUDE_PLUGIN_ROOT}/bin/deferral-route.js" --defer-reason {reason} --size {size} --priority {priority} --risk {risk} --agent-raised` (no `--severity`: an insight has none; axes as `recordPayload` scores it): on `digest` the batch table's Recommended column shows "Digest — below floor" instead of "Defer — {reason}", and the digest entry is written only when the human approves that row (or an auto path applies it), never before it reaches a human; `file` keeps "Defer — {reason}"; on `refused` or any other outcome the insight stays unactioned in the batch table, its row quoting what the command printed.
````

(The old sentence's negative rule "never before this recommendation reaches a human" is kept as "never before it reaches a human".)

Line 398, replace `A Capture recommendation's \`Defer-reason:\` is usually \`tangential\`, … and may render "Digest — below floor" instead.` (the last two sentences) with:

````text
Before it is rendered, run the Defer bullet's `deferral-route.js` command and follow its verdict the same way, `digest` rendering "Digest — below floor" in place of "Capture — {reason}".
````

- [ ] **Step 4: Run and see it pass**

Run: `node tools/run-tests.js tests/materiality-floor-conformance.test.js tests/deferral-gate-conformance.test.js tests/reflect-wrap-up-insights-staging-conformance.test.js`
Expected: the full-mode deferral-site test PASS; the recommend-only test (`digest entry is written only when the human approves that row`), the multi-branch citation count (≥ 2), the summary-surfacing tests and the hindsight pointer test PASS; `deferral-gate-conformance` PASS unmodified. `wc -c plugin/skills/reflect/full-mode.md` prints 39716 (≤ 39771).

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/reflect/full-mode.md
git commit -m "Route reflect Defer and Capture through deferral-route.js — no severity, insight stays unactioned on refusal (#5931)" -m "Claude-Session: https://claude.ai/code/session_016yg3znZfdV181e3d4oRJ3T"
```

### Task 4: Visual-review's record branches run the command

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/skills/visual-review/browser-review.md:247` (Issues Defer), `:248` (Issues Capture), `:253` (Ideas Defer), `:254` (Ideas Capture)
- Test: `tests/materiality-floor-conformance.test.js` (add the severity-mapping test after Task 1's block)

**Interfaces:**
- Consumes: Task 1's `read`, test file scaffolding.

- [ ] **Step 1: Write the failing test** (Review Focus 5, plan-review Decision 2), appended after Task 1's block:

```js
// --- #5931 Task 4: visual-review's Issue severities onto the command's (plan-review Decision 2) ---
const VISUAL_SEVERITY_MAP = ['Critical `critical`', 'Major `medium`', 'Minor `low`', 'Cosmetic `info`', 'none for an Idea'];
function visualSeverityProblems(text) {
  const defer = text.split('\n').find((l) => l.startsWith('- **Defer** (new work record — born-ready'));
  if (!defer) return ['the Issues Defer bullet is missing'];
  return VISUAL_SEVERITY_MAP.filter((m) => !defer.includes(m)).map((m) => `the Issues Defer bullet does not map ${m}`);
}
test('#5931 visual-review maps its Issue severities onto the route command\'s', () => {
  assert.deepStrictEqual(visualSeverityProblems(read('plugin/skills/visual-review/browser-review.md')), []);
});
for (const m of VISUAL_SEVERITY_MAP) {
  test(`#5931 go-red: dropping ${m} fails the visual-review severity map`, () => {
    const text = read('plugin/skills/visual-review/browser-review.md');
    const mutated = text.split(m).join('');
    assert.notEqual(mutated, text, `anchor ${m} not in browser-review.md`);
    assert.deepStrictEqual(visualSeverityProblems(mutated), [`the Issues Defer bullet does not map ${m}`]);
  });
}
```

- [ ] **Step 2: Run and see it fail**

Run: `git grep -n -F 'none for an Idea' -- plugin/skills/visual-review/browser-review.md`
Expected: FAIL — exit 1, no match (probed at plan time: exit 1).
Run: `node --test --test-name-pattern "visual-review|deferral site plugin/skills/visual-review" tests/materiality-floor-conformance.test.js`
Expected: FAIL after Step 1 — the mapping test reports all five literals missing, each go-red test fails on `anchor … not in browser-review.md`, and the deferral-site test reports `["no paragraph holds the deferral-route.js command form","restates a floor override"]`.

- [ ] **Step 3: Edit `browser-review.md`.**

Line 247, replace `Before creating the record, apply \`_shared/materiality-floor.md\`'s floor test: … (or an auto path applies it).` with:

````text
Before creating the record, apply `_shared/materiality-floor.md`'s floor test with `node "${CLAUDE_PLUGIN_ROOT}/bin/deferral-route.js" --defer-reason {reason} [--severity {severity}] --size {size} --priority {priority} --risk {risk} --agent-raised` (`--severity` for an Issue: Critical `critical`, Major `medium`, Minor `low`, Cosmetic `info`; none for an Idea): an item it routes `digest` shows "Digest — below floor" in the Recommended column instead, and only writes the digest entry once the human approves that row (or an auto path applies it); `file` keeps the Defer; on `refused` or any other outcome the row recommends neither and stays open, quoting what the command printed.
````

Line 248, replace `This branch is subject to \`_shared/materiality-floor.md\`'s floor test like any other filing branch: … same as the Issues Defer bullet above.` with `Before invoking capture, run the Issues Defer bullet's \`deferral-route.js\` command and follow its verdict the same way.`

Line 253, replace `Since an Ideas-Defer item is \`tangential\` by default, … following the same before-render check as the Issues Defer bullet above.` with `Before render, run the Issues Defer bullet's \`deferral-route.js\` command (no \`--severity\`) and follow its verdict the same way.`

Line 254, replace ` (an idea's usual reason is \`tangential\`, … same as the Ideas Defer bullet above).` (leading space through the closing `).`) with `; before invoking capture, run the Ideas Defer bullet's \`deferral-route.js\` command and follow its verdict the same way.`

- [ ] **Step 4: Run and see it pass**

Run: `node tools/run-tests.js tests/materiality-floor-conformance.test.js tests/deferral-gate-conformance.test.js tests/visual-decision-contract-conformance.test.js tests/demo-visual-decision-adoption.test.js`
Expected: the visual-review deferral-site test, the mapping test and its five go-red tests PASS; the recommend-only test (`writes the digest entry once the human approves that row`) and multi-branch count (≥ 2) PASS; the other three files PASS unmodified. `wc -c plugin/skills/visual-review/browser-review.md` prints 27532 (≤ 27796).
Then the Review Focus 5 probe: `node plugin/bin/deferral-route.js --defer-reason pre-existing-outside-diff --severity medium --size low --priority low --risk low --agent-raised` prints `{"verdict":"digest","rule":"floor",…}` (a Major with all-low axes digests), and the same with `--severity critical` prints `{"verdict":"file","rule":"severity",…}` (observed at plan time).

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/visual-review/browser-review.md tests/materiality-floor-conformance.test.js
git commit -m "Route visual-review record branches through deferral-route.js — only Critical takes the severity rule, Ideas pass none (#5931)" -m "Claude-Session: https://claude.ai/code/session_016yg3znZfdV181e3d4oRJ3T"
```

### Task 5: The wrap-up residue sweep and leftover routing run the command

**Role:** transcription
**Review risk:** high

**Files:**
- Modify: `plugin/skills/wrap-up/residue-sweep.md:165-173` (`remedy: record` routing), `:181-183` (Not on the ledger-narrowing path)
- Modify: `plugin/skills/wrap-up/leftover-routing.md:27-32` (Materiality floor, before composing)
- Test: `tests/materiality-floor-conformance.test.js` (Task 1's tests, no change)

Both files are hard-wrapped near 100 columns; keep the command's inline code span on one line (it may exceed the wrap width) so no span breaks. Both end within 3 bytes of their start size: copy the replacement text exactly.

- [ ] **Step 1: No new test** — Task 1's two deferral-site tests cover both files.

- [ ] **Step 2: Run and see it fail**

Run: `git grep -n -F 'bin/deferral-route.js' -- plugin/skills/wrap-up/residue-sweep.md plugin/skills/wrap-up/leftover-routing.md`
Expected: FAIL — exit 1, no match (probed at plan time: exit 1).
Run: `node --test --test-name-pattern "deferral site plugin/skills/wrap-up" tests/materiality-floor-conformance.test.js`
Expected: FAIL — both tests report `["no paragraph holds the deferral-route.js command form","restates a floor override"]`.

- [ ] **Step 3: Edit both files.**

`residue-sweep.md`, replace lines 165-173 (from `reaches Phase 2's per-item drill first applies` through `test once that value is chosen, before the record is composed.`; line 173's trailing `Otherwise it composes exactly as ledger Phase` stays) with:

````text
reaches Phase 2's per-item drill first applies `_shared/materiality-floor.md`'s floor test with
`node "${CLAUDE_PLUGIN_ROOT}/bin/deferral-route.js" --defer-reason {reason} --size {size} --priority {priority} --risk {risk} --agent-raised`:
on `digest` its Step 1 option is relabeled `"Digest — below floor"` instead of `"Route to a
record"`, so the human sees the actual destination before choosing it, never silently substituted
after approval; choosing it appends a digest entry, not a record, skipping the composition
below. `file` keeps the option; `refused` or any other outcome offers neither, naming the
command's output. This sweep's own end-of-run summary states the digest comment URL and the count
routed this run, per `_shared/materiality-floor.md`'s "Digest URL and count surfacing" section.
For an item whose reason the drill itself picks (the "anything else" case above), run the command
once that value is chosen, before the record is composed.
````

`residue-sweep.md`, replace `floor is not consulted on that path. \`_shared/ledger-format.md\` is deliberately not an adopter of` + the next two lines (through `alongside the digest's other coverage items.`) with `floor is not consulted on that path; only \`_shared/ledger-format.md\`'s control mode runs the command.`

`leftover-routing.md`, replace lines 27-32 (from `**Materiality floor, before composing.**` through `proceeds to the ordinary staging steps below unchanged.`; line 33's `This is not an exception …` stays) with:

````text
**Materiality floor, before composing.** Run `_shared/materiality-floor.md`'s floor test on each
section reaching here, `{reason}` from the fix-exhaust gate above:
`node "${CLAUDE_PLUGIN_ROOT}/bin/deferral-route.js" --defer-reason {reason} --size {size} --priority {priority} --risk {risk} --agent-raised`.
`digest` routes it to the digest container instead (log the contract's `AUTO` line when a run
directory resolves; skip the steps below); `file` stages it as below; `refused` or any other
outcome makes it an `open` ledger item for Phase 2's drill, naming the command's output.
````

- [ ] **Step 4: Run and see it pass**

Run: `node tools/run-tests.js tests/materiality-floor-conformance.test.js tests/deferral-gate-conformance.test.js tests/ledger-row-writer-conformance.test.js tests/wrap-up-flaky-escalation-row.test.js tests/bin-lib/wrap-up/ledger-write.test.js tests/absence-grep-control-check-prose.test.js`
Expected: both wrap-up deferral-site tests PASS; summary-surfacing tests (whitespace-collapsed `digest comment URL and the count routed`) PASS; all other files PASS unmodified. `wc -c` prints 17219 for residue-sweep.md (≤ 17222) and 16715 for leftover-routing.md (≤ 16717).

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/wrap-up/residue-sweep.md plugin/skills/wrap-up/leftover-routing.md
git commit -m "Route wrap-up residue and leftover deferrals through deferral-route.js — refusal leaves the item for the drill (#5931)" -m "Claude-Session: https://claude.ai/code/session_016yg3znZfdV181e3d4oRJ3T"
```

### Task 6: Control mode's `belowFloor` comes from the verdict

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/skills/_shared/ledger-format.md:171-178` (Standalone run paragraph), `:207-209` (supervised/trusted fall-through), `:211` (control-mode paragraph); `plugin/skills/wrap-up/review-console.md:123` (On approval step 10)
- Test: `tests/control-mode-console-prose.test.js` (`LEDGER_CLAIMS` lines 61-70, `STEP_10_CLAIMS` line 103)
- Read only: `plugin/bin/lib/console/residue-convergence.js` — line 77's `item.belowFloor === true` is the consumer; its tests run unmodified in Step 4.

Pin inventory: `STEP_10_CLAIMS` row 103 `` '`belowFloor` judged per `_shared/materiality-floor.md`' `` — retargeted to three rows: ``["`belowFloor` from that paragraph's `deferral-route.js` call", 'step 10 does not set an insight item belowFloor from the deferral-route.js verdict']``, ``['`false` on `refused` or any other outcome', 'step 10 does not set belowFloor false on a refused or unreadable verdict']``, ``['no `deferReason`: no call, `false`', 'step 10 does not skip the command for an insight with no deferReason']``. Every other `STEP_10_CLAIMS` row is kept; its needles (`--converge`, `source: 'insight'`, `id: 'insight-{row}'`, `status: 'open'`, `Recommended-cell reason`, `writes no ledger row`, `` as step 7 creates a `Q#` ``, `` `carried` → nothing more ``, `` `digested` → the digest entry only ``, `exit 2, 3 or 6`) all survive the edit, and the `GATE` literal on step 10 is untouched. `LEDGER_CLAIMS` gains two rows after line 69 (the narrowing slice runs from `#### Ledger narrowing` to `\nAfter Phase 1 (and, when the capability`, so it holds line 211): ``['prints `digest` (`false` on `file`, `refused` or any other outcome', 'the control-mode paragraph does not set belowFloor from the deferral-route.js verdict']`` and ``['no `deferReason`: no call, `false`', 'the control-mode paragraph does not skip the command for an item with no deferReason']``, plus two for the severity source: ``["`{severity}` the row's `severity={severity}` token", "the control-mode paragraph does not read a row's severity token"]`` and ``['else `high` for a `review`-phase row', 'the control-mode paragraph does not pass --severity high for a review row with no severity']``. The existing go-red loops (lines 81-87, 120-126) give every new row a message-matched control. `tests/reflect-wrap-up-insights-staging-conformance.test.js`'s step 10 needles (lines 71-78, 88) stay verbatim.

- [ ] **Step 1: Edit the rows** in `tests/control-mode-console-prose.test.js` as listed.

- [ ] **Step 2: Run and see it fail**

Run: `git grep -n -F 'deferral-route.js' -- plugin/skills/_shared/ledger-format.md plugin/skills/wrap-up/review-console.md`
Expected: FAIL — exit 1, no match (probed at plan time: exit 1).
Run: `node --test tests/control-mode-console-prose.test.js`
Expected: FAIL after Step 1 — 27 tests fail (scratch run): `AC2.1: ledger-format.md routes every open item …` reports the four new messages; `AC2.1: review-console.md step 10 …` reports the three new step-10 messages; each existing go-red loop entry for those two sections fails because the new rows are still missing.
Run: `node --test --test-name-pattern "deferral site plugin/skills/_shared/ledger-format.md" tests/materiality-floor-conformance.test.js`
Expected: FAIL — `["no paragraph holds the deferral-route.js command form"]`.

- [ ] **Step 3: Edit the two files.** Paragraphs and step 10 stay one physical line where they are one today.

`ledger-format.md` line 211, replace `` `belowFloor` judged per `_shared/materiality-floor.md`, `deferReason` per `wrap-up/residue-sweep.md`'s `remedy: record` mapping (omitted when no mapping applies) — `` with:

````text
`deferReason` per `wrap-up/residue-sweep.md`'s `remedy: record` mapping (omitted when none applies), `belowFloor` `true` only when `node "${CLAUDE_PLUGIN_ROOT}/bin/deferral-route.js" --defer-reason {reason} [--severity {severity}] --size {size} --priority {priority} --risk {risk} --agent-raised` prints `digest` (`false` on `file`, `refused` or any other outcome; no `deferReason`: no call, `false`), `{severity}` the row's `severity={severity}` token, else `high` for a `review`-phase row, else omitted —
````

(`{reason}` is the item's mapped `deferReason`. The `high` default is the fail-safe for a review finding whose row lost or never had the token: it files, so it never digests past release Step 3's `high-severity finding` gate.) The item JSON shape `{ "id", "source", "text", "status", "deferReason", "belowFloor" }` is unchanged.

`ledger-format.md` lines 207-209, replace `unchanged per-item drill below exactly as today. "Nothing stays unresolved" is true at \`unattended\`` + newline + `only; the fail-closed-to-asking rule stays correct wherever a human can actually answer.` with `unchanged per-item drill below. "Nothing stays unresolved" holds at \`unattended\` only.`

`ledger-format.md` lines 171-174, replace `reconcile a staged file into a real record. Note what the reason is **not**: the console is no` through `` `/wrap-up` run at all, so no wrap-up ever executes to render one. Apply Phase 3's standalone `` with:

````text
reconcile a staged file into a real record, as this `/claude-tweaks:ledger resolve` runs
outside any `/flow` or `/wrap-up` run, never because of the mode. Apply Phase 3's standalone
````

`ledger-format.md` lines 175-178, replace `behavior inline here instead —` with `behavior inline here —`, and `entry above, since no run-dir log exists to write it to.` with `entry above.` (the rest of those lines unchanged).

`review-console.md` line 123 (step 10), four replacements:
- `converge it with \`console-resolve.js --converge\` (the call \`_shared/ledger-format.md\`'s control-mode paragraph gives) as` → `converge it per \`_shared/ledger-format.md\`'s control-mode paragraph (\`console-resolve.js --converge\`) as`
- `` `belowFloor` judged per `_shared/materiality-floor.md`; `` → ``` `belowFloor` from that paragraph's `deferral-route.js` call (`false` on `refused` or any other outcome; no `deferReason`: no call, `false`); ``` — matching ledger-format.md's control-mode wording, so a row whose reason `refused-proposals.md` refused converges with `belowFloor: false` and no call.
- `approving this step never writes a memory file or files upstream feedback on its own; those two destinations resolve exclusively through this console's own separate \`M#\` (step 8) and \`U#\` (step 9) rows.` → `approving this step never writes a memory file or files upstream feedback on its own; only the \`M#\` (step 8) and \`U#\` (step 9) rows resolve them.`
- `An insights row lives inside one staged file, not a console item, so \`--set-item\` cannot reach it.` → `An insights row is not a console item, so \`--set-item\` cannot reach it.`

- [ ] **Step 4: Run and see it pass (AC4.1)**

Run: `node tools/run-tests.js tests/control-mode-console-prose.test.js tests/materiality-floor-conformance.test.js tests/bin-lib/console/residue-convergence.test.js tests/deferral-gate-conformance.test.js tests/ledger-reader-ownership-conformance.test.js tests/staged-patch-contract.test.js tests/reflect-wrap-up-insights-staging-conformance.test.js tests/console-resolve-conformance.test.js`
Expected: PASS, every file — all six deferral-site tests now green; `residue-convergence.test.js` and `deferral-gate-conformance.test.js` unmodified. `wc -c` prints 44939 for ledger-format.md (≤ 44944) and 43996 for review-console.md (≤ 44011).
Then the AC4.1 real-writer probe (plan-time run, recorded): spawn the CLI for `blocked-external` all axes low → `digest`; `blocked-external` priority medium → `file`; `not-a-reason` → exit 2 `refused`; map each to `belowFloor = verdict === 'digest'` and pass the items to the real `convergeResidue` (`plugin/bin/lib/console/residue-convergence.js`) with `compose: () => null`. Observed at plan time: `ledger-1: exit 0 verdict digest` → `digested`; `ledger-2: exit 0 verdict file` → `carried`; `ledger-3: exit 2 verdict refused` → `carried`. Re-run it from a scratch script (uncommitted), write its output to `$PIPELINE_RUN_DIR/evidence/5931-ac4-converge.txt`, and log an `AC evidence` entry as in Task 1 Step 2 naming `AC4.1`.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/_shared/ledger-format.md plugin/skills/wrap-up/review-console.md tests/control-mode-console-prose.test.js
git commit -m "Set control-mode belowFloor from the deferral-route verdict — ledger items and console insights alike (#5931)" -m "Claude-Session: https://claude.ai/code/session_016yg3znZfdV181e3d4oRJ3T"
```

### Task 7: Verify the acceptance criteria and the corpus suites

**Role:** transcription

**Files:**
- Test: `tests/materiality-floor-conformance.test.js`, `tests/deferral-gate-conformance.test.js`, `tests/bin-lib/deferral-route/route.test.js`, `tests/deferral-route-cli.test.js`, and the corpus suites in Step 3 (no edits)
- Waived `bin/deferral-route.js`: landed in #5930 and read only; Step 1 runs it for AC3.
- Waived `docs/skill-authoring.md`: read for the plugin-root placeholder and byte-cut rules, quoted in Global Constraints; no edit.

`{base}` below is the commit Task 1 builds on: record `git rev-parse HEAD` before Task 1 starts (75322a921e at plan time; `plugin/` and `tests/` are identical at 9820223283).

- [ ] **Step 1: AC3 — run the review routing's documented command with the fixture values** (the staging paragraph's form, placeholders filled):

Run: `node plugin/bin/deferral-route.js --defer-reason pre-existing-outside-diff --severity low --size low --priority low --risk low --agent-raised`
Expected (observed at plan time): `{"verdict":"digest","rule":"floor","input":{"deferReason":"pre-existing-outside-diff","severity":"low","size":"low","priority":"low","risk":"low","agentRaised":true}}`, exit 0 — AC3.1.
Run: `node plugin/bin/deferral-route.js --defer-reason pre-existing-outside-diff --severity high --size low --priority low --risk low --agent-raised`
Expected (observed at plan time): `{"verdict":"file","rule":"severity","input":{"deferReason":"pre-existing-outside-diff","severity":"high","size":"low","priority":"low","risk":"low","agentRaised":true}}`, exit 0 — AC3.2.
Write both outputs to `$PIPELINE_RUN_DIR/evidence/5931-ac3-verdicts.txt` and log an `AC evidence` entry naming `AC3.1` and `AC3.2`.

- [ ] **Step 2: AC2.1, AC2.3, AC6.1 and the CLI's own suites**

Run: `node tools/run-tests.js tests/materiality-floor-conformance.test.js tests/deferral-gate-conformance.test.js tests/bin-lib/deferral-route/route.test.js tests/deferral-route-cli.test.js`
Expected: PASS, every file — the six `#5931 deferral site …` tests and their go-red controls green (AC2.1). `git diff --stat {base}..HEAD -- tests/deferral-gate-conformance.test.js tests/bin-lib/console/residue-convergence.test.js` prints nothing — AC6.1 and AC4.1's "unmodified". In `tests/materiality-floor-conformance.test.js`, `git diff {base}..HEAD` shows the no-restatement test (lines 192-202 at base) unchanged — AC2.3.

- [ ] **Step 3: Corpus suites every skill edit can trip**

Run: `node tools/run-tests.js tests/skill-prose-plugin-root-invocations.test.js tests/skill-fence-guard-shapes.test.js tests/session-tmp-placeholder-quoting-conformance.test.js tests/skill-size-single-source.test.js tests/skill-graph-dangling-pointer.test.js tests/release-run-dir-lifecycle-conformance.test.js tests/bin-lib/skill-audit/context-cost.test.js tests/bin-lib/skill-audit/anti-patterns.test.js tests/bin-lib/skill-audit/house-structure.test.js`
Expected: PASS, every file (each passed in the plan-time scratch run).

- [ ] **Step 4: AC1.1 and the repo-wide command-form sweep**

Run: `git grep -c -F 'node "${CLAUDE_PLUGIN_ROOT}/bin/deferral-route.js" --defer-reason {reason}' -- plugin/skills`
Expected: one count each for `_shared/ledger-format.md`, `_shared/materiality-floor.md`, `reflect/full-mode.md`, `review/step3-routing.md`, `visual-review/browser-review.md`, `wrap-up/leftover-routing.md`, `wrap-up/residue-sweep.md` — seven files (`release/disposition.md` and `wrap-up/review-console.md` reach it through review's Defer bullet and ledger-format.md's control-mode paragraph).
Run: `git grep -n -E "always clears|override clears" -- plugin/skills/review/step3-routing.md plugin/skills/reflect/full-mode.md plugin/skills/wrap-up/residue-sweep.md plugin/skills/wrap-up/leftover-routing.md plugin/skills/visual-review/browser-review.md plugin/skills/_shared/ledger-format.md`
Expected: no output. Control, run first against base: `git grep -n -c -E "always clears|override clears" {base} -- plugin/skills/review/step3-routing.md plugin/skills/reflect/full-mode.md plugin/skills/visual-review/browser-review.md` prints 2, 1 and 3 (seen at plan time on 75322a921e), so the search can find its target.

- [ ] **Step 5: AC5.1 sizes.** Run `wc -c` on the nine edited skill files and compare with the Global Constraints table: every file must end at or below its start (materiality-floor.md 15408 ≤ 15413, step3-routing.md 39104 ≤ 39186, disposition.md 15559 ≤ 15590, full-mode.md 39716 ≤ 39771, browser-review.md 27532 ≤ 27796, residue-sweep.md 17219 ≤ 17222, leftover-routing.md 16715 ≤ 16717, ledger-format.md 44939 ≤ 44944, review-console.md 43996 ≤ 44011). A file above its start is a failed step: trim restatement in that file per the trim-inventory rule and re-run, never report growth. The PR body's AC5 section lists each file's start → end bytes and the trim inventory. If an upstream merge landed in any of these files after planning, re-measure start with `git cat-file -s {base}:{path}` and end with `wc -c` before reporting (shared-contract-extraction's merge-time rule).

- [ ] **Step 6: Public-contract proof**

Proof(public-contract): The contracts an in-flight run on the previous release reads stay compatible: `tests/bin-lib/deferral-route/route.test.js` (exhaustive oracle plus the byte-pin of `## The floor`/`## Overrides`) and `tests/bin-lib/console/residue-convergence.test.js` pass unmodified, so the prose an older run applies and the verdict the command gives agree, and the control-mode item shape `{id, source, text, status, deferReason, belowFloor}` is unchanged; the Audit line keeps its `AUTO {time} — materiality-floor:` prefix and only its free-text tail gains `rule={rule}`, and `git grep -n -F "routed below floor" -- plugin/bin tests` returns no reader; the removed `## Consumers` heading has no citing file (`git grep -n -E "materiality-floor\.md.{0,40}Consumers" -- plugin docs tests ':!docs/superpowers/plans' ':!docs/plans/*-ledger.md'` matches nothing; exclusions added per #4579, and the control — the same command without them — matches this plan's trim-inventory line, so the search can find its target); `bin/deferral-route.js` already sits on this branch, so a skill citing it ships with it in one release.

No commit in this task unless a step above forced a fix; any fix is committed by path with the message style above.

## Spec coverage

| Spec item | Task |
|---|---|
| Deliverable 1 (floor names the code twin and command form; reason, severity, axes, `--agent-raised`/`--human`) | Task 1 |
| Deliverable 2 (six sites run the command, no restatement) | Tasks 2-6 (plus release disposition and review-console step 10) |
| Deliverable 3 (`/claude-tweaks:capture` unchanged) | Global Constraints; no task edits it |
| Deliverable 4 (`refused` and any other outcome leave the item open, per site) | Tasks 2-6 text; Task 1 `any other outcome` assertion; Task 2 release fact; Task 6 step-10 rows |
| Deliverable 5 (`--agent-raised` everywhere; control mode `belowFloor` from verdict, no call without `deferReason`) | Task 1 assertion; Task 6 |
| Deliverable 6 (`rule={rule}` in the digest audit line) | Task 1 (Audit line template every site cites) |
| Deliverable 7 (conformance assertion; line-192 test kept) | Task 1 |
| Deliverable 8 / AC5.1 (every file ≤ start, Decision 1) | Global Constraints size table and trim inventory; Task 7 Step 5 |
| Decision 2 (visual-review severity map) | Task 4; Review Focus 5 |
| AC1.1 | Task 7 Step 4; Task 1 deferral-site tests |
| AC2.1 | Task 1 deferral-site tests and go-red controls; Task 7 Step 2 |
| AC2.2 | Task 1 Step 2 (base-tree red, logged) |
| AC2.3 | Task 7 Step 2 |
| AC3.1, AC3.2 | Task 7 Step 1 |
| AC4.1 | Task 6 Step 4 |
| AC6.1 | Tasks 2-6 Step 4; Task 7 Step 2 |
