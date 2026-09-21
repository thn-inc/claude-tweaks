# Issue Claims — Cross-Agent Coordination Contract

Prevents concurrent agents — a scheduled cloud routine, a second machine, another
collaborator's agent, whether running the `gh` CLI or the GitHub MCP bridge — from
double-building the same GitHub issue. One arbiter (a content blob on the `claims-registry`
branch) covers all topologies and both transports: a create-only or sha-conditional write to
that one file is an atomic test-and-set, and both transports write the same file.

Helper module: `bin/lib/issues/claims.js` (emit-only, no network — skills run `gh` or the MCP
tools). Consumers reference this file; do not restate the protocol inline.
Label taxonomy home: `_shared/work-record.md` — this file defines the claim protocol; the
record contract defines what the labels mean.

## The lock

**`bin/claim-targets.js --run-id <id> --targets <n,n,...>`** (claim side, `bin/lib/claim-targets/claim-targets.js`
+ `bin/lib/issues/claim-store.js`) and **`bin/release-claim.js <issue> --run <run-dir> --reason <reason>`**
(release side, `bin/lib/release-claim/release.js`) are the two CLI surfaces every real consumer of
this section runs instead of hand-scripting the loop per pipeline run — `flow/claim-targets.md`'s
Step 2.8 for claiming, `wrap-up/cleanup-procedures.md` Section E for releasing. Both are thin
wrappers over the one write-path module, `claim-store.js`: it tries a **git compare-and-swap**
first — fetch the `claims-registry` tip, commit the blob on it, push with
`--force-with-lease=refs/heads/claims-registry:<expected-tip>` (a rejected push is contested —
same handling as a live claim, not a retry) — falling back to the contents-API PUT below only when
git-CAS fails for a transport reason (no git push credential — an MCP-only sandbox, for instance)
or a secondary rate limit (classified as its own distinct outcome, never folded into "contested").
**A rejected push is not contested on the rejection alone:** that lease is on the whole
`claims-registry` branch tip, not on this issue's file, so a commit claiming an unrelated issue
rejects it too. `claim-store.js` re-reads the claim before deciding — content changed since the
read this write was based on = contested as above; content unchanged = unrelated branch activity,
so the write retries on the fresh tip, bounded at 3 attempts, and a rejection still spurious on
the last one reports as transient, never as a contest. The same re-read guards the contents-API
fallback: it may only write when the fresh content still matches what the write decision was
based on, so a claim that landed while git-CAS was failing is never silently overwritten.
The release side re-reads on the same principle before concluding "already released" (the
**Release** bullet below). The gh-CLI/MCP contents-API steps below are unaffected: their `sha` is
the target file's own blob sha, so a rejection there really is per-file and stays contested.
The MCP transport (`gh` absent) runs the contents-API algorithm as written below, over the MCP
tools — git-CAS requires a git push credential the MCP-only case doesn't have.

**One keyspace, one classifier, both transports.** `claims/issue-<number>.json`, a blob on the
`claims-registry` branch, is the *only* lock — checked and written identically whether this run
has `gh` on PATH or is going through the MCP bridge. `bin/lib/issues/claims.js`'s
`classifyClaimBlob(content, now)` turns a fresh read into a create-only / conditional-update /
contested decision without branching on transport, so a gh-CLI session and an MCP session
contending for the same issue read and write the same file — exactly one write lands regardless
of transport.

*Reachability:* `/claude-tweaks:dispatch`'s Preflight check 2 (`gh` installed) does not gate on
its own — `gh` present proceeds via the gh-CLI calls below, `gh` absent via the MCP calls below.
`/tidy`'s Step 4.7 sweep is a separate consumer of this same protocol, unaffected either way.

Build the payload once, from either transport, the same way:

```bash
node -e "const c=require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/claims.js');
  console.log(JSON.stringify(c.claimPayload({issueNumber:Number(process.argv[1]),
  runId:process.argv[2],sessionId:process.env.CLAUDE_CODE_SESSION_ID||'',
  host:require('os').hostname(),now:Date.now()})))" "$ISSUE" "$RUN_ID" > /tmp/claim-payload-${ISSUE}.json
```

- **Bootstrap the branch** (once per run, before the first claim/release write). Branch creation
  is a distinct call on either transport, never an implicit side effect of a content write —
  check whether `CLAIMS_BRANCH` already exists (a cheap read against a known path on it) and, if
  not, create it from the repository's default branch, tolerating an "already exists" rejection
  (a concurrent agent may have created it first — the same 422-tolerance the claim write itself
  has).
<!-- when: transport=gh -->
  - **gh CLI:** `gh api "repos/{owner}/{repo}/git/refs/heads/${CLAIMS_BRANCH}"` to check;
    `DEFAULT_SHA=$(gh api "repos/{owner}/{repo}/commits/$(gh api "repos/{owner}/{repo}" -q .default_branch)" -q .sha)`
    then `gh api "repos/{owner}/{repo}/git/refs" -f "ref=refs/heads/${CLAIMS_BRANCH}" -f "sha=${DEFAULT_SHA}"`
    to create.
<!-- /when -->
<!-- when: transport=mcp -->
  - **MCP:** call `create_branch` with name = `CLAIMS_BRANCH` (`claims-registry`,
    `node -e "console.log(require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/claims.js').CLAIMS_BRANCH)"`)
    and source = the repository's default branch.
<!-- /when -->

  Either bootstrap leaves `claims-registry` carrying the default branch's history underneath it
  — harmless, since the branch is a registry nobody merges, but not equivalent to an orphan
  branch.
- **Claim:** read first, then write — a create-only write cannot tell a live claim apart from a
  release tombstone, and a tombstone is never deleted, only overwritten, so treating file-exists
  as "contested" would reject every re-claim forever after its first release.

  1. Read the claim file at the payload's `claimPath` on `CLAIMS_BRANCH`, capturing both its
     content (or absence) and its current **blob sha** when it exists. A 404 (file does not
     exist) is a normal outcome, not an error — it means "never claimed." Emit the literal
     sentinel `__ABSENT__` on a 404 so step 2 can classify it the same way whether the read
     came from a live claim or a never-claimed issue:
<!-- when: transport=gh -->
     - **gh CLI:**
       ```bash
       if RAW=$(gh api "repos/{owner}/{repo}/contents/${CLAIM_PATH}?ref=${CLAIMS_BRANCH}" \
           -q '{content: (.content | @base64d), sha: .sha}' 2>/tmp/claim-read-err-${ISSUE}.txt); then
         echo "$RAW" > /tmp/claim-wrapper-${ISSUE}.json
         CONTENT_PATH_OR_ABSENT_SENTINEL="/tmp/claim-wrapper-${ISSUE}.json"
       elif grep -q 'HTTP 404\|Not Found' /tmp/claim-read-err-${ISSUE}.txt; then
         CONTENT_PATH_OR_ABSENT_SENTINEL="__ABSENT__"
       else
         # any other non-zero exit (network, auth, rate limit) — not a normal
         # absent-file outcome; handle per the Failure posture table below,
         # do not treat as absent.
         cat /tmp/claim-read-err-${ISSUE}.txt >&2
         exit 1
       fi
       ```
       The command's output (when it succeeds) is the **wrapper object**
       `{content: "<decoded blob text>", sha: "<blob sha>"}` — step 2 below needs only the
       `.content` field's *value*, not this wrapper, so extract it before classifying (see step 2).
<!-- /when -->
<!-- when: transport=mcp -->
     - **MCP:** the equivalent "get file contents" tool call against `claimPath` on
       `CLAIMS_BRANCH`; a not-found response is the same normal outcome — set
       `CONTENT_PATH_OR_ABSENT_SENTINEL="__ABSENT__"` in that case, otherwise write the tool's
       returned content to a file and use that path.
<!-- /when -->
  2. **Extract the content before classifying.** When step 1 produced a real file (not the
     `__ABSENT__` sentinel), that file holds the **wrapper object** `{content, sha}` from the
     `gh api` call's `-q` filter — step 2's classifier needs the **`.content` field's value**
     (the decoded claim-blob text itself), never the wrapper object. Extract it first:
<!-- when: transport=gh -->
     ```bash
     if [ "$CONTENT_PATH_OR_ABSENT_SENTINEL" = "__ABSENT__" ]; then
       CLASSIFY_INPUT="__ABSENT__"
     else
       jq -r '.content' "$CONTENT_PATH_OR_ABSENT_SENTINEL" > /tmp/claim-content-${ISSUE}.txt
       CLASSIFY_INPUT="/tmp/claim-content-${ISSUE}.txt"
     fi
     ```
<!-- /when -->
<!-- when: transport=mcp -->
     Step 1's MCP bullet already wrote the tool's returned content itself, not a wrapper —
     nothing to extract: `CLASSIFY_INPUT="$CONTENT_PATH_OR_ABSENT_SENTINEL"` as-is.
<!-- /when -->
     Then classify:
     ```bash
     node -e "const c=require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/claims.js');
       const content = process.argv[1] === '__ABSENT__' ? null : require('fs').readFileSync(process.argv[1],'utf8');
       console.log(JSON.stringify(c.classifyClaimBlob(content, Date.now())))" \
       "${CLASSIFY_INPUT}"
     ```
     A literal follower who skips the extraction and passes the wrapper-object file straight to
     this script hands `classifyClaimBlob` a JSON object with no `claimedAt`/`released` keys —
     it classifies `'unreadable'` (fails closed to *not reclaimable*, same as `'live'`), a false
     contest on a claim that may not exist or may be safely reclaimable. The extraction step
     above is what prevents this.
  3. **`state: 'absent'`** — no prior claim. Write **create-only** (no `sha`): the payload's
     `fileContent` at `claimPath` on `CLAIMS_BRANCH`.
<!-- when: transport=gh -->
     - **gh CLI:** `gh api --method PUT "repos/{owner}/{repo}/contents/${CLAIM_PATH}" -f "message=Claim issue #${ISSUE}" -f "content=$(base64 <<<"$FILE_CONTENT")" -f "branch=${CLAIMS_BRANCH}"`
       — omitting `sha` means create-only; a 422 means someone else's create-only write landed
       first between the read and this write.
<!-- /when -->
<!-- when: transport=mcp -->
     - **MCP:** `create_or_update_file` with `path` = `claimPath`, `content` = `fileContent`,
       `branch` = `CLAIMS_BRANCH`, omitting `sha`; a file-already-exists rejection is the same
       race.
<!-- /when -->
     A rejection on either transport is **contested** — same handling as `'live'` below, not a
     retry.
  4. **`state: 'tombstone'` or `'stale'`** — a legitimate re-claim, not a contest, EXCEPT: first
     check for an in-flight build (#974) — the MCP-transport equivalent of the in-flight check
     the "In-flight detection at claim time (#315)" section below documents for the `gh`-CLI
     transport (`tombstoneInFlightPr`, run inside `bin/claim-targets.js`, which does not apply
     here — this manual MCP path has no CLI to delegate to). Parse the tombstone content already
     extracted in step 2: when its `reason` field starts with `pr-opened:` and its `link` field is
     a well-formed `https://github.com/{owner}/{repo}/pull/{number}` URL for the SAME owner/repo
     as the issue being claimed (anything else — missing link, wrong repo, malformed value — skip
     this check and proceed to the write below, the identical fail-open posture
     `tombstoneInFlightPr` uses), read that PR's state via `mcp__github__pull_request_read`
     (`get` method) — the one documented PR-read exception to `_shared/github-write-transport.md`'s
     "Pull requests are not covered by this mapping" note, already used the same way by
     `_shared/pr-checklist-refresh.md`'s Phase-checklist update section. A still-`OPEN` state
     means a build for this issue already exists and reclaiming would race it — stop here, do not
     write, and report it the same way `flow/claim-targets.md`'s in-flight card does. Any other
     state (closed, merged) or a failed read falls through to the write below unchanged. Otherwise,
     write **conditionally** (**with** `sha` = the current file's blob sha from step 1):
<!-- when: transport=gh -->
     - **gh CLI:** the same `PUT contents` call as step 3, adding `-f "sha=${CURRENT_SHA}"`. (This
       transport's in-flight check runs inside `bin/claim-targets.js` itself, not this manual
       step — see "In-flight detection at claim time (#315)" below.)
<!-- /when -->
<!-- when: transport=mcp -->
     - **MCP:** the same `create_or_update_file` call as step 3, adding `sha: currentSha`.
<!-- /when -->
     A rejection here means someone else re-claimed or broke it first — contested.
  5. **`state: 'live'`** — contested. Do not attempt any write.
  6. **`state: 'unreadable'`** — fails closed to *live* (`classifyClaimBlob` reports
     `reclaimable: false`) — treat identically to step 5. `/tidy`'s sweep surfaces it for human
     judgment, per the standing "a claim you cannot read is not yours to break" posture. To
     repair or force-release a blob stuck in this state, see "Repairing an unreadable claim
     blob" below.

  The only `sha` either write above ever uses is the target **file's** current blob sha, from
  step 1's fresh read.
- **Release:** the same read-then-classify (steps 1-2 above), then write the payload's
  `tombstoneContent` with `sha` = the current file's blob sha — structurally the same
  conditional-overwrite as step 4's re-claim, differing only in what content it writes. A sha
  mismatch means someone else already broke/re-claimed it; treat as a release race (log, TTL is
  the backstop, per the Failure posture table below). **`bin/release-claim.js`** performs this
  whole sequence (read → classify → ownership check → tombstone `PUT` → comment → label
  removals) in one command on the `gh` path — `node "${CLAUDE_PLUGIN_ROOT}/bin/release-claim.js"
  <issue> --run <run-dir> --reason <reason> [--link <url>] [--remove-grants] [--keep-in-progress-label]`.
  `bot:in-progress` removal is opt-**out** (default on every release outcome that reaches the
  label step, #1631 — `--remove-in-progress` is still accepted, now a no-op, and
  `--keep-in-progress-label` is the only way to suppress it); `--remove-grants` (stripping
  `auto:build`/`auto:merge-pending`/`auto:merge`) stays opt-in — see "Grant revocation" below.
  Exit `0` released / `3` already released or swept / `4` held by another run / `5` claim blob is
  corrupt/unreadable (nothing written — distinct from `4`, since a corrupt blob can never
  self-resolve the way a live holder's claim eventually expires; do not retry-and-wait on `5` the
  way `4` permits) / `1` failed / `2` malformed or `gh` absent. The MCP path stays the manual
  read-classify-write above.

  **`--sweep` (#2090)** narrows the ownership check above for a caller that is, by construction,
  never the holder — `/tidy`'s hygiene pass, whose `--run` basename is the tidy run, not the
  crashed dispatcher's `runId`. With `--sweep`, the CLI resolves the issue's own open/closed state
  (`gh issue view <n> --json state`) and passes it through: the release proceeds when the blob
  classifies `'stale'` (unconditionally — a live run can legitimately outlive its TTL, but the
  sweep runs only after a human has already approved this specific row at Step 6, so the flag makes
  an approved release executable, never autonomous) or `'live'` **and** the issue reads closed; a
  `'live'` claim on an OPEN issue still exits `4` (`skipped-not-owner`) regardless of the flag. A
  failed issue-state read aborts the release rather than assuming closed. `--reason` must start
  with `swept:`, validated before any `gh` call. The resulting tombstone's own `runId` is still the
  sweep run (never a fake owner) — `sweptFrom` is the separate field naming the original holder,
  and both the CLI's JSON envelope and its `decisions.md` line carry it.
- **List all claims:** list the `claims/` directory on `CLAIMS_BRANCH`.
<!-- when: transport=gh -->
  - **gh CLI:** `gh api "repos/{owner}/{repo}/contents/claims?ref=${CLAIMS_BRANCH}" -q '.[].name'`
<!-- /when -->
<!-- when: transport=mcp -->
  - **MCP:** the equivalent read-tree/list-directory tool call against `claims/` on
    `CLAIMS_BRANCH`.
<!-- /when -->

### Repairing an unreadable claim blob

`classifyClaimBlob` fails closed to `'unreadable'` for a blob whose content isn't valid claim
JSON — both the acquire path (step 6 above) and `release-claim.js`'s exit `5` refuse to touch it,
since content they cannot parse might still encode someone's live claim. This is a **human or
`/tidy`-invoked override**, not a new classify outcome: performing it does not change what
`classifyClaimBlob` reports for the same content on a future read — it changes the *content*, by
overwriting it.

**Primary path — the CLI:** `node "${CLAUDE_PLUGIN_ROOT}/bin/repair-claim.js" <issue> --run <run-dir> --mode <release|reclaim> --reason <reason> [--link <url>] [--repo owner/name]` performs steps 1-4 below in one command — fresh read + sha capture, the confirm-`'unreadable'` gate (a live, stale, tombstone, or absent blob refuses with exit `4`, nothing written), the sha-carrying conditional overwrite (`release` writes `releasePayload`-shaped tombstone content, `reclaim` writes `claimPayload`-shaped content), and the override log (AUTO line in `<run-dir>/decisions.md`, plus the mirror comment). Exit `0` repaired / `3` CAS rejection (sha changed since the read — re-read and reassess, never retry blind) / `4` refused / `1` failed / `2` malformed or `gh` absent. The numbered manual steps below remain the transport-detail fallback for a `gh`-absent (MCP) environment — deliberately not grown into the CLI, matching `release-claim.js`'s own posture.

Repair reuses step 4's re-claim mechanics exactly — a conditional-overwrite `PUT`/
`create_or_update_file` with `sha` set — with one difference: step 4 gets its `sha` from a blob it
just classified as `'tombstone'`/`'stale'`; here the blob's *content* is unreadable, but its **blob
sha is ordinary response metadata from the read**, independent of whether the content parses, so
it is always available even when `classifyClaimBlob` cannot make sense of what the sha points at.

1. Read the blob at `claims/issue-<number>.json` on `CLAIMS_BRANCH` (step 1 above) and capture its
   current blob **sha** from the read response. This step never depends on the content parsing.
2. Confirm the content is genuinely unreadable rather than merely mis-extracted: run it through
   step 2's classify call and confirm the outcome really is `'unreadable'` — a wrapper-object
   extraction mistake (the false-`'unreadable'` case step 2's own note describes) is not this
   case and should be fixed at the read, not repaired here.
3. Write the replacement content **conditionally**, with `sha` = the sha captured in step 1 (the
   same `PUT`/`create_or_update_file` call shape as step 3/4 above, `sha` included):
   - **Force-release without re-claiming:** write `releasePayload`-shaped tombstone content — the
     same content shape the Release bullet above writes.
   - **Repair-and-claim in one step:** write `claimPayload`-shaped content — the same content
     shape steps 3/4 above write.
   A rejection here means the sha changed since step 1's read — someone else already broke or
   overwrote the blob first; re-read and reassess rather than retrying blind.
4. Log the override (who, when, why) somewhere durable (a `/tidy` run's own record, or a comment
   on the issue). Every other write in this file is a routine claim/release; this one silently
   destroys content that — despite failing to parse — may have carried a real holder's identity,
   so it is the one write here that should never go unlogged.

### Group claiming

Records whose key files overlap form a **file-overlap group** (`bin/lib/issues/grouping.js`'s
`groupByFileOverlap`). A dispatcher claims **all members of the group before starting any** —
building one member alone would leave the branch and its overlap partners racing each other.
Per-member acquisition uses the same 201/422 handling; on a partial group claim (some members
contested live mid-acquisition), release the members this run just claimed, log, and skip the
whole group this firing. Group membership is computed over *unclaimed* records only, so two
racing dispatchers converge: exactly one wins each contested member, and the loser backs off
group-wide.

**Post-write verification (#2073).** A write the claim store reports `ok: true` on has not yet
been confirmed to have actually landed — `bin/lib/claim-targets/claim-targets.js` re-reads every
claimed blob immediately after its own write (chained off the just-written git-CAS tip when
available, so this costs no extra fetch) and confirms it classifies `'live'` with `runId` equal
to this run's own. A mismatch or an absent/unreadable read-back is `claim-unverified` — exit `5`
(JSON `{unverified: [{issue}], ...}`), handled exactly like a contest: all-or-abort by default
(releasing every other target this invocation did confirm), downgraded to a per-target skip under
`--keep-going`. The unverified target itself is never included in that release — a write this run
cannot confirm might still be its own valid, if slow-to-replicate, claim, and blindly tombstoning
it risks breaking a claim that is in fact live; it is instead surfaced for `/tidy`'s sweep or human
judgment, the same posture `'unreadable'` already has.

## The mirror (human visibility only — never identity)

Identity and lock are now **one write** — the blob's own content, per "The lock" above. The
issue comment this section posts is purely a human-visibility mirror for the GitHub UI; it
carries no identity the blob doesn't already carry authoritatively, and its own failure never
affects claim state. Generate bodies with the module — never hand-write markers:

```bash
node -e "const c=require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/claims.js');
  console.log(c.claimPayload({issueNumber:Number(process.argv[1]),
  runId:process.argv[2],sessionId:process.env.CLAUDE_CODE_SESSION_ID||'',
  host:require('os').hostname(),now:Date.now()}).commentBody)" "$ISSUE" "$RUN_ID" > /tmp/claim-${ISSUE}.md
```
<!-- when: transport=gh -->
```bash
gh issue comment "$ISSUE" --body-file /tmp/claim-${ISSUE}.md
```
<!-- /when -->
<!-- when: transport=mcp -->
`add_issue_comment` with the issue number and `body` = the contents of
`/tmp/claim-${ISSUE}.md` (`_shared/github-write-transport.md`'s Comment row).
<!-- /when -->

Marker shapes (emitted by `claimPayload` / `releasePayload` — the same JSON shape the blob
content itself carries, so the comment is a legible copy of the blob, not a second source):

```
<!-- agent-claim: {"runId":"...","sessionId":"...","claimedAt":"<ISO>","ttlHours":72,"host":"..."} -->
<!-- agent-claim-release: {"runId":"...","reason":"...","releasedAt":"<ISO>"} -->
```

A sweep release (`release-claim.js --sweep`, #2090) adds one field to both the blob and the
comment marker: `sweptFrom` — the original holder's `runId`. `runId` in the marker is still the
releasing (sweep) run's own identity, never the holder's; `sweptFrom` is what distinguishes "I
released my own claim" from "I swept someone else's":

```
<!-- agent-claim-release: {"runId":"<sweep-run>","reason":"swept: stale claim","releasedAt":"<ISO>","sweptFrom":"<original-run>"} -->
```

Identity: `runId` is the pipeline run directory id (`{ISO-timestamp}-{spec-slug}`) — for a
directly-run or human-resumed `/flow`, the run directory it creates or adopts itself
(`basename($PIPELINE_RUN_DIR)`); for a `/claude-tweaks:dispatch`-originated claim, the
per-group run directory dispatch Step 4 mints (`{ISO-timestamp}-record-{n}`,
keyed to the group's representative record — see `dispatch/SKILL.md` Step 4) and passes to
both of that group's Task calls as `PIPELINE_RUN_DIR`. One identity either way: the directory
the claim was written under is always the same directory the pipeline itself resolves as
`$PIPELINE_RUN_DIR`, so no separate variable threads the two together. Dispatch's own
firing-level standalone-auto run dir (`_shared/run-dir-resolution.md`, e.g.
`{ISO-timestamp}-dispatch-standalone`) is a different thing entirely — it holds that firing's
own `decisions.md` (queue pull, selection, per-group minting log), never a claim's `runId`.
`sessionId` is `CLAUDE_CODE_SESSION_ID` — the same
identity `record-worktree` stamps. **If the comment post fails after the blob write succeeded,
the claim still stands** — retry once, warn, proceed; the blob is the lock, and this comment
never gates anything.

## The bot:in-progress label

`bot:in-progress` is a second, purely cosmetic visibility layer on top of the blob lock — a
label so the claim shows up in GitHub's own issue list/board UI, not just via a `claims/`
directory listing on `claims-registry`. It carries no locking semantics: the blob claim/release
is atomic regardless of whether the label add/remove succeeds.

- **Added** alongside claim acquisition — bootstrap-then-add, the same check-then-create
  pattern every label in this codebase uses (see `_shared/label-bootstrap.md` for the
  canonical snippet and the full work-record `LABELS_JSON`; `/dispatch` is the
  claim-acquiring consumer).
- **Removed** alongside claim release — every release removes it, regardless of outcome
  (`wrap-up/cleanup-procedures-execution.md` Section E, its duplicate in `flow/multispec-review-console.md`,
  and — for a single-spec issue-mode run the user chooses not to merge — the same Section E
  `abandoned:` path any single-spec `/wrap-up` already uses).
- Best-effort in both directions: a failed add/remove never blocks the claim, the release, or
  the pipeline. `/tidy` Step 4.7 flags an issue that still carries the label with no active
  claim as a backstop.
- Generic to the protocol — any future claim consumer gets this for free, not just
  backlog-originated issues.

## Reading claim state

**Authoritative: read the blob, classify with `classifyClaimBlob`** — "The lock" step 1-2 above.
This is the single source of truth for whether an issue is claimed, by whom, and whether the
claim is breakable. As in "The lock" step 2 above, the path passed below is the already-extracted
claim-blob content (or `__ABSENT__`) — never the raw `{content, sha}` wrapper object a fresh
`gh api` read produces; run "The lock" step 2's extraction first if reading fresh here on the
`gh` transport. On MCP, step 1's read already writes this same extracted content directly (no
wrapper to extract), so the path passed below is that file as-is.

```bash
node -e "const c=require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/claims.js');
  const content = process.argv[1] === '__ABSENT__' ? null : require('fs').readFileSync(process.argv[1],'utf8');
  const classified = c.classifyClaimBlob(content, Date.now());
  const identity = content ? JSON.parse(content) : null;
  console.log(JSON.stringify({ ...classified, claim: classified.state === 'live' || classified.state === 'stale' ? identity : null }))" \
  "${CLASSIFY_INPUT}"
```

`state: 'absent'` — never claimed (a tombstone still reads `'tombstone'`, not `'absent'`, so
"never claimed" and "claimed then released" stay distinguishable). `state: 'live'` — claimed,
not breakable; `claim` carries the full identity (`runId`, `sessionId`, `claimedAt`, `ttlHours`,
`host`). `state: 'stale'` — claimed, breakable (past TTL). `state: 'tombstone'` — released,
breakable (a fresh claim, not a takeover). `state: 'unreadable'` — fails closed to
not-breakable, same as `'live'`; `/tidy`'s sweep surfaces it for human judgment.

Paths in these snippets must be absolute (`/tmp/...` or a run-dir path) — `require()` inside
`node -e` resolves relative paths against the eval context, not the working directory.

## TTL and staleness

Default TTL 72h from `claimedAt`; stale iff `now >= claimedAt + ttlHours`. No heartbeat in v1.

**Breaking a stale claim:** conditionally overwrite the blob (the `'stale'` write path under
"The lock" step 4 — `sha` = the current file's blob sha, content = a fresh `claimPayload`'s
`fileContent`), then post a new claim comment noting the takeover and the prior run id.

Generate the takeover comment with `claimPayload`'s `note` param (e.g. `note: "Broke stale claim
from run {priorRunId} (expired {expiry})."`) — the note becomes a third human-readable line.
Never hand-edit or append to the marker line itself.

**A claim blob that is unreadable is never stale** — `classifyClaimBlob` reports
`reclaimable: false` for `'unreadable'` the same as `'live'` — treat as live, skip the issue,
and let `/tidy`'s sweep surface it for human judgment.

## Release triggers

| Trigger | Owner | Reason string |
|---|---|---|
| Spec merged / PR opened / discarded | `/wrap-up` cleanup item 7 | `merged: spec {spec}` / `pr-opened: spec {spec}` / `abandoned: spec {spec}` |
| Interactive `/flow` run stops at a gate, user chooses not to resume | `/flow` failure card (offered, not automatic) | `failed: {gate}` |
| Handed-off issue-mode run fails a HARD-GATE (headless `dispatch`, no human present) | `/claude-tweaks:dispatch` settle step (automatic, unconditional) | `failed: {gate}` |
| Headless bare `specify` drain (or its deprecated `next` alias) shapes the claimed record (success), routes it to `needs:definition` (success), or fails during shaping | `specify/next-mode-shape.md` Release step (#1346's split of `next-mode.md`; automatic, unconditional, always before that path's self-report) | `shaped: #{n}` / `routed: needs:definition #{n}` / `failed: shaping` |
| Stale or orphaned claim in hygiene pass | `/tidy` Step 4.7 (after batch approval), via `release-claim.js --sweep` (#2090) | `swept: stale claim` / `swept: issue closed` |
| Grant removal (`auto:build`/`auto:merge`) after a `merged:`/`pr-opened:` release | Console dispatch-label step (multi-spec) / `/wrap-up`'s `cleanup-procedures-execution.md` Section E step 6 (single-spec) | — (label edit, not a claim release) |
| Interrupted session | nobody — TTL ages it out; `/tidy` sweeps it | — |

**Ownership rule.** Before a this-run release overwrites the blob, read it fresh and confirm
`claim.runId` equals this run's `$RUN_ID`. A mismatch means a successor broke the stale claim and
now holds the lock — skip the write, log, and post nothing. `/tidy`'s sweep is exempt: it
releases *other* runs' stale claims by design, after batch approval.

**Dispatch's success path.** `/claude-tweaks:dispatch` Step 4 mints the group's run directory;
the first Task call's own `/claude-tweaks:flow` invocation claims it at Step 2.8
(`flow/claim-targets.md`) with the group's minted directory's basename as identity, and a
successful run's release happens inside `/wrap-up` (cleanup Section E) under that same
directory — `/flow` adopts it
directly as `$PIPELINE_RUN_DIR` rather than creating a separate one of its own, so
`cleanup-procedures-execution.md` Section E resolves `$RUN_ID` as `basename($PIPELINE_RUN_DIR)`
directly, no separate variable to thread through. A dispatched bundle is the one exception:
each spec's own `$PIPELINE_RUN_DIR` is a `spec-{N}/` subdirectory of the group's minted
parent, so Section E is deferred per-spec and the actual release happens once, at end-of-run,
against `basename($MULTISPEC_PARENT_DIR)` — see `flow/multispec-review-console.md`'s "Shared
teardown." The failure path (dispatch's own settle step) already releases with the same
identity that made the claim.

**Work-ready evidence.** Pass `releasePayload` a `link` (merge commit URL/sha or PR URL) when one
exists — it lands in the release marker and human line.

**In-flight detection at claim time (#315).** A `pr-opened:` tombstone's `link` field points at
the PR that build produced — before reclaiming such a tombstone, a claim-time reader may check
`gh pr view <link> --json state --jq .state`; a still-`OPEN` result means a build for this issue
already exists and reclaiming would race it. `bin/lib/issues/claim-store.js`'s `tombstoneInFlightPr`
runs this check (moved there from the retired `claim-engine.js`, #787), returning `{ link }` instead
of proceeding to a fresh claim; any other reason, a missing `link`, or a failed/closed/merged check
falls through to the reclaim behavior below unchanged (fail open). `link` is untrusted (any session
with registry-branch write access can set it), so `tombstoneInFlightPr` validates it — a well-formed
`https://github.com/{owner}/{repo}/pull/{number}` URL for the SAME owner/repo as the issue being
claimed — before ever calling `gh pr view`; anything else (wrong repo, malformed, non-string) is
treated the same as a missing `link` and never reaches `gh` at all.
`bin/lib/claim-targets/claim-targets.js` — the group-claim loop `/claude-tweaks:flow` Step 2.8 and
`/claude-tweaks:dispatch` actually call — imports this same `tombstoneInFlightPr` from
`claim-store.js` and reports the stopped target via `inFlight`/`reason: 'in-flight'` instead of
`outcome` (`flow/claim-targets.md`'s "Branch on exit code"). That CLI is the `gh`-transport only
(see "The lock" step 4's MCP note above) — "The lock" step 4's own in-flight check (#974) is
where the `gh`-absent MCP path gets the equivalent stop, since it has no CLI to delegate to.

Every claim, skip, break, and release is logged to the run's `decisions.md` per
`_shared/auto-decision-log.md` (status `AUTO`, reversible: release overwrites the blob with a
tombstone) — `bin/release-claim.js` appends its own line; claim-side entries go through
`bin/log-decision.js`.

## Close-via-merge

The agent never runs `gh issue close` (non-reversible network write — see
`_shared/auto-mode-contract.md`). Issues close through the user's own merge action instead, by
ensuring the closing keyword already exists in a commit that will reach the default branch:

- **Worktree path (single-spec, the common case):** before handing off to
  `/superpowers:finishing-a-development-branch`, `/wrap-up` cleanup Section C commits an empty
  carrier commit on the feature branch — `git commit --allow-empty -m "Fixes #{issue}"`, one
  line per issue — *before* that skill runs. This is necessary: that skill's "Merge locally"
  option runs a bare `git merge` with no `--no-ff` (no merge commit to carry a message into),
  and its "Push and Create PR" option never calls `gh pr create` (no PR body either). A carrier
  commit on the branch itself works across every option that skill offers, because GitHub scans
  every commit reaching the default branch, not just a merge commit or PR body.
- **Worktree path (multi-terminal parallel):** `flow/worktree-merge.md` merges directly —
  `git merge --no-ff {branch} -m "... Fixes #{issue} ..."`. The explicit `--no-ff` guarantees a
  real merge commit to carry the keyword, so no separate carrier commit is needed.
- **Current-branch path:** no merge commit, PR, or branch finish exists — the same
  `Fixes #{issue}` lines go in the final wrap-up commit message (per spec, in multi-spec runs).

One line per issue. Direct `gh issue close` commands surface only for issues resolved *without*
a merge (wontfix, duplicate), and the user runs them.

## Dispatch authorization

Headless agents building arbitrary issue content is a prompt-injection surface: an issue body
is untrusted input, and a drive-by issue must not be able to opt itself into autonomous
execution. The gate is GitHub's own permission model — **applying a label requires triage
permission, so a label is a maintainer's signature**. Authorization is two stackable grants
(see `_shared/work-record.md`, the taxonomy home, for full semantics), *granted* exclusively
by `/claude-tweaks:backlog refine`'s interactive invocation. Machinery may remove or downgrade
grants; it never adds them:

- `auto:build` — authorized to build. `/dispatch` selects on this, mints the run directory for
  the record's whole file-overlap group, and hands it to `/flow #{n}`, which claims the group at
  Step 2.8. Label = standing request, claim = in flight: the claim blob prevents double-dispatch
  across firings, and the grant persists until *successful* wrap-up — a failed run retries at a
  later firing once its claim ages out, up to the `dispatch-retry-ceiling` config key.
- `auto:merge` — additionally authorized to auto-merge without a live Review Console
  approval, but only when `/claude-tweaks:assess-agent-autonomy`'s `merge-check` mode verdicts
  `auto-merge` (the two-layer gate defined in `skills/dispatch/SKILL.md`). Additive on
  `auto:build`; alone it is inert.

**Grant revocation (machinery-owned, the only direction machinery moves):** the
correctness/ambiguous-vs-transient failure classification and the retry-ceiling
`auto:*`-removal + `bot:blocked` rule live in `_shared/work-record.md`'s "Grant semantics"
section — see that section for the full rule. The one addition specific to this gate:

- Flag-back at the gate (remove `ready`, comment why) returns an unshaped record to backlog
  state for more shaping — the gate's equivalent of "not yet."

These are reversible label writes, logged to `decisions.md`. Removing grants on *success* is
a different owner's job — `/wrap-up` (or the consolidated console) after a `merged:`/
`pr-opened:` release, per the Release triggers table above.

## Failure posture

Fail-closed on claiming; never block the session.

| Failure | Behavior |
|---|---|
| `gh` missing | Use the MCP path (see "The lock" above) — not a hard gate at the protocol level |
| `gh` present but unauthenticated | Consumer's existing hard gate (auto never silences a missing dependency) |
| Claim write rejected, blob classified `'live'` | Skip the issue, log `AUTO`, continue |
| Claim write rejected, blob classified `'stale'` | Break: conditional overwrite (`sha` from the fresh read) → takeover comment |
| Claim write rejected, blob classified `'unreadable'` | Treat as live: skip, log; `/tidy` surfaces it |
| Claim write rejected, blob classified `'tombstone'` | Treat as a fresh reclaim: conditional overwrite (`sha` from the fresh read) → new claim comment |
| Comment fails after blob write succeeds | The blob is the lock — retry the comment once, warn, proceed; claim stands either way |
| Release fails | Log; TTL is the backstop |
| Release attempted but the blob's current `runId` is not this run's | Skip the write, log — a successor holds the lock (ownership rule) |
| Blob listing fails in `/tidy` | Skip the sweep step, note it in the report |
| Any other `gh`/MCP failure during claim | Drop that issue, log, continue — partial batch over hung batch |

**Recognition.** A `gh`/MCP failure in the table above is classified per
`_shared/github-rate-limit.md` before applying that row's outcome — a rate-limit response
follows that file's taxonomy; every other failure class in this table applies exactly as
stated.

**Group-claim-all-or-abort exception.** The row above assumes an independent-batch context (dispatch's per-issue loop, `/tidy`'s sweep), where dropping one issue and continuing is safe. A consumer claiming multiple targets under the group-claim-all-or-abort invariant (`flow/claim-targets.md`'s Step 2.8) gets different treatment: any transient `gh`/MCP failure during a claim read or write — not just a classification-based contest — triggers the same all-or-abort release-and-stop (or `keep-going` skip) as a live contest, since silently continuing with one named target unclaimed reopens the double-build race group-claiming exists to prevent.

## Deliverable-name collisions (bin/ CLIs)

The lock above claims the *issue number* being worked, not the *deliverable* (a named `bin/`
CLI, module, or artifact) a record proposes to build — two different issues that each
independently propose a same-named `bin/` CLI never collide here; the first collision point is a
`git merge` add/add conflict, discovered only after both sides have already built, tested, and
relied on diverging designs (the #637/spec-686-vs-"Ship bin/ CLIs"-PR incident this section
exists to prevent a repeat of).

**Where this fires:** at capture or specify time, whenever a record's title or body proposes
building a new `bin/` CLI (a `bin/{name}.js` filename, or prose like "build a CLI for X"/"ship a
`bin/` script for X"). Before filing or shaping such a record, grep both the shipped tree and the
open queue for the proposed name:

```bash
ls plugin/bin/{name}.js 2>/dev/null; gh issue list --search "{name} in:title,body" --state open
```

A hit in either — an existing implementation, or another open record proposing the same
deliverable — means resolve the collision (reuse, rename, or explicitly supersede the other
record) before the record is shaped `ready`. `capture/SKILL.md`'s Adding-an-Entry step cites this
section rather than restating it.

Would this have caught the #637 incident? Yes — grepping `log-decision` against the open-issue
titles at the time spec 686 was shaped would have surfaced "Ship bin/ CLIs for the hand-scripted
per-run procedures" proposing the same `bin/log-decision.js` filename, before either side wrote
code — the collision was visible from issue/PR titles alone, well before the eventual merge
conflict.

## Consumers

| Skill | Role |
|---|---|
| `/claude-tweaks:dispatch` | Selects each authorized record's whole file-overlap group, mints the run directory, and hands off to `/flow` (which claims at Step 2.8); the settle procedure it dispatches releases + revokes on failure (per the retry-ceiling procedure) |
| `/claude-tweaks:flow` (issue-reference mode) | Claims its named targets at Step 2.8 (`flow/claim-targets.md`), whether the invocation came from dispatch's hand-off or a human running `/flow #{n}` directly. Releases via `/wrap-up`'s generic Section E `abandoned:` path when the user doesn't merge, and via failure-card-offered release on a gate failure. |
| `/claude-tweaks:wrap-up` (`cleanup-procedures.md` item 7 / `cleanup-procedures-execution.md` Section E) | Releases claims with the branch outcome as reason |
| `/claude-tweaks:tidy` (`scan-procedures.md` Step 4.7) | Sweeps stale/orphaned claims; releases only after batch approval |
| `/claude-tweaks:specify` `next` form (`specify/next-mode.md` + `next-mode-shape.md`, #1346's split) | Claims the selected record before shaping (Claim step, `next-mode.md`); releases on every path that actually acquired a claim (Release step, `next-mode-shape.md`) — the shaping-success path and a post-claim shaping-stage failure. A zero-eligible exit or a contested/ineligible-on-re-read exit never acquires a claim, so there is nothing to release on those paths. |

**Non-consumers (deliberate):** `/code-health` files issues but never works them — a concurrent-
filing race costs at worst one duplicate issue, caught by dedup next run. Interactive
single-spec `/build` does not claim — the user is present and collision is visible.
