# Broken-Reference Sweep — judge file

Judge file for the `references` registry row (`Broken references`), loaded per that row when its gate opens. The gate, the scope, and the row's `SCANNED` line are **engine-owned** — see `curation-engine.md`; this file is judgment only.

Finds references elsewhere in the repository that point at something **this run renamed, moved, or
removed** — a path, an anchor, a symbol name, a heading, a step number — and, when the `autonomy`
ceiling allows, repairs them within the initiative budget.

This is the sweep `CLAUDE.md`'s Don'ts prescribe by hand in five separate rules (`[IL-10]`,
`[IL-17]`, `[IL-21]`, `[IL-52]`, `[IL-93]`), every one recording the same failure: task-scoped
review cannot see an orphaned reference in an untouched file, by construction, so nothing catches
it until someone follows a dead pointer.

Unlike the Docs curation row's D1, this scans **files this run did not touch** — an orphan lives wherever the
old name was cited, which is precisely not where the change was made.

## Step 1: The target set

The rename/move/delete targets arrive in the worklist row (`scope.candidates`), resolved by the
engine — each is an old path that no longer resolves. Beyond paths, collect
renamed anchors and headings from the diff of files that were modified rather than moved — a
heading that changed text is a target for any `#anchor` link or "see the X section" citation
pointing at it.

`scope.candidates` carries **paths only**; the heading targets are yours to collect here. The
gate opens on either fact — a rename/deletion (`renamedOrDeleted`) *or* a heading removed from a
modified `.md` file (`headingRenamed`) — so a run that renamed nothing but a section heading still
reaches this step, and will arrive with an empty `scope.candidates`. That is not a signal to skip:
an empty path set with an open gate means the heading half is the whole target set.

## Step 2: Find surviving references

For each target, grep the repository for the **old** name. Two exclusions are mandatory:

- **The run's own diff.** Those hits are the change itself, not orphans.
- **Plan and design documents that legitimately quote the old name.** A document describing a
  removal necessarily contains the removed string (`[IL-28]`); a sweep that flags it reports its
  own source material as a defect.

Anchor the exclusion to the path position, not as a bare content substring — `grep -v "^path:"`,
never `grep -v "path"`, which drops any line whose *content* mentions that path and swallows real
hits (`[IL-34]`). And note that `grep -rl … .` returns paths **without** a leading `./`, so an
exclusion written against `./path` silently matches nothing, every time (`[IL-39]`).

Each surviving hit is a **candidate pointer repair**, carrying: the file it lives in, the old name,
the new name, and `brokenBy` — the run-changed path that invalidated it.

## Step 3: Resolve ambiguity first — ambiguity always stages

A candidate is only a mechanical repair when the new target is unambiguous. Stage, never apply,
when either holds:

- The old name could plausibly now point at **two or more** new targets.
- The old name **still legitimately exists** elsewhere, so the hit may not be an orphan at all.

The budget's whole premise is that the repair is checkable rather than judged. Where that premise
fails, the carve-out does not apply — see `_shared/initiative-budget.md`.

## Step 4: Apply or stage, by ceiling

**Under `--dry-run`, this step applies nothing** — whatever the ceiling says. Run the floor check,
report what *would* have been repaired as preview rows, and stage everything. This step runs in
Phase 2, well before Phase 4's execution-step preview branch, so `SKILL.md`'s "make no commits" alone would not have stopped the
edits themselves from landing in the tree; the rule has to live here, at the point of application.

Resolve the `autonomy` ceiling per `_shared/autonomy-ceiling.md`.

- **`supervised`** (the default, and any project that has not opted in) — stage every candidate as a
  `[ref] {file} — {old} → {new}` row for the Review Console. Each candidate still goes through
  `permittedInitiative`, which denies it on the ceiling; nothing is applied and its `hold` is still recorded.
- **`trusted` / `unattended`** — pass each candidate through
  `bin/lib/issues/initiative-budget.js`'s `permittedInitiative` and apply those that clear it, up to
  the budget, as a working-tree edit only — never a judge-side commit. The controller's serial-commit
  pass (`curation-engine.md` section 4) is what commits it, carrying the `Initiative-Fix: {run-id}`
  trailer. Stage every denial with its reason — over budget, over a cap, test file, merge-sensitive
  path.

When staging a candidate, write its full proposal to `staged/wrap-up-reference-{n}.md` and name
that path in the finding's `stagePath`, so the Review Console files it under Reference repairs.
Every staged candidate records `permittedInitiative`'s `hold` twice, copied verbatim and never
judged: as the finding's boolean `hold` field in the row's payload, and as exactly one `Hold: yes`
or `Hold: no` line in the staged file's header (the lines before the first blank line). Every
staged file's header also carries `Target: {repo path of the file holding the reference}`, and its
body a `{old} → {new}` line (for an ambiguous one, `{old} → one of {candidates}`), since a human
approving a no-diff repair needs both. That line, and any other prose, comes after the header's
blank line and before the first `diff --git` line, with nothing after the last hunk: the
resolver's strict parser reads a non-blank line after a hunk as unparseable, so a summary placed
after the diff holds every repair as `reference-repair-unclassified`.

A target Step 3 found ambiguous takes `hold: true`/`Hold: yes` whatever the floor said, plus a
`Held: {reason}` line naming why, and carries no diff: nothing has been decided to compose one
from. On any other `Hold: yes`, also add a `Held: {reason}` line naming why. Over-budget, over-cap
and `supervised` denials of an otherwise clean fix come back `hold: false`.

Every other staged repair's body carries the repair's real diff, one `diff --git a/{path} b/{path}`
block per file, with those lines unindented and at the start of the line. Compose it in a fresh
temp directory outside the repo holding `a/{path}` (the file as it is) and `b/{path}` (the repaired
text), then run from that directory:

```bash
git diff --no-index --no-prefix -- a/{path} b/{path}
```

Its exit 1 is success. Paste its output verbatim under the header, never hand-typed, so a staged
candidate leaves the shared worktree untouched, including under `--dry-run`. Then run
`_shared/staged-patch.md`'s Staging-time gate on the file
(`git -C "{worktree root}" apply --check "{stagePath}"`); on its malformed branch, recompose once.
When the diff cannot be composed at all
(the recipe exits anything but 1, the repaired text cannot be produced) or the recomposed one still
fails the gate, stage it held with no diff, the way an ambiguous candidate is: `hold: true`,
`Hold: yes`, a `Held: {why the diff could not be composed}` line, rather than that gate's
description-only `.md`, so a human sees it on the console.

A repair with no parseable diff never auto-approves. The resolver reads the repair's paths from a
strict parse of that diff rather than from `targetPath`, `files` or `summary`: every `---`, `+++`,
`rename` and `copy` line must agree with its section's `diff --git` line and every section must
have one, so the pasted output is never edited. `console-resolve.js --policy console-auto`
approves only when the finding's `hold` is `false`, the header says `Hold: no`, and no path in the
diff is a test file or matches `merge-sensitive-paths`; a true value on either side, a `Held:` line
or such a path resolves `pending — reference-repair-held`, and a missing, duplicated, misplaced or
malformed value on either side, or a missing or unparseable diff, resolves
`pending — reference-repair-unclassified`. Under `--dry-run` the same records are written, since
everything stages there.

Pack the repair (`{old} → {new}`), the `brokenBy` path, and — at `trusted`/`unattended` —
`permittedInitiative`'s own reason string into the finding's `summary` field.
`engine-render.js`'s Change column is a plain string copy of `summary`; that column is the only
place this detail can surface on an engine-rendered console.

```js
const { permittedInitiative } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/initiative-budget.js');
permittedInitiative({
  ceiling,                                  // resolved autonomy ceiling
  fix: { kind: 'pointer-repair', files, changedLines, brokenBy },
  changedFiles,                             // git diff --name-only {base}...HEAD
  spent,                                    // fixes already applied this run
  sensitivePaths,                            // array: merge-sensitive-paths split on ',', entries trimmed, empties dropped ([] when unset), as bin/lib/express/policy.js's sensitivePathsOf parses it; anything else holds every candidate
});
```

Read `_shared/initiative-budget.md` for the floor rule, the commit discipline, the `decisions.md`
entry shape, and the error handling — all of it lives there, not here.
