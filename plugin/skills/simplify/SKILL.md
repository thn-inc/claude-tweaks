---
name: simplify
description: Use when you want to simplify recently changed code — catches unnecessary complexity from iterative development, verbose debugging patterns, and cross-file inconsistencies. Works standalone or as a step within /claude-tweaks:build and /claude-tweaks:review.
argument-hint: "[<file-or-dir>...|#N|<spec-number>]"
---

# Simplify — Code Simplification

Run the code-simplifier subagent on recently changed files. Catches complexity that accumulates during iterative development — verbose patterns from trial-and-error debugging, premature abstractions, inconsistencies across files modified by different tasks. Part of the workflow lifecycle:

```
/claude-tweaks:build → /claude-tweaks:test → /claude-tweaks:review → /claude-tweaks:wrap-up
       │                                            │
[ /claude-tweaks:simplify ]                 [ /claude-tweaks:simplify ]
 (after implementation)                      (after review fixes)
```

## When to Use

- After finishing a batch of implementation work — clean up before review
- After fixing review findings — simplify the fixes
- After a debugging session — remove trial-and-error artifacts
- After a refactor — verify the result is actually simpler
- During `/claude-tweaks:build` Common Step 3 — invoked automatically
- During `/claude-tweaks:review` Step 5 — invoked automatically

## Input

`$ARGUMENTS` controls scope.

### Standalone (invoked directly):

1. **File paths** — specific files or directories to simplify
2. **Record/spec reference** (`#N`, or legacy bare spec number) — scope to files changed for that record
3. **No arguments** — resolve scope per `_shared/scope-resolution.md`'s deterministic fallback ladder, stating which rung resolved it in the run's opening line

```
/claude-tweaks:simplify                       → simplify all recently changed files
/claude-tweaks:simplify src/api/ src/db/      → simplify files in those directories
/claude-tweaks:simplify src/utils/validate.ts → simplify a specific file
/claude-tweaks:simplify #42                   → simplify files changed for record #42
/claude-tweaks:simplify 42                    → simplify files changed for spec 42 (legacy form)
```

### Pipeline context (invoked by parent skill):

The parent skill passes:
- **File scope** — files changed during the build or review fixes (`git diff --name-only`)

The simplifier always operates on the provided scope. It never expands to unrelated code.

## Step 1: Resolve Scope

1. **From arguments** — use the provided file paths or directories
2. **From a record/spec reference** — `#N` or a legacy bare spec number resolves to the files changed for that record (its associated commits/branch), mirroring `/claude-tweaks:deepen`'s and `/claude-tweaks:reflect`'s resolution rule
3. **From git diff** — `git diff --name-only` (or against the base branch) to identify changed files
4. **From parent** — accept the file list passed by the parent skill

Filter to source files only — skip generated files, lock files, and non-code artifacts.

If no files are in scope, state: "No changed files to simplify." and stop.

## Step 2: Run Code Simplifier

Invoke the `code-simplifier:code-simplifier` subagent on the scoped files. Follow the **Subagent Contract** (`_shared/subagent-output-contract.md`) — minimal input (file paths + the output template, no conversation history), `[Use: Standard]` (resolve via `node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-profile.js" standard`, `_shared/subagent-dispatch-core.md` § Model Selection), and the literal output template below inlined verbatim in the dispatch prompt (the subagent cannot read sibling files):

```
SCOPE (required):
- Files to simplify: {space-separated relative paths from Step 1}
- Constraints: preserve all behavior; never expand scope beyond the listed files. Do not run `git commit`, `git merge`, `git push`, or any other git mutation — edit the working tree only and return control; the caller commits (Step 4's "Note on committing").

OUTPUT FORMAT (required):
First reply line MUST be one of: DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED.

Then return ONLY a markdown table, no preamble:

| File | Change | Lines |
|---|---|---|
| {relative path} | {one-line description of the simplification} | -N/+M |

If no simplifications were made: return literal text "No simplifications needed."
Do not add narration, headers, or summaries before or after the table.
```

**What it catches and the constraints** are the shared simplification criteria — read `_shared/criteria-simplification.md`. The same criteria are reused by `/claude-tweaks:code-health`'s simplification lens, so the reactive pass and the proactive sweep flag identical complexity. (The `code-simplifier` subagent applies them; the dispatch prompt above carries the scope and output contract.)

**When dispatched with file-path scope** (rather than a diff range), the subagent optimizes the whole file — it has no way to know which lines the caller's own work actually touched. Before committing the returned changes, the caller should diff them against its own change scope and revert anything outside it, the same discipline `/review` Step 5 already applies to merge-provenance exclusions (`#174`).

## Step 3: Verify

If the simplifier made changes, run the shared verification procedure from `verification.md` in the `/claude-tweaks:test` skill's directory. This runs type checking, linting, and tests.

### Working Directory Discipline

Apply the Working Directory Discipline rule from `_shared/subagent-dispatch-core.md` before any verification command. On mismatch, return **BLOCKED** to the caller; never verify from the wrong directory.

### If verification fails

Verification failure is a **BLOCKED gate** — never silently retry or self-fix. Choose one branch:

**(a) BLOCKED — default, and the only option in interactive mode:**
Return control to the caller with the failing check. Do NOT attempt a fix in-place.

```
BLOCKED
Reason: verification failed after simplification.
Failing check: {typecheck | lint | tests}
Output: {one-line summary of the failure, or path to the failure log}
Next: caller decides whether to revert the simplification, fix the regression, or stage for review.
```

**(b) Stage and continue — only in `auto` mode AND when reversibility is high:**
Write a stage entry to `{run-dir}/staged/simplify-{n}.md` naming the failing check and the file(s) involved, then append to the auto-decision log under the `## /simplify` heading in `{run-dir}/decisions.md` (per `_shared/auto-decision-log.md`):

```
- STAGED {HH:MM:SS} — Step 3 verify: {check} failed after simplifying {files}. Stage path: staged/simplify-{n}.md.
```

Surface at the Wrap-Up Review Console. At this point the simplification is still an uncommitted change in the working tree (`/claude-tweaks:simplify` never commits — see Step 4's Note on committing). Continue only if it can be safely discarded via `git checkout -- <files>` / `git restore <files>` if the caller ultimately rejects it at the console; if not, fall back to BLOCKED.

Silent self-fixing is forbidden — see `_shared/auto-mode-contract.md`.

## Step 4: Report

### Changes made

```
### Code Simplification

| # | File | Change | Lines |
|---|------|--------|-------|
| 1 | {file} | {description of simplification} | {-N/+M} |
| 2 | {file} | {description} | {-N/+M} |

Verification: {pass/fail}
```

### No changes

```
No simplifications needed — code is already clean.
```

### Note on committing

`/claude-tweaks:simplify` never commits — it edits the working tree and verifies, then returns control. When invoked by `/claude-tweaks:build` or `/claude-tweaks:review`, the parent skill commits the resulting changes as part of its own flow. When invoked standalone, the user commits (or discards, via `git checkout -- <files>` / `git restore`) the changes themselves.

## Next Actions

When invoked directly (not by a parent skill), render as plain markdown (docs/skill-authoring.md's Skill handoffs convention):

**`/claude-tweaks:review {spec}`** — code review quality gate (recommended)
`/claude-tweaks:test` — verify changes

When invoked by a parent, omit Next Actions — the parent handles flow control.

## Component-Skill Contract

This skill is a **component skill** — invoked by `/claude-tweaks:build` (Common Step 3) and `/claude-tweaks:review` (Step 5). Parent invocation is signaled by `$PIPELINE_RUN_DIR` being set (the parent is running inside an active pipeline run). When invoked by a parent, omit the `## Next Actions` block — the parent owns the handoff. When invoked directly by a user (no `$PIPELINE_RUN_DIR`, regardless of whether file paths were typed in `$ARGUMENTS` or passed inline), render Next Actions as shown above.

## Anti-Patterns

| Pattern | Why It Fails |
|---------|-------------|
| Simplifying unrelated code | Scope creep — only simplify files changed in the current work |
| Making behavioral changes | Simplification preserves behavior — behavior changes are a different skill |
| Skipping verification after changes | Simplifications can introduce regressions — always verify |
| Running on generated files | Generated code should be regenerated, not hand-simplified |
| Over-simplifying at the cost of readability | Dense one-liners can be harder to read than explicit code |
