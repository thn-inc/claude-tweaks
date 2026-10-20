# Multi-Agent Coordination Primitive

Canonical patterns for how parallel subagents *interact* — composition rules, comparison logic, and decision-log shapes for the modes below. Consumed by `/review` (Reproduction, Debate) and `/specify` (Multi-persona red-team).

This file is the single source of truth. Skills inline the relevant dispatch template **literally** in their `Task()` prompts — agents only see what's in their prompt, they cannot read sibling files.

## Why this exists

The Subagent Contract (`subagent-output-contract.md`) describes how agents **format output** (Templates A/B/C, status protocol, model profiles). It does not describe how multiple agents **compose**. The following forces shape coordination:

1. **False positives in single-agent review** — one agent, even Capable, hallucinates findings. Cutting that requires N>1 with deterministic match rules.
2. **Cross-lens disagreement is signal, not noise** — when two reviewer lenses contradict each other on the same line, the right move is one structured debate round, not silent suppression.

The primitive addresses these with the coordination modes below, each with hard limits (not parameters).

## Composition rule

The primitive describes how agents **interact**; the Subagent Contract describes how agents **format output**. The two compose: a coordination dispatch sends N Template-A (or B / C) agents in one batch, then the primitive's comparison/aggregation logic decides what survives.

A coordination caller writes one Task() prompt per agent (each containing the relevant Template literally), runs them in parallel, then applies the primitive's deterministic rules to the returned outputs.

## Hard limits

| Mode | Agents | Layers | Rounds | Parameterizable? |
|---|---|---|---|---|
| Reproduction | 2 | 1 | 1 | No — N=2 always |
| Debate | 2 | 1 | 1 | No — exactly one critique round |
| Multi-persona red-team | 1 or 3 | 1 | 1 | Persona count only (by the sub-issue's `ceremony:*` tier) |

No mode composition. You cannot reproduce a debate. Modes are leaf operations.

## Mode 1 — Reproduction

### Purpose

Cut false positives in single-agent review by dispatching two identical agents and keeping only findings both surface. Each one's hallucinations are unlikely to land at the same `Path:Line` with the same severity bucket.

### Shape

- 2 agents, parallel, 1 turn each.
- Identical prompts (same scope, same Template, same tier).
- Independent runs (no agent sees the other's output).

### Comparison rule

Two findings match when **all three** hold:

1. **Exact path match** — `src/auth.ts` matches `src/auth.ts`, not `src/auth/index.ts`.
2. **Line within ±2, or within ±5 on text agreement** — same finding, slight line-number disagreement is acceptable. Inside ±2 a pair matches unless both texts are known and their substance similarity is below 0.2. A pair 3-5 lines apart (two agents anchoring one finding on different lines of one multi-line statement) matches only when both findings carry text and their substance similarity is at least 0.2, the same threshold that applies inside ±2. A pair with missing text never matches in the wider band.
3. **Matching severity bucket** — `critical` + `high` collapse to one bucket; `medium` + `low` + `info` collapse to another. Cross-bucket mismatches do not reproduce.

### Auto-resolution

| Outcome | Status | Destination |
|---|---|---|
| Both agents surface a matching finding | `confirmed` | Surface to caller; treat as real |
| Only one agent surfaces a finding (path/line/severity mismatch) | `unconfirmed` | STAGED to Review Console — never silently dropped |

No outcome is "ask the user inline." Unconfirmed findings stage; the caller's Review Console handles disposition.

### Dispatch template (inline in caller's Task() calls)

```
{Same Template-A prompt sent to BOTH agents — identical scope, identical paths, identical output format.}

[Use: Standard] — reproduction agent. Independent run; do not assume any prior context.
```

### Decision-log entry format

Per `auto-decision-log.md` schema:

```
- AUTO {HH:MM:SS} — /review reproduction: confirmed {N} findings, staged {M} unconfirmed. Reversibility: high (commit / stage path).
- STAGED {HH:MM:SS} — /review reproduction: finding {path}:{line} surfaced by one agent only. Stage path: staged/review-unconfirmed-{n}.patch.
```

`staged/review-unconfirmed-{n}.patch` follows `_shared/staged-patch.md`: `Target:` / `Invariant:` / `Finding:` / `Staged-at:` preamble plus the diff, validated per that file's Staging-time gate — `git apply --check` from the worktree, then its Stacked check (`bin/check-staged-stack.js`) — before the `STAGED` entry above is written — a failing check is handled per that gate and surfaced at staging, and the console re-derives from `Invariant:` when the diff has gone stale.

### Review Console staging format

```
| Finding | Source | Severity | Reproducibility |
|---|---|---|---|
| `src/auth.ts:42` Missing expiry check | agent-A only | high | unconfirmed |
```

## Mode 2 — Debate

### Purpose

Resolve cross-lens disagreement deterministically. When two reviewer lenses (security and architecture, say) produce contradictory verdicts on the same region of code, run exactly one critique round between two judging agents.

### Shape

- Triggered, not always-on. Fires only when cross-lens `Path:Line` overlap is detected.
- 2 agents, parallel, 1 round.
- Each agent reads both contradicting verdicts and returns: `agree` / `disagree` / `partial` plus one paragraph reasoning.

### Trigger

The dispatcher scans findings across lenses. If two findings from different lenses share:

- **Exact path** match, and
- **Line within ±5** (looser than reproduction's ±2, and with no substance gate — "same region of code"), and
- **Contradicting verdicts** (e.g., one says "issue", one says "no issue", or differing severities across bucket boundaries),

then debate is dispatched on that pair.

### Comparison rule

Two judging agents each return a verdict. Resolution table:

| Verdict A | Verdict B | Outcome | Status |
|---|---|---|---|
| agree | agree | `confirmed` | AUTO |
| disagree | disagree | `unconfirmed` | AUTO |
| any other combination (incl. `partial`) | — | `contested` | STAGED |

### Auto-resolution

All three outcomes auto-resolve. No "ask the user inline."

### Dispatch template (inline in caller's Task() calls)

```
Two lenses disagreed on this region. Review the conflicting findings below and return:
1. Verdict: agree / disagree / partial
2. One paragraph of reasoning.

Contested region: {path}:{line}
Finding A (lens: {lensA}): {finding text}
Finding B (lens: {lensB}): {finding text}

[Use: Frontier — debate agent. Independent run; do not see the other judge's reasoning.
Degrades per the resolver's preconditions (contract § Model Selection). One of this
plugin's contract-enumerated verdict-gate slots — the fixed 2-agent shape is exempted
from the general singleton-only rule; see `_shared/subagent-output-contract.md`.]
```

### Decision-log entry format

```
- AUTO {HH:MM:SS} — /review debate: {path}:{line} confirmed (both agreed). Reversibility: high.
- AUTO {HH:MM:SS} — /review debate: {path}:{line} unconfirmed (both disagreed). Reversibility: high.
- STAGED {HH:MM:SS} — /review debate: {path}:{line} contested (mixed verdicts). Stage path: staged/review-debate-{n}.md.
```

### Review Console staging format

Used only for `contested` outcomes:

```
| Region | Lens A verdict | Lens B verdict | Judge A | Judge B | Disposition |
|---|---|---|---|---|---|
| `src/auth.ts:42-46` | issue | no issue | agree | partial | contested → user decision |
```

## Mode 3 — Multi-persona red-team

### Purpose

Surface ambiguity and under-specification in a spec doc by reading it through one to three fixed lenses. Each persona asks one question; their findings flag spots where the spec leaves room for diverging interpretations.

### Shape

- 1 or 3 agents, parallel, 1 turn each — count set by the sub-issue's `ceremony:*` label: `fast-lane` dispatches Skeptical Reviewer only, `standard` (or a missing label) dispatches all three.
- The persona roster itself is fixed — extending, swapping, or adding personas is not parameterizable; only which subset of the fixed three run is.

### Personas (inline in caller's Task() prompts, verbatim)

| Persona | Lens question |
|---|---|
| Implementer | "Could I build exactly what this asks for without asking a question?" |
| Maintainer | "In 6 months, can someone changing related code know what they can/can't break?" |
| Skeptical Reviewer | "What unstated assumption is doing the load-bearing work here?" |

### Comparison / aggregation rule

Each persona returns findings as Template-A. Findings are written **into the artefact itself** (the spec being reviewed), not into a sidecar — either:

- An appended `## Open Questions` section at the bottom of the spec, with one bullet per finding labeled by persona, or
- Inline `<!-- ambiguity: {persona} — {question} -->` HTML comments at the location.

The dispatcher picks the form per caller; the primitive does not mandate one.

### Auto-resolution

Every finding produces a STAGED decision-log entry. None are auto-applied (these are *questions for the author*, not fixes). None are auto-dropped.

### Dispatch template (inline in caller's Task() calls — one Task() per persona)

```
You are reviewing a spec from the perspective of: {persona name}.

Your lens question: {persona lens question, verbatim}

Spec under review:
{spec content}

Return findings as Template-A. For each finding, give:
- Severity: medium / low (red-team findings are never critical or high — they're questions, not bugs)
- Path:Line: section heading or line in the spec
- Finding: the ambiguity, missing constraint, or assumption
- Evidence: which phrasing or omission in the spec triggered the lens

[Use: Standard] — {persona name} persona.
```

### Decision-log entry format

```
- STAGED {HH:MM:SS} — /specify red-team ({persona}): {path}:{line} {finding}. Stage path: staged/specify-redteam-{n}.md.
```

### Review Console staging format

```
| Persona | Spec section | Question / ambiguity |
|---|---|---|
| Implementer | ## Acceptance criteria | What does "fast enough" mean in AC 3? |
```

## Anti-Patterns

| Anti-pattern | Why it fails |
|---|---|
| Inventing a new mode | The modes are selected for specific gate problems. A new mode signals the gate is misshapen; fix the gate. |
| Composing modes (e.g., reproducing a debate) | Modes are leaf operations. Composition produces unbounded combinatorial agent counts and no clear winner-selection. |
| Exceeding the hard limits (N>2 reproduction, N>2 debate, >3 red-team personas) | Each limit is research-grounded: reproduction past N=2 has diminishing returns; debate past N=2 produces vote-counting not deliberation; red-team past 3 personas dilutes signal. |
| Leaving an outcome "ask the user inline" | Every outcome must auto-resolve to AUTO or STAGED. The Review Console is the user-facing gate, not the dispatcher. |
| Referencing the dispatch template from callers instead of inlining it | Callers can't `read` sibling files; agents only see prompt content. Inline the template literally in every Task() call. |
| Adding coordination-specific STATUS values (`CONTESTED`, `REPRODUCED`) to the decision log | The existing `AUTO` / `STAGED` / `KEPT-PROMPT` schema covers every outcome. Coordination-specific info goes in `action` and `detail`. |
| Skipping the decision-log entry to save tokens | Silent automation without an audit trail is forbidden per `auto-decision-log.md`. Always log. |

## See also

- `_shared/subagent-output-contract.md` — output templates and status protocol that compose with each dispatch
- `_shared/auto-decision-log.md` — entry schema for AUTO / STAGED / KEPT-PROMPT
- `bin/lib/coordination.js` — pure-function helpers for severity bucketing, finding matching, debate-verdict resolution, cross-lens overlap detection, and dispatch-shape construction
