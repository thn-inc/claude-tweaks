---
name: timing-procedure-read-counting
description: Use when changing how the timing tooling counts skill-file or composed-bundle reads from transcripts — the per-file read keys in `plugin/bin/lib/timing/turn-class.js`, the Bash read-shape parser, the per-row and per-dispatch `procedureFiles` counts in `transcript.js`, their phase join in `derive.js`, or the per-file report and `--recount` baseline in `tools/efficiency-report.js`. Keywords - procedureFiles, readFileKey, procedureFileKey, contextBundleKey, bashProcedureFiles, isProcedurePath, procedureFileRows, dispatchFileReads, joinTokens, recount, efficiency-report, timing.json.
---

# Timing: per-file procedure-read counting

## Overview

`timing.json` counts, per phase, how many times each skill file and each composed bundle was read. The count runs from the transcript up, and a wrong key or a missed read changes the reported numbers without any error. A read the parser misses reads as a skill that got cheaper, and a pattern argument counted as a file reads as one that got costlier. The chain: `turn-class.js` turns one tool call into keys, `transcript.js` puts them on rows and dispatches, `derive.js` `joinTokens` books them to phases, and `tools/efficiency-report.js` reports them.

## Key Patterns

### One key per file, whatever copy was read

`procedureFileKey` slices the path from its first `skills/` segment, so the repo, worktree and plugin-cache copies of one skill file count as one key. `contextBundleKey` maps `.claude-tweaks/pipelines/<run>/context/<name>.md` (nested `spec-N` run dirs included) to `context/<name>.md`. `readFileKey` tries the bundle key **first**: a main checkout that sits under a `skills/` directory makes a bundle path look like a procedure path too (`5f4bc4494`).

### A Bash read counts only through a read head, and only its file operands

`bashProcedureFiles` strips heredoc bodies with the write gate's own `stripHeredocBodies`, splits segments, sees through `timeout`/`xargs` wrappers, and counts only `READ_HEADS` (`cat head tail sed awk grep rg ugrep wc`). For `grep`/`rg`/`ugrep` the first operand is the pattern, unless a pattern flag (`-e`, `--regexp`, `-f`, `--file`, separate or attached) appears **anywhere**: grep permutes its arguments (`d79090354`). Flags whose value is the next token (`-A`/`-B`/`-C`/`-m`) skip it. Output redirect targets, unquoted globs, and `git show HEAD:…` / node-script arguments never count. An input redirect (`< file`) does.

### Dispatch reads join by time, not by row

A subagent's reads arrive as `procedureFileRows` (`{ ts, procedureFiles }`, transcript order) and enter `joinTokens` as `dispatchFileReads`, which adds to `procedureFiles` only, never to rows, tokens or round trips. Walk `timed` rows, not `keptRows`: `keptRows` puts untimed rows last, and an untimed row books to the dispatch's `startTs`.

### A dispatched run's Task-call files are rows, and they scope the dispatches

For a `dispatched: true` run, at-close adds to `transcriptPaths` the depth-1 Task-call files of the dispatching and resuming sessions whose dispatch prompt names exactly this run (`locateTaskTranscripts`, #5647). Their reads arrive as row `procedureFiles` through `readUsage`, and `dispatchFileReads` skips any dispatch whose `transcriptPath` is one of the paths, so they are not counted twice. Those files sit in the dispatcher session's `subagents/` directory beside its other Task calls. `collectDispatches`'s `scopeDispatchesTo` keeps only the attributed files' descendants from a directory reached only through them; a directory also reached through the run's own transcript keeps its window view minus them. A caller that passes Task-call paths without it books the reads of every other in-window Task call in that directory to this run. `--recount` passes the listed `subagents/agent-*.jsonl` paths (`isAgentTranscriptPath`).

## Decision Framework

| Change | Do this |
|---|---|
| A new read-shaped command | Add it to `READ_HEADS` only if it reads a file's text; add each flag that takes a separate value, or its value is counted as a file |
| A new bundle location | Extend `CONTEXT_BUNDLE_RE`, keep the bundle check ahead of `procedureFileKey` |
| Changing `isProcedurePath` | It also drives `procedureBytes` and the `procedure` turn class, so the shipped numbers move. Add characterization tests first (an open #4359 follow-up) |
| A baseline for a before/after claim | `node tools/efficiency-report.js --recount` rebuilds archived runs from the transcripts their `timing.json` lists. Runs that measured nothing are skipped, and a malformed `timing.json` is named as failed |

## Anti-Patterns

| Pattern | Why it fails here |
|---|---|
| Keying by full path | The repo, worktree and plugin-cache copies of one skill file split into separate rows, so no row shows the file's real read count |
| Treating grep's first operand as the pattern when `-e` is present | The real pattern is in `-e`, so the first operand is a file, and that read is missed |
| Hand-built transcript fixtures with single-shape tool calls | They agree with the parser that wrote them. Sample at least one real session transcript (`transcript-payload-verification`) |
| Letting a recount count a run with no usage rows as zero reads | It drags the median toward zero. Skip it and count it as skipped (`f6d36803e`) |

## Reference

- `plugin/bin/lib/timing/turn-class.js` — `readFileKey`, `procedureFileKey`, `contextBundleKey`, `bashProcedureFiles`
- `plugin/bin/lib/timing/transcript.js` — `readUsage` (row `procedureFiles`), `scanAgentDir` (`procedureFileRows`)
- `plugin/bin/lib/timing/derive.js` — `joinTokens(…, { dispatchFileReads })`
- `plugin/bin/lib/timing/run-timing.js` — `collectDispatches` (`scopeDispatchesTo`), `dispatchFileReads`; `transcript.js` — `locateTaskTranscripts`, `isAgentTranscriptPath`
- `plugin/bin/phase-timing.js`, `tools/efficiency-report.js` (`reviewFilesOf`, `recountRuns`)
- Tests: `tests/bin-lib/timing/{turn-class,transcript,derive,golden,cli}.test.js`, `tests/efficiency-report.test.js`
