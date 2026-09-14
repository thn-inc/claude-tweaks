---
files:
  - plugin/bin/compose-subject.js
  - plugin/bin/lib/compose-subject.js
  - plugin/bin/lib/release/subject.js
  - plugin/bin/lib/issues/record.js
  - plugin/skills/_shared/pr-first-merge.md
  - plugin/skills/_shared/local-merge-auto-finish.md
  - plugin/skills/dispatch/settle-and-merge.md
  - plugin/skills/specify/shaping-mode-stamping.md
---

# Merge a Record with a Conventional Subject

**Persona:** A claude-tweaks maintainer whose `/claude-tweaks:flow` run has just cleared its last gate and is about to merge — either watching the terminal Review Console click through, or reading `git log` on `main` the next morning to see what landed — and who wants every merge commit to carry a subject the release engines (release-please, the local engine) can parse without a human rewriting it.
**Goal:** The merge lands on the integration branch as one commit whose subject is `feat|fix|chore[!]: {record title} (#N)`, whose body carries the `Fixes #N` closing keywords and (when the record is `breaking`) a trailing `BREAKING CHANGE:` footer — composed by the plugin at merge time, identically on the pr-first and local-merge paths.
**Entry point:** Any merge site in the plugin: `_shared/pr-first-merge.md` Step 3 (`gh pr merge --squash`), or one of the four `git merge --no-ff` fences (`_shared/local-merge-auto-finish.md`, `wrap-up/auto-merge-short-circuit.md`, `dispatch/settle-and-merge.md`, `flow/worktree-merge.md`).
**Success state:** `git log -1 --format=%s` on the integration branch prints `feat: {title} (#N)` (or `fix:`/`chore:`, with `!` when breaking), the body ends with `Fixes #N` (and `BREAKING CHANGE: {note}` last when breaking), the record auto-closes, and `/claude-tweaks:help`'s auto-merged-this-week metric still counts the merge because the `[{tag}]` paragraph rides in the body.

## Steps

### 1. The merge site asks the composer for the subject — `bin/compose-subject.js`
- **URL:** `SUBJECT_EXPORTS=$(node "${CLAUDE_PLUGIN_ROOT}/bin/compose-subject.js" {n} --tag {tag} --shell) || exit 1` then `eval "$SUBJECT_EXPORTS"` (the guarded two-line form every merge fence carries; `{tag}` is `auto-merge`, `auto-finish`, `fast-lane`, or `manifesto-authorized` per site)
- **Action:** The agent runs the fence as written. The CLI reads the record(s) with `gh issue view` (Type from the native issue type, else the `type:*` label; `breaking` from the label; the summary from `## Overview`'s first sentence, falling back to `## Current State`), composes the subject and body, and prints two `sh` assignments.
- **Should feel:** Mechanical and boring — no title is typed by hand, no summary is paraphrased.
- **Should understand:** The exit status is load-bearing: a record with no resolvable Type, or a `breaking` label with no `## Breaking Change` section, makes the CLI exit 1 and the `|| exit 1` stops the fence before any merge runs. A bare `eval "$(…)"` would have swallowed that and merged with an empty subject.
- **Red flags:** A merge attempted after the composer printed an error; a merge commit with an empty subject or a body missing its `Fixes #N` line.

### 2. The merge lands with the composed message — `gh pr merge --squash` or `git merge --no-ff`
- **URL:** `gh pr merge {pr} --squash -t "$SUBJECT_TITLE" -b "$SUBJECT_BODY"` (pr-first) or `git merge --no-ff {branch} -m "$SUBJECT_TITLE\n\n$SUBJECT_BODY"` (local-merge)
- **Action:** The maintainer reads the resulting commit on the integration branch.
- **Should feel:** Predictable — the same grammar no matter which of the six sites produced it.
- **Should understand:** pr-first squashes so the integration branch carries exactly one conventional commit per PR (release-please walks every reachable commit); local-merge stays `--no-ff` because the local engine reads first-parent only. The title is cut at a word boundary with `…` when `{prefix}: {title}` plus ` (#N)` would exceed 72 characters; the `(#N)` suffix is never truncated.
- **Red flags:** A pr-first merge that produced a merge commit instead of a squash; a subject longer than 72 characters; a truncated `(#N)`.

### 3. A bundle merges under its most significant member — `dispatch/settle-and-merge.md`
- **URL:** `node "${CLAUDE_PLUGIN_ROOT}/bin/compose-subject.js" {n} {m} --tag auto-merge --shell`
- **Action:** A dispatched group of several records merges as one commit: the title and `(#N)` come from the lowest-numbered record, the prefix from the bundle's highest-precedence Type (`feature` > `bug` > `task`), one `Fixes #` line per record, and `breaking` if any member carries it.
- **Should feel:** Nothing is lost — a feature bundled behind a lower-numbered chore still reads `feat:`.
- **Should understand:** `chore` is invisible to release-please's changelog and bump by default, so aggregating by precedence is what keeps a bundled feature from silently producing no minor bump.
- **Red flags:** A bundle containing a `type:feature` record that merged as `chore:`.

### 4. A breaking record announces itself — `/claude-tweaks:specify` shaping mode, then the merge
- **URL:** `/claude-tweaks:specify #N` (the Compatibility bullet in `shaping-mode-stamping.md`), then the same merge fence as step 1
- **Action:** When the shaped Acceptance Criteria name a contract change (a removed or renamed public flag, exported function, hook payload field, schema field, or `_shared/*.md` convention), shaping mode stamps the `breaking` label and writes a `## Breaking Change` section stating what consumers must change. At merge time the composer emits `feat!: {title} (#N)` and appends `BREAKING CHANGE: {that section}` as the body's last paragraph.
- **Should feel:** Deliberate — the label is a read of the spec's own language, never an inference from a diff, and an unlabelled record reads as "not breaking" by default.
- **Should understand:** The footer's text is the record's own section, verbatim; a `breaking` record with no section is a shaping defect that fails composition (step 1's exit 1), never a merge with an empty footer.
- **Red flags:** A `breaking`-labelled record whose merge subject has no `!`; a `BREAKING CHANGE:` line that is not the last paragraph of the body.

## Origin
- Created during build of #2251 (Merge-time conventional subject and the `breaking` label) — unit 1 of the `/claude-tweaks:release` design (#2250)
- Steps 1-4 built in this session
- Related specs: #2252 (Reconcile under squash — squash commits change the branch-pruning proof), #2254 (the local release engine reads this grammar), #2256 (the `/claude-tweaks:release` skill)
