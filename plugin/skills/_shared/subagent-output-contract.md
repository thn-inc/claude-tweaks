# Subagent Contract

Canonical input/output rules for parallel-dispatched subagents. Referenced from every Form B / Form C parallel-execution site across skills.

This file is the single source of truth. Skills include the relevant template **literally** in their `Task()` prompts — agents only see what's in their prompt, they cannot read sibling files.

Five sections — Working Directory Discipline, Model Selection, Template A, Failed-agent
retrieval, and the fan-out section ("How to integrate at a dispatch site") — moved to
`_shared/subagent-dispatch-core.md` (#2019), so a call site that needs only those can compose a
bundle under the 40 KB ceiling without also paying for everything below. Both files together are
the one contract; this file cites the companion rather than restating it.

## Why this exists

This contract is **dispatch correctness** discipline. A dispatched agent is not a cheaper copy of the main thread — it is a separate reasoning context the dispatcher cannot see into, and every rule below exists to make that separation safe to act on:

1. **A dispatch you cannot reproduce is a dispatch you cannot trust.** An agent handed the conversation inherits the dispatcher's framing and its half-formed conclusions, then confirms them. The clean room is what makes N agents independent evidence rather than N echoes — the precondition for reproduction, debate, and refutation (`multi-agent-coordination.md`) meaning anything at all.
2. **An outcome you cannot route is an outcome you will misread.** Without a fixed status line, "I couldn't find the file" and "I found nothing wrong" arrive as the same confident paragraph, and a failed dispatch aggregates silently as a clean result.
3. **A result you cannot parse is a result you will paraphrase.** Free-form prose from three agents gets merged by the dispatcher's summary rather than by its content — inventing severities, dropping findings, smoothing over disagreement. Templates A/B/C keep aggregation mechanical.
4. **A model mismatch surfaces as a wrong answer, not just a bill.** An under-powered agent on judgment work returns confident nonsense shaped exactly like a finding.

The contract addresses all four — **input discipline** (below), **the status protocol**, **output templates** (Templates A/B/C), and **model selection** (per-dispatch profile guidance) — and adds **working-directory discipline**, the same principle applied to the filesystem: an agent whose CWD the dispatcher merely assumed lands real commits on the wrong branch while the dispatcher's own `git status` looks fine — and **waiting discipline**, the same principle applied to resume signals: a dispatcher that parks per-agent instead of trusting the notification wastes exactly the context this contract exists to conserve.

Following it also costs less to run, and the templates are deliberately compact. Treat that as a welcome side effect, never as the justification: a dispatch that saves tokens while returning an unroutable, unparseable, or context-contaminated result has bought nothing. The one sizing rule here (inherited project context, under Input Discipline) exists to stop a fan-out from being wider than it is worth — not to price the protocol.

## Input Discipline

A dispatched agent is a clean room. Don't pass the conversation. Pass exactly:

1. **The task scope** — one sentence: "Audit `src/auth.ts` for the OWASP top 10."
2. **The file/path the agent should read** — explicit paths, not "the relevant code."

   **Cite the run's composed bundle, never a `_shared/` path** — except inside the fallback sentence itself, which is expected to name the underlying source files it falls back to. The dispatcher composes the bundle before dispatch (`bin/compose-context.js`, `{run}/context/{step}.md`) and the prompt cites that path, stating in the same sentence the one fallback the agent can act on — if that bundle is absent, read the named source file directly; the compose command's own fallback (if the compose command is unavailable or exits non-zero, read the named source files directly) belongs to the dispatcher's compose instruction, since the agent never runs that command or sees its exit. `dispatch/task-prompt.md`'s Context pack is the reference shape for both halves.
3. **The output template** — literally, inline. Agents only see what's in their prompt; they cannot read sibling files.
4. **Constraints that prevent overreach** — "Do not modify other files." "Read-only."

Do NOT pass: prior messages, the user's original phrasing, your own findings so far, or "background context for completeness." Each of those compounds across N agents.

**Scratch rule.** A file an agent creates to verify its own work (probe script, benchmark, fixture) goes under the scratch directory the prompt names, never under the repository tree. The agent deletes what it created there before its status word; a dispatch granting write access must name that path. Self-reported; sweep callers check their subdir too (`step3-lens-dispatch.md`). **When that scratch directory lies outside the agent's own worktree** — an `EnterWorktree`-isolated dispatch whose `{ctx-dir}` resolves to the shared main checkout, the case a review fan-out hits on every `worktree`-mode run — create and delete the file via Bash (`mkdir -p` + a shell redirect/heredoc, then `rm`), never the `Write`/`Edit` tools. Empirically confirmed on record #2245: a `Write` call targeting a path outside the calling agent's own worktree is refused outright by the harness's worktree-pinning guard, with an explicit message naming the agent's worktree and telling it to write there instead — but a Bash-mediated write to the identical path succeeds, since the guard is scoped to the file-editing tools, not to Bash. This keeps the promise above intact rather than bypassing it: the scratch path is still outside the repository tree either way, only the mechanism used to reach it changes.

**`subagent_type: "fork"` is prohibited for a clean-room fan-out dispatch, and should be avoided for any narrow/read-only/research-scoped solo dispatch too** — full rationale, the empirically-verified structural mitigation, and the `isolation: "worktree"` mandate: `_shared/fork-worktree-isolation.md`. See "Session-inherit protection" below for the related, narrower model-override exemption this restriction is not.

When in doubt, give less context. If the agent comes back with `NEEDS_CONTEXT`, give it more on the re-dispatch.

**A file allowlist inherits the staleness of whatever it was derived from.** When the scope comes from an issue body, a design doc, or any other snapshot, the real work site may sit outside it — the four health-sweep skills file issues whose file lists are routinely wrong in both directions (a named file that isn't really affected, and an unnamed one that is). Say so in the dispatch: the agent must locate constructs by content rather than by the source's line numbers, and report an out-of-allowlist site under `DONE_WITH_CONCERNS` instead of silently scoping around it or editing outside its list. That report is cheap; a fix applied to the wrong file because the right one wasn't listed is not.

**Inherited project context is the dominant per-agent cost.** Every dispatched agent also inherits the project's `CLAUDE.md` in its system prompt — you do not pass it, and you cannot opt out of it. That inherited payload is typically an order of magnitude larger than a well-disciplined prompt, and it multiplies by N across a fan-out, so a wide dispatch of cheap, mechanical agents costs far more than its prompts suggest. Size a fan-out against the inherited total, not the prompt you wrote — and measure the current file rather than trusting a remembered figure, since it changes. Note the division of labour: input discipline governs only your share of the cost; the lever for the inherited term is keeping `CLAUDE.md` itself lean. Sonnet 5's tokenizer emits roughly 30% more tokens for the same text than its predecessor, so the inherited payload's cost rose with it — the lever is unchanged: keep CLAUDE.md lean.

**Pre-specify shared interface text across interdependent parallel dispatches.** When two dispatches in the same fan-out produce artifacts that must cite each other by exact text — a heading, a literal string, a function's return value, a CLI flag name — decide that exact text yourself and quote it in both prompts, rather than letting each agent invent its own wording and hoping they converge. Observed 3x on one 6-record batch run, each with zero-coordination convergence: a CLI interface's exact shape cited into a parallel SKILL.md-editing agent's prompt, a heading's exact characters cited into a second, a function's literal output (`formatOffsetClause`, see `feedback/session-evaluation.md`'s watermark offset clause) cited into a third — every agent landed on identical text with no reconciliation step needed. The technique is an extension of Input Discipline point 3 (inline the output template literally) to the *input* side: when a dispatch's correctness depends on matching another artifact byte-for-byte, that other artifact's text is exactly the kind of thing that must not be left for the agent to guess.

## HARD-GATE Marker Convention and Inheritance Hazard

**Marker convention.** Any skill step whose heading or prose asserts "HARD GATE" — a mandatory stop that must not be silently passed — carries a marker comment immediately before its blocking call (an `AskUserQuestion` invocation, or an equivalent hard-stop condition with no user-facing question). The marker is a single-line HTML comment placed on its own line directly above the blocking call, e.g. `<!-- HARD-GATE: refine-confirm -->`. A marker that predates this convention (e.g. `refine-lanes.md`'s `<!-- refine-confirm-gate -->`) stays as-is — do not rename a working marker to match this shape; the requirement is that *some* adjacent HTML-comment marker exists at the site, greppable by a conformance test, not that every marker share one literal string.

**HARD-GATE inheritance hazard.** A subagent dispatched via `fork`, a broad Task dispatch, or any mechanism that carries the dispatcher's full conversation, inherits a gated skill's own instructions as background context — including its HARD GATE. That inheritance does not make the gate optional: a subagent that reaches a HARD GATE it cannot present interactively (no live human to answer an `AskUserQuestion`) must stop and report `BLOCKED`, never execute past it on its own initiative. Observed live on `/claude-tweaks:backlog refine`: an orchestrating session dispatched three parallel background subagents to divide the skill's heavier sub-steps, each inheriting `refine-mode.md`'s own text; two honored their scoping, the third re-derived the skill's later steps on its own initiative and ran straight through the Apply logic, writing dozens of label/body changes — including 20 unreviewed `auto:merge` grants — to live GitHub issues without ever presenting the load-bearing confirm gate to a human (`docs/incident-log.md` `[IL-139]`). The skill's own prose stated this must never happen, and the subagent had that exact text in its inherited context — prose alone did not stop it. Treat any HARD GATE encountered inside a subagent's inherited context as binding on that subagent too, and prefer a scoped, non-`fork` dispatch (per Input Discipline above) over any dispatch shape that would hand a subagent a gate it cannot itself satisfy.

## Working Directory Discipline — moved

Moved to `_shared/subagent-dispatch-core.md`'s "Working Directory Discipline" section (#2019),
alongside Model Selection, Template A, Failed-agent retrieval, and the fan-out section — the five
dispatch-facing sections a review/test call site needs to compose under the 40 KB ceiling without
also paying for this file's remaining content. Read there.

## Waiting for Dispatched Agents

Read `_shared/dispatch-waiting.md` — the notification-driven resume pattern and the one-watchdog-per-wave cap (extracted for headroom, #1995).

## Implementer Status Protocol

Every dispatched agent reports one of four statuses as a labeled **trailing** line — `STATUS: {WORD}`, the reply's last non-empty line, after the output template:

| Status | Meaning | Dispatcher response |
|---|---|---|
| `DONE` | Task complete, no concerns | Accept output; proceed. |
| `DONE_WITH_CONCERNS` | Task complete, but the agent flagged doubts | Read the concerns. If correctness/scope → address before proceeding. If observational ("this file is getting large") → note and proceed. |
| `NEEDS_CONTEXT` | Information was missing from the dispatch | Provide what was missing; re-dispatch. |
| `BLOCKED` | Cannot complete the task | Diagnose: more context (re-dispatch), more capable model (upgrade), smaller scope (split), or wrong plan (escalate). Never force-retry with no changes. |

**Test-authoring tasks run a mutation probe before committing:** a dispatched implementer adding or modifying a test scratch-copies the code under test, mutates it to confirm the test goes red, restores it byte-identical, and reports mutants tried vs. survivors caught in its status line.

**Finish everything the blocker doesn't gate before reporting `BLOCKED`.** A failed precondition — a worktree path that doesn't resolve, a missing fixture, an unavailable service — usually gates only *some* of the task. Analysis, measurement, verification, and drafting the exact edits are typically all still possible, and a `BLOCKED` report carrying that finished work costs the dispatcher one cheap re-dispatch instead of a full redo. This applies to the wrong-worktree case in Working Directory Discipline above: report `BLOCKED` rather than editing the wrong checkout, but do the read-only work first and hand back verified, ready-to-apply results. Do not silently downgrade to `DONE_WITH_CONCERNS` because you got most of it done — the blocker still stands, and the status line is what the dispatcher routes on.

For review-style agents (Template A), the trailing status line follows the findings table (reversing the old "status line, then table" order). For search-style (B) and scout-style (C), the trailing status line follows whatever the template's own content is — the status replaces no sentinel, it comes after it.

```
| Severity | Path:Line | Finding | Evidence |
|---|---|---|---|
| ...
STATUS: DONE
```

```
Reason: couldn't locate the auth middleware referenced in the task scope.
Tried: grep -r "authMiddleware" src/, grep -r "requireAuth" src/
Need: actual file path of the auth middleware, or confirmation it doesn't exist.
STATUS: BLOCKED
```

SubagentStop hook (E3) logs replies missing the status line to the run dir's `events.jsonl` (best-effort — the event fires unreliably for Task dispatches, claude-code#27755). The detector (#2265) is two-tier: an exact-canonical trailing `STATUS: {WORD}` line is fully compliant (nothing logged); a bare or off-position status word within the reply's first-or-last 3 non-empty lines is lenient-compliant (logged as an *informational* `contract-violation` variant, distinguishable in the event's own fields — never a hard failure, and never returned to the dispatcher as a warning); the status word absent from that window entirely is a genuine violation, logged exactly as before.

**A logged `contract-violation` is evidence to read, not a confirmed violation.** The detector (`bin/lib/hooks/subagent-stop.js`) has no way to know *which* agent replied or what contract that dispatch declared, so one non-violating case still lands in the log: a dispatch whose own template specifies a different status shape (its header comment names this one). A **background-job-orchestrated session's own interim narration turn** — never a violation, since the status-line requirement above is scoped to a dispatched subagent's own *final* reply — is now filtered at the detector in both shapes the harness produces for it: an absent `agent_transcript_path` (#1928), and one identical to the same event's own `transcript_path` (#2036). A genuine subagent stop always carries its own distinct transcript file, so neither filter can suppress a real violation. A **third-party agent exempt from this contract entirely** (see Exemption below) is now filtered out at the detector itself via its `agent_type` input field (#1596), so `/claude-tweaks:simplify`'s `code-simplifier:code-simplifier` dispatch no longer needs manual triage. Triage the remaining case against the dispatch that produced it before treating it as a finding.

## Model Selection and Template A — moved

Moved to `_shared/subagent-dispatch-core.md`'s "Model Selection" and "Template A" sections
(#2019), alongside Working Directory Discipline, Failed-agent retrieval, and the fan-out
section. Read there.

## Template B — Search-style (returns locations)

Use when an agent locates code, files, or references.

```
OUTPUT FORMAT (required):
Return ONLY bullet lines, one per match:

- {path}:{line} — {one-line context}

If no matches: return literal text "No matches."
Do not add narration or grouping headers.
```

**Used by:** `/journeys` (per-journey extraction), `/stories` (per-flow probe), `/build` (search subagents).

## Template C — Scout-style (returns yes/no + evidence)

Use when an agent answers a binary question with brief evidence.

```
OUTPUT FORMAT (required):
First line: "yes" or "no"
Second line onward: up to 3 bullet lines of evidence (path:line — context).
Maximum 200 tokens total.
```

**Used by:** `/test` (parallel verification scouts), pre-checks before larger parallel dispatch.

## Not every consumer uses A/B/C

When a dispatch's output genuinely doesn't fit A/B/C, define the format explicitly in the dispatch prompt rather than forcing it into one of the three.

## Failed-agent retrieval — moved

Moved to `_shared/subagent-dispatch-core.md`'s "Failed-agent retrieval" section (#2019),
alongside Working Directory Discipline, Model Selection, Template A, and the fan-out section.
Read there.

## Exemption: third-party agents

**The condition is structural, not a judgment call.** An agent is exempt from this contract when **its definition file lives outside the `agents/` directory this plugin owns** — it ships with a third-party plugin and is invoked as a delegation. Everything under this repository's `agents/` (declared in `.claude-plugin/plugin.json`'s `agents` array) is claude-tweaks-authored and is **never** exempt, however awkward its output is to parse. "This agent's output is inconvenient" is not a reading this paragraph supports: a dispatch site settles its own eligibility by asking where the agent file lives, with no appeal to intent.

Why an exemption rather than a conformance shim: this contract buys **dispatch correctness** for agents claude-tweaks authors, where we control the prompt and the protocol is what makes the result routable. A third-party agent is a delegation — it already has its own input and output contract, written by someone else and versioned with their plugin. Wrapping it to force a `DONE` line and a Template A table would mean paraphrasing its output into a shape it never promised, which is exactly the failure this contract's own rationale warns about. Adapt at the boundary instead.

**The exemption covers the agent, never the caller.** Everything on the dispatcher's side still binds:

- **Normalize at the boundary.** The caller maps the third-party output into the shape its own consumers already read, and documents that mapping at the call site. A caller that passes foreign output through unmapped has not adapted, it has leaked.
- **Handle the outcomes the status line would have carried.** With no `BLOCKED` / `NEEDS_CONTEXT` to route on, the caller must still separate *agent unavailable*, *agent failed*, *agent returned nothing*, and *agent returned something that does not parse* — and must never report a clean result for any of them. Silence is not a pass.
- **Check availability at the agent level.** Plugin presence does not imply agent presence; agents are added and removed between versions of one plugin. Resolve the agent's own definition file before dispatching.
- **Input discipline and working-directory discipline still apply** — both describe what the dispatcher sends, not what comes back.

Re-prompting on format (below) does not apply to an exempt agent: it is not violating a format it was never given.

**Current exempt dispatch:** `impeccable-finish-reviewer`, shipped by the Impeccable plugin and dispatched by `/claude-tweaks:design-wrapper`'s `review` mode (`modes/review.md` Step 3.7). Its four-section output contract (`persistence` / `ceiling` / `material_fixes` / `keep`) is upstream's; that mode's Step 4 maps it into this repo's normalized finding shape.

## Re-prompt on violation

When an agent returns malformed output — a wrong or missing status line, no table, narration before the table, wrong columns — the dispatcher re-prompts:

```
Your output didn't match the required format. Re-emit using only this format:
{template repeated}
Do not add explanation.
```

Cap at one retry. If still malformed, accept what you got and move on (do not loop).

**Check the status word's position, not merely its presence.** A reply whose status word never lands as a genuine trailing marker still violates the Implementer Status Protocol even though the literal token appears somewhere in the reply. Two failure modes to watch for: a **bare trailing word** instead of the labeled `STATUS: {WORD}` line ("...the tests are done" reads as ambiguous prose, not a status marker), and a **status line that isn't truly the last non-empty line** — trailing narration or a stray blank-then-comment after it defeats the position check just as opening narration used to. Verify the reply's actual last non-empty line reads exactly `STATUS: {WORD}` before accepting it: reading a reply for its content does not check this, and a dispatcher that trusts its own read-through accepts the violation silently. Observed twice under the old first-line rule — #606's wrap-up (a lens agent accepted on token presence alone), and record #1653, where 3 of 8 `/claude-tweaks:review` lens dispatches opened with narration and all three were accepted with no re-prompt, despite every prompt carrying an explicit `WRONG:` example — the trailing-line convention and `subagent-stop.js`'s lenient fallback (#2265) exist to make both classes of drift survivable without a human catching every one by hand.

## Anti-Patterns

| Anti-pattern | Why it fails |
|---|---|
| Padding the template with optional sections "if relevant" | Agents include them every time, defeating the compression. |
| Using soft directives like "be concise" or "summarize" | Too soft — agents drift back to prose. |
| Asking for both narration AND a table | Agents pick narration. The contract must be exclusive. |
| Omitting the severity scale | Agents invent their own scales (P0/P1, MUST/SHOULD, urgent/normal), making aggregation impossible. |
| Letting agents read sibling files for the template | Agents only see their prompt. Always inline the template literally. |
| Stating a requirement in prose beside the inlined template | The agent receives the fence, not the file around it. Anything outside the block never arrives. |
| Skipping the "if no findings" literal text | Without it, agents pad empty results with explanation. |

## How to integrate at a dispatch site — moved

Moved to `_shared/subagent-dispatch-core.md`'s "How to integrate at a dispatch site" section
(#2019) — the fan-out section, alongside Working Directory Discipline, Model Selection,
Template A, and Failed-agent retrieval. Read there.

## Related primitives

- `skills/_shared/multi-agent-coordination.md` — inter-agent coordination patterns (Reproduction, Debate, Multi-persona red-team) that compose with these templates.
