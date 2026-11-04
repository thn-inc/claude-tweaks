# Backlog Refine (Headless Posture) — GitHub MCP Transport (`gh` absent)

Loaded by `/claude-tweaks:backlog refine`'s grant sub-stage — reached headlessly via `--source
routine|sweep`, or via the deprecated `grant` alias, which forces the same headless posture
(`refine-headless.md`) — when Preflight's Detection Ladder check 2 resolves `gh` as absent
(`backlog/SKILL.md`'s grant sub-stage Preflight paragraph). Every call site in
`refine-headless.md` runs its `gh` CLI form unchanged when `gh` is present, so a normal run never reads
this file.

**Verification status: documented, not verified.** Unlike `dispatch/mcp-transport.md` (verified
against a live cloud run — the bridge plan's Task 10 — before its own check-2 gate was flipped from
a hard gate to a branch), none of the mappings below have been run against a live cloud sandbox as
of this writing. Treat every mapping here as the intended path, not a confirmed one, until a live
run verifies it — the same ordering discipline `dispatch/mcp-transport.md`'s own Gotchas paragraph
names: this record ships the mapping doc and flips `backlog/SKILL.md`'s gate together, but "flipped"
here means "branches to this doc," not "verified end-to-end" the way dispatch's flip was.

CRUD mappings throughout are per `_shared/github-write-transport.md`, cited rather than restated.

---

## Step 1 + Step 2 Phase A — ready-queue fetch and gates 1-3

**This call site is structurally different from every other one in this file.** `refine-headless.md`'s
Step 1 + Step 2 Phase A run as a single invocation of `bin/backlog-grant-gate.js`, which hard-gates
on `gh` itself — `deps.ghAvailable()` → stderr `` `gh` is required `` → exit 2 — before it ever
reaches `computeOutlook`'s injectable `runner`/`gitRunner` parameters. Unlike a prose-level `gh`
call in a skill file, this CLI is not invocable at all when `gh` is absent; there is no MCP-backed
`runner` wired into it today.

The underlying fetch/compute split is still usable, because the compute half is pure. Everything
`computeOutlook` does past the initial fetch — `bin/lib/backlog-grant-gate/backlog-grant-gate.js`'s
`filterCandidates` and `computePhaseA`, `bin/lib/issues/backlog.js`'s `machineGrantOutlook`, and
`bin/lib/issues/trust.js`'s `trustRows`/`parseGitLog` — takes already-fetched data as plain
arguments, never a runner. The `gh`-absent path bypasses `bin/backlog-grant-gate.js` entirely and
reproduces its two halves separately, with no new module (every function above is already
exported):

1. **Fetch, via MCP:**
   - Ready-labeled candidates → `_shared/github-write-transport.md`'s "List open issues by label"
     row (`list_issues`, `label: "ready"`, `state: "open"`), shaped to the fields
     `CANDIDATE_FIELDS` names (`number,title,body,labels,createdAt`).
   - The historical `--state all` record set (trust rows' input) → the same row, `state: "all"`,
     shaped to `record-snapshot.js`'s `UNION_FIELDS` — `_shared/record-queue-fetch.md`'s
     session-scoped snapshot still applies on this transport; a fresh MCP `list_issues` call reads
     into that same cache rather than bypassing it.
   - Sub-issue numbers, only relevant when `work-links: native`: no MCP equivalent exists for the
     native sub-issues API (`_shared/github-write-transport.md`'s PR-scoped gap note is the same
     shape of gap — an uncovered read, not a write). Under `gh`-absent, always take
     `resolveSubIssueNumbers`'s non-native, body-parse fallback branch (`parseSubIssues` over the
     already-fetched `--state all` bodies) regardless of the project's `work-links` policy value —
     it needs no extra call beyond the fetch above.
   - Git log → unaffected by `gh` presence at all: `fetchGitLog` shells `git`, not `gh`, so it runs
     identically on both transports. No MCP mapping needed here.
2. **Foreign blockers, via MCP (#4793):** `filterCandidates`' third argument is required, so the
   `gh`-absent path computes it the way the CLI does. Run `filterCandidates(issues, openNumbers,
   new Map())` for the cheap survivors, read each survivor's body-declared foreign refs (`Blocked by
   owner/name#N` lines) with `issue_read` (`get` method), and build one states object keyed
   `owner/name#N`, each value copied from `issue_read`'s `state` (any case) or `null` for a ref it
   cannot read. Build the Map with `bodyForeignBlockers(cheapSurvivors, { states })`
   (`bin/lib/issues/cross-repo-states.js`) and pass it as the third argument of the second
   `filterCandidates` call. A ref left out, or `null`, still blocks (fail closed).
   `overview-mode.md`'s funnel on this transport passes the same `{ states }` to its
   `bodyForeignBlockers` call.
3. **Compute, locally, no MCP call:** feed the fetched JSON into `filterCandidates` →
   `computePhaseA` / `machineGrantOutlook` / `trustRows` directly, via a `node -e` snippet
   `require`-ing `bin/lib/backlog-grant-gate/backlog-grant-gate.js` and `bin/lib/issues/backlog.js`
   — the same pure logic `bin/backlog-grant-gate.js` runs, called with MCP-sourced data instead of
   `gh`-sourced data.

This reproduces the CLI's outcome rather than a rewritten one — a live run should confirm the MCP
`list_issues` field shapes line up with `CANDIDATE_FIELDS`/`UNION_FIELDS` closely enough that no
translation step is needed before the compute step runs (unverified as of this writing, per the
header above).

## Step 4 — bot:blocked probe and grant/re-authorize edit

- `gh issue view "$ISSUE" --json labels` (bot:blocked probe) → `_shared/github-write-transport.md`'s
  "Get a single issue by number" row (`issue_read`, get mode), reading the returned labels the same
  way the `gh` form does.
- `gh issue edit --remove-label bot:blocked --add-label auto:build` (re-authorize) and
  `gh issue edit --add-label auto:build[ --add-label auto:merge-pending]` (grant) → that file's
  "Edit labels / body" row (`issue_write`, update mode) — one call per label-set change, the same
  two-call shape the `gh` form already uses for the compound re-authorize case, not a regression.

## Audit format — record comment

The evidence-snapshot comment (with its trailing `<!-- grant-mode-audit: ... -->` marker) →
`_shared/github-write-transport.md`'s "Comment" row (`add_issue_comment`). The marker text is
unchanged on this transport — Cap tracking's read-back below parses the same string either way.

## Cap tracking — same-day grant count

`gh search issues --repo ... --match comments "grant-mode-audit: date=${TODAY}"` has no MCP
equivalent, and none is added here: it is exactly the full-text/eventually-consistent search
pattern `_shared/github-write-transport.md` already bans for find-by-marker lookups (three
duplicate-digest incidents, #1016/#1079/#1089 — see that file's "Never use `search_issues`..."
note, which now also names this section as the reference bounded-walk implementation).

**Resolution: a bounded list-then-read-comments walk, replacing the search on *both* transports**
— the `gh` form changes too, not just the MCP one, since the eventually-consistent-index risk
applies identically to `gh search issues`:

1. List open issues carrying `auto:build` (`_shared/github-write-transport.md`'s "List open
   issues by label" row, `label: "auto:build"`, `state: "open"`) — every issue a same-day grant or
   re-authorize could have touched still carries this label at read time, unless a same-day merge
   already stripped it (see the caveat below).
2. For each, read its comments (`_shared/github-write-transport.md`'s "List an issue's comments"
   row) and count matches of `<!-- grant-mode-audit: date=${TODAY} auto-merge=... -->`.

**Caveat, accepted deliberately.** An issue granted today that also merged and had `auto:build`
stripped today (a fast-maturing `auto:merge-pending` → merge → `/wrap-up` label removal, all
within one UTC day) drops out of this walk and undercounts the cap by one. `refine-headless.md`'s own
Concurrency section already accepts a comparable small, self-correcting margin on the `gh`-search
form (two racing firings each reading a stale "N of M" count); this walk's undercount is the same
order of magnitude, on a cap that same section already calls "not worth a distributed lock for."
Not resolved further here.

Sizing the `auto:build`-labeled list follows `_shared/github-write-transport.md`'s sizing rule —
bounded by that label's live cardinality (typically small: in-flight authorized-but-unmerged
records), never by copying another call site's `--limit`.

---

## Concurrency — does the MCP transport need `_shared/issue-claims.md`'s lock?

**No — same conclusion as the `gh` transport, checked rather than assumed.** `refine-headless.md`'s own
Concurrency section reasons that every label write here is idempotent under `gh`: two overlapping
firings applying the same `--add-label` at worst repeat the same write. That idempotency comes
from label-set semantics (adding a label twice is the same as adding it once, order-independent),
not from `gh`'s ref-level compare-and-set — so it transfers to `issue_write` (update mode)
unchanged: a plain field/label update on the MCP transport is exactly as commutative as the CLI
form, since the headless posture's writes never depended on ref-level atomicity to begin with.
`_shared/issue-claims.md`'s file-blob lock solves a different problem — mutual exclusion over *who
builds* one issue — that this posture's label-add writes don't have: nothing in this posture claims an
issue for building, only authorizes it for `/claude-tweaks:dispatch` to claim later. No lock added
for this MCP path.
