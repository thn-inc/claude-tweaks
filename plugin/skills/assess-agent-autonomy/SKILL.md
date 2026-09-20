---
name: assess-agent-autonomy
description: Use when backlog, dispatch, or specify need a content-aware trust or ceremony verdict, not a label lookup. Keywords - autonomy, trust, judgment, grant recommendation, auto-merge, blast radius, failure classification, ceremony profile, fast-lane.
argument-hint: "<grant-check|merge-check|failure-check|ceremony-check> [#{n}] [--base <ref>]"
---

# Assess Agent Autonomy — Content-Aware Trust Verdicts

Four-mode inline helper that replaces mechanical label lookups with judgment read from actual
record/diff/failure content. Never invoked directly by a human — always a component step inside
`/claude-tweaks:backlog refine` (human-present or headless posture), `/claude-tweaks:dispatch`,
`/claude-tweaks:specify`, or (fallback only) `/claude-tweaks:flow`:

```
/claude-tweaks:backlog refine (human-present)     [ grant-check ]    -> RECOMMEND_BUILD / RECOMMEND_MERGE
/claude-tweaks:backlog refine (headless posture)  [ grant-check ]    -> RECOMMEND_BUILD / RECOMMEND_MERGE
/claude-tweaks:dispatch Auto-merge                [ merge-check ]    -> VERDICT: auto-merge | needs-human
/claude-tweaks:dispatch Settle                    [ failure-check ]  -> CLASSIFICATION + NOTIFY_NOW
/claude-tweaks:specify Step 3                     [ ceremony-check ] -> CEREMONY: fast-lane | standard
```

Each mode's full Gather/Judge/Render procedure lives in its own sub-file — read only the one the
caller needs:

- `grant-check` → `grant-check.md`
- `merge-check` → `merge-check.md`
- `failure-check` → `failure-check.md`
- `ceremony-check` → `ceremony-check.md`

## When to Use

The diagram above names each mode's call site; each sub-file's own "Called from" line gives the
full detail, including secondary same-mode callers (e.g. `grant-check` also covers
`refine`'s headless posture's gate chain; `merge-check` also covers `/claude-tweaks:wrap-up`'s
Review Console Auto-merge short-circuit).

Not for: granting `auto:build`/`auto:merge` (still `/claude-tweaks:backlog refine`'s
human-confirmed job), merging anything itself (`/claude-tweaks:dispatch` acts on the verdict), or
any decision outside the call sites above — this is not a general-purpose risk service.

## Input

`$ARGUMENTS` is `{mode} [#{n}] [--base <ref>]` — `mode` selects one of `grant-check` |
`merge-check` | `failure-check` | `ceremony-check`; `#{n}` is the record's issue number, when the
mode needs one. Each mode's own Step 1 ("Gather") is the source of truth for exactly what it
fetches and how — they differ enough (some key off `#{n}`, `merge-check` doesn't consume it at
all) that this router doesn't restate it.

`#{n}` is omitted only from `ceremony-check`'s primary call in `/specify`'s Step 3
decomposition-mode per-sub-issue loop — the sub-issue has no issue number yet at that point in the
procedure (it's assigned only after the record is created, later in the same step), so that call
site invokes this skill as bare `ceremony-check` with no trailing `#{n}` at all. Every other mode,
and `ceremony-check`'s own Shaping-mode and `/flow`-fallback calls, always pass `#{n}`.

`--base <ref>` is `merge-check`-only — an optional pre-known merge-base commit or ref the caller
already has in context; see its own Step 1 for how it short-circuits integration-branch
resolution. Ignored by the other three modes.

Invoked inline via the Skill tool, in the calling agent's own context — never a fresh Task-agent
dispatch (see Anti-Patterns); there is no cross-process hand-off.

## Error Handling

Two failure shapes render different rationale text — never collapse them:

- **could-not-gather** — Step 1's own gather failed (`gh` absent with no MCP fallback, a fetch
  error, a timeout, an unreachable repo). Render the mode's usual conservative outcome below, with
  RATIONALE naming the specific gather failure verbatim — never phrased as a content judgment,
  since none was read.
- **gathered-but-inconclusive** — the gather succeeded, but the content itself doesn't clearly
  support a confident verdict (malformed input, an inconclusive read). Same conservative outcome;
  RATIONALE explains the content ambiguity instead.

Conservative default per mode: `grant-check` → `RECOMMEND_BUILD: false` / `RECOMMEND_MERGE:
false`; `merge-check` → `VERDICT: needs-human`; `failure-check` → `CLASSIFICATION: correctness`;
`ceremony-check` → `CEREMONY: standard`. Never resolve ambiguity toward more autonomy or less
ceremony — a missed auto-merge or a fuller wrap-up pass costs a human a click or a few extra
minutes; a wrongly-granted shortcut could ship something bad or under-reflect on real complexity.

## Component-Skill Contract

`/claude-tweaks:assess-agent-autonomy` is **always** a component skill — it is never invoked
directly by a human, and never renders a `## Next Actions` block. Its only callers are
`/claude-tweaks:backlog` (`refine` Step 2 and `grant`'s gate 4, both `grant-check`),
`/claude-tweaks:dispatch` (Auto-merge gate `merge-check`; Settle step `failure-check`),
`/claude-tweaks:wrap-up` (Review Console's Auto-merge short-circuit, `merge-check`),
`/claude-tweaks:specify` (Step 3, `ceremony-check`), and `/claude-tweaks:flow` (materialization
fallback, `ceremony-check`, only when a record carries no `ceremony:*` label) — each sub-file's own
"Called from" line is the source of truth for the full detail behind each entry here.

## Anti-Patterns

| Pattern | Why It Fails |
|---------|--------------|
| Dispatching this as a fresh Task agent instead of an inline Skill invocation | The caller already holds the diff/review-findings/failure-output. `challenge/SKILL.md`'s framing-check mode declined the same structural isolation on three grounds, not cost alone (#1276) — see its Called-from paragraph for the full declined-isolation rationale. |
| Treating `ceremony-check`'s verdict as a merge-safety signal | `ceremony-profile` and `auto:merge` are independent axes — a `fast-lane` record can still fail `merge-check`. Ceremony depth never influences merge eligibility, or vice versa. |
| Writing to `decisions.md` from inside this skill | This skill doesn't resolve run dirs; logging is the caller's job (`/claude-tweaks:backlog refine` or `/claude-tweaks:dispatch`). |
| Rendering a conservative verdict with a content-judgment-style rationale when the gather itself failed | Misreports a tooling/transport gap as if the record/diff/failure content had been weighed and found wanting — indistinguishable from principled caution to anyone reading the log. Name the gather failure verbatim instead (could-not-gather, above). |

Mode-specific Anti-Patterns rows live in their own sub-file (`merge-check.md`, `failure-check.md`) —
these four are the ones that hold across every mode.
