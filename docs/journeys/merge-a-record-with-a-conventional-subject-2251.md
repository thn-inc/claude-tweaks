---
files:
  - plugin/bin/compose-subject.js
  - plugin/bin/lib/compose-subject.js
  - plugin/bin/lib/commit-scope.js
  - plugin/bin/lib/policy.js
  - plugin/bin/lib/release/subject.js
  - plugin/bin/lib/issues/record.js
  - plugin/bin/lib/compose-record/compose.js
  - plugin/skills/_shared/pr-first-merge.md
  - plugin/skills/_shared/local-merge-auto-finish.md
  - plugin/skills/dispatch/settle-and-merge.md
  - plugin/skills/wrap-up/auto-merge-short-circuit.md
  - plugin/skills/flow/worktree-merge.md
  - plugin/skills/dispatch/close-out.md
  - plugin/skills/specify/shaping-mode-stamping.md
  - plugin/skills/specify/spec-template.md
---

# Merge a Record with a Conventional Subject

**Persona:** A claude-tweaks maintainer whose `/claude-tweaks:flow` run has just cleared its last gate and is about to merge — either watching the terminal Review Console click through, or reading `git log` on `main` the next morning to see what landed — and who wants every merge commit to carry a subject the release engines (release-please, the local engine) can parse without a human rewriting it.
**Goal:** The merge lands on the integration branch as one commit whose subject is `feat|fix|chore[(scope)][!]: {record title} (#N)`, whose body carries a `Release-Note: {line}` paragraph, the `Fixes #N` closing keywords, and (when the record is `breaking`) a trailing `BREAKING CHANGE:` footer — composed by the plugin at merge time, identically on the pr-first and local-merge paths.
**Entry point:** Any merge site in the plugin: `_shared/pr-first-merge.md` Step 3 (`gh pr merge --squash`), or one of the four `git merge --no-ff` fences (`_shared/local-merge-auto-finish.md`, `wrap-up/auto-merge-short-circuit.md`, `dispatch/settle-and-merge.md`, `flow/worktree-merge.md`).
**Success state:** `git log -1 --format=%s` on the integration branch prints `feat: {title} (#N)` (or `fix:`/`chore:`, with `!` when breaking), the body contains a `Release-Note: {line}` paragraph (from the record's own `## Release Note` spec section — required on every record since #2580) and ends with `Fixes #N` (and `BREAKING CHANGE: {note}` last when breaking), the record auto-closes, and `/claude-tweaks:help`'s auto-merged-this-week metric still counts an automated merge because the `[{tag}]` paragraph rides in the body (a `[human-approved]` close-out merge is deliberately left out of that count).

## Steps

### 1. The merge site asks the composer for the subject — `bin/compose-subject.js`
- **URL:** `node "${CLAUDE_PLUGIN_ROOT}/bin/compose-subject.js" {n} --tag {tag} --range {base}...{head} --out-dir "{subject-dir}"` (the composer line every merge fence carries, no `eval`; the local-merge fences append `|| exit 1` because they run as one multi-line script, while a pr-first fence runs the composer as its own Bash call; `{tag}` is `auto-merge`, `auto-finish`, `fast-lane`, `manifesto-authorized`, or `human-approved` per site; pr-first sites pass `--pr {pr-number}` in place of `--range`)
- **Action:** The agent runs the fence as written. The CLI reads the record(s) with `gh issue view` (Type from the native issue type, else the `type:*` label; `breaking` from the label; the summary from `## Overview`'s first sentence, falling back to `## Current State`; the release note from the subject record's own `## Release Note` section — never aggregated across a bundle), composes the subject and body, and writes `title.txt`, `body.md` and `message.txt` into `{subject-dir}`.
- **Should feel:** Mechanical and boring — no title is typed by hand, no summary is paraphrased, no release note is written from scratch at merge time (it was already authored at spec time).
- **Should understand:** The exit status is load-bearing: a record with no resolvable Type, a `breaking` label with no `## Breaking Change` section, or **any** record in the batch with no non-empty `## Release Note` section (unconditional — not gated behind `breaking`), makes the CLI exit 1. A local-merge fence's `|| exit 1` stops it before the merge runs; a pr-first fence runs the composer as its own Bash call, and the agent stops on the non-zero exit instead of running the `gh pr merge` call. A project whose convention needs `type(scope):` sets the `commit-scope` and/or `commit-scope-paths` policy keys; every fence passes `--range {base}...{head}` (local-merge) or `--pr {pr-number}` (pr-first) so the composer can read the changed paths, an explicit `--scope {token}` overrides both, and `commit-scope-paths` set with neither also exits 1; a scope that is not one `[A-Za-z0-9._/-]+` token, or too long to leave room for the title, also exits 1. On a host that rejects `--json issueType`, the composer's silent retry prints nothing — gh's stderr is captured, so the only stdout is the single-quoted title.
- **Red flags:** A merge attempted after the composer printed an error; gh error text printed ahead of a composed subject on a successful run; a merge commit with an empty subject or a body missing its `Fixes #N` line or its `Release-Note:` paragraph.

### 2. The merge lands with the composed message — `gh pr merge --squash` or `git merge --no-ff`
- **URL:** `gh pr merge {pr} --squash -t {title-arg} --body-file "{subject-dir}/body.md"` (pr-first) or `git merge --no-ff {branch} -F "{subject-dir}/message.txt"` (local-merge)
- **Action:** The maintainer reads the resulting commit on the integration branch.
- **Should feel:** Predictable — the same grammar no matter which of the six sites produced it.
- **Should understand:** pr-first squashes so the integration branch carries exactly one conventional commit per PR (release-please walks every reachable commit); local-merge stays `--no-ff` because the local engine reads first-parent only. The title is cut at a word boundary with `…` when `{prefix}: {title}` plus ` (#N)` would exceed 72 characters; the `(#N)` suffix is never truncated.
- **Red flags:** A pr-first merge that produced a merge commit instead of a squash; a subject longer than 72 characters; a truncated `(#N)`.

### 3. A bundle merges under its most significant member — `dispatch/settle-and-merge.md`
- **URL:** `node "${CLAUDE_PLUGIN_ROOT}/bin/compose-subject.js" {n} {m} --tag auto-merge --range {integration-branch}...{branch} --out-dir "{subject-dir}"`
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
- Updated during build of #2580 (Release notes: authoring contract — unit 1 of the per-record public release-notes design) to reflect the new required `Release-Note:` paragraph and its unconditional exit-1 gate
- Updated during build of #3028 (compose-subject stderr, `--scope`, `human-approved` tag): optional `(scope)` in the grammar, the `human-approved` tag for `dispatch/close-out.md`'s confirmed merge (excluded from the auto-merged-this-week metric), and the silent `issueType` retry
- Updated during build of #3298 (merge-subject scope source): the `commit-scope`/`commit-scope-paths` policy keys, the composer-side resolution, and `--range` (local-merge) / `--pr` (pr-first) on every fence — the "pr-first only" qualifier is gone
- Updated during build of #3522 (guard-safe --out-dir merge fences): the composer writes `title.txt`/`body.md`/`message.txt` into `{subject-dir}` and every fence reads them (`-F`, `--body-file`) — no `eval`, no `--shell`
