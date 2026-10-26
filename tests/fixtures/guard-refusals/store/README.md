# Transcript store fixture (#4028)

A miniature of Claude Code's `~/.claude/projects` store for `tests/guard-refusals/transcripts.test.js`
and `cli.test.js`. Every line is a **real** transcript line copied from the maintainer's store
(`/Users/me/.claude/projects/`, Claude Code 2.1.302, 2026-10-24),
with each string value longer than 300 characters cut to its head plus `…` (a value naming a pipeline
run id keeps the id; a refusal message is kept up to 1500 characters, which is all of it). Nothing is
hand-typed. Only the project directory names were shortened (`-Users-me-…`).

**Paths are anonymized.** The maintainer's home directory, account config directory and workspace
folder were replaced everywhere, in this README too, by literal substitution inside JSON string
values: the user name became `me` (`/Users/me/…`, `-Users-me-…` slugs), the account directory
`.claude-accounts/<account>` became `.claude`, and the workspace folder (a two-word name containing a
space, in its spaced, escaped and slugged spellings) became `code`. Each line's JSON stays valid, with the same keys; the truncated tail line
stays truncated. Lengths changed, so a value's cut point is no longer exactly 300 characters.

Slugs are `<slug>/<session>.jsonl` (main) and `<slug>/<session>/subagents/<agent>.jsonl` (subagent).
The tests copy this tree to a temp directory and stamp every file's mtime; a checkout gives them all
"now".

| Fixture file | Source file (under the store root) | Source lines | Shape it carries |
|---|---|---|---|
| `-Users-me-claude-tweaks/00211950-4a25-4747-a8aa-5f2fd40bdc8c.jsonl` | `-Users-me-code-claude-tweaks/00211950-4a25-4747-a8aa-5f2fd40bdc8c.jsonl` | 1577, 1579, 1589, 1590, 1591 | A main transcript. Line 3 (source 1589) is the real `This session is isolated…` refusal of `toolu_01JM1m9AVMDyXEHcrSARNzJJ`; lines 4 and 5 (source 1590, 1591) are `api-request-blob` entries echoing the request, the assistant's `tool_use` blocks and the same refusal again. Line 1 (source 1577) names the run `2026-10-24T110909-spec-4039`. |
| `-Users-me-claude-tweaks/0c44b2b9-5474-4ec3-be09-bf547e54aa66.jsonl` | `-Users-me-code-claude-tweaks/0c44b2b9-5474-4ec3-be09-bf547e54aa66.jsonl` | 327, 328, 619, 638, 639 | Two refusals in one file, each after a different run id (`…record-3498`, then `…record-3350`): attribution takes the nearest preceding run. |
| `-Users-me-claude-tweaks/05ae9aae-1d0f-4916-8e98-12c59147a8e7/subagents/agent-a600e825960d7a9f4.jsonl` | `-Users-me-code-claude-tweaks/05ae9aae-1d0f-4916-8e98-12c59147a8e7/subagents/agent-a600e825960d7a9f4.jsonl` | 366, 367 | A subagent's own refusal (`toolu_01XkSC9UVprFoENL2rvy1y3K`). |
| `-Users-me-claude-tweaks/05ae9aae-1d0f-4916-8e98-12c59147a8e7/subagents/agent-adb453131e964bd6c.jsonl` | `-Users-me-code-claude-tweaks/05ae9aae-1d0f-4916-8e98-12c59147a8e7/subagents/agent-adb453131e964bd6c.jsonl` | 366, 367, 534 | A fork of the file above: it replays the parent's history (the same `tool_use` and refusal as source lines 366 and 367 above), then a `<fork-boilerplate>` user entry (source 534). |
| `-Users-me-adhoc/0abec85b-3c5f-4486-9a98-1b623ee68597/subagents/agent-ab1ce6ebd797a6f56.jsonl` | `-Users-me-code-adhoc/0abec85b-3c5f-4486-9a98-1b623ee68597/subagents/agent-ab1ce6ebd797a6f56.jsonl` | 409, 410 | The `This agent is isolated…` wording, in a project other than claude-tweaks. No run id. |
| `-Users-me-claude-tweaks/8307632c-d334-4558-8434-09b421be6ed2/subagents/agent-a05018134f5ee897f.jsonl` | `-Users-me-code-claude-tweaks/8307632c-d334-4558-8434-09b421be6ed2/subagents/agent-a05018134f5ee897f.jsonl` | 95, 96 | The `Refusing to run it there` variant (working directory resolved to the shared checkout). The source file's earlier run-id line (source 40) is left out, so this refusal stays unattributed. |
| `-Users-me-record-3670/5c28ef9e-a723-493c-9c70-294071dd8fe7/subagents/agent-a20eb732992453d65.jsonl` | `-Users-me-code-claude-tweaks--claude-worktrees-record-3670/5c28ef9e-a723-493c-9c70-294071dd8fe7/subagents/agent-a20eb732992453d65.jsonl` | 590, 592 | A refused `node "${CLAUDE_PLUGIN_ROOT}/bin/…"` call with the placeholder kept verbatim (the `node-var-script` row). |
| `-Users-me-closeout-session/a45494c1-ee1b-457b-886a-274896a61fbe.jsonl` | `-Users-me-code-claude-tweaks--claude-worktrees-closeout-session/a45494c1-ee1b-457b-886a-274896a61fbe.jsonl` | 279, 1047 | A parent session that names run `…record-3431` at 18:59 (source 279) and a later run `…record-3457` the next morning (source 1047). Run 3457 is never refused, so it is the zero-refusal run in the per-pipeline denominator. |
| `-Users-me-closeout-session/a45494c1-ee1b-457b-886a-274896a61fbe/subagents/agent-ab3414151093704cd.jsonl` | `-Users-me-code-claude-tweaks--claude-worktrees-closeout-session/a45494c1-ee1b-457b-886a-274896a61fbe/subagents/agent-ab3414151093704cd.jsonl` | 1, 32, 33 | A subagent of the file above whose own tool calls name no run. Its first entry (source 1) is stamped 2026-10-19T19:14:19Z; the refusal (source 32, 33) takes the parent's run in force then, `…record-3431`, not the parent's last run. |
| `-Users-me-claude-tweaks/0f9d7830-4cc7-451b-a9d3-e5114a9d62a0.jsonl` | `-Users-me-code-claude-tweaks/0f9d7830-4cc7-451b-a9d3-e5114a9d62a0.jsonl` | 4463, 4465 | The negative case: a successful (`is_error` not true) `sed -n` result whose output quotes the refusal message. It is not a refusal. |
| `-Users-me-claude-tweaks/truncated-tail.jsonl` | the first line of `0c44b2b9-….jsonl` above (source 327), cut off mid-JSON 60 characters after `"type":"tool_use"` | n/a | A JSON line truncated mid-write, as the tail of a file still being written is. |

Counts the tests pin: 11 files, 1 unreadable line, 12 unique Bash and Write calls, 8 unique refusals, of
which 5 attribute to a run; with a window covering the runs' start times, 6 runs enter the per-pipeline
denominator (the five refused ones and the clean 3457).
