# Release State — the `release-state` branch and the reviewed-through marker

The one place `/release` keeps cross-run state: a small JSON file per name on a dedicated
branch, moved only through `bin/release-state.js` (`bin/lib/release-state/store.js` and
`marker.js`). Consumers cite the headings below; do not restate the protocol inline.

## The branch and its files

- The branch is `release-state`. The first write creates it from the default branch tip, as
  `claims-registry` is created (`_shared/issue-claims.md`, Bootstrap the branch), so it carries
  that history underneath. It is never an orphan branch, and nothing merges it.
- Files sit flat at the root and match `[a-z0-9][a-z0-9-]*\.json`. Compare-and-set is per file:
  git compares the whole branch tip (a rejection is re-read before it counts), the contents API
  the file's blob sha.
- `store.js` is the sole writer API: `reviewed-through.json` today, the merge-pause flag
  (#5884) next. Reads try git first (fetch the tip into a scratch ref, show the file), then the
  contents API. A missing file reads absent only once the branch read confirms it; an
  inaccessible repository reads unreadable, never absent.
- It never writes to `main`: every push names `refs/heads/release-state`, every contents-API
  write carries `branch=release-state`, and a create confirms the branch (creating a missing
  one) before its first write, on either transport.
- The git fetch uses `--no-write-fetch-head`, which needs git 2.29 or newer. On older git the
  local history answers insufficient history and the store falls back to the contents API. On
  the gh path the compare API then answers; exit 5 follows only when no compare history exists
  (as in emit mode), so a consumer on old git can tell why every check reads insufficient history.

## reviewed-through.json

The marker `/release` has reviewed through. `sha` is 40 lowercase hex, `advancedAt` ISO-8601
UTC, `run` the caller's run id (`init` for `marker init`).

```json
{
  "version": 1,
  "sha": "1111111111111111111111111111111111111111",
  "advancedAt": "2026-11-18T09:30:00.000Z",
  "run": "2026-11-18T093000-release"
}
```

The bytes are exactly `JSON.stringify(marker, null, 2)` plus one trailing newline. A reader
requires those four keys, ignores any others, and reads every other shape as unreadable: never
absent, never a marker. `version` is the expand-contract seam: a new shape adds beside the old,
and any version other than `1` reads as unreadable. The branch name, file name, marker shape and
exit codes are a frozen contract; change them only by expand-contract.

## Writer rules

- Forward-only along the first-parent line of `--branch` (default `main`). A target behind the
  marker or merged in through a second parent is refused; a marker no longer on the line is
  orphaned. The same sha is a no-op (`reason: "same"`).
- A lost compare-and-set re-reads. A marker at or past the target is success with no write
  (`reason: "at-or-past"`); otherwise one re-validated retry; a second lost write is checked once
  more for at-or-past, else contested (exit 4). A marker that vanishes on a re-read is contested.
- A shallow or stale clone answers what it holds. A sha it lacks is insufficient history
  (exit 5 once no compare history can answer either), never refused or orphaned. With no local
  answer the compare API serves.
- `marker init` is create-if-not-exists, at a target on the first-parent line, with run `init`.
- Every commit message is one line, at most 200 characters, with no `#`: the generated
  `track-issue-fixes.yml` job fires on a `#` beside a closing keyword, so a reason such as
  `fix #12` would label issue #12. The store refuses any other message.
- `--run` ids match `[A-Za-z0-9][A-Za-z0-9._:-]{0,127}`; `init` is reserved. A flag value
  starting with `-` is a usage error.

## The CLI

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/release-state.js" marker read [--repo [host/]owner/name | --marker-json <path>]
node "${CLAUDE_PLUGIN_ROOT}/bin/release-state.js" marker advance --to <sha> --run <id> [--branch <name>] [--repo [host/]owner/name | --marker-json <path> [--after-conflict]]
node "${CLAUDE_PLUGIN_ROOT}/bin/release-state.js" marker init --to <sha> [--branch <name>] [--repo [host/]owner/name | --emit]
node "${CLAUDE_PLUGIN_ROOT}/bin/release-state.js" marker reset --to <sha> --run <id> [--force (--reason <text> | --reason-file <path>)] [--branch <name>] [--repo [host/]owner/name | --marker-json <path>]
```

The repo is `--repo`, else the origin. The local clone serves history only when its origin is
that repo; any other target uses the contents and compare APIs alone, with no git call that
could reach `origin`.

On exit 0 stdout is one JSON line; `--help` prints the usage text instead, also on exit 0.
Exits 1 and 3-6 print nothing on stdout and one stderr line
`release-state.js: {outcome} — {reason}`; with `gh` missing a second hint line follows. Exit 2
prints `release-state.js: {error}` and then the usage text; an unresolvable or refused repo
prints `release-state.js: {message}` alone, with no outcome word.

- `read`: the marker object, or `{"absent":true}`.
- `advance`: `{"advanced":true,"from","to"}`, or `{"advanced":false,"sha","reason":"same"|"at-or-past"}`.
- `init`: `{"initialized":true,"sha"}`. `reset`: `{"reset":true,"from","to","basis"}`.
- An `advance`, `init` or `reset` that writes, under `--marker-json` or `--emit`, prints
  `{"write":{"branch","path","content","sha","message"}}` in place of its line.

### Exit codes

| code | name | meaning |
|---|---|---|
| 0 | `ok` | done; one JSON line on stdout |
| 1 | `refused` | not allowed: no marker, a target off the line or behind the marker, a marker already exists |
| 2 | `usage` | a malformed invocation, or an unresolvable or refused repo |
| 3 | `unreadable` | the marker, repo or handoff file cannot be read, or a write failed for a non-contest reason |
| 4 | `contested` | a competing writer changed the marker; read it again |
| 5 | `insufficient-history` | the history could not settle it: a shallow clone, no local clone and no compare answer |
| 6 | `orphaned` | the marker is off the first-parent line; `marker reset` recovers |

Exit 5 is never exit 1: a history that cannot answer does not refuse.

## gh-absent (MCP) path

Detection is `_shared/github-write-transport.md`'s Detection: `gh` absent selects this path. The
CLI never reaches MCP; the agent fetches, hands the CLI a file, and makes the one write it
prints. Emit mode does no repo resolution and no origin check: run it from a checkout of the
same repository.

1. Read: `get_file_contents` of `reviewed-through.json` at ref `release-state`. With the Write
   tool, write `{content, sha}`, `null` or `{failure}` to the path
   `node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value release-state-marker.json` prints;
   that path is `{tmp-marker-json}` below. `content` is the decoded file text (never base64) and
   `sha` the file's 40-lowercase-hex blob sha.
   A not-found counts as `null` only after `get_file_contents` of the root on `release-state`
   succeeds (the file is missing), or that read answers not-found and the root on the default
   branch succeeds (the branch is missing). Any other failure on any read is `{failure}`. Any
   other file shape exits 3.
2. Run `node "${CLAUDE_PLUGIN_ROOT}/bin/release-state.js" marker advance --to {sha} --run {id} --marker-json "{tmp-marker-json}"`
   from that checkout, and route on its exit code. Before either goes on the line, check that
   `{sha}` is 40 lowercase hex and `{id}` matches `[A-Za-z0-9][A-Za-z0-9._:-]{0,127}`; both
   grammars are shell-inert, and a value that fails its check is not run.
3. On exit 0 with `write`, call `create_or_update_file` with `branch`, `path`, `content`,
   `message` and `sha` (omitted when null): the conditional-write pattern in that same file.
4. On a sha-mismatch or exists rejection, re-read (step 1) and re-run step 2 with `--after-conflict`
   added: it applies the at-or-past check of Writer rules to the fresh file. Exit 0 without
   `write` is success (at-or-past); exit 0 with `write` makes step 3's call once more; any other
   exit routes as in step 2. On a second rejection, re-read and re-run with `--after-conflict`
   again: exit 0 without `write` is success; anything else, a `write` included, is the exit-4 equivalent,
   and nothing is written. A `null` file under `--after-conflict` is exit 4.
5. A step-3 call that fails with no rejection (a 5xx or a network error, a write that landed but
   whose answer was lost included): re-read and re-run with `--after-conflict`. A write that
   landed reads as at-or-past (exit 0 without `write`, success); anything else is the exit-3
   equivalent, and nothing more is written.

`reset` takes `--marker-json` the same way and makes one write; a rejection is the exit-4
equivalent, with no retry.

Init: `--emit`, then `create_branch` (name `release-state`, from the default branch; tolerate
"already exists"), then `create_or_update_file` without `sha`. An exists rejection is the
exit-1 equivalent.

The descent check needs a local clone, because no compare tool is used on the MCP path. Without
one, the CLI exits 5. When exit 5 comes from a shallow clone or git older than 2.29, deepen the
clone (`git fetch --unshallow origin`) or upgrade git, then re-run.

## Recovery: an orphaned or malformed marker

- Orphaned (exit 6): `marker reset --to {sha} --run {id}`. It succeeds only for an orphaned
  marker (basis `orphaned`). `{sha}` is 40 lowercase hex and `{id}` matches
  `[A-Za-z0-9][A-Za-z0-9._:-]{0,127}`; check both before they go on the line (both grammars are
  shell-inert), and do not run a command whose value fails its check.
- Any other marker, a malformed one included: a forced reset (basis `forced`). The reason is free
  text, so it never goes on the command line: with the Write tool, write it to the path
  `node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value release-state-reset-reason.txt`
  prints, then add `--force --reason-file "{that path}"`. Never pass `--reason "…"` from skill
  prose: double quotes still expand `$(…)` and backticks. A reason is one line of at most 200
  characters with no `#`, and the composed commit message must fit the same budget, else exit 2.
- The reset is logged in the `release-state` commit message (`forced: {reason}` when forced).
- The target must be on the first-parent line; one write, and a lost one is contested.
