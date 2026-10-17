# 0024. Skill size limits block only where they guard a platform limit

- **Status:** accepted
- **Date:** 2026-10-17
- **Context:** #3230 (rethink skill byte ceilings), decomposed as parent #3305 into #3306–#3311; reverses #2020; supersedes the ceiling numbers of [0016](0016-composed-bundles-gate-context-size-not-per-file-ceilings.md)

## Context

One global byte ceiling (`CEILING_BYTES`, raised in steps from 40 KB to 50 KB) gated every shipped skill file and, since #1990, every composed bundle. It kept tipping `main` red on concurrent merges. Two branches each green alone could merge into a file over the line, and each raise only moved the cliff (#3230). #2020 had decided every `SKILL.md` keeps a hard ceiling in `npm test`.

The number was never derived from a limit. The platform limits that actually exist, read from Claude Code 2.1.302 (calibrated in session; `plugin/bin/lib/skill-audit/budgets.js`'s header records the samples):

- **Read tool:** 25,000 tokens and 2,000 lines per call without `offset`/`limit`. Over the cap, Read returns a paged partial view, so the file cannot be read in one call.
- **Skill listing:** budget = context tokens × 4 × 0.01 characters; each description is capped at 1,536 characters.
- **Bash inline output:** 30,000 characters. This, not a single-read ceiling, is what truncated #611's 34.3 KB file. Skill prose instructs Read, never `cat`, so this cap is recorded and is **not** a rail.

## Decision

Four goals, each with its own mechanism:

1. **Guard the platform limit (blocks).** The Read-limit rail: `RAIL_BYTES` = 25,000 tokens × 2.1 B/token (the densest measured file) = 52,500 B, and `RAIL_LINES` = 2,000, at `RAIL_RATIO` 1.0. An 80% rail landed under 17 shipped files at the measured ratio and was set to the cap at #3306's plan gate. The margin is the conservative bytes-per-token itself. The rail binds every shipped skill `.md` and every composed bundle (`rail.js`; the `rail:` tests in `context-cost.test.js`), and each description's 1,536-character cap.
2. **Show per-invocation cost (never blocks).** `/review`'s skill load delta (floor and closure per entry point, #3307) and `/harness-health`'s transcript-measured load (#3309).
3. **Keep files coherent (evidence, never blocks).** The corpus-relative `sizeOutlier` bloat signal (#3308).
4. **Compose, don't fragment.** [0016](0016-composed-bundles-gate-context-size-not-per-file-ceilings.md)'s composition-over-fragmentation principle stands, and the remedy depends on which number is near the rail. A composed bundle near or over the rail is fenced with `when:` markers, or composed. A raw file near or over the rail has bytes cut, or a genuinely lazy section that some runs never read moved into its own file, which 0016 allows; fencing does not help there, because the rail measures the raw file with only the marker lines stripped. Never a "read X now" split that every run follows, since it moves bytes without cutting what a run loads.

Plan-audit keeps its near band at 90% of the limit (now `RAIL_BYTES`), unchanged from its existing convention, as a plan-time heads-up threshold, not re-derived. Its JSON envelope keys keep their names.

`budgets.js`'s exports are read in code by `plan-audit`'s `checks.js` (`RAIL_BYTES`) and `rail.js` (`overRail`, `DESCRIPTION_MAX_CHARS`); harness-health's analysis procedure (`_shared/harness-health-analysis.md`) reaches them through `rail.js`; tests read them in `budgets.test.js`, `context-cost.test.js`, and plan-audit's `checks.test.js` and `cli.test.js`; and skill prose in `/build`, `/specify`, and `/harness-health` names `RAIL_BYTES`. Renaming `RAIL_BYTES` or `overRail` means updating each of these deliberately.

## Consequences

- No size number tips `main` red unless a file or bundle genuinely cannot be read in one call. The concurrent-merge disclosure (`merge-size-probe`) goes with the cliff it predicted.
- #2020's hard per-`SKILL.md` gate is reversed. #3311 deletes `CEILING_BYTES`, the warning tier, `COMPOSED_STEP_EXCEPTIONS`, `merge-size-probe`, and the per-file test pins.
- **Accepted trade-off:** the rail sits at the cap with no ratio margin. Tokenizer drift, `when:` marker lines a direct Read still sees, and a denser-than-measured file are absorbed only by the 2.1 B/token floor until the calibration is re-run (#3304 tracks drift checks).
- Cost is visible but no longer gated. A file can grow expensive below the rail, and the load delta and the size outlier make that a reviewer's judgment, not a test failure.

## Alternatives considered

- **Keep one global ceiling and raise it again:** rejected. It is the cliff that kept tipping `main` red, and no limit derives its number.
- **Per-file ceilings tuned per file:** rejected. Hundreds of numbers to maintain, still unrelated to any platform limit.
- **A rail at 80% of the Read cap:** rejected at #3306's plan gate. 42,000 B at the measured ratio sat under 17 shipped files.
- **A rail on the Bash 30,000-character cap:** rejected. Skills read with Read, and the cap sits below files shipping today.

## Update (2026-10-17, #3311)

#3311 shipped the deletions listed under Consequences, plus the description ceilings in `context-cost.js` and `bloat.js`'s ceiling signal. 0016's composed gate now runs only as the rail's composed check (`composedRailViolations`), with no per-step exceptions, and its per-file warning tier is gone. "The only size limit" is now enforced, not just documented: `tests/skill-size-single-source.test.js` fails when any file under `tests/` or `plugin/bin/` other than `budgets.js` declares or compares a skill-size number. That guard is one more consumer to update when `RAIL_BYTES` or `budgets.js` is renamed. It names the path as `SINGLE_SOURCE` and the rail's export names in `RAIL_NAMES`, and a rail name missing from that set is reported as unclassified. This does not revise the decision above; it records how it was enforced.
