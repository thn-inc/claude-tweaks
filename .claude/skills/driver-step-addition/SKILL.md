---
name: driver-step-addition
description: Use when adding a step to the pipeline driver's table (`STEPS` in `plugin/bin/lib/driver/steps.js`, walked by `plugin/bin/drive.js`), changing a step's stop class, or giving a step a new side effect. Lists every site the step lands in across `events.js`, `steps.js`, `run.js` and `tests/bin-lib/driver/run.test.js`, plus the decisions it owes: its default stop class, a per-result override, the ctx flag and interruptClass rung for a new durable side effect, the interrupt check after an await, neutralizing worker text, and the one-retry rule. Keywords - drive.js, driver, STEPS, STEP_NAMES, defineStep, stop class, STOP_CLASSES, OUTCOME_BY_CLASS, interruptClass, ctx flag, newCtx, finalEvent, settle unit, event vocabulary, express-lane port, harness, defaultScript.
---

# Driver step addition

## Overview

`plugin/bin/drive.js` takes each named record from admission to a draft PR. It walks `plugin/bin/lib/driver/steps.js`'s frozen `STEPS` table once per record. `run.js` owns only event emission, stop handling and interrupts, and it names no step, so most of a new step is one table entry.

Not all of it, though. The loop classifies an interrupted record by the side effects the record holds, and it sees only the effects a step records on `ctx`. #5218 shipped with run.js's header saying "adding a step is a table entry, never a change here". Review then found that `interruptClass`, `finalEvent` and `reportInterrupt` read flags that steps set. A step with a new durable side effect would therefore get the wrong interrupt class, and the header was narrowed (`8bcc7eef5`).

## Sites

| Site | What lands there |
|---|---|
| `plugin/bin/lib/driver/events.js` `STEP_NAMES` | The step's name, at its table position. This list is the event vocabulary. Event fields may be added but never renamed, because the settle unit reads the final line's `stop` |
| `plugin/bin/lib/driver/steps.js` | A `defineStep(STEP.{camelName}, STOP_CLASSES.{X}, fn)` entry, placed in `STEPS` at the same index as its name. A step that ports a section of `plugin/skills/_shared/express-lane.md` names that section in its comment. No test reads that prose, so the two are kept in step by hand |
| `plugin/bin/lib/driver/run.js` `newCtx` and `interruptClass` | Needed only for a new durable side effect. Initialize its flag in `newCtx`, and set it in the step once the effect exists. Then add a rung to `interruptClass` where its class falls in the ladder (`configWritten`, then `pushed`, then `runDir`, then `claimed`, else refused). Never add a step-name literal: `AC13.1` scans run.js's comment-stripped code for one |
| `realDeps` in `run.js` | Each new external call, as a `deps` member with its own bound (see `gh-api-module-pattern`). A new gh-shaped kind states its reason beside it, as `ghBatch` and `ghCreate` do |
| `tests/bin-lib/driver/run.test.js` | A happy-path reply in `defaultScript` for every call the step makes, because the harness throws `unexpected {kind} …` on anything else. A new gh-shaped dep kind joins the kind list in `dispatch` that refuses `pr merge` and `pr ready` (AC8). Add a `SCENARIOS` entry and a row in `AC7.1, AC7.7: outcome and stop class for every stop (table-driven)` for each new stop. A new flag also gets a case in `interruptClass keys on the side effect held` |
| `plugin/bin/lib/driver/settle.js` `selectRow`, `SETTLE_ROWS`, `CLASS_BY_ROW` | Needed for a new stop class: a `selectRow` case, a `SETTLE_ROWS` row and a `CLASS_BY_ROW` entry. Without the case, `selectRow`'s default settles the stop by the `blocked` row and flags it `unclassified`, and no test fails, because `selectRow`'s test lists the known classes by hand. A new pre-push `reason` must be one of `ESCALATION_REASONS`: `stopObject` passes it through `toEscalationReason`, which turns anything else into `express-error`. A new durable side effect that a pre-push stop must undo also needs a field in `stopObject`'s `created` and a settle call on the `pre-push` row |
| `docs/driver.md` | Copied by hand, and no test reads it. For a new step: the `step` list under "Event lines". For a new stop class: the "Outcome words" table, the `stop` object's class list, `settleRow`'s row list and the "When a run stops" table |

## Decisions each step owes

### Default class: what the record holds if this step fails

A step's class is the stop class of a failure inside it. It is keyed on what has been written by that point, never on the step's name or position. This is `driver-skill-outcome-taxonomy`'s rule of picking the word from the world, applied in code. `events.js`'s `OUTCOME_BY_CLASS` maps each class to an outcome word: refused to refused, claim to blocked, pre-push to express-escalated, blocked to blocked, and none to pending-review.

### Override per result when a failure still leaves a side effect

A step whose failure can still land something returns its own `stopClass` with the result:
- The push step re-reads `git ls-remote` after a failed `git push`. If origin's branch is at the checked HEAD, the step sets `ctx.pushed = true` and returns `blocked`, because the push landed.
- The run-dir step returns `pre-push` when its claim-log write fails, because the run directory already exists.
- The check step returns `blocked` on a non-zero `express-lane.js check` exit.

A `halt: false` result, like the summary step's, reports a failure on its own event without ending the record.

### Interrupts at await points

The loop yields to the event loop before every step and then checks `ctx.shared.interrupted`. A signal that arrives inside an awaiting step is reported at once by run.js's handler. So a step that awaits (`deps.sleep`, the worker) checks `ctx.shared.interrupted` after each await and stops before its next side effect: the pr step does this after its retry wait, and the ci step after each poll sleep. If the handler can report a step mid-flight, that step keeps on `ctx` whatever the interrupted line must carry, as the ci step does with `ctx.ci` and `ctx.ciWaitStartedAt`.

### Worker-controlled text is neutralized before it leaves

The worker can shape strings such as its summary, a path it named, or CLI stderr that may echo either. Each such string goes through `events.js`'s `neutralize` before it reaches an event `detail`, a commit message, a PR body or a log line (AC14.3). The rule itself is `headless-worker-launch`'s "What the consumer owes"; this is where each step applies it.

### One retry, and only after a read-back

`AC6.6: no other step is retried` pins that the claim, push, record-pr and set-config calls each run once. Only the pr step retries. A new retry follows the same shape:
1. Classify the failure on stderr and a timeout kill, never `err.message` (`gh-api-module-pattern`'s `batching-failure-posture.md`).
2. Read back whether the first attempt landed.
3. Retry once.

## Anti-Patterns

| Pattern | Why it fails here |
|---|---|
| Adding a step with a new durable side effect as a table entry only | `interruptClass` cannot see the effect, so a signal after it reports the rung below, and the settle unit settles the wrong state (#5218 review, `8bcc7eef5`) |
| Choosing a stop class from the step's name or position | A failed push that landed is `blocked`, not `pre-push`: the class follows what was written |
| A step-name literal in `run.js` | It breaks the table-only contract, and `AC13.1` fails on it |
| Retrying outside the pr step, or retrying a create blind | `AC6.6` fails, and a lost response may already have landed, so a blind retry opens a duplicate PR |
| Raw worker text in a `detail` | A `closes #N` or `@user` inside it reaches the forge (AC14.3) |
| A new stop class added to `STOP_CLASSES` and `OUTCOME_BY_CLASS` only | `selectRow` has no case for it, so settle runs the `blocked` row: the record is labelled `bot:blocked`, the final line's outcome reads `blocked` whatever the class maps to, and `unclassified` is the only sign |

## Reference

- Code: `plugin/bin/drive.js`; `plugin/bin/lib/driver/run.js` (`newCtx`, `interruptClass`, `finalEvent`, `reportInterrupt`, `realDeps`); `plugin/bin/lib/driver/steps.js` (`defineStep`, `STEPS`); `plugin/bin/lib/driver/events.js` (`STEP_NAMES`, `STOP_CLASSES`, `OUTCOME_BY_CLASS`, `neutralize`)
- Tests: `tests/bin-lib/driver/run.test.js` (`harness`, `defaultScript`, `SCENARIOS`)
- Journey: `docs/journeys/drive-a-named-record-to-a-draft-pr-5218.md`
- Related skills: `headless-worker-launch` (the worker step's rights and envelope), `driver-skill-outcome-taxonomy` (outcome words keyed on what landed), `gh-api-module-pattern` (the `deps` seam and its bounds)
