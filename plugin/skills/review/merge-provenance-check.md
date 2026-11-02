# Merge-Provenance Check — /claude-tweaks:review Step 2

Read from `code-mode-steps.md`'s Step 2 only when the detect command there reported at least one merge commit on a branch scope. With no merge commits the check is a no-op and this file is never read. A `base:{ref}` scope never reads this file: its range is the integration branch's own line, where a merge is how a PR shipped.

Before analyzing the diff, check whether the integration branch was merged into this branch mid-history — content that arrived via such a merge should not be misattributed as work this branch introduced. This was caught concretely during the #45 native-review prototype: a CHANGELOG entry that actually rode into the branch via a merge from `main` was flagged as if it were part of this branch's own work, and was only correctly attributed by manually tracing merge-commit parentage.

Resolve `{integration-branch}` per `_shared/integration-branch.md` and run `git fetch origin {integration-branch}` (a failed fetch is not fatal; the commands read the last-fetched ref). Then run this as its own call. What it prints is `{fork}`, pasted literally into the next block:

```bash
git merge-base {branch} origin/{integration-branch}
```

Each of these is its own call:

```bash
git rev-list --first-parent {branch} | grep -Fx {fork}   # fork on this branch's own line
git diff {fork} {branch} --name-only                     # branch-side files
git diff {base}...{branch} --name-only                   # full diff files
```

`{base}`/`{branch}` reuse whatever base-branch resolution the rest of this step already uses (the base branch, or the fallback ladder from Input resolution rule 7 — `_shared/scope-resolution.md`) — no new base-resolution logic needed.

- **Excluded files** are those in the full diff and absent from the branch-side list: their content at `{branch}` is what the integration branch held at the fork point. Report them separately ("arrived via merge from {integration-branch}, not this branch's own work"), stating the count of files/lines excluded and why, feeding Step 7's summary. Do not fold them silently into "what changed." With none, add no report section.
- **Nothing is excluded without that evidence.** When the first command prints `{fork}`, it is on this branch's own first-parent line: the branch extends that line rather than having merged it, so nothing is excluded. When `git merge-base` prints nothing, or `{integration-branch}` does not resolve, there is no fork point, nothing is excluded, and the raw `git diff` scope stands. Absence from a first-parent walk proves nothing: another branch merged in ships with this one, and so does a merge commit's own edit.
- The **own-work scope** — the full diff minus the excluded files, not the raw `git diff` scope — is what feeds the change analysis below, and what Step 3's lens dispatch and Step 3.5's debate dispatch review.

"The change analysis below" is the diff-shape analysis in `code-mode-steps.md`'s Step 2, which resumes after this check; Step 5 (`/claude-tweaks:simplify`) takes the same own-work scope.
