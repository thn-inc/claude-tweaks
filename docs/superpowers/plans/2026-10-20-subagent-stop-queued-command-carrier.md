# SubagentStop queued_command carrier in isAsyncWaitSignal (#3589) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `isAsyncWaitSignal` exempts a reply that comes immediately after a `queued_command` completion notification, using the same carrier predicate `countPendingDispatches` already uses.

**Architecture:** Split the two real completion carriers (origin-shaped user entry, `queued_command` attachment) out of `notificationCarrierBody` into one entry-only predicate, `completionCarrierBody(entry)`. `notificationCarrierBody` calls it, then keeps its own `api-request-blob` echo branch. `isAsyncWaitSignal` calls it in place of its inline `origin.kind` check.

**Tech Stack:** Node CommonJS, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-20T131504-record-3589/work/3589-spec.md` (materialized from GitHub issue #3589)

Scope keywords: isAsyncWaitSignal, notificationCarrierBody, queued_command

## Global Constraints

- One carrier predicate shared by `isAsyncWaitSignal` and `countPendingDispatches`, not a second copy (Deliverable 1).
- The fixture is built from verbatim live `queued_command` completion lines (AC1).
- Existing SubagentStop tests pass unchanged (AC3).

## Review Focus

- **`api-request-blob` echo immediately before a reply.** It must not exempt the reply: a blob repeats history (157 of 109,685 live blobs carry more than one `<task-notification>`), so treating it as a signal would exempt replies to old notifications. A live survey of 7,105 subagent transcripts found 0 replies immediately after a blob. Pinned in Task 1's unit assertions.
- **`queued_command` relaying a plain message** (a `prompt` without `<task-notification>`). It is not a signal; the reply is still graded. Pinned in Task 1.
- **Origin-shaped notification with a missing body.** It is still a signal for `isAsyncWaitSignal`, as today (its body is `null`, not `undefined`), and still indeterminate for `countPendingDispatches`. The existing tests cover both.

---

### Task 1: Share the completion-carrier predicate with isAsyncWaitSignal

**Files:**
- Modify: `plugin/bin/lib/hooks/subagent-stop.js` (header comment source 4 ~lines 75-95; `isAsyncWaitSignal` ~283-299; `notificationCarrierBody` ~315-324)
- Test: `tests/hooks-subagent-stop.test.js` (append after the last #3015 test)

**Interfaces:**
- Produces: `completionCarrierBody(entry) -> string | null | undefined`. The return is `undefined` when `entry` is not an origin-shaped or `queued_command`-with-`<task-notification>` carrier; otherwise it is the body (`null` or non-string when the origin body has drifted). Module-private, not exported. `isAsyncWaitSignal(entry)` keeps its signature and is exported unchanged.

- [ ] **Step 1: Write the failing tests.** Add three verbatim constants from `~/.claude-accounts/personal-gmail/projects/-Users-thomasholknielsen-Code-Workspaces-claude-tweaks/6ccd43b3-f322-4848-b923-9c7fc33d8c03/subagents/agent-a0d130f6ef719c4f1.jsonl`, Claude Code 2.1.283: `REAL_FIXWAVE_LAUNCH_ACK` (line 373), `REAL_FIXWAVE_QUEUED_COMPLETION` (line 379) and `REAL_FIXWAVE_REPLY` (line 380, text `"Now the one scoped re-review of the fix wave."`). Shorten long irrelevant values with `…` and shorten cwd/paths, following the existing `REAL_*` convention. Keep structure, field names, ids (`a66c5eb4351b3033a`, `toolu_01LRjPGMY1pkGPJjnsn8jBS4`) and timestamps untouched. Then add the tests:
  - `AC1.1: a non-compliant reply right after a verbatim queued_command completion (nothing pending) is not blocked and logs nothing`. Transcript `[REAL_FIXWAVE_LAUNCH_ACK, REAL_FIXWAVE_QUEUED_COMPLETION, REAL_FIXWAVE_REPLY]`. Assert `countPendingDispatches(lines, 2) === 0`, which proves only the #2041 signal can exempt it. Then assert `runOn(...).out` deep-equals `{}`, there are 0 events, and no retry was recorded for the agent id.
  - `AC2.1: the same notification followed by other tool calls, nothing pending, ends in a non-compliant reply that is still blocked`. Transcript: launch ack, queued completion, `...readCall(…)` entries timestamped after the completion, then a non-compliant reply. Assert `out.json.decision === 'block'`.
  - `#3589 isAsyncWaitSignal: true for a queued_command task-notification, false for a relayed queued_command and for an api-request-blob echo`. Assert `isAsyncWaitSignal(JSON.parse(REAL_FIXWAVE_QUEUED_COMPLETION)) === true`, and `true` for `queuedNotification('a1','toolu_1',1)`. Assert `false` for that helper's output with `attachment.prompt = 'Please also check the README.'`, and `false` for `JSON.parse(REAL_REQUEST_ECHO)`.

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `node --test tests/hooks-subagent-stop.test.js`
Expected: FAIL. AC1.1 gets `decision: 'block'`, and the `isAsyncWaitSignal` assertion for the queued completion is `false`. AC2.1 passes already, because it is the negative control.

- [ ] **Step 3: Implement.** Add `completionCarrierBody(entry)`, holding the two carrier branches that currently open `notificationCarrierBody`. Rewrite `notificationCarrierBody(entry, line)` as `const body = completionCarrierBody(entry); if (body !== undefined) return body;` followed by the existing `api-request-blob` branch. Do not use `??`, because an origin entry with a `null` body must not fall through to the blob branch. In `isAsyncWaitSignal`, replace the `origin.kind` line with `if (completionCarrierBody(entry) !== undefined) return true;`. Update the `isAsyncWaitSignal` doc comment and header-comment source 4 so they name the `queued_command` carrier (#3589) and say that a request echo is deliberately not a signal.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `node --test tests/hooks-subagent-stop.test.js tests/hooks-log-modules.test.js`
Expected: PASS, 0 fail (AC3.1: the existing SubagentStop tests pass, including `hooks-log-modules`'s `isAsyncWaitSignal` unit test).

- [ ] **Step 5: Prove the tests discriminate.** Temporarily restore the old `isAsyncWaitSignal` body. Confirm AC1.1 and the queued `isAsyncWaitSignal` assertion go red, then restore the fix.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/hooks/subagent-stop.js tests/hooks-subagent-stop.test.js
git commit -m "Recognize queued_command completions in isAsyncWaitSignal — share the carrier predicate with countPendingDispatches (refs #3589)"
```

---

## Self-review

- **Spec coverage:** Step 3 covers Deliverable 1 (one shared predicate) and Deliverable 2 (exemption). AC1.1, AC2.1 and AC3.1 are covered by the test names in Steps 1 and 4.
- **Real-input probe:** the fixture is the verbatim live triplet named in Step 1. The live survey (0 blob-before-reply, 4 queued-before-reply cases) sets the blob exclusion.
- **Consumers:** `git grep isAsyncWaitSignal` finds one call site (`lastAssistantText`) and one unit test (`tests/hooks-log-modules.test.js:507`). `notificationCarrierBody` has one call site (`countPendingDispatches`).
- **Placeholders:** none.
