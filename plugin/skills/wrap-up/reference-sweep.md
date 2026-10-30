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
  `[ref] {file} — {old} → {new}` row for the Review Console. Nothing is applied.
- **`trusted` / `unattended`** — pass each candidate through
  `bin/lib/issues/initiative-budget.js`'s `permittedInitiative` and apply those that clear it, up to
  the budget, as a working-tree edit only — never a judge-side commit. The controller's serial-commit
  pass (`curation-engine.md` section 4) is what commits it, carrying the `Initiative-Fix: {run-id}`
  trailer. Stage every denial with its reason — over budget, over a cap, test file, merge-sensitive
  path.

When staging a candidate, write its full proposal to `staged/wrap-up-reference-{n}.md` and name that path in the finding's `stagePath`, so the Review Console files it under Reference repairs. Pack the repair (`{old} → {new}`), the `brokenBy` path, and — at
`trusted`/`unattended` — `permittedInitiative`'s own reason string into the finding's `summary`
field. `engine-render.js`'s Change column is a plain string copy of `summary`; that column is the
only place this detail can surface on an engine-rendered console.

```js
const { permittedInitiative } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/initiative-budget.js');
permittedInitiative({
  ceiling,                                  // resolved autonomy ceiling
  fix: { kind: 'pointer-repair', files, changedLines, brokenBy },
  changedFiles,                             // git diff --name-only {base}...HEAD
  spent,                                    // fixes already applied this run
  sensitivePaths,                            // merge-sensitive-paths from policy.yml
});
```

Read `_shared/initiative-budget.md` for the floor rule, the commit discipline, the `decisions.md`
entry shape, and the error handling — all of it lives there, not here.
