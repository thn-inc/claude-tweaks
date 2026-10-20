# Skill description trim audit (record #2799)

OpenAI's GPT-6 Astra guidance (the source named in the record's original request) says to shrink
skill descriptions and to stop pre-reading documentation stacks that were written to compensate for
weaker models. It is another vendor's model guidance, so this audit applies it only where it agrees
with Claude Code's own platform limits (the skill-listing budget, decision 0024) and this repo's
conventions; tying re-runs to Claude model bumps is a judgment, not a transfer of the vendor's
claim. This audit judges this plugin's skill descriptions against that guidance. Audit date: 2026-10-20. Scope: all
39 `plugin/skills/*/SKILL.md` descriptions, plus `plugin/agents/qa-agent.md` judged separately (it
is an agent, not a skill, so it is outside the measured totals below).

## Guidance vs this repo's conventions

- **Agrees.** `docs/skill-authoring.md` already says "Keep it short — every description loads into
  every session". The guidance adds no new rule here, only a reason to re-check.
- **Conflict, repo side kept: "shrink" vs the Keywords-preservation rule (#394).** Keywords are the
  skill-selection surface, and a lost keyword can stop a skill from firing. No Keywords token was
  trimmed. Human call: whether the guidance should override that rule.
- **Conflict, repo side kept, needs-human-judgment: "stop pre-reading doc stacks" vs CLAUDE.md's
  conditional "Read X before touching Y" pointers and the lazy-loaded sub-file pattern (decisions
  0016, 0024).** Those are scoped, on-demand reads, not upfront stacks. No change made.
- **Basis for the edge trims.** CLAUDE.md's Cross-references rule: "Do not restate an edge inside a
  `SKILL.md`". A description saying "works as a step within /X" or "used by /Y" restates a
  `docs/skill-graph.md` edge. Six of the trimmed skills (`browse`, `deepen`, `journeys`, `reflect`,
  `visual-review`, `visualize`) lacked a row in `docs/skill-graph.md` for at least some of those
  edges (for `browse`, only the `/stories` and `/visual-review` edges; its `/review` and `/demo`
  edges already existed), so the description was the only place those were recorded. The trim added
  11 rows there first, so no relationship was lost.

## Measurements

Total description characters across the 39 skill descriptions (excludes `qa-agent`, an agent
whose description is not part of the skill listing):

| | Chars |
|---|---|
| Before (base `7aa24bd26`) | 8,616 |
| After | 7,709 |

The listing budget from decision 0024 is 8,000 characters at 200k context and 40,000 at 1M. It is
presumably shared with every other installed plugin's skills; that sharing is an inference, not
something decision 0024 states. The 7,709 above counts description characters only. As
`tests/bin-lib/skill-audit/context-cost.test.js` notes, "listing entries also carry whenToUse and
the name, so the real listing cost is higher". The 39 `claude-tweaks:{name}` strings alone add about
875 characters, putting the real cost at roughly 8,580 or more, still over 8,000 at 200k context.
The trim cut about 900 characters of listing cost but did not bring the corpus under the budget; it
stays under the 1M figure. The per-description maximum of 1,536 is untouched; the largest skill
description was 260 characters before (`browse`, `release`) and is 259 after (`dispatch`,
`docs-health`, `specify`, `stories`). `qa-agent`, an agent rather than a skill, is a separate 409
characters, unchanged and in neither total.

Verdicts across the 39 skills plus `qa-agent`: 11 trim, 6 needs-human-judgment (including
`qa-agent`), 23 keep.

## Per-skill findings

| Skill | Chars before | Chars after | Verdict | Reason |
|---|---|---|---|---|
| `activity` | 246 | 246 | keep | Names the report's inputs and the "citations validated against gh facts" property; Keywords carry the retro/standup phrasings. |
| `assess-agent-autonomy` | 245 | 245 | keep | The "not a label lookup" clause separates it from `backlog`'s label handling. |
| `backlog` | 250 | 250 | keep | Each clause names one of its three modes (refine, overview, attention). |
| `browse` | 260 | 132 | trim | Consumer list and vocabulary clause were body content and restated skill-graph edges. |
| `build` | 220 | 220 | keep | The record-vs-design-doc input forms are the trigger distinction. |
| `capture` | 112 | 112 | keep | Already minimal. |
| `challenge` | 253 | 253 | keep | Each clause names a distinct entry point (verdict, evidence-or-accept-risk, lens). |
| `code-health` | 227 | 227 | keep | "never edits it" separates it from the editing skills. |
| `deepen` | 196 | 147 | trim | Restated the `/review` and `/reflect` edges. |
| `demo` | 257 | 257 | keep | "Distinct from /test and /review" is the disambiguation among three verification skills. |
| `design-wrapper` | 252 | 143 | trim | Explanatory second sentence removed; the caller list stays as the trigger. |
| `dispatch` | 259 | 259 | keep | Drain vs `#N` direct modes are both trigger surfaces. |
| `docs-health` | 259 | 259 | keep | "Never edits docs" and the audit axes are the scope. |
| `feedback` | 255 | 255 | keep | Separates upstream filing from `claude-user-config:repo-feedback`. |
| `flow` | 239 | 239 | keep | The records-only negative scope stops design-doc misuse. |
| `harness-health` | 254 | 254 | keep | "Never edits code" and the audit targets are the scope. |
| `help` | 134 | 134 | keep | Overlaps the CLI's built-in `/help`; the trigger wording disambiguates. |
| `init` | 220 | 220 | keep | Collides with the built-in `init` skill; the re-run trigger is the claude-tweaks anchor. |
| `intake` | 116 | 116 | needs-human-judgment | No "Use when/to/for" trigger form; a convention-conformance question, not a trim. |
| `journey-health` | 255 | 255 | keep | Scope ("one journey or the due coverage scan") and "always files an issue" are behavior the selector needs. |
| `journeys` | 152 | 93 | trim | Restated the `/build` edge. |
| `ledger` | 226 | 226 | needs-human-judgment | "A knowledge dependency read by build/test/review/wrap-up/flow" is a consumer list of the kind trimmed elsewhere; kept pending a human call, since its "never invoked via the Skill tool" clause is a documented reason to keep and prevents a failing invocation. |
| `pipeline-smoke-test` | 251 | 251 | keep | Scope (live git/gh state, claim-race path) is what distinguishes it from the test suite. |
| `reflect` | 233 | 146 | trim | Restated the `/review` and `/wrap-up` edges. |
| `release` | 260 | 100 | trim | Procedure summary; the Keywords carry the scope. |
| `research` | 246 | 246 | keep | "via /deep-research" disambiguates from `anthropic-skills:deep-research`. |
| `review` | 227 | 164 | trim | Dropped the restatement "The quality gate between…"; "Gates on /claude-tweaks:test passing" kept as a precondition. |
| `routine` | 242 | 242 | keep | Create/update/status verbs and "project-agnostic template" distinguish it from `routine-kickoff`. |
| `routine-kickoff` | 246 | 155 | trim | Procedure summary removed; the "Not user-facing" negative trigger kept. Its description, like `intake`, `sweep` and `walkthrough`, has no "Use when/to/for" form; that is intentional for a machine-invoked, not-user-facing skill, so it is not grouped with those three. |
| `simplify` | 257 | 257 | needs-human-judgment | Name collides with the built-in `simplify` skill, and its edge clause is the only claude-tweaks-lifecycle anchor, so trimming is not clear-cut. |
| `specify` | 259 | 259 | keep | The `#N`, `#N,#M`, `#A-#B` and design-doc input forms are the trigger surface. |
| `stories` | 259 | 259 | keep | "semantic-locator (schema v2)" and "diff-aware updates" separate it from `test`'s story validation. |
| `sweep` | 126 | 126 | needs-human-judgment | No "Use when/to/for" trigger form; a convention-conformance question, not a trim. |
| `test` | 127 | 127 | keep | "The mechanical 'does it work?' gate" separates it from `review` and `demo`. |
| `tidy` | 141 | 141 | keep | Already short; each item names a distinct hygiene scan. |
| `visual-review` | 247 | 187 | trim | Restated the `/review` edge. |
| `visualize` | 212 | 139 | trim | Restated skill-graph edges. |
| `walkthrough` | 236 | 236 | needs-human-judgment | No "Use when/to/for" trigger form; a convention-conformance question, not a trim. |
| `wrap-up` | 160 | 132 | trim | Dropped the restatement "The lifecycle closure step." |
| `qa-agent` | 409 | 409 | needs-human-judgment | The "owns a single named session, runs in parallel" clause guides the dispatching model, not trigger matching, so whether it belongs in the description is a judgment call. |

## Re-running this audit

Re-run it on a model version bump, alongside the checklist in `docs/skill-authoring.md`'s
"Model-version prompting notes". Re-measure with:

```bash
node -e 'const m=require("./plugin/bin/lib/skill-audit/context-cost.js");const d=m.measureDescriptions(process.cwd()+"/plugin");console.log(m.totalDescriptionChars(d));for(const x of d)console.log(x.name,x.chars)'
```

Then re-judge each description by the same rule: trim only a clause that is body content or a
restated skill-graph edge, never a Keywords token or a name-collision disambiguation.
