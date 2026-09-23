---
record: 815
origin: capture
risk: low
size: low
ceremony: fast-lane
grants: [build, merge]
surface: backend
---
# 815: auto-decision-log.md's canonical Entry schema section documents log-decision.js's pre-rewrite CLI signature

Surface: backend

**Related:** none

## Current State
`skills/_shared/auto-decision-log.md`'s "Entry schema" section (~line 61) still shows the old `--run-dir <dir> [--spec <n>] [--skill <name>] <STATUS> <message>` form, but the CLI was rewritten to require `--run/--status/--text/--section` and now hard-errors (exit 2) on the old flags. A corrected example already exists ~80 lines later in the same file. Backlog #788 fixed `bin/log-decision.js` and `docs/plugin-structure.md` but missed this citation.

## Deliverables
Update the canonical Entry schema section to the current `--run/--status/--text/--section` form.

## Acceptance Criteria
The file has one consistent CLI signature throughout, matching the actual `bin/log-decision.js` `parseArgs` contract.

Defer-reason: found-during-review — surfaced by a whole-branch `/code-review` pass ahead of a release; not the review's own scope to fix.

## Original request

auto-decision-log.md's canonical Entry schema section documents log-decision.js's pre-rewrite CLI signature

**Related:** none

## Current State
`skills/_shared/auto-decision-log.md`'s "Entry schema" section (~line 61) still shows the old `--run-dir <dir> [--spec <n>] [--skill <name>] <STATUS> <message>` form, but the CLI was rewritten to require `--run/--status/--text/--section` and now hard-errors (exit 2) on the old flags. A corrected example already exists ~80 lines later in the same file. Backlog #788 fixed `bin/log-decision.js` and `docs/plugin-structure.md` but missed this citation.

## Deliverables
Update the canonical Entry schema section to the current `--run/--status/--text/--section` form.

## Acceptance Criteria
The file has one consistent CLI signature throughout, matching the actual `bin/log-decision.js` `parseArgs` contract.

Defer-reason: found-during-review — surfaced by a whole-branch `/code-review` pass ahead of a release; not the review's own scope to fix.

