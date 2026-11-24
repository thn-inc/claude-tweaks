---
files:
  - plugin/skills/build/plan-authoring-checks.md
---

# Quote Governing Project-Skill Rules Into a Plan

**Persona:** A `/claude-tweaks:build` session, maintainer or agent, finalizing a plan in a repo that keeps project skills under `.claude/skills/`. The skills hold rules about specific files, and the SDD implementers and reviewers it dispatches will see only their task briefs.
**Goal:** Make sure every rule a project skill states about a file the plan touches reaches the agents doing the work, word for word, so a weaker restatement cannot pass every gate that reads the plan.
**Entry point:** `plan-authoring-checks.md`'s **Governing-skill quote check:**, run while finalizing a plan in Spec Step 3 or Design Step 3.
**Success state:** For each file the plan creates or modifies, the plan's Global Constraints either quote each governing skill's applicable rules verbatim (bullets, paragraphs or table rows) or say why no skill governs that file.

## Steps

### 1. List the files the plan touches
- **URL:** the plan's per-task `Files:` blocks.
- **Action:** Collect every `Create:` and `Modify:` path across the plan's tasks, together with the module each path belongs to.
- **Should feel:** Like copying a short list out of the plan.
- **Should understand:**
  - A test file is a file the plan creates. The skill that governs how this repo writes tests counts as much as a skill about the code under test.
- **Red flags:**
  - Checking only the implementation file and skipping the new test file.

### 2. Find the project skills that govern each file
- **URL:** `.claude/skills/*/SKILL.md`.
- **Action:** Grep each skill's description and body for the file's path or its module name, for example `git grep -n "plan-authoring-checks" -- .claude/skills`. Then read each hit's description to decide whether the skill really governs that kind of change.
- **Should feel:** Quick, one grep per file plus a short read of each hit.
- **Should understand:**
  - A skill can govern a file without naming it in its description. #3712's `pre-tool-use-gate-exemptions` rule sat in the skill's body.
  - A grep hit is a candidate, not a verdict. A skill that only mentions the module in passing may not govern this change.
- **Red flags:**
  - A search limited to skill descriptions.
  - A file with no grep at all.

### 3. Quote the rules, or say why none apply
- **URL:** the plan's `## Global Constraints` section.
- **Action:** Paste each applicable rule verbatim, whether it is a bullet, a paragraph or an Anti-Patterns table row, and name the skill it came from. For a file no skill governs, add one line saying so and why, citing the grep that found nothing.
- **Should feel:** Like quoting, not summarizing. The implementer reads the skill's own words.
- **Should understand:**
  - Every task review compares code against the plan. A rule the plan restates more weakly passes every review that reads the plan. #3712's plan wrote "provably owned = isTrustedOwnedRun AND not ad-hoc" and dropped the skill's `classifyOwnership === 'mine'` requirement. Five task reviews and the whole-branch review passed it, and only `/review`'s lens 3a caught it.
- **Red flags:**
  - A paraphrase in place of the skill's text.
  - Only bullets quoted when the skill states its rule as a paragraph or a table row.
  - A file with neither a quote nor a "none apply" line.

## Origin
- Created during the build of #3763, a reflect finding from #3712 (review fix 0a5d6cf24). #3789 had added a narrower form of the check, keyed only on a skill's description, with no "none apply" escape and no pin. #3763 widened it.
- Pinned by `tests/plan-authoring-governing-skill-quote-prose.test.js`. Its per-fact go-red controls make each rule clause of the check fail the suite when that clause is removed (the rationale sentence is not pinned; only the #3712 citation is), and removing the whole paragraph fails it too.
- Related: `reprove-checks-after-an-inserted-guard-3988.md` and `prove-an-absence-grep-can-match-3571.md`, two other plan-authoring checks in the same file.
