---
name: pretooluse-updatedinput-normalizer
description: Use when adding, changing or reviewing a rewrite rule in `plugin/bin/lib/hooks/guard-rewrite.js` — the PreToolUse `updatedInput` normalizer that respells Bash shapes the harness worktree-isolation guard refuses — or any other hook output that rewrites a tool call's input. Covers the decline-on-doubt rule, the bash+zsh equivalence and property tests every rule owes, why a rewrite never carries `permissionDecision`, the lazy-require wiring that keeps a load fault from disabling deny gates, and every site a new rule id must land in. Keywords - guard-rewrite, updatedInput, hookSpecificOutput, normalizer, worktree guard, rewriteForGuard, guardRewriteOutput, RULE_IDS, decline, bash zsh equivalence, property test, permissionDecision, lazy require.
---

# PreToolUse updatedInput normalizer

## Overview

`plugin/bin/lib/hooks/guard-rewrite.js` (#4028) rewrites Bash commands whose meaning is fully known from the text but which Claude Code's worktree-isolation guard refuses, and hands the result back as `hookSpecificOutput.updatedInput`. It is the plugin's first hook output that changes what a tool call runs, rather than allowing or denying it. A wrong deny fails loudly; a wrong rewrite silently runs a different command than the model wrote. Every pattern below exists to keep that second failure impossible.

The measured premise — `updatedInput` is applied before the guard, and the guard re-checks the rewritten command — is in `docs/reference/pretooluse-updatedinput-worktree-guard.md`; the contract summary is `docs/hooks.md`'s "Guard normalizer" bullet.

## Key Patterns

### Decline unless the rewrite is provably the same command

A rule returns a rewritten string only when it can prove the result means the same thing under both shells the Bash tool runs, bash and zsh. On any doubt it returns `null`, and `rewriteForGuard` returns `null` on any throw. The proofs are allowlists, never denylists:

- The value-inlining rules (`inline-literal-assignment`, `plugin-root-placeholder`) require every command-position word to be a plain literal outside the runner, reserved-word and computed-name-assigning builtin sets (`commandWordsPlain`), no arithmetic context (`hasArithmetic`), an uppercase name (`SUBSTITUTABLE_NAME`: zsh keeps its special parameters lowercase) outside `SHELL_MAINTAINED`, and a value matching `LITERAL_VALUE`.
- `drop-redundant-cd` requires the literal to spell the cwd, not merely resolve to it (a symlinked spelling changes `$PWD`), and declines when the rest of the command reads `OLDPWD`.
- `quote-escaped-space` skips tilde, zsh `=cmd` and assignment words, which change meaning once quoted.

A preserved divergence is a ruling, not an oversight: `node-eval-separator` differs only when the runtime value starts with `-`, accepted by ruling and stated in the module header. Name every residual the text cannot show (shell-snapshot functions and aliases, zsh glob qualifiers that run them) in the header; never claim a proof the text does not support.

### Prove it under bash and zsh, then by property

`tests/bin-lib/hooks/guard-rewrite.test.js` runs every positive case through both shells and compares stdout, stderr and exit status; runs must-decline cases to show the naive inline really differs, so each decline is earned; and draws commands from a seeded PRNG (`mulberry32`) for a property test. A new rule adds positive cases to the equivalence list, one must-decline case per bail condition, zsh-only cases marked `shells: ['zsh']` where the form is a bash syntax error, and keeps the harness self-check that the comparison can go red ("equivalence harness discriminates"). The shell tests skip on win32 and without bash; a missing zsh is reported as a diagnostic, never counted as a pass.

### Normalize, never bypass: no permissionDecision

`guardRewriteOutput` builds `{ hookEventName: 'PreToolUse', updatedInput: { ...toolInput, command } }` and nothing else. An `allow` beside it would skip the permission prompt for text the user never saw, and the guard re-checks the rewrite anyway, so the rewrite needs no permission decision to take effect. Spread `toolInput` so the call's other fields (`description`, `timeout`, `run_in_background`) survive.

### Rewrite only where the guard runs

`rewriteForGuard` returns a rewrite only when `cwd` is absolute and `isLinkedWorktree(cwd)` is true (a `.git` file, not a directory). Outside a linked worktree there is no guard to satisfy, so a rewrite there is pure risk. Tests inject `deps.isLinkedWorktree`.

### Wire it lazily at both sites, and let a deny win

Two sites emit it. `bash-prefilter.js`'s `earlyGate` covers the skip path (a Bash call no covered word sends to the full handler), and `bin/hooks.js` prints its `json` with `fs.writeSync` before `process.exit(0)` so the exit cannot truncate it. `pre-tool-use.js`'s `withGuardRewrite` covers the full path. Both `require('./guard-rewrite')` inside a `try`, so a load fault costs only the rewrite, never the module carrying every deny gate. `withGuardRewrite` returns the outcome untouched when it already holds a `hookSpecificOutput` (today only a deny does), so a deny always wins over a rewrite. `guard-rewrite.js` requires only `path` and `../path-guard` and keeps every scan linear in the command length, because it loads on every skip-path Bash call.

### Order is load-bearing

`RULES` runs in order, each rule reading the previous rule's output: `drop-redundant-cd` first, so leading assignments sit at the start of the command; value inlining next; argument-reshaping rules last. Place a new rule by what it reads and what it writes, and update the comment above `RULES`.

## Decision Framework

| Situation | Do this |
|---|---|
| A refused shape whose meaning is fully known from the text, the same in bash and zsh | A new rule in `RULES`, with equivalence, decline and property cases |
| A shape whose meaning depends on runtime state (a computed path, `$(…)`, a shell function) | No rule. Rewrite the skill fence into a guard-accepted form (`_shared/scratch-worktree.md` section 7) |
| A rewrite that is the same command in one shell but not the other | Decline for the whole command; never pick one shell |
| A rule whose only divergence is a narrow, injection-shaped input | Stage a ruling, then state the accepted divergence in the module header and `docs/hooks.md` |
| Wanting the rewrite to also skip a permission prompt | Never: that is a bypass, not a normalization |

## Project Conventions

- A new or renamed rule id lands in `RULES` and its order comment; `docs/hooks.md`'s guard-normalizer bullet; `docs/reference/pretooluse-updatedinput-worktree-guard.md`; `_shared/scratch-worktree.md` section 7's normalizer paragraph and its "five shapes" count; and the `RULE_IDS.length` assertion in `tests/guard-refusals/probe-doc.test.js`, which derives the ids from the export and fails until the prose follows.
- Section 7's table records the guard's own behavior; the normalizer paragraph under it names the refused rows the normalizer rescues. Never flip a row to "passes" because the normalizer handles it.
- A refusal of a normalized shape means the normalizer declined or was not loaded. `post-tool-use-failure` logs it as `wd-guard-refusal`, and `tools/guard-refusals.js` measures the rate across transcripts.

## Common Operations

```bash
node --test tests/bin-lib/hooks/guard-rewrite.test.js
node --test tests/guard-refusals/probe-doc.test.js
node --test tests/hooks-bash-prefilter.test.js tests/hooks-pre-tool-use.test.js
```

## Anti-Patterns

| Pattern | Why It Fails in This Project |
|---|---|
| Denylisting dangerous command words instead of allowlisting plain ones | zsh alone adds reserved words, precommand modifiers and module builtins that assign computed names (`zstyle -s`, `print -v`, `sysread`); the test file's zsh-only cases are each a word a denylist would have to know in advance |
| Proving a rule under bash only | An unquoted spaced value splits in bash and not in zsh ("equivalence harness discriminates"), so a bash-only proof certifies a different command than the one zsh runs |
| Emitting `permissionDecision: 'allow'` with the rewrite | Skips the prompt for text the user never approved, and buys nothing: the guard re-checks the rewrite |
| A top-level `require('./guard-rewrite')` in `pre-tool-use.js` | A load fault in the normalizer would take down every deny gate with it |
| A new gate emitting a non-deny `hookSpecificOutput` (`ask`, `additionalContext`) | `withGuardRewrite` treats any existing `hookSpecificOutput` as a decision and skips the rewrite, so the gate silently disables normalization for every call it answers |
| Flipping a section 7 row to "passes" because the normalizer handles it | The guard still refuses it wherever the normalizer is absent, declines, or the cwd is not a linked worktree |

## Reference

- `plugin/bin/lib/hooks/guard-rewrite.js`: the rules, `rewriteForGuard`, `guardRewriteOutput`, `RULE_IDS`
- `plugin/bin/lib/hooks/bash-prefilter.js` (`earlyGate`), `plugin/bin/hooks.js`, `plugin/bin/lib/hooks/pre-tool-use.js` (`withGuardRewrite`)
- `docs/hooks.md` (Guard normalizer), `docs/reference/pretooluse-updatedinput-worktree-guard.md`
- `tests/bin-lib/hooks/guard-rewrite.test.js`, `tests/guard-refusals/probe-doc.test.js`
- Sibling skill: `pre-tool-use-gate-exemptions` governs the deny gates this output must never weaken
