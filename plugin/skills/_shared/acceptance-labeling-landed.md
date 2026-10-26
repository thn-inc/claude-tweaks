# Acceptance Labeling — the Landed check

The one definition of whether a PR's acceptance labeling (`demo:pending`, the Try it walkthrough)
has landed. Consumers cite it and state only what they do on each outcome — including whether they
run the live-state tier when the run dir does not resolve: `_shared/pr-first-merge.md` Step 1,
`dispatch/close-out.md` step 3, and tidy's `## Arm ready PR`.

## Resolve the run dir

Read the PR body's `claude-tweaks-run: {run-id}` marker, validating the run-id as
`flow/claim-targets.md` validates it — a marker that fails that check counts as no valid marker.
The run dir is `$RUN_ROOT/.claude-tweaks/pipelines/{run-id}/`, else
`$RUN_ROOT/.claude-tweaks/pipelines/archive/{run-id}/`. No valid marker, or neither path exists:
outcome `no run dir`.

## verify.json tier

A multi-spec PR's marker names the parent run, and `verify` writes only
`{parent}/spec-{N}/verify.json`: when the run dir has `spec-*/` subdirectories, read every
`spec-*/verify.json`; otherwise read the run dir's own. Labeling has landed only when every file
read exists and its `acceptance-labeling` row's `result` is `pass`/`skip`.

## Live-state tier

Applies when the verify.json tier read every file successfully but did not land — `verify.json
missing` or `acceptance-labeling: {result}` — and on `no run dir` only for a consumer that states it
runs the tier there. An unreadable `verify.json` is not rescued by this tier, and its outcome stays
`unreadable: verify.json`: a file that could not be read gives no evidence either way about whether
this run's labeling step ran, while a readable-but-malformed one (`acceptance-labeling: unparseable`)
shows the run reached verify. `wrap-up/verification-brief.md`'s issue pointer comment is a plain post
that duplicates on a re-run, so labeling still counts as landed when either holds:

- every record in the PR's `Fixes` lines carries `demo:pending` — at least one record, and every
  label read succeeded; an empty `Fixes` set or a failed read shows nothing;
- the PR carries a trusted `<!-- run-comment: brief -->` or `<!-- run-comment: try-it -->` run
  comment (or its multi-spec `brief:{N}`/`try-it:{N}` form; trusted per
  `_shared/pr-run-comments.md`'s Trusted authors).

The tier lands when either check positively holds; a failed read in one check does not cancel the
other check's success. A live-tier read failure yields `unreadable: {labels | comments}` only when
neither check shows landed.

## Outcomes

`landed`, or one not-landed outcome. An `unreadable: …` outcome from any tier takes precedence over
the other not-landed outcomes — a read failure is never masked; otherwise the outcome is the
run-dir / verify.json tier's:

- `no run dir`
- `verify.json missing`
- `acceptance-labeling: {result}` — the row's `result`, or `unparseable` / `row absent` for a
  malformed file
- `unreadable: {verify.json | labels | comments}`

A failed read never counts as landed.
