# #5584 Deliverable 1, Part 1 — typed-command probe capture

Captured 2026-11-16 02:07–02:23Z on Claude Code **2.1.325**, macOS, by the second build of #5584.

Harness: a `--settings` file adding a scratch `UserPromptSubmit` hook and a `PreToolUse` hook (match `*`). Both log and never block. The `UserPromptSubmit` hook records the raw payload, the hook process's `CLAUDE_CODE_*`/`CC_*` variables and `os.tmpdir()`. The `PreToolUse` hook records, at each tool call, which prompt ids already have a non-tool-result user row in the session transcript. Every session was launched with `env -i` (HOME, PATH, USER, LOGNAME, SHELL, LANG, TERM, TMPDIR, CLAUDE_CONFIG_DIR only) in a non-git scratch directory, driven through a pty with `expect`. The line under test was `/claude-tweaks:dispatch #3` (#3 is a closed issue; every dispatch that followed refused it). Sanitized rows (fixed test ids, message text kept only for the command-form string): `5584-captured-rows.json` beside this file.

## Cases

The row test is the record's Technical Approach row test: markers (`turnOrigin` `human`, `origin.kind` `human`, `isMeta` absent/false, `promptSource` absent or `typed`, none of `scheduledTaskId`/`scheduledFireId`/`wakeupSource`/`queueSkipSlashCommands`) and command (`message.content` is the whole three-tag command form with one line of args naming the record).

| Case | How the line arrived | Prompt row (non-tool-result, same `promptId`, not `isMeta`) | Markers | Command | Verdict | Row in file at turn's first Bash call |
|---|---|---|---|---|---|---|
| (a) | typed at an idle prompt | `turnOrigin: "human"`, `origin: {kind: "human"}`, no `promptSource`, no `isMeta`; content is the command form, args `#3` | pass | pass | `typed` | yes |
| (b) | typed while the model's previous turn was still running (before its first tool call) | same keys and values as (a); `turnPosition.promptIndex` 2 | pass | pass | `typed` (reported) | yes |
| (c) | first prompt on the launch line of an interactive session (`claude "/claude-tweaks:dispatch #3"`) | same keys and values as (a) | pass | pass | `typed` (reported) | yes |
| (g) | a prompt the model scheduled for itself (`ScheduleWakeup`, 60 s, prompt = the line) | `turnOrigin: "scheduled"`, no `origin`, no `promptSource`, no `isMeta`; keys `scheduledTaskId`, `scheduledFireId`, `wakeupSource: "loop_wakeup"`, `queuePriority: "later"`, `queueSkipAttachments: true`; content **is** the command form, args `#3` | fail | pass | `not-typed` | yes |
| (h) | a message another session delivered (`cc-router hub send <pid> "<line>"`, the session socket) | `turnOrigin: "peer"`, `origin: {kind: "peer"}`, `promptSource: "system"`, `isMeta: true`, `queueSkipSlashCommands: true`, `queueSkipAttachments: true`; content is the raw line, not the command form (the model then ran the skill through the Skill tool) | fail | fail | `not-typed` | yes |
| (i) | a resumed session given the line on the launch line (`claude --resume <id> "<line>"`) | same keys and values as (a); `turnPosition.promptIndex` 2 | pass | pass | `typed` (reported) | yes |

Gating outcome: (a) is accepted; (g) and (h) are refused by the markers part. Part 1 passes; the build proceeds.

## Facts recorded

- Hook payload keys in every case: `cwd`, `hook_event_name`, `permission_mode`, `prompt`, `prompt_id`, `scratchpad_dir`, `session_id`, `transcript_path`. The first line of `prompt` is the raw line `/claude-tweaks:dispatch #3` in (a), (b), (c), (g), (h) and (i).
- The payload's `prompt_id` equals the `promptId` of the case's transcript row in every case (gotcha "ASSUMPTION — verify at build" #1: confirmed for (a)).
- The row was in the transcript at the turn's first tool call in every case: the first `PreToolUse` (Bash in (a), (b), (c), (i); Skill in (h)) came 2.5–18 s after the prompt and the row was present.
- A `cc hub send` delivery is not expanded into the command form (gotcha "ASSUMPTION — verify at build" #2: confirmed for (h)).
- A `ScheduleWakeup` prompt holding a plugin slash command **is** expanded into the command form on 2.1.325 (the measured corpus had only non-plugin re-fired commands in that form). Its row is refused by the markers part: `turnOrigin` is `scheduled`, `origin` is absent and `scheduledTaskId`/`scheduledFireId`/`wakeupSource` are present. The command part alone would not refuse it.
- Hook process environment in every case: `CLAUDE_CODE_ENTRYPOINT=cli`, `CLAUDE_CODE_SESSION_ATTENDED=1`, `CLAUDE_CODE_SESSION_ID` equal to the payload's `session_id`. `os.tmpdir()` in the hook equals the session's.
- `PreToolUse` payloads also carry `prompt_id` (keys: `cwd`, `effort`, `hook_event_name`, `permission_mode`, `prompt_id`, `scratchpad_dir`, `session_id`, `tool_input`, `tool_name`, `tool_use_id`, `transcript_path`).

## Launch-line rows (Decided 2026-11-16 follow-up)

Every key of the (c) and (i) prompt rows, ids and times aside, has the same presence and value as the (a) row: `cwd`, `entrypoint: "cli"`, `gitBranch`, `isSidechain: false`, `origin: {kind: "human"}`, `parentUuid` set, `turnOrigin: "human"`, `turnPosition`, `type`, `userType: "external"`, `version`. `turnPosition` is `{promptIndex: 1, turnIndex: 1}` for (c), the same as a first typed prompt; (i) has index 2, the same as a second typed prompt. No field separates a launch-line command from a typed one, so the transcript cannot tell a launch line from a typed line; condition 4 is then the only refusal for a launcher.
