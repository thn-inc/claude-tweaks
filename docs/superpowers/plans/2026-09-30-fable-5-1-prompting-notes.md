# Model-Version Prompting Notes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a durable "model-version prompting notes" checklist to `docs/skill-authoring.md` summarizing the documented Claude Fable 5.1 prompting deltas, cross-check a sample of existing skills against them, and link the source doc.

**Architecture:** Single-file documentation change — one new `##` section appended to `docs/skill-authoring.md` (this repo's canonical skill-authoring conventions file per CLAUDE.md's Conventions section). No code, no runtime behavior change; the deliverable is prose plus a cross-check sweep whose findings are recorded inline.

**Tech Stack:** Markdown documentation only.

**Spec:** `.claude-tweaks/pipelines/2026-09-30T141651-record-2644/work/2644-spec.md` (record #2644)

## Global Constraints

- New content goes in `docs/skill-authoring.md` (`docs/` is maintainer-side per CLAUDE.md's Structure section — not part of the shipped plugin payload, so no composed-bytes ceiling applies, but it is still read by anyone authoring or editing skills).
- The checklist must be framed as a durable, repeatable process ("run this whenever a new Claude model version ships"), not a one-off note tied specifically to Fable 5.1 (spec AC3).
- The cross-check (spec Deliverable 2 / AC2) is a sampling exercise over a representative handful of skills, not an exhaustive audit of every skill file (spec Gotchas).
- Link the real source doc verbatim: `https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-fable-5-1` (spec AC4).

## Review Focus

- A reader skimming only the new section's headline sentence, not the sub-bullets, must still be able to tell this applies beyond Fable 5.1 — the framing sentence must say so explicitly, not just the closing paragraph.
- The tool-call-batching delta's one-line note must not contradict the file's own existing "Parallel execution directives" section a few sections above — the cross-check must reconcile the two rather than silently duplicating guidance.
- The progress-update delta's one-line note must distinguish "no user-facing narration between tool calls" (the Fable 5.1 default) from "silent automation is forbidden" (this repo's existing `auto-decision-log.md` philosophy) — these are adjacent but different concerns, and conflating them would misstate the delta.
- The cross-check must name which skills were actually read, not assert "skills were reviewed" without naming any — an unfalsifiable audit claim is worse than a narrow, named one (spec AC2 requires at least one shown example).
- The link to the source doc must be a real, fetchable URL copied exactly as given in the spec, not paraphrased or shortened — a broken or altered link defeats spec AC4's intent (future model bumps need to find the real doc).

---

### Task 1: Add the "Model-version prompting notes" section to `docs/skill-authoring.md`

**Files:**
- Modify: `docs/skill-authoring.md` (append new `##` section after the last existing section, `## Parallel execution directives`)

**Interfaces:**
- Consumes: nothing (first task)
- Produces: nothing consumed by a later task — this plan has one task

- [ ] **Step 1: Draft the new section and append it to `docs/skill-authoring.md`**

Read the current end of the file first (`tail -30 docs/skill-authoring.md`) to confirm the append point is still `## Parallel execution directives`'s closing paragraph — if a concurrent edit has added content after it, append after whatever the new last section is instead.

Append this section, verbatim except where the cross-check step below finds a factual correction to make before committing:

```markdown

## Model-version prompting notes

Anthropic documents behavioral differences between Claude model versions that can silently
change how an existing skill's prose is followed — not because the skill's instructions are
wrong, but because the model reading them defaults differently than the model the skill was
written against. Run this checklist whenever a new Claude model version ships, not only for
the Fable 5.1 delta below: re-read the model's own "Prompting Claude {version}" doc (when
Anthropic publishes one) and re-check the deltas that apply to skill instructions specifically.

**Claude Fable 5.1 vs. Fable 5** (source:
https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-fable-5-1):

| Delta | What changed | What a skill author should check for |
|---|---|---|
| Tool-call batching | In coding/agent loops, 5.1 may issue one independent tool call per turn instead of batching them, where the next calls are implied by the task rather than explicitly requested. | A skill step that names several independent read-only operations (Glob/Grep/Read/Bash) should carry one of this file's own Parallel execution directive forms (see that section above) rather than assuming the model batches them unprompted. |
| Progress-update prompting | 5.1 writes fewer user-facing updates during long tool-calling turns by default, especially at higher effort — a final message can cover only the last step instead of the whole task. | A skill that runs a long, mostly-silent tool chain (a multi-phase pipeline, a sweep) should say explicitly when it wants interim narration and what each update should contain — distinct from this repo's own `auto-decision-log.md` silent-automation-is-forbidden rule, which governs *audit trail*, not conversational narration. |
| Effort-level selection | Effort-level names don't correspond to the same amount of thinking across model versions — a `Fast`/`Standard`/`Capable`/`Frontier` mapping tuned for one model version is not guaranteed to hold for the next. | Re-run the model-profile sweep in `_shared/subagent-output-contract.md`'s Model Selection section against the new model version's own evals before assuming an existing profile mapping still holds. |
| Formatting | 5.1 leans toward less bold/fewer headers/lists by default than earlier models did; anti-formatting instructions written against an earlier model's over-formatting tendency can now over-correct. | A skill carrying explicit anti-bullet/anti-bold language (written against an earlier model's opposite bias) should be re-checked against the new model's own default rather than assumed still necessary. |
| Safeguard false positives | 5.1's safety classifiers produce fewer false positives than earlier launches, but specific phrasings (e.g. "does this compile?" vs. "are there bugs?") and base64 tool output still trigger them more than other phrasings. | A skill instructing an agent to phrase a security/bug-finding request should prefer "are there bugs/vulnerabilities" phrasing over "does this compile/pass" phrasing, and avoid routing base64-encoded tool output through a step that also asks the model to reason about it. |
| Subagent and vision handling | 5.1 coding agents get lower time-to-completion when the lead agent keeps working while a dispatched subagent runs, rather than blocking on it; vision work benefits from crop/zoom tooling on dense images. | A skill dispatching Task-tool subagents for independent work should not require blocking-wait phrasing when the lead has other independent work to continue; a skill analyzing a screenshot/chart should offer a crop/zoom step rather than a single full-image read when detail matters. |

**Sample cross-check (2026-09-30, record #2644).** Read `plugin/skills/_shared/subagent-dispatch-core.md`
(dispatch instructions to subagents), `plugin/skills/flow/SKILL.md` (multi-phase pipeline orchestrator),
`plugin/skills/build/SKILL.md` (long-running autonomous build), and this file's own Parallel execution
directives section, against the deltas above:

- **Tool-call batching** — already covered, repo-wide: this file's own "Parallel execution directives"
  section (Forms A/B/C, above) already instructs skills to batch independent read-only operations and
  dispatch independent analytical work in parallel. No skill body was found asserting the opposite.
  Confirmed unaffected — the existing convention already produces the behavior 5.1's delta calls for.
- **Progress-update prompting** — `flow/SKILL.md` Step 4 already narrates `## Flow: Running {step} ({N}/{total})`
  once per pipeline phase (a deliberate exception to that file's own mechanical-coupling rule, precisely
  because there is no other progress signal for a single-spec run). This is exactly the kind of explicit
  interim-narration instruction the delta recommends adding; confirmed aligned, not affected.
- **Finish-the-whole-task / autonomy** (related but not table-listed above, since the spec's named delta
  list doesn't include it — noted here as an incidental finding) — `build/SKILL.md`'s "Autonomy Rules"
  section ("Do not ask for feedback during execution", "Do not ask 'should I proceed?' — yes, you should.
  Always.") already matches 5.1's documented "operating autonomously" prompting pattern. Confirmed aligned.
- No skill body was found relying on now-changed default formatting or safeguard-phrasing behavior in this
  sample; a full-corpus sweep was out of scope for this record (spec Gotchas).

- [ ] **Step 2: Verify the required anchors are present**

Run:
```bash
grep -n "## Model-version prompting notes" docs/skill-authoring.md
grep -n "platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-fable-5-1" docs/skill-authoring.md
grep -n "whenever a new Claude model version ships" docs/skill-authoring.md
grep -n "Tool-call batching" docs/skill-authoring.md
grep -n "Progress-update prompting" docs/skill-authoring.md
grep -n "Effort-level selection" docs/skill-authoring.md
```
Expected: every grep prints at least one match (non-empty output, exit 0). This mechanically confirms
spec AC1 (names the three headline deltas), AC3 (durable-process framing sentence present), and AC4
(source link present) before committing.

- [ ] **Step 3: Commit**

```bash
git add docs/skill-authoring.md
git commit -m "Add model-version prompting notes checklist to skill-authoring guidance — Fable 5.1 deltas, durable process for future model bumps (#2644)"
```
