---
name: pre-tool-use-gate-exemptions
description: Use when adding or reviewing a scoping exemption in `plugin/bin/lib/hooks/pre-tool-use.js`'s deny gates (`checkBookkeepingStampsGate`, `checkWorktreeRequired`, and their sibling checks) — the unwritten discipline every existing exemption in that file already obeys, reproduced independently in two review findings on record #1678 alone. Keywords - pre-tool-use, exemption, deny gate, fail closed, indeterminate, realTarget, symlink, worktree-detect, bookkeeping-stamps, IL-83, IL-149, IL-150.
---

# pre-tool-use.js gate-exemption authoring

`plugin/bin/lib/hooks/pre-tool-use.js` carries a whole family of scoping exemptions on its deny gates — `isPipelineBookkeeping`, `isPolicyFile`/`realTarget`, `isPolicyOnlyCommit`, `isDeleteOnlyPush`, `isStampsGateExemptTarget`, the Bash foreign-repos branch, and `checkBookkeepingStampsGate`'s file-tool foreign-target branch (#1678). Every one of them obeys the same discipline, documented nowhere as a single list before this file — record #1678 reproduced two of these rules' violations in one function in one review pass (`[IL-149]`, `[IL-150]`), which is the evidence this gap was real.

## The discipline

- **Absolute-path-only guard.** A relative path resolves against the *hook process's own cwd* (`repoInfo`'s internal `path.resolve`), not the calling session's `ctx.cwd` — never provable, so it must fall through unchanged, exactly like an indeterminate answer. Check `path.isAbsolute(...)` before doing anything else with a caller-supplied path.

- **Resolve the leaf symlink before deciding — mirror `realTarget()`.** A path-based ALLOW/exemption decided on the raw literal target path can be defeated by a symlink located outside the check's scope whose target resolves inside it (or vice versa) — `[IL-150]`. `realTarget()` (near the top of this file) is the canonical helper: it follows every symlink including the leaf when something exists there, and falls back to a parent-only resolution (keeping the literal basename) for a genuinely new path with nothing at the leaf yet — never treating an *existing-but-unresolvable* (dangling) symlink as "doesn't exist yet." Reuse it, or replicate its three-way shape (resolved / dangling-and-unprovable / new-file-passthrough) exactly — don't call `wtDetect.repoInfo()` or any other path-answering function on a literal path without first asking whether the leaf is a symlink.

- **Every unprovable answer fails CLOSED, and a conclusive exemption is never gated on an unrelated inconclusive one.** `wtDetect.repoInfo()`/`mainCheckoutRoot()` return `indeterminate: true` or `null` when the question genuinely went unanswered (a timeout, an EACCES/ELOOP/EIO stat, an unreadable `.git` file) — that is a *different fact* from a definitive negative answer, and must never be read as "not a repo" or "different repo." The subtler failure mode, from `[IL-149]`: don't nest a value's already-conclusive exemption inside a check on a *different, unrelated* value's resolution succeeding. `if (mainRoot) { if (!targetRoot) return {}; }` denies a target `repoInfo` already proved has no repo root at all, on a transient failure of the unrelated `mainRoot` lookup — hoist the conclusive check out so it fires unconditionally on its own evidence. See `docs/donts.md`'s `[IL-83]` for the sibling rule about ordering an exemption after an early return that can claim the same value.

- **A Bash-shaped exemption matches the ENTIRE command string against a grammar** — no extra flag, no shell operator, no env-var prefix slipping past a substring match. Prove the staged set with `git diff --name-status`, never `--name-only` — a rename into the target collapses to one `--name-only` line and hides that a second file also changed.

- **A containment check calls `shared-primitives.js`'s `isPathContained(candidate, root, { orEqual })` — never a retyped `startsWith(root + path.sep)`.** Both of this file's containment-shaped exemptions route through it: `isPipelineBookkeeping` (strict) and `checkTeardownGate`'s own-cwd refusal (`orEqual: true`). #2324's review found the idiom independently retyped in six places — `reconcile/reap-merged.js`, `hooks/worktree-reap.js`, `timing/transcript.js`, and this file's two sites — each copy free to drop the `+ path.sep` (making `/repo/.claude-tweaks-evil` match inside `/repo/.claude-tweaks`) or the equals branch. Pass already-resolved paths in: it is a pure string comparison, never a filesystem call, so it does not substitute for the symlink resolution the `realTarget()` bullet above requires.

- **Every new exemption needs a regression test proven to go red on revert.** Write the test, revert only the code fix (`git checkout -- {file}` on that one file, not `git stash`), confirm the new test — and only the new test — fails, then restore the fix. A green suite alone is not evidence the test discriminates.

## Existing coverage, checked

`gh-api-module-pattern` governs the `run(argv, deps)`/`execFileSync` seam elsewhere in `plugin/bin/lib/` — not this file's deny-gate exemptions, which call `wtDetect` directly (no injectable seam; `deps` here is a single test-only `resolveIntegrationModel` override). Nothing else in `.claude/skills/` touches hooks.

**A fail-open sibling exists and is not covered by this skill's discipline.** `plugin/bin/lib/pr-bookkeeping/precondition.js`'s `checkPrBookkeepingPrecondition` (#2472) reuses `pre-tool-use.js`'s exported `hasMaterializeCommit`/`hasLoggedPrDegrade`/`resolveRunPinnedIntegrationModel` and the same `isLinkedWorktree`/`indeterminate` scoping pattern this skill documents — but it is a benefit-of-the-doubt *precondition* check, not a deny gate, and deliberately inverts the posture: ambiguity resolves to `{ok: true}` (proceed) rather than fail-closed. Do not apply this skill's "every unprovable answer fails CLOSED" rule to that file — it is a correct, intentional divergence, not an instance of the anti-pattern this skill exists to catch.

## Anti-Patterns

| Pattern | Why It Fails |
|---|---|
| Calling `repoInfo()`/any path-answering function on a literal path without checking for a leaf symlink first | The exact bypass `[IL-150]` names — a symlink outside the check's intended scope can point anywhere |
| Nesting a conclusive exemption's `return {}` inside a check on an unrelated value | A transient failure of the unrelated check denies a target already proven out of scope — `[IL-149]` |
| Treating `mainCheckoutRoot() === null` as "different repo" | `null` also means "the answer is unknown" (EACCES/ELOOP/EIO, unreadable `.git`) — only a resolved-AND-different root exempts |
| Proving a Bash exemption's staged set with `git diff --name-only` | A rename into the target collapses to one line and hides a second changed file — use `--name-status` |
| Retyping `candidate.startsWith(root + path.sep)` instead of calling `isPathContained` | Six independent copies existed before #2324; a copy silently drops the separator (a prefix sibling then matches) or the `orEqual` branch |
| Shipping a new exemption with no regression test proven to fail on revert | A green suite alone proves nothing about whether the new test actually discriminates |
