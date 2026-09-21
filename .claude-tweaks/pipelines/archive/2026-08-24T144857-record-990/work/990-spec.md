---
record: 990
origin: human
risk: medium
size: medium
ceremony: standard
grants: [build]
surface: backend
---
# 990: archiveRunDir() can still orphan engine-state.json after #902's enumeration fix — reproduced live during #893's own wrap-up

Surface: backend

## Current State

During #893's own wrap-up (2026-08-20), `archiveRunDir()` left `engine-state.json` orphaned in the live run directory even though #902's enumeration fix (`08098fe7`) was already on `main` at the time. `config.yml`, `decisions.md`, `events.jsonl`, `run-state.json`, and `staged/` all moved correctly to `.claude-tweaks/pipelines/archive/2026-08-20T044204-record-893/`; only `engine-state.json` (mtime predating the archival) was left behind in the live path, defeating the final `fs.rmdirSync(runDir)` — the exact failure mode #893/#902 already fixed once, reproducing via a different mechanism.

Working theory: `wrap-up-engine.js record`'s last write to `engine-state.json` may land after `archiveRunDir()`'s `fs.readdirSync(runDir)` snapshot but before its own `fs.rmdirSync` — or `archiveRunDir()` is invoked more than once in a single `reconcile` pass in a way that lets a second/late writer recreate the file in the just-emptied directory before the directory removal. Fixed manually this time via `mv` + `rmdir`; needs root-causing before the reconciler's automatic archival can be trusted again in this scenario.

## Deliverables

- Reproduce the race (or ordering gap) between `wrap-up-engine.js record`'s writes to `engine-state.json` and `archiveRunDir()`'s enumeration snapshot
- Fix the ordering so `archiveRunDir()` cannot complete while a later `engine-state.json` write is still pending, or re-snapshot immediately before `fs.rmdirSync` and retry-move any new stragglers
- Add a regression test reproducing this exact sequence (a `record` call landing between `archiveRunDir()`'s readdir and its final rmdir)

## Acceptance Criteria

- `engine-state.json` never survives a full `archiveRunDir()` pass under the reproduced sequence
- A regression test pins the fix
- `fs.rmdirSync(runDir)` succeeds and the live run dir fully disappears

_Filed by wrap-up (record #893's own reflect pass) via specShapedBody._

## Original request

archiveRunDir() can still orphan engine-state.json after #902's enumeration fix — reproduced live during #893's own wrap-up

## Current State

During #893's own wrap-up (2026-08-20), `archiveRunDir()` left `engine-state.json` orphaned in the live run directory even though #902's enumeration fix (`08098fe7`) was already on `main` at the time. `config.yml`, `decisions.md`, `events.jsonl`, `run-state.json`, and `staged/` all moved correctly to `.claude-tweaks/pipelines/archive/2026-08-20T044204-record-893/`; only `engine-state.json` (mtime predating the archival) was left behind in the live path, defeating the final `fs.rmdirSync(runDir)` — the exact failure mode #893/#902 already fixed once, reproducing via a different mechanism.

Working theory: `wrap-up-engine.js record`'s last write to `engine-state.json` may land after `archiveRunDir()`'s `fs.readdirSync(runDir)` snapshot but before its own `fs.rmdirSync` — or `archiveRunDir()` is invoked more than once in a single `reconcile` pass in a way that lets a second/late writer recreate the file in the just-emptied directory before the directory removal. Fixed manually this time via `mv` + `rmdir`; needs root-causing before the reconciler's automatic archival can be trusted again in this scenario.

## Deliverables

- Reproduce the race (or ordering gap) between `wrap-up-engine.js record`'s writes to `engine-state.json` and `archiveRunDir()`'s enumeration snapshot
- Fix the ordering so `archiveRunDir()` cannot complete while a later `engine-state.json` write is still pending, or re-snapshot immediately before `fs.rmdirSync` and retry-move any new stragglers
- Add a regression test reproducing this exact sequence (a `record` call landing between `archiveRunDir()`'s readdir and its final rmdir)

## Acceptance Criteria

- `engine-state.json` never survives a full `archiveRunDir()` pass under the reproduced sequence
- A regression test pins the fix
- `fs.rmdirSync(runDir)` succeeds and the live run dir fully disappears

_Filed by wrap-up (record #893's own reflect pass) via specShapedBody._

