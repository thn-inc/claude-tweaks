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
| 1 | `VERBS` table in `plugin/bin/hooks.js` | One entry, `'{verb}': { usage: '{verb} --run <dir> [...]', run: run{Verb} }`. `USAGE` (derived from it), the `--help`/`-h` intercept, dispatch and the unknown-verb usage listing all read this table, so one entry is the whole registration in `hooks.js` apart from rows 2, 3 and 8: a verb cannot dispatch without a usage line or get dispatched without the guard. |
| 2 | `KNOWN_FLAGS` in `plugin/bin/hooks.js` | Only for a flag-strict verb (one where an unknown or misspelled flag must print the usage line rather than run): its declared flags. Update the two comments that describe the table's membership. |
| 3 | The verb's handler, `async function run{Verb}(argv)` | Returns the verb's exit code; `main()` calls it through the table entry's `run`. Resolve `--run` through `resolveRunArg`; decide mandatory vs implicit (below). |
| 4 | `tests/hooks-help-guard.test.js` | Add the verb to the `runAccepting` list (any verb that accepts `--run`). |
| 5 | `docs/hooks.md` | The anchored-`--run` paragraph: bump the spelled-out count (the "{N} subcommands that accept it" phrase) and insert the verb in the list. If the verb exits 1 on refusal, name it in the exit-code exception sentence beside `close-run` and `resolve-console`. |
| 6 | `docs/plugin-structure.md`'s `plugin/bin/hooks.js` line | Add the verb to the subcommand list and renumber any ordinal prose that counts the verbs. |
| 7 | `docs/hooks.md`'s implicit-resolution sentence ("The five mutating run-state verbs … plus `delete-ledger` …") | Only for a verb that resolves an omitted `--run` through `resolveRunArg`'s `unambiguousOnly` path: name it there. The row-5 anchored-`--run` list does not cover this sentence, and a verb can land in one and miss the other (#3897's `resolve-ledger` did). |
| 8 | The comment block above `KNOWN_FLAGS` in `plugin/bin/hooks.js` | For a read-only flag-strict verb, name it in the comment's description of the table's membership (row 2 already asks for that update). For a verb that calls `resolveRunArg` and has no `KNOWN_FLAGS` entry, name it in the comment's "Every other resolveRunArg caller" list; a verb that becomes flag-strict leaves that list. The comment above `VERBS` does not enumerate verbs, so it needs no edit. |

Then add a dedicated `tests/hooks-{verb}.test.js` (spawn the CLI, assert stdout, stderr and the exit code separately) and, if a skill calls the verb, a conformance pin on the call text.

## Decisions each verb owes

1. **Is `--run` mandatory?** A prose-side gate that must never guess a run dir exits 1 with `requires --run` when `explicit` is false. A convenience verb may fall back to implicit resolution; say which in the usage string.
2. **What is on stdout?** If a skill parses it, stdout carries only the machine-readable result. Notices (the worktree-local-fallback disclosure, refusals) go to stderr through `reportWorktreeLocalFallback(runDir, flag, process.stderr)`.
3. **What does refusal exit with?** Sibling `check-*` verbs print a line and exit 0; a verb whose caller treats a non-zero exit as a stop exits 1. The latter is a documented exception (site 5), not a default.
4. **Flush before returning.** `await new Promise((resolve) => process.stdout.write(line, resolve))`, never a bare write followed by an exit code that lets the process end early.
5. **Is it flag-strict?** Decide by whether the verb moves, writes or commits anything, not by which family it belongs to. A verb with no `KNOWN_FLAGS` entry ignores an unknown flag, so a typo or an unsupported `--dry-run` on a mutating verb runs it for real: `archive-run` sat outside the table, classed with the read-only verbs, and archived and committed on `--dry-run` until #4773. The lenient mutating verbs still in `VERBS` (`sweep-shadow`, `adopt-run-dir`, `reconcile`) are not precedent for a new one. Before adding an existing verb to the table, check that every call site passes only the flags you declare (`git grep -n 'hooks.js" {verb}'`), then land rows 2 and 8 and a spawn test that runs an undeclared flag in both argument orders and asserts the usage stdout, exit 0, and that nothing moved or committed (`tests/archive-run-verb.test.js`).

## Adding a flag to an existing verb

A new flag on a shipped verb lands in a subset of the verb's sites, and which subset depends on the verb. #3992 (`resolve-console --filing-failed`, flag-strict, takes a value) and #4677 (`resolve-run-dir --archived`, not flag-strict, boolean) touched different ones.

| # | Site | When |
|---|---|---|
| 1 | The verb's `usage` string in `VERBS` | Always: append `[--{flag}]` or `[--{flag} <value>]`. |
| 2 | The handler's option parse | Always: `args.includes('--{flag}')` for a boolean, `flagVal(args, '--{flag}')` for a value, passed through to the lib call. |
| 3 | `KNOWN_FLAGS` | Only when the verb has an entry there. Without it the unknown-flag guard refuses the new flag. |
| 4 | `VALUE_FLAGS` | Only for a value-taking flag on a flag-strict verb, so the unknown-flag scan skips the value token. |
| 5 | The doc that owns the verb's call | Always: the usage line plus one bullet on the flag's semantics, in the `_shared/*.md` file skill steps cite for the verb (`_shared/pipeline-run-dir.md` for `resolve-run-dir`, `_shared/console-execution.md` for `resolve-console`). A skill that calls the flag cites that bullet rather than restating it; #4677's review replaced `wrap-up/merge-mode.md`'s restated copy with a citation. |
| 6 | Tests | A CLI spawn test that the flag reaches the handler, whose negative half runs the same args without the flag and asserts the old reason, not just the exit code (`tests/hooks-resolve-run-dir-cli.test.js`); and a pin on the home doc's usage line. |

Decisions each flag owes:

1. **What does a typo do?** A verb with no `KNOWN_FLAGS` entry ignores an unknown flag, so a misspelled flag runs the verb as if the flag were absent. Keep the without-flag path the safe one and byte-for-byte unchanged for existing callers (`--archived` is opt-in, and without it the call resolves nothing and its caller stops), or make the verb flag-strict.
2. **Refuse bad combinations first.** Check a flag's conflicts and prerequisites before any resolution step or write, so an earlier short-circuit cannot mask them: `--archived` refuses `--create` and a missing `--spec-slug` before step 1, so an inherited `PIPELINE_RUN_DIR` never hides the refusal.
3. **Removing a flag** from a flag-strict verb follows the two-release order in the comment above `teardown-run`'s `KNOWN_FLAGS` entry: the prose call sites and their pins first, the table entry and usage text a release later.
