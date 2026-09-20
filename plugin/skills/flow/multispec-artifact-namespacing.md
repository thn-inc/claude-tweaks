# Artifact-overwrite completion check (#786)

`journeys/SKILL.md` and `stories/SKILL.md` namespace their generated filenames by spec id
(`docs/journeys/{journey-name}-{N}.md`, `{OUTPUT_DIR}/{site-name}-{persona-or-area}-{N}.yaml`)
when running inside a multi-spec shared worktree — see each skill's own "Multi-spec shared
worktree" note. This check verifies the *outcome* directly from git history rather than trusting
that every present-and-future write path in the shared worktree actually implements the
namespacing rule:

Before the Consolidated Review Console renders, run (once, over the whole run's commit range):

```bash
git -C "$WORKTREE" log --name-status --diff-filter=AM "{EXPECTED_BASE}..HEAD" -- docs/journeys/ stories/
```

`{EXPECTED_BASE}` is the same value `worktree-setup.md`'s Step 0 captured when the shared
worktree was created (the commit before spec 1's materialize commit) — the run's own commit
range, never the whole repo history. Walk the output: if any path under `docs/journeys/` or
`stories/` shows status `A` (added) in one commit and status `M` (modified) in a **later** commit
within this same range, that later commit is a candidate — not yet a confirmed overwrite (see
"Append vs. overwrite" below) — for "a spec's journey/story artifact was silently overwritten by
a later spec's write", the exact failure #786 exists to catch.

This is independent of whether the namespacing rule was actually followed by the write that
produced each commit: it verifies "no overwrite happened," not "namespacing was applied," so a
future skill that reintroduces an unnamespaced write path is still caught here even if its own
prose omits the naming rule.

## Append vs. overwrite (#2014)

A shared journey is *meant* to be extended by later specs — `journeys/SKILL.md`'s own "extend the
existing journey" guidance has every spec that touches the file append its own numbered step (and,
commonly, a trailing bookkeeping line naming which spec added it). That shape trips the raw
A-then-M walk above even though nothing was lost: in the #1988–#1997 run,
`docs/journeys/compose-a-per-run-context-bundle-1988.md` was added by #1988 and then modified by
#1989, #1991, #1992, #1993, #1995, and #1997 — every cross-spec modification in that range was
append-only (0 net content loss), yet the raw walk cannot distinguish that from a real overwrite
and used to require a manual ruling with `git log --numstat` as evidence.

Before treating an `A`-then-`M` path as a HARD-GATE, run the mechanized check instead of ruling by
hand:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/check-artifact-overwrite.js" --base "{EXPECTED_BASE}" --path docs/journeys/ --path stories/
```

It re-runs the same walk and, for every `A`-then-`M` path it finds, judges each later modifying
commit's own deletions on that path (via `git log --numstat`) by two independent tests — either
one is enough to call the commit an extension rather than an overwrite:

1. **Same-spec self-edit.** Every deleted line traces, via `git blame` on the commit's parent
   revision, back to a commit carrying the *same* `refs #{N}` trailer as the deleting commit
   itself — a spec correcting its own prior content (a typo fix, a follow-up within the same
   build). A deletion that traces to a *different* spec's commit fails this test.
2. **List reflow.** Every deleted line in the hunk is itself a `- ` list entry (a YAML frontmatter
   `files:` item, or a markdown bookkeeping bullet such as a running "Related specs: …" line), and
   the hunk replaces it with at least as many list-entry lines as it removed. This is the
   shared-collection case: appending one more entry to a running list routinely reflows the
   previous "last" entry even though no single spec owns that line the way it owns its own step
   body — in the #1988–#1997 run this is exactly what happened to the journey's closing
   "Related specs: …" bullet on nearly every later spec's commit.

Only a commit that deletes lines failing *both* tests — non-list content it did not itself add, or
a list it shrinks rather than reflows — is a real overwrite. HARD-GATE: stop before rendering the
console and report the offending path, commit, and reason (the tool's `overwrites[]` array — exit
code `1`) plus both commits' spec ids (`refs #{N}`). A clean run (exit `0`, `overwrites: []`, or no
`A`-then-`M` path at all) passes with no manual ruling and the console renders normally. Exit `2`
is a malformed invocation of the tool itself (never a verdict about the walk); exit `3` means the
walk could not run at all (an unresolvable `{EXPECTED_BASE}`) — treat both as this check's own
failure to run, not as a clean result, and fall back to the raw `git log --name-status` walk above
plus a manual `git log --numstat` ruling. Algorithm: `bin/lib/flow/artifact-overwrite-check.js`;
fixture coverage (append-only, self-correction, list reflow, and a genuine cross-spec overwrite,
plus a live replay of the #1988–#1997 range): `tests/bin-lib/flow/artifact-overwrite-check.test.js`.
