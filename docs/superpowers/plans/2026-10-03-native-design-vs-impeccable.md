# Native /design vs. Impeccable Comparison Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a short, honest comparison note between Anthropic's native `/design` skill (research preview) and Impeccable, checked into `design-wrapper`, and decide whether `design-wrapper` should route to the native skill.

**Architecture:** This is a documentation-only decision record, not a code change. One new markdown file is added under `plugin/skills/design-wrapper/`. No routing code is added or modified, because the pre-investigation below already establishes the decision: the native skill cannot be exercised from any agent-driven context in this environment, which `design-wrapper`'s callers (`/build`, `/flow`, `/test`, `/review`, `/visual-review`, `/specify`, `/tidy`) exclusively are.

**Tech Stack:** Markdown only (this plugin's skill-authoring format). No code, no tests to run beyond the repo's existing prose-conformance suite (unaffected by an unreferenced new file).

**Spec:** GitHub issue #2690 ("Assess native /design skill vs. Impeccable in design-wrapper"), materialized at `.claude-tweaks/pipelines/2026-10-03T182549-record-2690/work/2690-spec.md`.

## Global Constraints

- No source code changes — this record's Acceptance Criteria is satisfied entirely by a documentation artifact.
- The comparison must not fabricate example output or a guessed workflow comparison for the native `/design` skill — if it cannot be exercised, say so plainly (CLAUDE.md Philosophy: "Do it properly," no display-only workarounds).
- File lands under `plugin/skills/design-wrapper/` or its docs, per the record's Acceptance Criteria wording.

## Review Focus

- **Fabricated comparison risk:** a reviewer must confirm the note does not invent example `/design` output or a guessed feature list — it must state only what was actually verified (the Skill-tool probe and its exact error text), never a description of the skill's internals beyond that.
- **Overclaiming the decision's permanence:** the note must state a concrete, checkable revisit condition (the model-invocation restriction lifting, or a human-run `/design` session feeding back real output) rather than closing the question permanently.
- **Scope creep into routing code:** a reviewer must confirm no file under `plugin/skills/design-wrapper/SKILL.md`, `modes/`, or any routing table was touched — the record's own Gotchas section states "stay Impeccable-only" is a valid, complete outcome, and the pre-investigation confirms that is the only honest outcome here.
- **Discoverability:** the note should be plain enough that a future contributor revisiting this decision (per the revisit condition) can find it without re-deriving the same probe — filed as its own named file, not buried as a stray paragraph in an unrelated sub-file.
- **Accuracy of the verified claim:** the note's description of the Skill-tool probe and its error text must match what was actually observed, not a paraphrase that drifts from the literal error message.

---

### Task 1: Write the native `/design` vs. Impeccable comparison note

**Files:**
- Create: `plugin/skills/design-wrapper/native-design-comparison.md`

**Interfaces:**
- Consumes: nothing — this is a standalone reference file, not loaded by any mode's dispatch logic.
- Produces: a markdown reference file. No other file in this plan reads it back (single-task plan).

- [ ] **Step 1: Write the comparison note**

Create `plugin/skills/design-wrapper/native-design-comparison.md` with this exact content:

```markdown
# Native `/design` vs. Impeccable — comparison and routing decision

Decision record for #2690. Read this if revisiting whether `design-wrapper` should route
any mode to Anthropic's native `/design` skill instead of (or alongside) Impeccable.

## What this record asked

Anthropic (via the official ClaudeDevs account) announced a native `/design` skill
(research preview) with an artboard workflow built on artifacts. The record asked: try it
on a sample UI task, compare its output/workflow against Impeccable's, and decide whether
`design-wrapper` should route artboard-style exploration to it while keeping Impeccable for
deeper critique/audit passes, or stay Impeccable-only.

## What was actually verified

A side-by-side output comparison was **not possible** in this environment, and this note
does not fabricate one. What was verified directly, live, in the environment this record
was built in:

A skill literally named `design` **is** registered in the Claude Code skill registry here.
Invoking it via the Skill tool (the only mechanism an agent has to invoke a skill) returns:

> Skill design cannot be used with Skill tool due to disable-model-invocation. Ask the user
> to run /design themselves — it cannot be invoked via the Skill tool. Do not replicate this
> skill's workflow by other means — it is reserved for explicit user invocation.

This is categorically different from "unknown skill" (which is what an unregistered name
returns). The skill exists, but is deliberately scoped **out** of any agent- or
model-driven invocation path. Only an interactively-typed `/design` command, typed by a
human in their own session, can run it.

## Why this settles the routing question without a feature comparison

`design-wrapper` exists to be invoked *by other skills* — every one of its callers
(`/build`, `/flow`, `/test`, `/review`, `/visual-review`, `/specify`, `/tidy`) dispatches it
programmatically, with no human in the loop at the point of dispatch. That is the entire
reason the wrapper exists (see `SKILL.md`'s opening line). A skill that refuses invocation
by anything other than a human typing the command directly cannot be a dispatch target for
a wrapper whose only callers are agents. This holds regardless of how good native `/design`'s
artboard workflow turns out to be — the mismatch is structural (who is allowed to invoke it),
not qualitative (how good its output is), so no amount of output quality on either side
changes the answer.

## Decision

**Stay Impeccable-only.** No routing change is made to `design-wrapper`. This is not a
judgment that native `/design` is worse than Impeccable — no such judgment could be made
from this environment, since the native skill could not be exercised at all. It is a
judgment that an agent-invoked wrapper cannot route to a human-invocation-only skill.

## Maturity note

Native `/design` is explicitly a research preview, per the record's own Gotchas. Even
setting aside the invocation restriction, a routing decision based on a preview feature
would need revisiting as it matures. The invocation restriction is the more immediate and
more structural blocker of the two, and is the one this note is based on.

## Revisit when

- The model-invocation restriction on the native `/design` skill is lifted (a future harness
  or CLI release that permits non-interactive, subagent, or programmatic invocation), **or**
- A human manually runs `/design` on a representative UI task in an interactive session and
  shares the real output/workflow for comparison against Impeccable's `review`/`polish`/
  `survey` modes — at that point a genuine side-by-side becomes possible and this decision
  should be re-opened with real evidence instead of a structural argument.

Until one of those holds, re-running this same probe will reproduce the same
`disable-model-invocation` result, and the structural argument above still applies.
```

- [ ] **Step 2: Verify the file was written correctly**

Run: `test -f "plugin/skills/design-wrapper/native-design-comparison.md" && echo FILE_EXISTS`
Expected: `FILE_EXISTS`

Run: `grep -c "disable-model-invocation" "plugin/skills/design-wrapper/native-design-comparison.md"`
Expected: `1` (the quoted error text)

- [ ] **Step 3: Commit**

```bash
git add plugin/skills/design-wrapper/native-design-comparison.md
git commit -m "Add native /design vs Impeccable comparison note — stay Impeccable-only

refs #2690"
```
