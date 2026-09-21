# Tidy — Step 4.7 backstops: issue-claim audit-trail integrity

Step 4.7's four backstop scans, extracted from `scan-procedures.md` so they no longer count
against that file's own budget. That file keeps each `### Backstop: ...` heading as a stub
pointing here, so an external reference naming one of the four by name still resolves in one hop.

The dispatcher reads this file **whole** and inlines it into the Issue Claims agent's prompt,
directly after the rest of Step 4.7's own section in `scan-procedures.md` (the primary claim
listing) — subagents cannot read sibling files, so everything that agent needs is either there or
here. That ordering is load-bearing: every "this step's own claim listing above" reference below
means the claim listing in `scan-procedures.md`, inlined immediately before this file.

The Working-directory discipline note at the top of `scan-procedures.md`'s Step 4.7 (the
`{REPO_ROOT}` vs `{RUN_ROOT}` anchoring split) applies to every command below exactly as it does
to that step's primary claim listing — both `find .claude-tweaks/pipelines` backstops take
`{RUN_ROOT}`, the `gh issue list` backstop takes `{REPO_ROOT}`.

### Batched read: the preferred transport for the primary claim listing

**Why this exists (#2613).** A claim's live/stale/unreadable state is a binary per-issue
fact, not something a statistical sample can approximate. A standalone tidy run against this
repo's own ~1000-blob registry once sampled ~10 blobs instead of following the documented
full listing, flagged 14 issues as "no active claim," and 13 of those 14 (93%) turned out to
have real, non-expired claims — caught only because a downstream pre-write re-verification
step happened to exist. `scan-procedures.md`'s primary listing (immediately before this file
in the assembled prompt) states the rule: every blob in the keyspace gets classified, every
time this step runs. This section is where to go instead of sampling.

**When a local git checkout with network access to `claims-registry` is available** — the
common case, since this is the same git-CAS transport `_shared/issue-claims.md`'s write path
already prefers — use the batched reader instead of one `gh api`/`gh issue view` round-trip
per blob. `readClaimBlobsGitBatch` (`bin/lib/issues/claims-git-cas.js`) turns the whole
listing + read into exactly 2 subprocess calls (`git ls-tree` + `git cat-file --batch`)
regardless of registry size — the `ls-tree` call alone already IS the full keyspace listing,
so this replaces the `gh api contents/claims` call too, not just the per-blob reads:

```bash
node -e "
  const { execFileSync } = require('child_process');
  const { readClaimBlobsGitBatch, CLAIMS_BRANCH } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/claims-git-cas');
  const scratchRef = \`refs/claims-audit-read/\${process.pid}-\${Date.now()}\`;
  execFileSync('git', ['fetch', '-q', 'origin', \`\${CLAIMS_BRANCH}:\${scratchRef}\`]);
  const tip = execFileSync('git', ['rev-parse', scratchRef], { encoding: 'utf8' }).trim();
  execFileSync('git', ['update-ref', '-d', scratchRef]);
  const { results, failure } = readClaimBlobsGitBatch({ tip });
  if (failure) { console.error(failure); process.exit(1); }
  console.log(JSON.stringify(results));
"
# {results} maps issueNumber -> {content, tipSha, absent, failure} — feed each
# entry's .content (when not absent/failure) into "The lock" steps 1-2's
# CLASSIFY_INPUT exactly as scan-procedures.md's per-blob form does, then
# gh issue view <n> --json state -q .state for each surviving number.
```

Falls back to `scan-procedures.md`'s per-blob `gh api` form only when no local git access to
`claims-registry` exists (a contents-API-only sandbox, or no git remote reachable).

---

### Backstop: missed `parked` restoration

Find materialized build-time headers (`flow/materialize.md`) that recorded `parked-at-shaping:
true` but never got the restoration finished — a defense-in-depth flag for a mutation that
silently failed at claim release (`wrap-up/cleanup-procedures-execution.md` Section E, step 7), same shape
as the `bot:in-progress` missed-removal backstop below. Both checks below are flagged only —
recommendations execute after Step 6 batch approval, same as every other Step 4.7 mutation.

Materialized headers are committed, never gitignored (`flow/materialize.md`'s "Committed as
audit trail" section), so they survive on disk at `.claude-tweaks/pipelines/**/work/*-spec.md`
(single-record runs) and `.claude-tweaks/pipelines/**/spec-*/work/*-spec.md` (multi-record
runs) — in both live and archived (`.claude-tweaks/pipelines/archive/`) run directories:

```bash
cd "{RUN_ROOT}" && find .claude-tweaks/pipelines -path "*/work/*-spec.md" 2>/dev/null | while read -r header; do
  grep -q "^parked-at-shaping: true$" "$header" || continue
  n=$(grep -m1 "^record:" "$header" | sed 's/^record: *//')
  [ -z "$n" ] && continue
  gh issue view "$n" --json state,labels,closedByPullRequestsReferences
done
```

(`closedByPullRequestsReferences` is a native `gh issue view --json` field — no raw GraphQL
needed; the issue-side mirror of `closingIssuesReferences`, which `_shared/github-pr-scan.md`
already reads from the PR side via `gh pr view --json`.)

For each result: flag as a likely missed restoration when the issue is `OPEN`, its labels do
not include `parked`, `closedByPullRequestsReferences` is empty (no linked PR, open or
merged — a linked PR means the outcome was `merged:`/`pr-opened:`, where skipping restoration
is correct behavior, not a missed one), and it has no active claim (cross-reference against
this step's own claim listing above — blob classified `'live'` for `claims/issue-{n}.json`).
Recommend the same `gh issue edit {n} --add-label parked` command the release step itself
would run.

→ Collect each as: `[claim] issue #{n} — materialized header {path} has parked-at-shaping: true, no parked label, no active claim, no linked PR — likely missed parked restoration`

### Backstop: missed `bot:in-progress` removal

```bash
cd "{REPO_ROOT}" && gh issue list --label bot:in-progress --state open --json number,title -q '.[] | "\(.number) \(.title)"'
```

For each result, cross-reference against this step's own claim listing above: flag as a likely
missed removal when the issue carries `bot:in-progress` but has no active claim (`claimed &&
!stale`) for its number. Recommend the same `gh issue edit {n} --remove-label bot:in-progress`
command the release step itself would run.

→ Collect each as: `[claim] issue #{n} — bot:in-progress present, no active claim — likely missed bot:in-progress removal`

### Backstop: empty decisions.md on a completed standalone run

Same audit-trail-integrity concern as the two backstops above, applied to every standalone-auto
run directory on disk — this includes the human-gate skills' runs (`/claude-tweaks:backlog`,
`/claude-tweaks:dispatch`), but also `/tidy`'s own past
standalone-auto firings, `/claude-tweaks:init`, and `/claude-tweaks:capture` (the full
standalone-auto allowlist per `_shared/run-dir-resolution.md`'s step 4 — all five skills use the
identical `{ISO-timestamp}-{skill-name}-standalone` naming, and the glob below has no
skill-name filter, so it matches all of them equally). A `worktree-always`-blocked or otherwise
silently-skipped log write leaves no trace anywhere except an empty file:

```bash
cd "{RUN_ROOT}" && find .claude-tweaks/pipelines -maxdepth 1 -type d -name "*-standalone" 2>/dev/null | while read -r RUN_DIR; do
  STATUS=$(node -e "try{console.log(JSON.parse(require('fs').readFileSync(process.argv[1]+'/run-state.json','utf8')).status)}catch(e){console.log('unknown')}" "$RUN_DIR")
  [ "$STATUS" = "clean" ] || continue
  SIZE=$(wc -c < "$RUN_DIR/decisions.md" 2>/dev/null || echo 0)
  [ "$SIZE" -eq 0 ] && echo "$RUN_DIR"
done
```

A standalone-auto run whose `run-state.json` reports `clean` (completed) but whose `decisions.md`
is empty means either the skill that ran there took auto-decisions with no audit trail (forbidden
per `_shared/auto-decision-log.md`'s Anti-Patterns table) or the run genuinely made zero
auto-decisions (legitimate — e.g. a `/backlog refine` session where every row was flagged back). File
state alone can't distinguish the two; flag for manual review rather than auto-resolving either
way.

→ Collect each as: `[claim] {run-dir} — clean standalone run, empty decisions.md — possible skipped audit-log write (manual review)`

### Backstop: preserved but unfiled upstream feedback drafts

`/claude-tweaks:feedback`'s Step 8 preserves a draft as `staged/upstream-unfiled-{N}.md` when
filing fails — deliberately outside the `staged/wrap-up-upstream-*.md` glob the consoles
re-enumerate, so a resume never re-files it, and there is no automatic retry. Enumerate every
surviving preserved draft, live and archived, `find`-only (run dirs are gitignored):

```bash
cd "{RUN_ROOT}" && find .claude-tweaks/pipelines -path "*/staged/upstream-unfiled-*.md" 2>/dev/null
```

For each match:

- **Run id** — the path segment naming the run directory (one level under `pipelines/archive/`
  for an archived run, directly under `pipelines/` for a live one).
- **Title** — the file's first `**Summary:**` line (the field `feedback/SKILL.md` Step 5's draft
  template guarantees on every drafted body); when absent, `{filename} (run {run id})`.
- **Age** — parse the run id's leading `{ISO-timestamp}-{slug}` prefix and report elapsed time;
  `age unknown` when the run id doesn't parse as one.
- **Live-run check** — a path under `pipelines/archive/` is archived, no further check needed.
  Otherwise read that run's `run-state.json`: a `status` in `run-integrity.js`'s `NON_TERMINAL`
  set (`active`, `interrupted`) means the run is still live.

A live, non-terminal run's draft gets the annotation "run still live — leave unless abandoned"
in place of the two action options below — the race with an active session is accepted, since
every action here is a human paste and nothing destructive runs automatically. Every other match
(archived, or live-but-terminal) gets two paste-ready commands, each on its own line:

    /claude-tweaks:feedback re-file the preserved draft at {abs path}
    rm '{abs path}'

No matches at all: report "0 unfiled upstream drafts" explicitly — a scan that ran and found
nothing is a different fact from a scan that never ran.

→ Collect each as: `[unfiled] {title} (run {run id}, {age}) — {abs path} — re-file or discard (see options above)` — or, for a live non-terminal run, `[unfiled] {title} (run {run id}, {age}) — {abs path} — run still live, leave unless abandoned`
