# Health-State — Durable Cross-Firing Storage Contract

`code-health`, `harness-health`, `journey-health`, and `docs-health` each need rotation cursors, a
filing retry queue, and — where the skill opts in, see the tree below — a sub-threshold
"remembered" cache and/or a durable "declined" suppression record, to survive between scheduled
Routine firings. A scheduled cloud-routine (CCR) firing starts from a fresh, stateless container
every time, so local gitignored disk (`.claude-tweaks/{skill}/*.json`) does not survive between
firings — only `cache.json` (the open/closed/wontfix/regressed dedup cache, rebuilt fresh from
`gh issue list` every run) stays there, since GitHub issue state is already its own source of
truth.

Everything else durable lives on a dedicated branch, **`health-state`**, created once and never
merged into `main` or any other branch — a scratch area for machine bookkeeping only. The tree
below is derived from each skill's own `bin/lib/{skill}/cache.js` construction call to
`createDurableState` — read those four call sites directly (not this file) if this tree and the
code ever appear to disagree:

```
code-health/cursors.json
code-health/remembered.json      # sub-threshold findings — only where includeRemembered is set
code-health/retry-queue.json
code-health/runs.json            # capped to the last 90 records
code-health/declined.json        # label-derived entries only ({lastSeenMs, origin:'wontfix-label'}) — code-health has no `mark` command, so no human-declined entry ever lands here. Same deletion consequence as harness-health's below.

harness-health/cursors.json
harness-health/remembered.json
harness-health/retry-queue.json
harness-health/runs.json
harness-health/declined.json     # fingerprint -> {status:'declined', lastSeenMs} — only where includeDeclined is set. Deleting it: previously-declined/wontfix findings resurface on the next sweep.

journey-health/cursors.json
journey-health/retry-queue.json
journey-health/runs.json
journey-health/declined.json     # same shape/consequence as harness-health's above — journey-health opts into includeDeclined but NOT includeRemembered

docs-health/cursors.json
docs-health/remembered.json
docs-health/retry-queue.json
docs-health/runs.json
docs-health/declined.json        # same shape/consequence as harness-health's above
```

## Mechanism

`bin/lib/health-core/durable-state.js`'s `createDurableState(skillName, { includeRemembered, includeDeclined } = {})`
returns `{ readState(root), writeState(root, mutatorFn), writeStateLocal(root, mutatorFn), pushState(root) }`:

- **`readState`** — `git fetch origin health-state`, then `git show origin/health-state:<path>`
  per file. Degrades to `{}`/`[]` defaults if the branch or a file doesn't exist yet — never
  throws.
- **`writeState`** — builds a new commit entirely from plain git plumbing (`git hash-object`
  for each changed file's blob, `git ls-tree`/`git mktree` to splice those blobs into the
  skill's own subtree and then the branch's root tree, `git commit-tree` on top of the
  branch's current tip), then publishes with a single `git push origin <sha>:refs/heads/
  health-state`. A non-force push is the compare-and-swap: it creates the ref if absent,
  fast-forward-updates it if present, and is rejected if another firing moved the branch
  first — `writeState` retries the whole read-modify-write cycle on rejection (bounded at 3
  attempts). No `gh` CLI, no GitHub MCP tools, no separate bootstrap step — the very first
  write's own commit (no parent) creates the branch. On exhaustion, it returns
  `{ ok: false, error }` rather than throwing — for cursor/run-history bookkeeping, a lost
  write just means the next firing might redo some rotation work, which is safe (GitHub-issue
  fingerprint dedup during `validate-findings` means a redundant scan resolves to `skip`,
  never a duplicate issue). The retry queue is the one exception: `retry-cli.js`'s `drain()`
  returns the queued payloads as-is, with no existence/fingerprint check against GitHub before
  the calling skill re-attempts `gh issue create` — so if a payload's `gh issue create`
  succeeds but the same firing's end-of-run `writeState` (which bundles that dequeue with the
  cursor/run-history update) then exhausts its retries, the un-dequeued entry survives in
  `retry-queue.json` and the next firing's drain re-files it, creating a real duplicate issue
  rather than a safely-redone no-op.
- **`writeStateLocal`/`pushState`** (#2545) — a local-only/explicit-push split for a caller that
  must not push `health-state` as a side effect of its own call (a fan-out judge calling once per
  analysed item, e.g. `harness-health.js validate-findings`). `writeStateLocal` commits the
  mutation onto this namespace's own `refs/heads/health-state-local-{namespace}` branch — never
  `origin` — with no retry loop (there is no remote race to retry against). `pushState` ships
  everything a namespace has accumulated on that local ref to `origin/health-state` in exactly one
  push, re-anchored onto `origin`'s current tip at push time so a sibling namespace's write that
  landed while this one was accumulating locally is preserved. Currently used by
  `harness-health.js`'s `validate-findings`/`push-cursor` pair only — `writeState`'s existing
  callers (`cmdMark` and the other three health skills) are unaffected and keep pushing on every
  call.
- `includeRemembered` (default `false`) gates whether `remembered.json` is ever read or written
  at all for this skill — a property decided once, at `createDurableState` call time, not
  inferred per-write from whether the in-memory state object happens to carry a `remembered`
  key. The skills that pass `{ includeRemembered: true }` are exactly the ones carrying a
  `remembered.json` in the tree above; any skill that leaves the flag at its default can
  never accidentally pick up a stray `remembered.json`.
- `includeDeclined` (default `false`) gates `declined.json` the same way `includeRemembered`
  gates `remembered.json` above — decided once, at `createDurableState` call time. All four
  skills pass `{ includeDeclined: true }`; `code-health` was the last to opt in (#171). It still
  has no `mark` command — see `bin/lib/health-core/mark.js`'s header comment — so a human
  `mark <fingerprint> declined` call can never be its source, but the GitHub-issue `wontfix` path
  below applies to it exactly as to the other three: until it opted in, a `wontfix` suppression
  code-health read off a live issue lived only in the local gitignored cache and was lost with
  the container. `declined.json` holds `{fingerprint: {status:'declined', lastSeenMs,
  origin?}}` entries — a human `mark <fingerprint> declined` call (`mark.js`'s `makeCmdMark`) or a
  GitHub-issue `wontfix` label (`mark.js`'s `mergeWontfixIntoDeclined`) folded in durably so the
  suppression survives a scheduled Routine's fresh container, which the local gitignored cache
  does not. **Deleting `declined.json` un-suppresses every fingerprint in it** — those findings
  are eligible to be re-proposed (and re-filed) on the skill's next sweep, exactly as if they had
  never been declined.
- Each skill's own `bin/lib/{skill}/cache.js` calls these instead of the old local
  `readCursors`/`writeCursors` — same call shape, new storage underneath.
- **`bin/lib/health-core/retry-cli.js`**'s `makeRetryQueueCommands({ readDurableState, writeDurableState })`
  gives the retry-queue drain/update commands (below) one shared implementation, bound to each
  skill's own `readDurableState`/`writeDurableState` — `code-health`, `harness-health`,
  `journey-health`, and `docs-health`'s CLIs each call this instead of restating the same logic
  four times.

This is impure (real `git` calls via an injectable runner), unlike `bin/lib/issues/claims.js`'s
deliberately emit-only design — issue claim/release is a decision-laden, audit-visible action
meant to be legible in the skill's own bash trail; reading/writing this branch is mechanical
plumbing nobody inspects mid-flight, closer to `bin/lib/code-health/scope.js`'s existing
impure-but-isolated git calls.

## Retry / dead-letter queue

Each skill's `retry-queue.json` is an array of
`{ fingerprint, payload, firstFailedAt, attempts, lastError }` — one entry per finding that was
fingerprinted but whose `gh issue create` call failed. Filing itself stays skill-executed
(`gh issue create`, run by the skill's own bash steps, same as always) — only the durable
bookkeeping of *which* findings still need retrying lives in `durable-state.js`.

**Drain-before-rotate.** Every firing's filing step first attempts to re-file everything
already in the skill's retry queue, *before* normal slice/target rotation begins:

1. Read the current queue (`readState(root).retryQueue`).
2. Attempt `gh issue create` for each queued payload, same as any freshly-discovered finding.
3. On success, remove the entry (`dequeueRetry`).
4. On a fresh failure (queue drain, or a brand-new finding that fails to file), add/update the
   entry (`enqueueRetry`) — increments `attempts` for a repeat fingerprint, starts a new one at
   `attempts: 1`.
5. Persist the updated queue in the same `writeState` call that also persists this firing's
   cursor/run-history update — one commit per firing, not one write per queue mutation.
6. For any entry where `shouldEscalate(entry)` is now true (3rd consecutive failure), file (or
   update) a dedicated issue labeled `{skill}:filing-failed` naming the stuck fingerprint and
   its failure history, bootstrapped via `_shared/label-bootstrap.md`'s standard snippet. This
   surfaces the problem through the normal GitHub issue list a human already watches, rather
   than growing the queue silently forever.

## What this contract does not cover

`cache.json`'s open/closed/wontfix/regressed dedup entries — those stay local, gitignored,
rebuilt fresh from `gh issue list` every run, unaffected by this contract.
