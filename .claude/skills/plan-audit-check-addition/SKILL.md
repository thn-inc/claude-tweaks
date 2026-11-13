---
name: plan-audit-check-addition
description: Use when adding a check to `plugin/bin/plan-audit.js`, or a new key or flag to an existing one — every site the change must land in, the gating-versus-warn-only decision, the skip-gate ruling, and the check-letter enumerations that have gone stale on each of the last two additions. Keywords - plan-audit, Check A, Check E, checks.js, parser.js, summaryLine, envelope key, warn-only, skip gate, Result interpretation, USAGE.
---

# Plan-audit check addition

`plugin/skills/build/plan-audit.md` owns the runtime procedure /build follows on the audit's output. This skill owns the build procedure for adding a check: every site it must land in, and the decisions each addition owes.

## The registration set

A check is not shipped until every row below lands in the same change.

| Site | What it gets |
|---|---|
| `plugin/bin/lib/plan-audit/parser.js` | The extractor for the check's input, exported. Keep "could not read" apart from "nothing here" (`parse-signal-discipline`) |
| `plugin/bin/lib/plan-audit/checks.js` | The check function returning `{ok, ...}`, exported, and named in the module's header comment |
| `plugin/bin/plan-audit.js` | The `report` key, a `summaryLine` part for every non-empty signal, the `pass` conjunction (gating checks only), and the header comment naming the check |
| `plugin/bin/lib/plan-audit/args.js` | Only for a new flag: the parser branch, `USAGE`, and a `UsageError` for any pairing that would silently ignore it |
| `plugin/skills/build/plan-audit.md` | The opening enumeration of mechanized checks, the envelope key list under `## Invocation`, one `## Result interpretation` bullet per result key, a `## What each check covers` bullet, and a skip-gate ruling |
| `plugin/skills/build/SKILL.md` Common Step 1.5 | The invocation line, when the check needs a new flag |
| `docs/plugin-structure.md` | The `plan-audit.js` usage line and the `build` row of the sub-file table. Both name the checks |
| `tests/bin-lib/plan-audit/{parser,checks,cli}.test.js` | Extractor, check and CLI-envelope tests |
| A prose test | Pins the new `plan-audit.md` bullets. With a new flag, also assert every restated invocation names exactly `USAGE`'s flags (`tests/plan-audit-check-e-prose.test.js`) |
| `plugin/skills/build/plan-review.md` Step 6 | The re-audit's list of checks it acts on for the amended spec and plan. A gating check missing from it reads as not re-checked |
| `plugin/skills/build/micro-plan.md` and `plugin/bin/lib/express/eligibility.js` | Only for a gating check that must also hold on a fast-lane record. Neither path writes an audited plan, so a record the check would stop is made ineligible for both: Check G added micro-plan condition 4 and the express `riskFlags` reason (`f01b05880`) |

## Decisions each addition owes

- **Gating or warn-only.** A gating check joins `pass` and can stop the build. A check built on a prose heuristic stays warn-only: `ok` always `true`, named in `summaryLine`, never in `pass`. Check E (#3099) is warn-only because "a hard gate on a heuristic would block builds on its false positives". State the choice in the check's comment and in its `What each check covers` bullet.
- **The skip gate.** On a trivial plan, Common Step 1.5 skips Checks A/B/C and headroom and runs only Check D, through `--bytes`. A new check either shares that gate or argues for an exception. Write the ruling into `plan-audit.md`, as #3099's "**Check E shares that gate too**" paragraph does. A read-only verb (`--bytes`, `--count-tasks`) never runs the new check, so refuse its flag beside them.
- **Absent input versus unreadable input.** An optional input left off the command line is a `skipped` result (`checkE: {ok: true, skipped: 'no-spec'}`). A named input that cannot be read exits 2, the same as an unreadable plan. Never fall back from the second to the first.
- **The audited plan is in the repo.** A check that walks the tree also sees the plan file. Check B reported every keyword-bearing plan as unplanned until #3099 (PR #3244) added the plan's own path to the planned set.
- **A corpus noise probe before a warn-only check ships.** A warn-only check is only as useful as its false-positive rate, and synthetic per-task fixtures never measure it. Before calling the check done, run it over every committed plan under `docs/superpowers/plans/` paired with its committed spec (`git ls-files '*/work/*-spec.md'`, matched on the record number the plan's name ends in), and over CRLF copies of a few of those plans. Count the entries per result class, and read every entry a well-formed plan produced: each is a defect to fix in this change, not a threshold to tune. #3602's per-task tests all passed on fixtures; the final review's run of Check F over 37 pairs found two noise classes no fixture had — a full-path waiver that missed a plugin-relative citation, and a CRLF plan that read as listing nothing — and cost a fix wave plus a scoped re-review (`2ebf43c34`).
- **Normalize every text input once, at the check's entry.** Line endings (`\r\n?` to `\n`) and path prefixes (a leading `./`) are normalized in the check function before any extractor sees the text, so two extractors reading the same input cannot disagree. Check F's CRLF defect was exactly that: `extractPathWaivers` normalized its input and `extractFileEntries` did not, until `checkF` normalized the plan once for both.
- **A gating check exempt from the skip gate gets its own read-only verb.** Check G (#4618) is gating, and a trivial plan or a fast-lane record is exactly where a skipped proof would pass, so it does not share the gate: `--risk-proofs --spec` runs it alone on the skip path. The verb makes the full audit's input reads (the `--repo-root` default, the policy read), so it and the full audit's `checkG` never disagree. It requires the input it reads and is refused beside the other read-only verbs. The skip sentence in `build/SKILL.md` Common Step 1.5 handles its result as the full audit does, and stops on any exit other than 0 and 1, or on output with no result key (review added that stop, `af8f6fc3b`). Measure that file against its byte rail before adding to it: Check G's sentence left `build/SKILL.md` with no headroom.

## Anti-patterns

| Pattern | Why it fails here |
|---|---|
| Adding the new check's bullets but leaving the existing check-letter enumerations alone | No test reads them. Adding Check D needed a follow-up commit (`1922e4f6b`) for the stale "A/B/C" in `plan-audit.js`, `checks.js` and `docs/plugin-structure.md`. Adding Check E missed the `checks.js` header (caught in review on PR #3244) and the `docs/plugin-structure.md` `build` row. Run `git grep -nE 'Checks? A/B' -- plugin docs` before calling the change done |
| A check list in a file that re-runs the audit, left naming only the older checks | After Check G shipped, `plugin/skills/build/plan-review.md` Step 6 still read "Checks A, C, D, headroom, and Check E", so the re-audit of an amended spec never named the new gating check. Review caught it (`af8f6fc3b`). The `Checks? A/B` grep above does not match that spelling, so also run `git grep -nE 'Checks A[,/-]' -- plugin docs` |
| A warn-only key with no `summaryLine` part | The agent reads the human line, so a signal it never names is never seen. Every non-empty informational key gets its own part (`Composed: N unmeasured`, `Check E: N unparsed AC item(s)`) |

## Evidence

- Check E (#3099): PR #3244 (squash-merged; its branch commits are not on main).
- Check D: `89baa0953`, enumeration follow-up `1922e4f6b`.
- Check G (#4618): micro-plan and express-lane ineligibility `f01b05880`; review fixes `af8f6fc3b` (plan-review re-audit list, skip-path stop).
