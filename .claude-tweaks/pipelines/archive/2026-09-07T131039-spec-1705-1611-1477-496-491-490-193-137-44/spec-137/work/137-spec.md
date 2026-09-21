---
record: 137
origin: human
risk: low
size: low
ceremony: standard
grants: []
surface: infra
---
# 137: Report the resolved claude-tweaks build from the SessionStart hook, not just routine prompts

Surface: infra

## Current State

6.39.0 made routine firings report which plugin build they resolved, by adding a paragraph to the standard prompt preamble. That preamble is written once in `skills/_shared/routine-template-schema.md` and copied verbatim into all six `skills/*/routine-template.yml` files, so the diagnostic exists as seven copies of one paragraph, pinned by a drift test added in the same release (`tests/routine-template-schema.test.js`).

It also only reaches routine firings. An interactive session, a `/flow` run, a dispatched subagent - none of them report the build they resolved, and all of them can sit on a stale plugin directory for exactly the reasons `[IL-89]` documents.

`bin/lib/hooks/session-start.js:55` already returns `hookSpecificOutput.additionalContext` - that is how the unfinished-pipeline-run notice reaches a session today. Emitting `claude-tweaks v{version} @ {CLAUDE_PLUGIN_ROOT}` from there would cover every entry point (local, cloud, routine, subagent), not just the six routine templates; read the version from `${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json`, the same authoritative source the preamble uses; and remove the seven-copy maintenance burden for the diagnostic purpose specifically.

## Deliverables

Add a resolved-build line to `bin/lib/hooks/session-start.js`'s `additionalContext` output, alongside the existing unfinished-pipeline-run notice, reading the version from `plugin.json` the same way the routine preamble does. This is a complement to the existing preamble paragraph, not a replacement: the hook puts the version in the session's context (the agent knows it, but may never say it out loud), while the preamble puts it in the agent's output (what a headless self-report, a routine transcript, or a filed issue can actually be read back from later). The preamble's seven copies stay, still pinned by the existing drift test.

Whoever picks this up should also decide whether the hook line should be unconditional, or emitted only when the resolved version differs from the marketplace catalog's declared version - turning a constant always-on line into a signal, at the cost of the hook doing a catalog read on every session start.

## Acceptance Criteria

- `bin/lib/hooks/session-start.js`'s `additionalContext` output includes a resolved-build line (`claude-tweaks v{version} @ {CLAUDE_PLUGIN_ROOT}` or equivalent) on every session start, sourced from `plugin.json`.
- The existing seven-copy routine preamble paragraph and its drift test (`tests/routine-template-schema.test.js`) are untouched - this record adds, it does not replace.
- The decision on unconditional-vs-differs-from-catalog is made and documented in the implementation, not left as an open question in code.
- `npm test` passes.

## Technical Approach

Add the resolved-build line to the same `hookSpecificOutput.additionalContext` composition `bin/lib/hooks/session-start.js:55` already builds for the unfinished-pipeline-run notice - read `${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json`'s version field (the authoritative source the routine preamble paragraph already cites) and format it consistently with how the preamble states it, so a reader comparing a routine transcript's self-report against a session's own context sees the identical string shape. If the differs-from-catalog option is chosen, this needs a marketplace catalog read at session start; if the unconditional option is chosen, no extra read is needed - decide before implementing, per the open question above.

### Key Files

- `plugin/bin/lib/hooks/session-start.js` - add the resolved-build line to `additionalContext`, near the existing unfinished-pipeline-run notice around line 55
- `.claude-plugin/plugin.json` - the version source, read but not modified

## Gotchas

- This is additive, not a replacement - do not remove or shorten the seven-copy routine preamble paragraph or its drift test; the two mechanisms serve different purposes (context vs. output) as the Current State explains.
- The always-on-context-cost tradeoff is real and explicitly left as an open decision for whoever implements this - don't silently pick unconditional without at least noting the alternative was considered.
- If the differs-from-catalog option is chosen, a marketplace catalog read on every session start is a new latency/failure surface (network dependency at session start) that the unconditional option doesn't have - weigh this before committing to that branch.

## Original request

Report the resolved claude-tweaks build from the SessionStart hook, not just routine prompts

**Trigger:** the resolved-build line proves useful in practice (a routine firing where it actually disambiguated a stale sandbox from a real bug), **or** the routine preamble's seven copies need editing again for any reason — whichever comes first.

**Origin:** deferred from `/claude-tweaks:wrap-up` reflection on #129 (shipped in 6.39.0).

## Context

6.39.0 made routine firings report which plugin build they resolved, by adding a paragraph to the standard prompt preamble. That preamble is written once in `skills/_shared/routine-template-schema.md` and copied verbatim into all six `skills/*/routine-template.yml` files — so the diagnostic now exists as seven copies of one paragraph, pinned by a drift test added in the same release (`tests/routine-template-schema.test.js`).

It also only reaches **routine firings**. An interactive session, a `/flow` run, a dispatched subagent — none of them report the build they resolved, and all of them can sit on a stale plugin directory for exactly the reasons `[IL-89]` documents.

## The alternative

`bin/lib/hooks/session-start.js:55` already returns `hookSpecificOutput.additionalContext` — that is how the unfinished-pipeline-run notice reaches a session today. Emitting `claude-tweaks v{version} @ {CLAUDE_PLUGIN_ROOT}` from there would:

- cover every entry point (local, cloud, routine, subagent), not just the six routine templates
- read the version from `${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json` — the same authoritative source the preamble uses
- remove the seven-copy maintenance burden for the diagnostic purpose specifically

## Why this is a complement, not a replacement

The two put the version in different places, and the difference matters:

- The **hook** puts it in the session's *context* — the agent knows it, but may never say it.
- The **preamble** puts it in the agent's *output* — which is what a headless self-report, a routine transcript, and a filed issue can actually be read back from later.

A self-report needs the output form. So this record proposes *adding* the hook, not deleting the preamble paragraph. The preamble's seven copies would remain, still pinned by the drift test.

## Open question for whoever picks this up

Whether the hook line is worth its always-on context cost in every session, given it is only ever consulted when something looks wrong. One option worth weighing: emit it only when the resolved version differs from the marketplace catalog's declared version — turning a constant line into a signal, at the cost of the hook doing a catalog read on every session start.


