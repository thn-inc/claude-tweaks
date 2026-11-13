---
files:
  - plugin/bin/dispatch-prompt.js
  - plugin/bin/lib/dispatch/task-prompt.js
  - plugin/bin/lib/hooks/dispatch-prompt-gate.js
  - plugin/bin/lib/hooks/pre-tool-use.js
  - plugin/hooks/hooks.json
  - plugin/skills/dispatch/SKILL.md
  - plugin/skills/dispatch/task-prompt.md
  - plugin/skills/dispatch/two-call-gate.md
---

# Dispatch a Group Whose Task Prompts Are Rendered, Not Hand-Filled

**Persona:** The maintainer of a claude-tweaks repo running `/claude-tweaks:dispatch` (the dispatching session) over a ranked group, who reads the firing's `decisions.md` and final report afterwards to learn whether each Task call went out exactly as the template says.
**Goal:** Send each Task call (first, second, a handoff continuation) with a prompt that came from `plugin/skills/dispatch/task-prompt.md` through a program, so a paraphrased or half-substituted prompt can never reach a dispatched agent.
**Entry point:** `/claude-tweaks:dispatch` Step 5, after Step 4 minted the group's run directory (`{minted-run-dir}`) and the phase bundles were composed.
**Success state:** The call's prompt is byte-for-byte the latest render recorded for it in `{minted-run-dir}/dispatch-prompts.jsonl`, the `Agent` call went through, and `decisions.md` holds no `Prompt render failed` or `Prompt denied twice` line. On the terminal path the group is cleaned up with one `REFUSED` line instead.

## Steps

### 1. Render the call's prompt — `dispatch/SKILL.md` Step 5, `bin/dispatch-prompt.js`
- **URL:** `plugin/skills/dispatch/task-prompt.md` (the fenced first-call and second-call blocks)
- **Action:** **Dispatching session** runs `node "${CLAUDE_PLUGIN_ROOT}/bin/dispatch-prompt.js" --call first|second --run "{minted-run-dir}" --issues {n}[,{m}...]`. A handoff continuation adds `--next-steps` (a bundle's per-record form such as `#12:none;#34:test` included). The CLI fills the closed placeholder set, writes the whole prompt to `out` plus read parts `{out}.part1..N` of at most 20,000 bytes each, appends one digest line to `{minted-run-dir}/dispatch-prompts.jsonl`, and prints one JSON envelope (`out`, `chunks`, `join`, `profile.model`, `sha256`, and more). The prompt itself never goes to stdout.
- **Should feel:** Mechanical: one command in place of reading a long template and substituting by hand.
- **Should understand:** Exit 0 means rendered. Exit 1 is a failure (template unreadable, a placeholder left over, an oversized prompt, a registry that cannot be written). Exit 2 is a malformed invocation or a `--run` that is missing or refused. On exit 1 or 2 no prompt is recorded. The model for the Task call is the envelope's `profile.model`, never a value typed by the dispatcher.
- **Red flags:** A prompt composed by hand because the CLI was "just" a convenience; a `{placeholder}` left in a prompt that was dispatched; a `profile.model` replaced by a remembered model name.

### 2. Read each part and pass them joined — `dispatch/SKILL.md` Step 5
- **URL:** —
- **Action:** **Dispatching session** `cat`s each path in the envelope's `chunks` with one plain command per part, then sends the parts in order, joined by the envelope's `join` (one newline), as the Task prompt, with `profile.model` as `model`.
- **Should feel:** Plain copying, with no judgement call left in it: the text is not summarized or reflowed.
- **Should understand:** The join of the parts is byte-identical to the file at `out`, and the first line carries the `[dispatch-prompt: {run-id} {call}]` marker the gate keys on. The wording is load-bearing, because the four-value status line and output formats downstream skills parse are in it.
- **Red flags:** Parts read out of order or with a part skipped; a trailing newline added or dropped; the marker line trimmed.

### 3. The Agent call the gate allows — `bin/lib/hooks/dispatch-prompt-gate.js`, `plugin/hooks/hooks.json`
- **URL:** —
- **Action:** **Dispatching session** sends the `Agent` call. The PreToolUse gate on `Agent`/`Task` compares the prompt's exact bytes with the latest registry line for the marker's call and, on a match, allows the call with no event.
- **Should feel:** Invisible on the happy path. The operator never sees the gate.
- **Should understand:** Only the latest render of a call is current, so re-rendering the same call supersedes the earlier render. The gate checks a main-thread call only; a dispatching session that is itself a subagent sends calls with an `agent_id` and is not checked. Any fault inside the gate fails open, so the gate can miss a bad prompt but never blocks a good one for its own error.
- **Red flags:** A dispatch that proceeded on a prompt whose bytes differ from the registry; the gate denying a prompt that was sent unchanged on its first attempt.

### 4. A deny: resend the identical prompt once — `docs/hooks.md` (Dispatch-prompt fidelity gate)
- **URL:** —
- **Action:** When the gate denies (a prompt that is not the latest render for its call, or a marker-less prompt naming a run this session dispatched), its reason names the latest `{out}.part1..N` files. **Dispatching session** `cat`s them again and resends the unchanged joined text once.
- **Should feel:** Recoverable: the deny says what to do next and the fix is to resend, not to edit.
- **Should understand:** The resend is the same render, never a modified one. If the first send differed by a stray edit, the resend of the real text passes.
- **Red flags:** An "improved" prompt sent as the resend; more than one resend; the deny reason ignored and the text retyped from memory.

### 5. Terminal path: render failure or a second deny — `dispatch/two-call-gate.md` §2, §5, §6
- **URL:** `{minted-run-dir}/decisions.md`
- **Action:** When `dispatch-prompt.js` exits non-zero, or the resend is denied too, **dispatching session** does not dispatch the call and does not fill the template by hand. It logs `Prompt render failed: exit {code}: {stderr}` (or `Prompt denied twice: {reason}`) through `log-decision.js --status REFUSED --text-file`, then treats the call as one that returned no parseable report: a first call or its continuation goes to §5's cleanup-only call, a second call or its continuation to §6. A first call that never dispatched appends `(prompt-not-dispatched: skip the claim release)` to the §5 cleanup-only call.
- **Should feel:** Safe: a refused group is visibly refused, never quietly half-run.
- **Should understand:** The skip phrase exists because a first call that never ran never claimed the record, so a claim release would post a false release comment on an absent claim. It is appended only for a first call that never dispatched: a continuation, an escalated express run's first call (the express lane took its claim) and a second call all hold a claim and release it as usual. A render failure then ends the firing once that cleanup call returns (`dispatch/SKILL.md`'s Render-failure stop, #5255) — relayed with the exit code and stderr line, and notified when headless — while a second deny moves the firing on to the next group.
- **Red flags:** A `REFUSED` group that leaves its claim or worktree unreleased; the skip phrase appended for a continuation or second call, leaving a live claim; a hand-filled prompt dispatched after a render failure; a render failure followed by another group's dispatch in the same firing; a denied-twice call that ends the firing.

## Origin
- Created during build of #4589 (render every dispatch Task prompt through a CLI and gate the resend). Steps 1-5 built in this session.
- Updated during build of #5255: step 5. A render failure ends the firing; a second deny still moves on.
- Related: `resume-a-stalled-dispatched-build-4588.md` (the resume first call is rendered with `--resume-verdict`), `clear-the-two-call-gate-for-a-dispatched-group-2775.md` (the gate between the calls), `compose-a-per-run-context-bundle-1988.md` (the bundles composed before each render), `audit-dispatch-first-call-model-3224.md` (the model read from the envelope's `profile`)
