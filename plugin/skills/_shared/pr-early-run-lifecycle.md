# PR-Early Run Lifecycle — draft PR at run start, phase-checklist updates

Canonical procedure for making a `pr-first` (`_shared/integration-model.md`) pipeline run
**born public**: a draft PR opens immediately after the worktree exists and the materialize
commit lands, before any implementation work — not only when a run happens to reach
`pending-review` (`docs/incident-log.md`'s `[IL-128]` records the narrower, dispatch-only
procedure this generalizes and replaces). Every later phase exit pushes
(`_shared/git-discipline.md`'s Phase-exit push section) and updates the PR's phase checklist, so
the PR always reflects live progress rather than only the state as of run start or only the state
as of `pending-review`.

<!-- when: integration-model=local-merge -->
`local-merge` runs (`_shared/integration-model.md`) skip this file entirely — today's no-PR
lifecycle, unchanged.
<!-- /when -->

## Root cause: MCP PR-body sanitization strips HTML comments on read, not write (#929)

Confirmed against `github/github-mcp-server`'s own source (`gh api repos/github/github-mcp-server/contents/...`), 2026-08-22:

- **Write path is unsanitized.** `pkg/github/pullrequests.go`'s `CreatePullRequest` and
  `UpdatePullRequest` set the PR body straight from the raw tool-call parameter
  (`newPR.Body = github.Ptr(body)` / `update.Body = github.Ptr(body)`) — no sanitize call.
  A PR created or edited via `mcp__github__create_pull_request`/`update_pull_request`
  stores the body on GitHub byte-for-byte, HTML comments included.
- **Read path is sanitized.** `pkg/github/minimal_types.go`'s `convertToMinimalPullRequest`
  calls `Body: sanitize.Sanitize(pr.GetBody())` before returning a PR to the calling LLM
  (`GetPullRequest`, the tool behind `pull_request_read get`). `pkg/sanitize/sanitize.go`'s
  `getPolicy()` builds a `bluemonday.StrictPolicy()` with an explicit `AllowElements(...)`
  list that never includes comments and never calls `AllowComments()` — `FilterHTMLTags`
  therefore strips every `<!-- ... -->` span. This is a prompt-injection defense (hidden
  HTML comments are a classic vector for smuggling instructions into content an LLM later
  reads back), not a GitHub API/storage behavior.

**Consequence:** a PR opened via MCP on a `gh`-absent sandbox genuinely carries the
`<!-- claude-tweaks-run: -->` / `<!-- phases-start -->` / `<!-- phases-end -->` markers on
GitHub's stored body — but any later read of that same PR *through the MCP transport*
(`pull_request_read`, or the implicit re-fetch inside `update_pull_request`) returns a body
with those markers invisibly gone, even though a `gh pr view`/REST read of the identical PR
would show them intact. A gh-absent phase-checklist-update or reconciler pass that reads via
MCP therefore has nothing to find-and-replace between, even though the markers are really
there. The fix is not "make the MCP server stop sanitizing" (the sanitization is a
deliberate, reasonable defense) — it's to also carry a plain-text companion form that never
looks like an HTML tag to the sanitizer in the first place, so it survives the MCP read path
unchanged. See "Dual-marker scheme" in Step 3 below.

<!-- when: transport=mcp -->
**Scope extends to issue reads, not just PR reads (#1700).** The same `bluemonday.StrictPolicy()`
strips `<!-- ... -->` spans from `mcp__github__list_issues` and `mcp__github__issue_read` results
too — confirmed live (2026-08-30): fetching a batch of `by:docs-health` issues via both
`list_issues` (labels filter, no state filter) and `issue_read` (`get` method, one issue
specifically) returned every `body` with its `<!-- work-fingerprint: ... -->` marker stripped,
while a `gh`-based read of the identical issues (this project's own filing convention always
appends that marker as the body's literal last line) showed it intact — the same live-verification
method used above for PR bodies. `_shared/health-issue-index.md` documents the consequence for
health-sweep dedup and the fix (`bin/lib/issues/record.js`'s plain-text `work-fingerprint:`
companion line, mirroring this file's own dual-marker scheme) rather than restating it here.
<!-- /when -->

## Callers

| Caller | Invokes from |
|---|---|
| `build/worktree-setup.md` Step 6 | Once per run, immediately after `build/SKILL.md` Spec Step 1's materialize commit, before Spec Step 2 |

Phase-checklist updates and the pre-merge title/description refresh moved to
`_shared/pr-checklist-refresh.md` (#2002) — its own Callers table lists that file's callers
(every phase's own skill file, and `_shared/pr-first-merge.md`'s Step 2/Step 2.5).

## Run start: push, then open (or reuse) the draft PR

### Step 1: Resolve identity and check for an existing PR

Resolve `{host}/{owner}/{repo}` once: `gh repo view --json nameWithOwner,url`. Then check
`run-state.json`'s `pr` field first (a resumed run already recorded one) — if present, skip
straight to "Resume: reconcile a recorded PR" below instead of re-deriving from scratch.

No recorded `pr` field: check GitHub directly before creating anything, so a resumed or retried
run against the same branch never duplicates:

```bash
gh pr list --repo {host}/{owner}/{repo} --head {branch} --state all --json number,url,state,isDraft
```

- **A match with `state: OPEN`** (draft or not): reuse it. Record via `record-pr` (below) and
  skip PR creation. **Never flip an already-non-draft open PR back to draft** — log the reuse and
  move on.
- **A match with `state: CLOSED`**: this is a retry — by construction, nothing else in this
  design closes a run's PR except `_shared/pr-run-comments.md`'s failure tombstone (a prior
  attempt's HARD-GATE failure). Reopen it rather than starting fresh, so the new attempt's
  comments land in the same thread as the prior failure(s):

  ```bash
  gh pr reopen {number} --repo {host}/{owner}/{repo}
  ```

  **Reopen succeeds:** record via `record-pr` and skip creation, same as the OPEN branch above.
  Log: `AUTO {time} — PR-early run lifecycle: reopened PR #{number} for retry. Reversibility: high.`

  **Reopen fails** (the branch was force-pushed out from under it, or some other state GitHub
  rejects): fall through to creation below. The fresh PR reuses the same title/body template;
  its new number/url overwrites the stale one via `record-pr` (Step 4), and — only if a pointer
  comment already exists on the issue from an earlier attempt that reached far enough to post one
  (Verification Brief routing, `_shared/pr-run-comments.md`) — update that pointer comment to the
  new PR via the same find-and-update-by-marker shape, since it would otherwise link to a closed,
  now-orphaned PR. A failed HARD-GATE run never reaches the brief, so this update is usually a
  no-op — stated for the rare case a later phase's own failure follows an earlier phase's partial
  progress.
- **A match with `state: MERGED`**: this branch's PR already merged — the record is done. Treat
  as no match and fall through to creation; a fresh run against an already-merged branch is an
  unexpected precondition this file does not need to specially handle beyond not erroring.
- **No match**: fall through to creation.

**Why a stale-branch collision can't reach this step (#767, #1470).** This procedure runs against
whatever branch name `build/worktree-setup.md` Step 2 already created — and that step's own Step
1.5 (Stale same-name branch check) removes a leftover same-name local branch from a prior
closed-unmerged attempt *before* `EnterWorktree` ever creates the new one. Before that check
existed, a same-name retry risked reopening the CLOSED PR found above (this step) ahead of Step
2's push, then having that push rejected non-fast-forward — leaving a reopened PR pointing at
stale content with no automatic re-close. Step 1.6 (Remote-only stale branch check) closes the
same gap in the other direction — a same-name branch left on `origin` by a prior attempt on a
*different* machine or sandbox, invisible to Step 1.5's local-refs-only check — by stopping for a
human decision before `EnterWorktree` ever runs, rather than letting it surface only via this
step's own reopen logic or a later rejected push. With both collision directions closed at their
root, the branch this step queries is always freshly created, so `gh pr list --head {branch}` only
ever matches a PR this exact run itself opened (resume case) — the CLOSED-match reopen branch above
still exists for that legitimate resume, just never for a same-name-collision retry anymore.

### Step 2: Push the branch

```bash
git -C "{worktree-path}" push origin {branch}
```

Its own Bash call — never chained (the `worktree-always` gate denies a compound command whole,
same as every other push in this plugin).

**On success: this log line is mandatory, not optional — write it before moving on to Step 3,
for the same reason the failure line below is (#838, #1356's Current State: a run that skips it
leaves no way to distinguish "Step 6 hasn't run yet" from "Step 6 ran and this is fine").** Log
to `decisions.md`:

`AUTO {time} — PR-early run lifecycle: pushed {branch} to origin. Reversibility: high (branch can be reset/force-pushed).`

**On a transient-looking failure** (the error text names a 5xx/server error, a timeout, a reset
connection, or otherwise names no auth/ref problem — e.g. GitHub's push-receive endpoint or its
backing GraphQL API returning a `503`) — retry **once** after a 15-second wait, then treat a
second failure exactly like any other failure below. This is a narrower, faster retry than
`_shared/github-rate-limit.md`'s 45-90s window on purpose: that file's recognition taxonomy is
scoped to rate-limit signatures (403/429), not a server-side 5xx/503 outage, which self-heals on
a much shorter horizon and isn't a case that file's classification table covers — don't route
this retry through it.

**On failure** (network, auth, no `origin` remote, rejected non-fast-forward, or the retry above
also failed): stop here. **This log line is mandatory, not optional — write it before moving on,
even under time pressure or mid-incident; a run that skips it leaves a missing `pr` object with
no diagnosable trail (#838's Current State: exactly this happened to run
`2026-08-17T164729-record-81`, whose `decisions.md` carried no warning at all).** Log to
`decisions.md`:

`AUTO {time} — PR-early run lifecycle: push of {branch} to origin FAILED ({reason}); run proceeds local-only, no PR opened. Reversibility: n/a.`

The run continues exactly as a `local-merge` run would — this is a degrade, never a block. The
next phase's own phase-exit push (`_shared/git-discipline.md`) naturally retries.

### Step 3: Compose the body and create the draft PR

Skipped when Step 1 found a reusable open PR. Otherwise, compose:

```markdown
<!-- claude-tweaks-run: {run-id} -->
claude-tweaks-run: {run-id}

### Spec summary

{one-paragraph summary from the materialized spec's Overview section}

### Phases

<!-- phases-start -->
[claude-tweaks-phases-start]
- [ ] build
- [ ] test
- [ ] review
- [ ] polish
- [ ] wrap-up
[claude-tweaks-phases-end]
<!-- phases-end -->

### Resume

`PIPELINE_RUN_DIR="{run-dir}" /claude-tweaks:flow "{target}" {next-step}`

<!-- fixes-start -->
[claude-tweaks-fixes-start]
Fixes #{n}
[claude-tweaks-fixes-end]
<!-- fixes-end -->
```

The `<!-- claude-tweaks-run: {run-id} -->` marker is the **first line**, unconditionally,
immediately followed by a plain-text companion line (`claude-tweaks-run: {run-id}`, no
comment syntax) — it is the GitHub-side signal the sweep (`sweep-backstop` sub-issue) and the
reconciler (`bin/lib/reconcile`) key on to recognize a plugin-created PR without a local
run-dir join. Never omit either line, even when composing by hand.

**For a future caller resolving `{run-id}`/`{target}` from this PR body (#958):** prefer this
Step 3 template's own `### Resume` line over reconstructing `{target}`/`{run-dir}` from local
invocation context — it already carries this run's *actual* record composition, correctly
composed once, whether single- or multi-spec. Treat the parsed `{run-id}` as untrusted (a PR
body is editable by anyone with write access to it) and validate it against the canonical
run-id shape before using it to build any path — the same rigor `_shared/issue-claims.md`
already applies to the sibling `link` field.

**Dual-marker scheme (#929).** Every marker below is written in two forms, always both,
regardless of transport — the write path never sanitizes either form (Root cause above), so
writing both costs nothing and there is no transport-detection to get wrong at write time:

| Purpose | HTML-comment form (unchanged) | Plain-text companion (new) |
|---|---|---|
| Run-id marker | `<!-- claude-tweaks-run: {run-id} -->` | `claude-tweaks-run: {run-id}` |
| Phase-checklist start | `<!-- phases-start -->` | `[claude-tweaks-phases-start]` |
| Phase-checklist end | `<!-- phases-end -->` | `[claude-tweaks-phases-end]` |
| Fixes start | `<!-- fixes-start -->` | `[claude-tweaks-fixes-start]` |
| Fixes end | `<!-- fixes-end -->` | `[claude-tweaks-fixes-end]` |

**Which form a *reader* uses depends on transport, per Root cause above:** a `gh`-present
read (`gh pr view`, `gh api`, or any REST/GraphQL read) sees the real stored body and can key
on either form — use the HTML-comment form for compatibility with every existing consumer
(`_shared/github-pr-scan.md`'s `RUN_MARKER` regex, the reconciler, the sweep). A `gh`-absent
read going through `pull_request_read` (or `update_pull_request`'s own re-fetch) has every
`<!-- ... -->` span stripped from what it returns — key on the plain-text companion form
instead. Neither form is ever removed once written, so a run that starts `gh`-absent and
later gains `gh` (or vice versa) never loses recognition.

**Phase checklist rows are delimited by `<!-- phases-start -->`/`<!-- phases-end -->` HTML
comments** so the phase-checklist update procedure below can re-compose reliably (read body,
replace only the content between the markers, write back) instead of parsing prose. Both
delimiter pairs bracket the same checklist rows — the HTML-comment pair outermost, the
plain-text pair immediately inside it (see the template above) — so either reader finds an
unambiguous, non-overlapping span to replace. Start every row unchecked — `- [ ] {phase}` —
even for steps this run's step-list argument will skip (e.g. `no-polish`); a skipped phase's
row is removed at that phase's own would-be exit rather than predicted at creation, since Step
1's own step-list resolution can still change before then in `interactive`/`hybrid` mode.

Omit a `polish` row when the record's `surface:` is `backend` (polish never runs) — the same
frontend/backend split `flow/steps-and-gates.md`'s own polish decision tree already makes; don't
duplicate that logic, just skip the row when it will never happen.

**One `Fixes #{n}` line per record.** A single-record run gets one line. A dispatch bundle
(`dispatch/SKILL.md`'s file-overlap grouping) enumerates every record from the parent
`manifest.yml`'s `specs[].id` list and lists one `Fixes #{m}` line per record — provisional
(#2015). Unlike the retired
dispatch-only durability procedure this file replaced (`docs/incident-log.md`'s `[IL-128]`),
whose PR opened only when a run already reached `pending-review` (i.e. after `review`'s gate
already passed) and used `Refs`, this PR opens **before any gate has run**, and it stays in
draft the whole time gates are still pending — GitHub blocks merging a draft by default, so
`Fixes` sitting inert in a draft body is safe. It only becomes live once the merge-path sub-issue
marks the PR ready after gates pass.

`{target}` and `{next-step}` in the Resume line: `{target}` is the same record reference(s) this
run was invoked with (`#{n}` or the bundle's comma-joined list). `{next-step}` is the step this
run is *about* to execute — `build` at run start, since this procedure runs before any phase.

Write the body to `/tmp/pr-early-body-{run-id}-{n}.md` — scoped by this run's own `{run-id}`
(the run-dir basename), not just the issue number, so a retried run's fresh write can never
land on a stale file a prior attempt left at a fixed `{n}`-only path (worse on Windows, where
`Write` and `Bash` can resolve `/tmp` differently). Before invoking `gh pr create`, re-read the
file's first line back and confirm it is `<!-- claude-tweaks-run: {run-id} -->` for *this run's*
`{run-id}` — second line of defense; hard-stop this step on a mismatch rather than push a wrong
body.

```bash
gh pr create --repo {host}/{owner}/{repo} --draft --base {integration-branch} --head {branch} \
  --title "{record title} (#{n})" --body-file /tmp/pr-early-body-{run-id}-{n}.md
```

`{record title}` — the lowest-numbered record's title for a bundle; `{n}` likewise the
lowest-numbered record.

**On success: this log line is mandatory, not optional — write it before moving on to Step 4,
for the same reason Step 2's success line is (#1356).** Log to `decisions.md`:

`AUTO {time} — PR-early run lifecycle: opened PR #{number} for {branch}. Reversibility: high (gh pr close).`

**If creation fails, retry once** — wait 15 seconds first when the failure looks transient (a
5xx/server error or timeout, same signature as Step 2's push retry above), immediately otherwise.
**If the retry also fails: log and continue local-only — this log line is mandatory, not
optional, for the same reason Step 2's is (#838)**, and it is mandatory for a second, mechanical
reason: the bookkeeping-stamps gate (`docs/hooks.md`) releases a PR-less run only when
`decisions.md` already carries a degrade line matching `PR-early run lifecycle: … FAILED`. Step 2
has already pushed by this point, so #989's one-shot initial-publish exemption no longer applies —
without this exact line, every later covered write or push in the run is denied outright. Write it
verbatim, keeping the literal token `FAILED`:

`AUTO {time} — PR-early run lifecycle: gh pr create for {branch} FAILED ({reason}); run proceeds local-only, no PR opened. Reversibility: n/a.`

Do not reuse Step 2's push-failure wording here — the push succeeded; only creation failed. The
branch is already on origin from Step 2 either way.

### Step 4: Record the PR

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" record-pr {number} {url}
```

Writes `run-state.json`'s `pr: { number, url }` field through the sanctioned write path — the
same `record-worktree`/`close-run` precedent (CLAUDE.md's Hooks section: run-state is written
only through `hooks.js` verbs). Resolves the target run dir the same way `record-worktree` does
(`--run "$RUN_DIR"` explicit, or the fallback resolver) — pass `--run` explicitly here too, for
the same reason `build/worktree-setup.md` Step 4.5 already states: a stale never-closed run
elsewhere in the project can otherwise win the fallback resolution.

## Resume: reconcile a recorded PR

A resumed run (`run-state.json.pr` already set from an earlier phase of the same run) re-verifies
before trusting the recorded value — the PR could have been closed or the branch force-pushed
out from under it since:

```bash
gh pr view {recorded-number} --repo {host}/{owner}/{repo} --json state,isDraft,url
```

- **Still open**: nothing to do — proceed to whichever phase this resume targets.
- **Closed or gone** (404): the recorded PR is stale. Fall through to Step 1's `gh pr list --head`
  check above — reuse a different open PR for the branch if one exists, otherwise create a fresh
  one (Step 3) and re-`record-pr` (Step 4) to overwrite the stale value. Log:

  `AUTO {time} — PR-early run lifecycle: recorded PR #{old} no longer open; {reused #{new} | created #{new}}. Reversibility: high.`

## Phase-checklist update and pre-merge title/description refresh — moved

Both moved to `_shared/pr-checklist-refresh.md` (#2002), which now carries the "Phase-checklist
update (every phase exit)" and "Pre-merge title/description refresh" sections in full — read
there. They moved out of this file so the two merge-time compose call sites
(`wrap-up/auto-merge-short-circuit.md`, `wrap-up/review-console.md`) no longer need to compose
this file's run-start-only Steps 1-4, Root cause, and Resume sections (below and above) just to
reach that content — this file alone was 30+ KB of the ~57-60 KB the `merge` composed bundle
measured, most of it never read again after run start.

## Skip / degrade behavior

| Condition | Behavior |
|---|---|
| `integration-model: local-merge` | Skip this entire file — today's no-PR lifecycle. |
| Push at run start fails | Local-only run, logged warning (Step 2 above), continue. Every later phase-exit push retries naturally. |
| Push or `gh pr create` fails with a transient-looking (5xx/timeout) signature | One 15-second-backoff retry (Step 2/Step 3 above) before falling through to the corresponding row's degrade — a 503-class outage self-heals fast enough that most retries succeed without ever reaching a logged degrade. |
| `gh pr create` fails twice | Local-only run (branch already pushed), logged warning, continue. |
| `gh` absent | No longer a degrade (#929) — `mcp__github__create_pull_request`/`update_pull_request` is the documented fallback (`_shared/github-write-transport.md`'s Pull Request create/update exception), using the same dual-marker template as the `gh`-present path. Only a genuine MCP write failure degrades, logged the same as any other Step 2/Step 3 failure above (`reason: gh-absent — mcp__github__create_pull_request failed: {error}`). |
| Offline / no `origin` remote | Same degrade path as any push failure — `_shared/forge-detection.md` would already have resolved `local-merge` for a no-remote project, so this case is specifically "remote configured but unreachable right now." |

The merge-time `gh` absent row (`_shared/pr-first-merge.md` Step 2.5) moved to
`_shared/pr-checklist-refresh.md`'s "Merge-time gh-absent degrade" section (#2002) — that
procedure runs at merge time, never at run start, so it belongs with the other merge-time-only
content that moved there.

None of these ever block the pipeline — a pr-first project whose GitHub connectivity is degraded
for one run behaves exactly like a `local-merge` run for that run, with the degradation logged
rather than silent.

<!-- when: integration-model=local-merge -->
**`local-merge` row specifically (`build/SKILL.md` Spec Step 1's documented conditional action):**
this is the one row above with no existing log line of its own — every connectivity-degrade row
already writes its own `AUTO … FAILED` line (see the citations above) and keeps doing so unchanged.
Write one `SKIP` entry per `_shared/auto-decision-log.md`'s degrade-trace rule:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/log-decision.js" --run "$PIPELINE_RUN_DIR" --status SKIP \
  --section "/build" --step "Spec Step 1 draft-PR bootstrap (skipped)" \
  --text "condition: integration-model=local-merge → fallback: no draft PR opened" --reversibility n/a
```

Standalone `/build` (no run dir): list the skip in the Step 7 handoff instead (`build/handoff-template.md`'s inline-skip listing).
<!-- /when -->
