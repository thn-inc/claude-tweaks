# Blocking-wait probe

Measured 2026-11-16 on Claude Code 2.1.325 (`claude --version` printed `2.1.325 (Claude Code)`), macOS, for record #5602 (Deliverable 1). It answers the four questions a blocking `wait-for.js` rests on, for the three kinds of waiter that would call it. The waiter is always a dispatched agent.

**Result: the gate fired.** Question 4 is "no" for two of the three waiters, so the record's build stopped after Deliverables 1 and 2. Deliverables 3 to 6 (the stop marker, `plugin/bin/wait-for.js`, its exit-code contract and its docs) are re-shaped by a human from the facts below.

## Answers

| Question | 1. Dispatched `Agent` subagent of an interactive session | 2. Subagent of a headless `claude -p` worker | 3. Context-handoff child |
|---|---|---|---|
| Q1. `SubagentStop` fires when the waiter's own child finishes, and its `session_id` equals the waiter's `CLAUDE_CODE_SESSION_ID` | yes | yes | yes |
| Q2. The payload's `agent_id` equals the `agentId` in the waiter's launch result | yes | yes | yes |
| Q3. A child's completion notification that arrives while a foreground Bash call blocks is delivered when that call returns | yes | not measured: no launch requested the background (`requested.background: 0`); the child ran synchronously | yes |
| Q4. A foreground Bash call may run 540 seconds with `timeout` 600000 | **no**: moved to the background after 180 s | yes | **no**: moved to the background after 180 s |

## How each waiter was probed

**Waiter 1** was the dispatched `/flow` build agent of record #5602 itself: a subagent of the interactive dispatching session `b979e2ab-48eb-4f61-a8ee-7134e913a163`. It launched one async `Agent` child (`haiku`, told to run `sleep 5` and reply without a `STATUS:` line), then at once ran `date +%s; sleep 540; date +%s` with `timeout` 600000.

**Waiter 2** was a subagent of a headless worker started from a scratch directory as `claude -p --settings settings.json --allowedTools "Bash Read Agent Task" --output-format json < headless-prompt.txt`. The worker's main agent dispatched the waiter, which ran the same steps as waiter 1. `settings.json` added one `SubagentStop` hook that appended its stdin to a file, so the payloads below are the raw hook input.

**Waiter 3** emulated a context-handoff child: `flow/context-handoff.md` dispatches one fresh `Agent` from the agent that crossed the context cap, and under `/claude-tweaks:dispatch` that agent is itself a dispatched subagent. Waiter 1 dispatched a fresh `Agent` (`sonnet`) with the same steps, so the waiter sat at depth 2 and its child at depth 3.

For waiters 1 and 3 the hook payload was read through the plugin's own `SubagentStop` hook (`plugin/bin/lib/hooks/subagent-stop.js`). The session owns the pipeline run, so a child reply with no `STATUS:` line is blocked once and its `agent_id` is written to `ct-contract-retries-{session_id}.json` under the OS temp directory (`plugin/bin/lib/hooks/contract-retries.js`). The file name carries the payload's `session_id`; its members are the payload's `agent_id`s.

## Evidence

### Session ids

Waiter 1's shell, `printenv CLAUDE_CODE_SESSION_ID CLAUDE_PLUGIN_ROOT CLAUDE_CODE_ENTRYPOINT`:

```
b979e2ab-48eb-4f61-a8ee-7134e913a163
```

(The command printed one line, so `CLAUDE_PLUGIN_ROOT` and `CLAUDE_CODE_ENTRYPOINT` were both unset in the subagent's shell.) Waiter 3 reported:

```
SESSION_ID: b979e2ab-48eb-4f61-a8ee-7134e913a163
PLUGIN_ROOT: unset
```

Waiter 2 and its headless main agent reported:

```
TOP_SESSION_ID: 4d837e8d-20c2-42da-aa84-e7341f88867d
SESSION_ID: 4d837e8d-20c2-42da-aa84-e7341f88867d
PLUGIN_ROOT: unset
```

### Q1 and Q2, waiters 1 and 3

Waiter 1's launch result named `agentId: aeb324ea74f4aec80`. Waiter 3's launch result named `agentId: aa5ce0b38f41f6fe9`. Before the probe `ct-contract-retries-b979e2ab-48eb-4f61-a8ee-7134e913a163.json` did not exist; after the children stopped it read:

```
["aeb324ea74f4aec80","aa5ce0b38f41f6fe9","a14e0e7353f13fed8"]
```

and later, after waiter 3 itself stopped:

```
["aeb324ea74f4aec80","aa5ce0b38f41f6fe9","a14e0e7353f13fed8","a4bdbbc53f0b61cc2"]
```

`aeb324ea74f4aec80` is waiter 1's child and `aa5ce0b38f41f6fe9` is waiter 3's child (depth 3): the hook ran for both, under the root session's id, with the launch result's id as `agent_id`. The two other ids are waiter 1's other children (the headless launcher and waiter 3), whose stops the hook also saw. Both children then replied again with `STATUS: DONE`, as the hook's block instructs.

### Q1 and Q2, waiter 2

The raw `SubagentStop` payloads the scratch hook wrote, in order (paths shortened to `…`):

```
{"session_id":"4d837e8d-20c2-42da-aa84-e7341f88867d","transcript_path":"…/4d837e8d-20c2-42da-aa84-e7341f88867d.jsonl","cwd":"…/scratchpad/probe","prompt_id":"10bdf077-d5c0-4184-a791-cd896f9e48c6","permission_mode":"dontAsk","agent_id":"a22f5347ef209e63b","agent_type":"general-purpose","effort":{"level":"medium"},"hook_event_name":"SubagentStop","stop_hook_active":false,"agent_transcript_path":"…/4d837e8d-20c2-42da-aa84-e7341f88867d/subagents/agent-a22f5347ef209e63b.jsonl","last_assistant_message":"probe-grandchild reply","background_tasks":[],"session_crons":[]}
{"session_id":"4d837e8d-20c2-42da-aa84-e7341f88867d", … ,"agent_id":"ab5ec833281ffaa77","agent_type":"general-purpose", … ,"agent_transcript_path":"…/4d837e8d-20c2-42da-aa84-e7341f88867d/subagents/agent-ab5ec833281ffaa77.jsonl", … }
```

The waiter reported `CHILD_AGENT_ID: a22f5347ef209e63b`, the first payload's `agent_id`. The payload carries `session_id`, `agent_id`, `agent_type`, `transcript_path` and a distinct `agent_transcript_path`, which Deliverable 3's marker condition needs, plus `last_assistant_message` and `background_tasks`.

### Q3

Waiter 1: the child's notification arrived as soon as the foreground call returned, which was when the harness moved it to the background at 180 s:

```
<task-notification>
<task-id>aeb324ea74f4aec80</task-id>
<tool-use-id>toolu_013eXdeCC6BjmT3kDeegP8iL</tool-use-id>
…
<status>completed</status>
<summary>Agent "probe child one" finished</summary>
…
<result>probe-child-1 reply
STATUS: DONE</result>
<usage><subagent_tokens>53090</subagent_tokens><tool_uses>1</tool_uses><duration_ms>12139</duration_ms></usage>
</task-notification>
```

Waiter 3 reported the same order (`NOTIFICATION_TIMING: … It was delivered after step 4's call returned its "moved to the background" message`), with task-id `aa5ce0b38f41f6fe9`.

Waiter 2: in the headless worker the `Agent` call did not launch async. Its tool result was the child's final report (`… The report follows: probe-grandchild reply agentId: a22f5347ef209e63b …`), and no notification followed. The worker's result JSON counts it: `"subagent_stats":{"spawned":2,"requested":{"background":0,"foreground":1,"unset":1},"started_in_background":0,"max_depth":2, …}`. No launch requested the background, so this shows only that a launch that did not request it ran synchronously; whether a headless subagent can launch a child in the background was not tried.

### Q4

Waiter 1, `date +%s; sleep 540; date +%s` with `timeout` 600000:

```
1794790038
Command was moved to the background (ID: blqweykjf) after running for 180s. …
```

Waiter 1, the same shape with no `timeout`:

```
date +%s; sleep 150; date +%s   →  1794790242 / 1794790392   (ran in the foreground)
date +%s; sleep 200; date +%s   →  1794790395 / "Command was moved to the background (ID: bdz5mwumf) after running for 180s."
```

Waiter 3: `SLEEP_EPOCHS: 1794790039 1794790579 backgrounded (the Bash tool moved it to the background at 180s, then it ran the full 540s)`.

Waiter 2: `SLEEP_EPOCHS: 1794790072 1794790612 foreground` — 540 s in one foreground call.

## What this changes for the design

- In a dispatched subagent of an interactive session, at depths 1 and 2 (both tried), a foreground Bash call is moved to the background after 180 s, with or without `timeout`. A 150 s call with no `timeout` stayed in the foreground. So `plugin/skills/test/verification.md`'s Foreground rule ("a call with no explicit `timeout` is moved to the background after about 120 seconds, and 600,000 ms is the largest `timeout`") does not hold for these waiters, and the record's `--max-seconds 540` with `timeout` 600000 would be backgrounded. The spec's Technical Approach says: "If the probe measured other limits, the default stays 20 seconds under the measured default window and the cap 30 seconds under the measured largest timeout, and the probe file says so." With one 180 s ceiling governing calls with and without `timeout`, that gives a cap of 150 s and a default of 160 s, so the default would exceed the cap.
- In a headless `claude -p` worker a 540 s foreground call ran to the end, and a launch that did not request the background ran synchronously; whether a headless subagent can launch in the background was not tried.
- The `SubagentStop` side holds at every depth tried: the hook fires for a child of a dispatched agent and of a depth-2 agent, keyed by the root session's id, which equals `CLAUDE_CODE_SESSION_ID` in the waiter's shell, with the launch result's `agentId` as `agent_id`.

## Depended on by

After the gate fired, Deliverables 3 to 6 were re-shaped against the 180 s ceiling and shipped: `plugin/bin/wait-for.js` takes `--max-seconds` default 100, at most 150 (`MAX_SECONDS_CAP` in `plugin/bin/lib/wait-for/index.js`), and a `ci` call may run 20 s past it (`POLL_GRACE_MS`), so the longest call is 170 s and callers pass no `timeout`. The stop marker `wait-for.js agents` reads rests on Q1 and Q2. A re-probe after a Claude Code upgrade that measures a different ceiling, or a changed `session_id`/`agent_id` match, re-checks those constants and the marker condition in `plugin/bin/lib/hooks/subagent-stop.js`.
