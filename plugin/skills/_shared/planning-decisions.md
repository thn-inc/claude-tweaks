# Planning Decisions — which planning questions go to the user, and how the rest are settled

This file is the one statement of which planning questions a human answers and how every other one is settled and written down (#6051). It applies only when policy key `planning-decisions` resolves `asked-classes`; under the default `ask-all` every plan-review gap is asked, and nothing here changes that. `build/plan-review-asked-classes.md` cites it for build-time plan review today; specify-time planning will cite it later. Cite this file's sections by name rather than restating the classes.

## Asked classes

A question is asked only when it falls in one of three classes.

**(a) Design-level.** Settling it changes what the record or its design doc says the work is for, who it serves, its shape, or a goal, non-goal or anti-goal.

**(b) Hard to undo.** The question falls in a risk category the record keeps in `Risk-flags:`. When it plainly falls in a category the record does not flag, the flag is added first through `bin/risk-flags.js add` (add, never drop), the question is asked, and the plan owes that flag's Check G proof.

**(c) Contradiction.** No reading keeps every Acceptance Criterion and recorded decision intact.

A row whose readings all break an Acceptance Criterion or recorded decision is (c) whatever its topic.

The classifier is the build's plan review (the controller), never the reviewer. The reviewer reports the finding and its readings; the controller decides the class against this file.

## Settled path

Every other question is settled: among readings that keep every Acceptance Criterion and recorded decision intact, take the one closer to stated intent (the criterion-as-written reading when the row came from a criterion change).

When two readings keep every Acceptance Criterion and recorded decision intact and sit equally close to the stated intent (the record body and its design doc), take the one that changes fewer observable contracts.

A settled question is never asked in any posture (`auto`, `confirm`, `interactive`, `hybrid`). It is written down in the `## Line forms` shape.

## Doubt rule

Class (b) is bounded to the declared categories: the four built-ins (`migrations`, `auth`, `public-contract`, `irreversible-side-effect`) plus policy `risk-categories`. A question that does not plainly fall in one is settled, never asked.

Policy `risk-categories` extras count as declared only when policy `control-mode` resolves `on`, the rule `bin/risk-flags.js add` reads them by; with control mode off the declared categories are the four built-ins alone.

Plainly means the question is about the category's own subject: a schema or data migration, who may authenticate or what an unauthenticated caller may reach, an interface outside callers depend on, or a side effect that cannot be reversed. Touching a file that such a subject also touches is not enough.

## Line forms

Each settled question is written as one line: `Settled at planning: {finding} — chose {reading}; not {other reading}`.

Each question the user answered is written as one line: `Decided by the user at planning: {finding} — chose {reading}; not {other reading}`.

Both forms go under an additive `## Planning Decisions` section that never edits an existing criterion's line.

A row an answered round returns gets a `Decided by the user at planning:` line and is never asked again: its `{reading}` is the reading the user's recorded decision implies, and the line quotes that decision.

## Asking

One `AskUserQuestion` per question set, at most four questions per call: the recommended reading first, labelled `(Recommended)`, then the other reading, then `Stop the build` (build) or `Leave for later` (specify).

The recommended reading is the one `## Settled path` would pick; for a class (c) row, where that rule cannot choose, it is the reviewer's Reading A.

## Worked examples

Classify a new row by the closest example below.

**Settled, #4265.** The finding: which `error` string the claim release returns when the fresh read shows a competing run's live claim. Reading A: `not this run's claim`. Reading B: `claim held by another run`. Neither reading changes what the work is for, and both keep every criterion. Neither falls in a category the record flags, and the `releaseFailed` string is read only by the plugin's own skills, so it does not plainly fall in `public-contract`. Reading A is closer to stated intent, because the record's deliverable asks for an error that says the claim is not this run's. The line: `Settled at planning: which error string the release returns for a competing live claim — chose not this run's claim; not claim held by another run`.

**Settled, #4786.** The finding: the record asks to update the two prompt files and `docs/hooks.md`, but does not say which of them carries the one-sentence pointer to the newly wired stash guard. Reading A: `docs/hooks.md`. Reading B: `plugin/skills/dispatch/task-prompt.md`. Neither falls in a category the record flags, and a pointer sentence is no interface an outside caller depends on, so it does not plainly fall in `public-contract`. The record names both files, so the two readings sit equally close to stated intent. Reading A changes fewer observable contracts, because no dispatched agent reads `docs/hooks.md` as its prompt. The line: `Settled at planning: which file carries the stash-guard pointer — chose docs/hooks.md; not plugin/skills/dispatch/task-prompt.md`.

**Asked, migration.** The finding: whether a schema change drops the old column in this release or the next. Dropping it now cannot be undone once a deployed reader still expects the column. This is class (b), `migrations`. If the record does not flag `migrations`, the flag is added first and the plan owes its Check G proof. The recommended reading is the one closer to stated intent.

**Asked, auth.** The finding: whether an unauthenticated caller may read a run's decisions. Either answer sets who can see the run's audit trail. This is class (b), `auth`. If the record does not flag `auth`, the flag is added first. The recommended reading is the one closer to stated intent.

**Doubt example:** a question about whether a `decisions.md` line says `skipped` or `not run` touches a file the Review Console reads, but it does not plainly fall in `public-contract`, so it is settled. Take the reading closer to stated intent, and write a `Settled at planning:` line.
