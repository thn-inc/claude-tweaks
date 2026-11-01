---
name: hooks-js-verb-registration
description: Use when adding a subcommand (verb) to `plugin/bin/hooks.js`, or adding or removing a flag on an existing verb — every site the verb or flag must land in so the dispatcher, the --help guard, the flag-strict guard and the docs agree, plus the decisions each verb owes (stdout contract, exit codes, --run anchoring) and each flag owes (typo behavior, combination refusals). Keywords - hooks.js, verb, subcommand, flag, VERBS, USAGE, KNOWN_FLAGS, VALUE_FLAGS, flagVal, resolveRunArg, check-pass-reentry, runAccepting, anchored --run.
---

# hooks.js verb registration

`docs/hooks.md` owns the dispatcher contract (run-dir anchoring, the never-break-a-session invariant). This skill owns the build procedure for adding a verb: every site it must land in, and the decisions it owes. #3553 (`check-pass-reentry`) touched all six sites and no project skill listed them.

## The registration set

A verb is not shipped until every row lands in the same change.

| # | Site | What to add |
|---|---|---|
| 1 | `VERBS` table in `plugin/bin/hooks.js` | One entry, `'{verb}': { usage: '{verb} --run <dir> [...]', run: run{Verb} }`. `USAGE` (derived from it), the `--help`/`-h` intercept, dispatch and the unknown-verb usage listing all read this table, so one entry registers the verb's usage line and dispatch. Rows 2 and 3 are still required in the same change: a verb cannot dispatch without a usage line or get dispatched without the guard, and a verb without its `KNOWN_FLAGS` entry refuses every flag. |
| 2 | `KNOWN_FLAGS` in `plugin/bin/hooks.js` | Every `VERBS` verb gets an entry: its declared flags, or `[]` when it takes none. The registration test in `tests/hooks-js-flag-strict.test.js` fails otherwise. |
| 3 | The verb's handler, `async function run{Verb}(argv)` | Returns the verb's exit code; `main()` calls it through the table entry's `run`. Resolve `--run` through `resolveRunArg`; decide mandatory vs implicit (below). |
| 4 | `tests/hooks-help-guard.test.js` | Add the verb to the `runAccepting` list (any verb that accepts `--run`). |
| 5 | `docs/hooks.md` | The anchored-`--run` paragraph: bump the spelled-out count (the "{N} subcommands that accept it" phrase) and insert the verb in the list. If the verb exits 1 on refusal, name it in the exit-code exception sentence beside `close-run` and `resolve-console`. |
| 6 | `docs/plugin-structure.md`'s `plugin/bin/hooks.js` line | Add the verb to the subcommand list and renumber any ordinal prose that counts the verbs. |
| 7 | `docs/hooks.md`'s implicit-resolution sentence ("The five mutating run-state verbs … plus `delete-ledger` …") | Only for a verb that resolves an omitted `--run` through `resolveRunArg`'s `unambiguousOnly` path: name it there. The row-5 anchored-`--run` list does not cover this sentence, and a verb can land in one and miss the other (#3897's `resolve-ledger` did). |
| 8 | The comment block above `KNOWN_FLAGS` in `plugin/bin/hooks.js` | It states the membership rule (every `VERBS` verb) without enumerating verbs, so it needs an edit only when that rule changes. |

Then add a dedicated `tests/hooks-{verb}.test.js` (spawn the CLI, assert stdout, stderr and the exit code separately) and, if a skill calls the verb, a conformance pin on the call text.

## Decisions each verb owes

1. **Is `--run` mandatory?** A prose-side gate that must never guess a run dir exits 1 with `requires --run` when `explicit` is false. A convenience verb may fall back to implicit resolution; say which in the usage string.
2. **What is on stdout?** If a skill parses it, stdout carries only the machine-readable result. Notices (the worktree-local-fallback disclosure, refusals) go to stderr through `reportWorktreeLocalFallback(runDir, flag, process.stderr)`.
3. **What does refusal exit with?** Sibling `check-*` verbs print a line and exit 0; a verb whose caller treats a non-zero exit as a stop exits 1. The latter is a documented exception (site 5), not a default.
4. **Flush before returning.** `await new Promise((resolve) => process.stdout.write(line, resolve))`, never a bare write followed by an exit code that lets the process end early.
5. **Flag-strict is the default (#4777).** Every `VERBS` verb refuses an undeclared flag on stderr with exit 1, and a verb with no `KNOWN_FLAGS` entry refuses every flag, so a new verb owes its declared flags, not a strictness decision. `archive-run` archived and committed on `--dry-run` until #4773. Where a verb's flags change, check that every call site passes only the flags you declare (`git grep -n 'hooks.js" {verb}'`), then land a spawn test that runs an undeclared flag in both argument orders and asserts empty stdout, the two-line stderr refusal, exit 1, and that nothing moved or committed (`tests/archive-run-verb.test.js`).
6. **The flag refusal is the dispatcher's, not the verb's.** `--help` or `-h` prints `claude-tweaks: usage: {usage}` on stdout and exits 0 before the handler runs, and wins over an undeclared flag in the same call, whatever decisions 2 and 3 chose. An undeclared flag, or a value flag followed by a `--`-prefixed token, writes `claude-tweaks: {verb}: …` plus the usage line on stderr and exits 1 before the handler runs, so a stdout-capturing or exit-gated caller sees the typo as a failure (#4834).

## Adding a flag to an existing verb

A new flag on a shipped verb lands in a subset of the verb's sites, and whether the flag takes a value sets that subset: a value-taking flag also lands in row 4. #3992 (`resolve-console --filing-failed`, takes a value) touched row 4; #4677 (`resolve-run-dir --archived`, boolean) did not.

| # | Site | When |
|---|---|---|
| 1 | The verb's `usage` string in `VERBS` | Always: append `[--{flag}]` or `[--{flag} <value>]`. |
| 2 | The handler's option parse | Always: `args.includes('--{flag}')` for a boolean, `flagVal(args, '--{flag}')` for a value, passed through to the lib call. |
| 3 | `KNOWN_FLAGS` | Always: append the flag to the verb's entry. Without it the unknown-flag guard refuses the new flag. |
| 4 | `VALUE_FLAGS` | For a value-taking flag, so the unknown-flag scan skips the value token. The set is shared by all verbs: a flag that takes a value on one verb and is boolean on another swallows the next token on the boolean verb. `tests/hooks-js-flag-strict.test.js` checks rows 1, 3 and 4 against each other: every flag a usage line names must be declared, and exactly the `<value>` flags must be in this set. |
| 5 | The doc that owns the verb's call | Always: the usage line plus one bullet on the flag's semantics, in the `_shared/*.md` file skill steps cite for the verb (`_shared/pipeline-run-dir.md` for `resolve-run-dir`, `_shared/console-execution.md` for `resolve-console`). A skill that calls the flag cites that bullet rather than restating it; #4677's review replaced `wrap-up/merge-mode.md`'s restated copy with a citation. |
| 6 | Tests | A CLI spawn test that the flag reaches the handler, whose negative half runs the same args without the flag and asserts the old reason, not just the exit code (`tests/hooks-resolve-run-dir-cli.test.js`); and a pin on the home doc's usage line. |

Decisions each flag owes:

1. **What does a typo do?** Every verb refuses an unknown flag on stderr with exit 1 (#4777), so a misspelled flag never runs the verb. Keep the without-flag path safe and byte-for-byte unchanged for existing callers (`--archived` is opt-in, and without it the call resolves nothing and its caller stops).
2. **Refuse bad combinations first.** Check a flag's conflicts and prerequisites before any resolution step or write, so an earlier short-circuit cannot mask them: `--archived` refuses `--create` and a missing `--spec-slug` before step 1, so an inherited `PIPELINE_RUN_DIR` never hides the refusal.
3. **Removing a flag** from a verb follows the two-release order in the comment above `teardown-run`'s `KNOWN_FLAGS` entry: the prose call sites and their pins first, the table entry and usage text a release later.
