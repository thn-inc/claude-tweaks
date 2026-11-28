---
name: superpowers-step-override
description: Use when a claude-tweaks skill must change what a superpowers skill does at one of its steps — skip it, replace its test run, suppress its handoff, lift its loop cap — without editing the superpowers file. Covers phrasing the override as an imperative inside the invocation instruction, pinning the overridden upstream line in tools/upstream-drift/manifest.yml, and the conformance test that holds both. Keywords - superpowers, override, invocation instruction, imperative, directive, descriptive clause, upstream pin, must-match, will rely on, contract-paths, using-git-worktrees, subagent-driven-development.
---

# Superpowers step override

## Overview

claude-tweaks never edits a superpowers file. It changes what a superpowers skill does by telling that skill, in the text that invokes it. That invocation is the only channel that reaches the skill: a sentence elsewhere in our prose describing what the skill does, or no longer does, is read by our model and never passed on, so superpowers runs its own step anyway. And superpowers ships on its own schedule, so the upstream line we override can be renamed or removed; a pin in `tools/upstream-drift/manifest.yml` is what notices.

#5117 hit the first half. `plugin/skills/build/worktree-setup.md` first said the baseline run was skipped inside a pipeline as a description of what `/superpowers:using-git-worktrees` handles; `/review` confirmed it as a medium finding, because nothing told the skill to skip its "Step 3: Verify Clean Baseline". The fix moved the override into Procedure step 2, the invocation itself: "when `$PIPELINE_RUN_DIR` is set, tell it to skip its "Step 3: Verify Clean Baseline" (#5117)".

## Key Patterns

### The override is an imperative in the invocation instruction

Put the override in the sentence that invokes the skill, as a directive addressed to it, and name the upstream step or line in its own words so the skill can find what it is told to change. `plugin/skills/build/dispatch.md` is the canonical shape: each override opens "In the same invocation instruction, also direct `/superpowers:subagent-driven-development` to …" — **Affected-set testing (#5117)** replaces SDD's "run the full suite once before committing" and test-driven-development's "Other tests" reading that way. The reason for the override goes in a separate descriptive sentence beside it (worktree-setup.md step 3); it is for our reader, never the override itself.

### Pin the overridden line, not just the file

Add an assertion to the `superpowers` entry of `tools/upstream-drift/manifest.yml`:

```yaml
      - file: "plugin/skills/build/worktree-setup.md"
        claims: "will rely on (record #5117): using-git-worktrees has a Step 3 named Verify Clean Baseline — the baseline test run worktree-setup skips inside a pipeline"
        upstream-path: "skills/using-git-worktrees/SKILL.md"
        must-match: "## Step 3: Verify Clean Baseline"
```

`file` is our file holding the imperative; `claims` names the record and ends with what the override does to that line; `must-match` is the overridden line as the installed copy spells it. When the upstream file is not yet in the entry's `contract-paths`, add it too (#5117 added `skills/test-driven-development/SKILL.md` and `skills/executing-plans/SKILL.md`), so `/upstream-drift`'s capability diff reads it on the next release. The literal and prove-it-can-fail rules are the `upstream-repin` skill's "An entry with no contract tests" section; follow them rather than restating them.

### Pin both sides in one conformance test

`tests/pipeline-test-scope-conformance.test.js` pins the local imperative (the step-2 facts: the upstream step's name, the `$PIPELINE_RUN_DIR` scope, the directive verb `tell it to skip`, the record tag) apart from the step-3 rationale, and pins the manifest side (each `must-match` appears once, under the right `upstream-path`, against the right `file`). Write it per the `skill-prose-conformance-tests` skill, with a go-red proof per fact.

## Project Conventions

- Scope a pipeline-only override on `$PIPELINE_RUN_DIR` and say what standalone use keeps ("Standalone `/build` keeps it.").
- Add the override's edge to `docs/skill-graph.md`, as #5117 did for its affected-set, baseline-skip and batched edges.
- An `unmatched` drift result on an override pin means re-read the override against the new upstream text and re-pin (the `upstream-repin` skill); it does not by itself mean the override is wrong.

## Anti-Patterns

| Pattern | Why It Fails in This Project |
|---|---|
| Describing the overridden behaviour ("the skill handles X", "pipeline: no baseline") instead of directing the skill | Only the invocation reaches superpowers, so it runs its own step anyway — #5117's first worktree-setup wording, caught at `/review` |
| Overriding a step with no manifest pin | An upstream rename leaves the imperative naming a step that no longer exists, and every check stays green |
| Pinning the local imperative but not the upstream line, or the reverse | Either side can drift alone; #5117's conformance test pins both |

## Reference

- `plugin/skills/build/dispatch.md` (the invocation-instruction directives), `plugin/skills/build/worktree-setup.md` (Procedure steps 2-3)
- `tools/upstream-drift/manifest.yml` (`superpowers` entry), `tools/upstream-drift/checks.js` (`checkAssertions`)
- `tests/pipeline-test-scope-conformance.test.js`
- Related skills: `upstream-repin`, `upstream-drift`, `skill-prose-conformance-tests`
