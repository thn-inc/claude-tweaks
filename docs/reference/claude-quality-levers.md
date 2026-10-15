# Claude coding-quality levers independent of model weights

Three operational levers — documented in Anthropic's own postmortem on a string of Claude Code
quality regressions — that can swing coding quality without the underlying model weights
changing at all. Relevant whenever triaging a quality complaint, and whenever deciding whether
an existing skill's (or CLAUDE.md's own) verification/self-check instructions are still earning
their keep after a model version bump — see `docs/skill-authoring.md`'s "Model-version prompting
notes" checklist, which this doc backs.

Source (fetched and read directly, not via a secondary citation):
https://www.anthropic.com/engineering/april-23-postmortem

## Reasoning-effort defaults

Anthropic lowered the default reasoning effort from `high` to `medium` on March 4, 2026 to cut
latency, then reversed the change on April 7 after user feedback — "Users told us they'd prefer
to default to higher intelligence and opt into lower effort for simple tasks." Current defaults
are `xhigh` for Opus 4.7 and `high` for other models. A skill's own effort-profile assumptions
(e.g. `_shared/subagent-dispatch-core.md`'s Model Selection table) can silently stop matching
reality if the platform default moves without that skill being re-checked.

## Response-length system-prompt instructions

A system-prompt change on April 16, 2026 that capped response length ("keep text between tool
calls to ≤25 words; keep final responses to ≤100 words") measurably hurt coding quality once
combined with other prompt changes — a 3% intelligence drop on broader evals — and was reverted
on April 20. A skill instruction that caps verbosity for its own reasons should not assume the
platform is simultaneously doing the same thing by default.

## Idle-session context-clearing

A March 26, 2026 caching optimization meant to clear a session's thinking content after an hour
of idle time shipped with a bug that cleared it on every subsequent turn instead of once, making
Claude appear forgetful/repetitive and draining usage limits faster. Fixed since; cited here as a
reminder that caching/context-management defaults are themselves a quality lever, not a fixed
constant to assume away.

## What this doc does not claim

The postmortem documents the three regressions and fixes above; it does not itself state a
general recommendation to remove old verification/self-check instructions when upgrading to a
newer, higher-effort model — that framing, as sourced from a secondary article, is not
substantiated by a direct read of the primary source. Treat "a newer model may already cover
what an older instruction was compensating for, so trim rather than add" as a reasoned inference
to apply case-by-case via `docs/skill-authoring.md`'s checklist, not as an Anthropic-stated policy.
