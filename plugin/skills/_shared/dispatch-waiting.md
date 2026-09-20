# Waiting for Dispatched Agents — Shared Procedure

Extracted from `_shared/subagent-output-contract.md` (#1995) for that file's byte headroom; cited from there, never restated.

The task-notification that arrives when a dispatched agent finishes is the **primary resume signal** — it is what actually wakes the dispatcher, not a per-agent `ScheduleWakeup` park-and-poll loop (a bounded slot-fill poll like `/test`'s QA dispatch is a different, still-valid pattern — see that skill's `qa-prompts.md`). Treat the notification as the default: after dispatching a wave of parallel agents, let their completion notifications drive the next turn.

**Cap parking to one long-delay watchdog per dispatch wave, not one per dispatch.** A `ScheduleWakeup` call for every individual agent in a fan-out is redundant against the notification each one already sends on completion, and it inflates per-wave API-call and context overhead for no additional signal — six scheduled parks buy nothing that the six completion notifications don't already deliver on their own. If a backstop against a hung or unusually slow wave is genuinely needed, schedule at most one long-delay watchdog for the whole wave, not one per agent dispatched into it.
