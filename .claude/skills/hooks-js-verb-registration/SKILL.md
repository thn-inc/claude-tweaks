---
name: hooks-js-verb-registration
description: Use when adding a subcommand (verb) to `plugin/bin/hooks.js` — every site the verb must land in so the dispatcher, the --help guard, the flag-strict guard and the docs agree, plus the decisions each verb owes (stdout contract, exit codes, --run anchoring). Keywords - hooks.js, verb, subcommand, VERBS, USAGE, KNOWN_FLAGS, resolveRunArg, check-pass-reentry, runAccepting, anchored --run.
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
| 8 | The comment block above `KNOWN_FLAGS` in `plugin/bin/hooks.js` | For a read-only flag-strict verb, name it in the comment's description of the table's membership (row 2 already asks for that update). The comment above `VERBS` does not enumerate verbs, so it needs no edit. |

Then add a dedicated `tests/hooks-{verb}.test.js` (spawn the CLI, assert stdout, stderr and the exit code separately) and, if a skill calls the verb, a conformance pin on the call text.

## Decisions each verb owes

1. **Is `--run` mandatory?** A prose-side gate that must never guess a run dir exits 1 with `requires --run` when `explicit` is false. A convenience verb may fall back to implicit resolution; say which in the usage string.
2. **What is on stdout?** If a skill parses it, stdout carries only the machine-readable result. Notices (the worktree-local-fallback disclosure, refusals) go to stderr through `reportWorktreeLocalFallback(runDir, flag, process.stderr)`.
3. **What does refusal exit with?** Sibling `check-*` verbs print a line and exit 0; a verb whose caller treats a non-zero exit as a stop exits 1. The latter is a documented exception (site 5), not a default.
4. **Flush before returning.** `await new Promise((resolve) => process.stdout.write(line, resolve))`, never a bare write followed by an exit code that lets the process end early.
