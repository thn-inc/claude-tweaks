# #5584 Deliverable 1 — UserPromptSubmit probe capture

Captured 2026-11-16 00:52–01:12Z on Claude Code **2.1.325**, macOS, by the build of #5584.

Harness: a `--settings` file adding one `UserPromptSubmit` hook (a Node script that appends the raw payload, the hook process's environment and `os.tmpdir()` to a log, and blocks any prompt whose first line starts with `/claude-tweaks:dispatch`). Every session was launched with `env -i` (HOME, PATH, USER, LOGNAME, SHELL, LANG, TERM, TMPDIR, CLAUDE_CONFIG_DIR only), so no `CLAUDECODE`, `CC_*` or session variable leaked in from the launching session. Interactive rows were driven through a pty with `expect`. The line under test was `/claude-tweaks:dispatch #1`.

`(a)`'s payload keys: `cwd, hook_event_name, permission_mode, prompt, prompt_id, scratchpad_dir, session_id, transcript_path`.

| Row | How the line reached the session | Hook fired | First line of `prompt` | Payload fields differing from (a) | `CLAUDE_CODE_ENTRYPOINT` / `CLAUDE_CODE_SESSION_ATTENDED` (hook process) |
|---|---|---|---|---|---|
| (a) | typed at an idle prompt | yes | `/claude-tweaks:dispatch #1` (raw) | — | `cli` / `1` |
| (b) | typed while a 45 s foreground Bash call ran | yes, at submit | raw | none | `cli` / `1` |
| (c) | first prompt of an interactive launch (`claude "/claude-tweaks:dispatch #1"`) | yes | raw | none | `cli` / `1` |
| (d) | `claude -p "/claude-tweaks:dispatch #1"` | yes | raw | `scratchpad_dir` absent | `sdk-cli` / `0` |
| (e) | the model called the Skill tool (`Skill{skill:"claude-tweaks:dispatch",args:"#1"}`, confirmed in the transcript) | **no** | — | — | — |
| (f) | a Task subagent called the Skill tool | **no** for the Skill call; the subagent's completion arrived as a `<task-notification>` prompt, which did fire the hook | `<task-notification>` | none | `cli` / `1` |
| (g) | a prompt the model scheduled for itself (`ScheduleWakeup`, 60 s, prompt `/claude-tweaks:dispatch #1`) | **yes** | **`/claude-tweaks:dispatch #1` (raw)** | **none** | `cli` / `1` |
| (h) | a message from another session (`cc-router hub send <pid> "/claude-tweaks:dispatch #1"`, the same per-session socket `SendMessage` uses) | **yes** | **`/claude-tweaks:dispatch #1` (raw)** | **none** | `cli` / `1` |
| (i) | resumed session given the prompt on the command line (`claude --resume <id> "/claude-tweaks:dispatch #1"`) | yes | raw | none | `cli` / `1` |

Other facts captured:

- The hook process and a Bash child of the same session resolve the same `os.tmpdir()` (`/var/folders/3_/…/T`).
- The payload's `session_id` equals `CLAUDE_CODE_SESSION_ID` in the hook process and in a Bash child, in every row.
- A Bash child sees `CLAUDE_CODE_ENTRYPOINT=cli`, `CLAUDE_CODE_SESSION_ATTENDED=1`, and stdin not a terminal.
- `permission_mode` was `dontAsk` in every row (this account's default), so it does not separate rows here.
- The transcript, written after the hook returns, does tell the rows apart: joined on `prompt_id` = the transcript entry's `promptId`, a typed prompt carries `promptSource: "typed"`, `turnOrigin: "human"`, `origin: {kind: "human"}`; (g) carries `promptSource: "system"`, `turnOrigin: "scheduled"`, `isMeta: true`; (h) carries `promptSource: "system"`, `turnOrigin: "peer"`, `origin: {kind: "peer"}`, `isMeta: true`; a task notification carries `origin: {kind: "task-notification"}`. A blocked prompt is never written to the transcript.

## Outcome under Deliverable 1's rule

Rows (a) and (b) reach the hook as a raw first line (pass). Rows **(g)** and **(h)** also reach the hook as the raw first line `/claude-tweaks:dispatch #1` and differ from (a) in **no payload field**. Deliverable 1's outcome rule: "If one of them cannot be told apart, stop `BLOCKED` with the capture: shipping would let a command no person typed build an ungranted record." The build stops here, before any code.
