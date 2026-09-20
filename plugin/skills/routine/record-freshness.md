# Routine — Record Freshness

Loaded by `/claude-tweaks:routine` before any step that reads
`.claude-tweaks/routines/*.yml`. Three call sites cite it: CREATE Step 3 and UPDATE Step 1
(`create-and-update.md`) and STATUS Step 1 including its `--all` branch (`status.md`).

It lives in its own file rather than inside either of those because `status.md` exists
precisely so a `status --all` run never loads the 30 KB `create-and-update.md`; putting the
shared procedure in either file would undo that split.

## Why this exists

`.claude-tweaks/routines/*.yml` is a **committed** artifact (`.gitignore` carves it out of the
`.claude-tweaks/` rule for exactly that reason), so the branch it is committed to — not the
working checkout — is where a record actually lives. Reading the checkout directly means a
checkout behind that branch reports drift that does not exist, and then feeds that stale read
into real writes (#190):

- **CREATE Step 3** is the dangerous one. A record created and committed upstream is simply
  invisible to a working-tree read, so the idempotency check routes to CREATE and mints a
  **second live routine** for the same project+skill. That is the duplicate this skill's own
  Anti-Patterns table already forbids, and `RemoteTrigger` has no delete action to undo it.
- **UPDATE Steps 1-2** compare a stale `template_version` and then issue a real
  `RemoteTrigger update` and record rewrite from it — reverting a live routine to superseded
  values, and staging that regression for commit.
- **STATUS** only misreports, but it is the highest-frequency entry point (`/claude-tweaks:init`
  Update Mode runs `status --all`), and a record renamed upstream is reported under its old
  name while the new one is invisible.

Distinct from #11 (the *cloud sandbox's* checkout being stale at firing time, addressed by the
template kernel) and #132 (which branch a routine audits). This is the **local skill
invocation** reading stale project state.

**Generalized by #407/#408.** This file's own `git fetch` was a narrow, single-consumer fix for
#190 — one skill's checkout-staleness problem, patched in isolation. `bin/lib/reconcile`
generalizes the same fetch-and-converge operation to every shared-state read point in the
plugin (`session-start.js`, `dispatch/SKILL.md`, `tidy/scan-procedures.md`, routine template
kernels, `_shared/worktree-setup.md`); Step F2 below now calls it too instead of carrying its
own copy. The disposition logic in Step F3 is untouched — only the freshness source changed.

## Step F1 — Resolve the comparison branch

Resolve `INTEGRATION_BRANCH` per `skills/_shared/integration-branch.md`'s Resolution ladder.
Do not restate the ladder here. Two deliberate narrowings, the same shape
`_shared/worktree-setup.md`'s Pre-flight divergence check applies for its own, different reason
(that section excludes rank 5 outright; this one excludes ranks 1-2 and restricts rank 5):
<!-- integration-branch-ranks: excludes=1,2 -->

- **Ranks 1 and 2 do not apply** — `--branch <name>` and `template.branch` name the branch the
  *routine audits*, which is a different question from where this project commits its records.
  A project whose records live on `main` while a routine is deliberately pointed at `dev` would
  otherwise be compared against the wrong tree, turning a fix into a new instance of the same
  bug. Start at rank 3 (`integration-branch:` in `.claude-tweaks/policy.yml`).
- **At rank 5, always take the GitHub-default side of the ladder's mismatch rule** — never the
  current branch. That is the ladder's own documented no-human behavior, and this check never
  surfaces a choice: it is a precondition, not a decision. It also means a session inside a
  linked worktree compares against a real branch rather than a throwaway isolation branch.

Nothing resolved → the per-consumer fallback in that file's table: skip the comparison,
report it unverified, and proceed. See Step F3's Unverified rule.

## Step F2 — Compare

First, run `node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" reconcile` — this generalizes what used
to be this step's own private fetch (see the pointer at the end of this section): reconcile's
mirror-ff check (`bin/lib/reconcile`, #407/#408) already fetches `origin` for the main
checkout, and remote-tracking refs (`refs/remotes/origin/*`) are shared repository-wide, so a
linked worktree sees the same freshly fetched `origin/{INTEGRATION_BRANCH}` this reconcile call
just produced, regardless of which checkout `/claude-tweaks:routine` is running from.

Then, assign and use `INTEGRATION_BRANCH` in the **same** Bash call — a fresh shell per
invocation means a value resolved in an earlier call arrives empty here, and an empty branch
silently degrades the check to unverified:

```bash
export INTEGRATION_BRANCH="<Step F1's resolved branch, or empty if nothing resolved>"
node -e "
  const { compareRoutineRecords, freshnessNote } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/routine-template-parser.js');
  const r = compareRoutineRecords({ branch: process.env.INTEGRATION_BRANCH || undefined, fetch: false });
  console.log(JSON.stringify({ ...r, note: freshnessNote(r) }, null, 2));
"
```

`fetch: false` is deliberate — the reconcile call above already fetched `origin`, so
`compareRoutineRecords` reads the remote-tracking ref reconcile just produced instead of
issuing its own redundant `git fetch`. (The reconcile call is best-effort like every other
call site — if it was skipped or degraded, `compareRoutineRecords` still resolves `origin/
{INTEGRATION_BRANCH}` from whatever remote-tracking state already exists locally; a genuinely
stale ref surfaces as a larger `behind` count, never a false "verified".) `compareRoutineRecords`
returns a verdict over the **union** of the working checkout's records and that branch's. The
union is the point: a record that exists only upstream is exactly the one a working-tree read
cannot see. Relevant fields:

| Field | Meaning |
|---|---|
| `verified` | `true` only when the fetch succeeded and the ref resolved. **Every stop below is gated on this.** |
| `reason` | Why not, when `verified` is false: `branch-unresolved`, `no-remote`, `fetch-failed`, `no-ref` |
| `ref` | The ref compared against, e.g. `origin/dev` |
| `behind` | Commits in `HEAD..{ref}` |
| `records[]` | One entry per filename across both sides: `{filename, presence, uncommitted, authority, fields, local, upstream}` |
| `presence` | `both` \| `local-only` \| `upstream-only` |
| `authority` | Which copy to read — `upstream` when the checkout is behind and the record is not locally edited, else `local` |
| `fields` | Which significant fields differ (`created_at` is excluded: UPDATE Step 7 rewrites it every run, so counting it would make every record differ). `kernel_version` IS significant (unlike `created_at`) — an update that re-assembles against a newer kernel must read as divergence. |
| `onlyUpstream` | Filenames committed upstream and absent here — the duplicate-minting case |

An uncommitted local edit always keeps `authority: 'local'`, even on a behind checkout. That
edit is deliberate in-progress intent and must not be discarded in the name of freshness.

**Always read the copy named by `authority`**, never `local` unconditionally. That single rule
is what makes the report describe the branch of record rather than this checkout.

## Step F3 — Disposition, per call site

The three sites differ because their blast radii differ. The two that **write** stop; the one
that only reads never does.

### CREATE Step 3 — hard stop on `upstream-only`

Existence is `presence` being anything at all — the union, not the working tree:

| Entry for `{PREFIXED_NAME}.yml` | Action |
|---|---|
| `both` or `local-only` | A record exists — continue at UPDATE, exactly as today |
| `upstream-only` | **STOP.** See the message below |
| No entry | No record exists — CREATE proceeds |

Routing `upstream-only` to UPDATE instead would deadlock: UPDATE Step 1 requires the local
file, which is the thing that is missing, so it would send the user straight back to CREATE.
Stop with the state and both recovery paths:

> **BLOCKED — a record for `{PREFIXED_NAME}` is committed on `{ref}` but is not in this checkout.**
>
> upstream: template v`{upstream.template_version}`, schedule `{upstream.schedule or "n/a (one-off)"}`, run_once_at `{upstream.run_once_at or "n/a (recurring)"}`, branch `{upstream.branch or "unpinned"}`, routine_id `{upstream.routine_id}`
> local: absent — this checkout is `{behind}` commit(s) behind `{ref}`
>
> Creating now would mint a second live routine for this project+skill, and `RemoteTrigger` has
> no delete action to undo it. Recover with either:
>
> - `git pull --ff-only origin {INTEGRATION_BRANCH}` — bring the whole checkout current
> - `git checkout {ref} -- .claude-tweaks/routines/` — narrower; leaves the rest of the checkout alone
>
> then re-run `/claude-tweaks:routine create {skill}` (it will route to UPDATE).

### UPDATE Step 1 — hard stop when the local record is behind

Run this **before** Step 1's "no record exists, run `create` first" message. That message is
wrong on a stale checkout — the record does exist, just not here — and acting on it routes to
CREATE, which is the duplicate-minting path above. The two stops interlock deliberately.

Stop when `verified` **and** the entry's `authority` is `upstream` **and** either `presence` is
`upstream-only` or `fields` is non-empty. Otherwise proceed as today.

> **BLOCKED — this checkout's copy of `{PREFIXED_NAME}` is behind `{ref}` by `{behind}` commit(s).**
>
> | Field | this checkout | `{ref}` |
> |---|---|---|
> | *(one row per entry in `fields`)* | … | … |
>
> Every remaining step writes: Step 6 issues a live `RemoteTrigger update` and Step 7 rewrites
> the record. Both would be assembled from the stale copy, reverting the live routine to
> superseded values and staging that regression for commit. Recover with either recovery path
> above, then re-run.

Nothing is stopped when the checkout is behind but *this* record is identical on both sides —
that is the common case after any unrelated commit, and stopping on it would make `update`
unusable on any repo with activity.

### STATUS Step 1 — never stops

STATUS is read-only, and `status --all` is what `/claude-tweaks:init`'s Update Mode fires in
bulk; a stop here would block a read path. Instead:

1. **Enumerate `records[]`, not the directory.** An `upstream-only` record becomes a full row
   with a real verdict — it carries a `routine_id`, so Step 2's `RemoteTrigger get` and Steps
   3/3.5's checks all run normally against it.
2. **Compute every verdict against the `authority` copy.** This is what retires the phantom
   drift: a record already current upstream now reports **In sync** instead of Drifted.
3. **Say which copy was read.** Suffix the row's Detail with `— read from {ref}; this
   checkout's copy is stale` (presence `both`, authority `upstream`) or `— read from {ref}; not
   present in this checkout` (presence `upstream-only`).
4. **Print one banner line above the table**, always: `Compared against {ref} — this checkout is
   {behind} commit(s) behind` (or `up to date`), or the unverified note below.

No new verdict value is introduced. The five in `status.md` stay exactly as they are, so
`skills/init/update-mode.md`'s own enumeration of them keeps resolving.

### Unverified — fail open, out loud

When `verified` is false — no `origin` remote, an unreachable host, a fetch past its timeout (a
captive portal, a hung SSH handshake), no such branch upstream, or no branch resolved at all —
**skip the comparison entirely and proceed exactly as this skill did before this check
existed.** Transient and permanent causes both land here and must not be told apart `[IL-92]`.

Both stops above are gated on `verified === true`, so an offline session is never blocked: a
plane, a locked-down CI runner, and a repo with no remote all keep `/claude-tweaks:routine`
fully usable. This is the same fail-open posture as the hooks' "ambiguity resolves to allow."

Print `freshnessNote(r)` verbatim, once, wherever the run reports anything. It is one line and
it is not optional — silence is what let the original phantom-drift report read as authoritative
with nothing indicating otherwise:

> Record freshness unverified (`origin/dev`): the fetch did not succeed — offline, unreachable,
> or no such branch upstream. Comparing this checkout's copy only — a record committed upstream
> but not present here cannot be seen.
