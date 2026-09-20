# Session-Scoped Temp-Root Convention

Canonical definition — cited, never restated, by every skill snippet that composes a body,
payload, or intermediate fetch result to a temp file. Fixes the class of collision behind #266:
a literal shared `/tmp/{skill}-{thing}.json` path races across two concurrent sessions of the
same skill — a compose-then-create window can silently overwrite one run's in-flight state with
another's, and a queue-pull read can come back truncated mid-run when two sessions land on the
same filename.

## The mechanism

`bin/lib/session-tmp.js` — pure filesystem helpers, no network:

- `sessionTmpRoot(sessionId)` — `{os.tmpdir()}/ct-session-{sessionId}`, or `null` when
  `sessionId` is absent/blank.
- `sessionTmpPath(sessionId, filename)` — the full path for one file under that session's root
  (creating the root directory if needed), or `null` under the same absent/blank condition.
  `filename` keeps the exact basename a skill already uses today (e.g.
  `specify-parent-body.md`) — the root directory is what changes, not each call site's own
  per-purpose naming.

This reuses the exact session-identifying value `bin/lib/issues/record-snapshot.js` already
established as reachable from skill-snippet execution (`_shared/record-queue-fetch.md`'s
Session-scoped record snapshot, #645) — `$CLAUDE_CODE_SESSION_ID`, empirically confirmed present
in the snippet execution environment rather than assumed. `session-tmp.js` is this file's
general-purpose sibling: `record-snapshot.js` owns one specific artifact shape (the cached issue
list); this module owns the root directory every *other* skill's own temp files land under.

## Degrade rule

A caller that cannot see `$CLAUDE_CODE_SESSION_ID` (a subagent the dispatcher inlines a prompt
into, rather than letting it read shared files directly — the same shape `record-queue-fetch.md`'s
own header note describes) gets `null` back from `sessionTmpPath`. Fall through to the original
unscoped `/tmp/{filename}` path in that case — nothing breaks; only the collision-avoidance
benefit is unavailable to a session-id-less caller, mirroring `record-snapshot.js`'s own
never-fresh degrade for the same condition.

## Usage (every consuming skill fills in `{filename}`)

**Single path:**

```bash
{tmp-var}=$(node -e "
  const { sessionTmpPath } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/session-tmp.js');
  console.log(sessionTmpPath(process.env.CLAUDE_CODE_SESSION_ID, '{filename}') || require('path').join(require('os').tmpdir(), '{filename}'))
")
```

The degrade fallback resolves the OS temp dir programmatically (`os.tmpdir()`) rather than hardcoding a `/tmp/` literal — behaviorally the same path on Linux, but it never re-introduces the exact unscoped-literal shape this convention exists to remove, and it degrades correctly on a non-Linux temp directory too.

**Several paths in one fence** — `bin/session-tmp-resolve.js`, a thin CLI wrapper, is the
byte-cheaper form once a script needs three or more (each inline `node -e` block above costs
roughly 350 bytes; this form costs roughly 90 bytes total, which matters for a skill file already
close to the 45 KB ceiling):

```bash
eval "$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" VAR1=file1.json VAR2=file2.md)"
```

Both forms resolve through the same `sessionTmpPath` and degrade identically; pick whichever
reads better at the call site, and prefer the CLI form once a file is within a few hundred bytes
of the ceiling (`wc -c` before committing).

`{filename}` is the skill's own existing purpose-suffixed basename, unchanged from its current
literal `/tmp/{filename}` form — e.g. `specify-parent-body.md`, `dispatch-groups.json`,
`backlog-overview-open.json`. Only the directory a call site writes to changes; the filename each
snippet already reads/writes elsewhere in its own prose does not need renaming, only the
`/tmp/{filename}` prefix does.

**Per-purpose suffix, not just a per-session root.** Two different purposes within the *same*
session must never share one filename even under a common root — the compose-then-create window
`/specify`'s own observed near-corruption came from is exactly this class, and a session-unique
root alone does not close it. Every migrated call site keeps its own distinct basename (the
skill already had one); this convention only relocates where that basename lives.

**Record-suffixed callers keep both suffixes.** A caller that already suffixes its filename with
a record number (e.g. `assess-agent-autonomy/grant-check.md`'s `assess-grant-${N}.json`) combines
the session root with the existing record-number suffix — neither replaces the other. Two
different sessions building the same record concurrently still need the session segment; two
different records in the same session still need the record segment.

## Idempotency and resume

The session root directory (`mkdirSync(..., { recursive: true })`) is safe to re-derive on every
call within the same session — a resumed skill invocation in the *same* session finds its own
prior files still in place under the same root. A skill whose own documented resume path already
re-fetches rather than trusting a stale shared file (e.g. `record-creation.md`'s Idempotency
section) is unaffected either way — this convention changes *where* a file lives, never whether a
caller trusts a stale read.

## Consumers

`skills/specify/decomposition-mode.md`, `skills/specify/record-creation.md`,
`skills/specify/record-creation-subissues.md`, `skills/specify/shaping-mode-stamping.md`
(#1346's split of `record-creation.md`/`shaping-mode.md`), `skills/dispatch/queue-pull-script.md`,
`skills/_shared/headless-self-report.md`, `skills/dispatch/settle-and-merge.md`,
`skills/dispatch/SKILL.md`, `skills/backlog/overview-mode.md`,
`skills/backlog/refine-mode.md`, `skills/backlog/refine-lanes.md`,
`skills/backlog/refine-headless.md`, `skills/backlog/attention-mode.md`,
`skills/backlog/trust-signal.md`, `skills/assess-agent-autonomy/grant-check.md`,
`skills/_shared/trust-table.md` — whose Fetch section resolves seven paths at once via the
CLI wrapper and hands their literal values downstream as `{tmp-*}` placeholders (see that
file's Fetch section); `skills/backlog/trust-signal.md` re-resolves two of the same
filenames (`trust-table-records.json`, `trust-table-git-log.txt`) independently, since
`sessionTmpPath` is deterministic per session id + filename and a shell variable from
`trust-table.md`'s own resolution call cannot survive into `trust-signal.md`'s separate
Bash call.

**Extended (#923) to the remaining `skills/**` sweep:** `skills/specify/next-mode.md`,
`skills/capture/SKILL.md`, `skills/help/status-scan.md`, `skills/tidy/step-1-records.md`,
`skills/init/bootstrap/step-14-cloud-routine-parity.md` (and the `scripts/claude-cloud-setup.sh`
it generates — that standalone bootstrap script reimplements the mechanism inline rather than
requiring `${CLAUDE_PLUGIN_ROOT}`, since its whole job is installing the plugin onto a sandbox
that doesn't have it yet), `skills/code-health/SKILL.md`, `skills/code-health/filing.md`,
`skills/code-health/focus-mode.md`, `skills/docs-health/SKILL.md`,
`skills/harness-health/SKILL.md`, `skills/harness-health/filing.md`,
`skills/harness-health/judge-procedure.md` (whose per-target findings files and narrative-density
scratch file combine the session root with the existing `{target.id}` suffix — the
record-suffixed-caller case above), `skills/journey-health/SKILL.md`,
`skills/wrap-up/SKILL.md`, `skills/wrap-up/unblocked-records.md`,
`skills/wrap-up/docs-health-integration.md`, `skills/wrap-up/leftover-routing.md`,
`skills/wrap-up/verification-brief-parent-gate.md`, `skills/_shared/label-bootstrap.md`,
`skills/_shared/github-pr-scan.md`, `skills/_shared/github-pr-scan-acceptance.md` (re-measured
with `wc -c` after every edit to stay under its 45 KB per-invocation ceiling — see that file's own
header note), and `skills/_shared/harness-health-analysis.md`.
