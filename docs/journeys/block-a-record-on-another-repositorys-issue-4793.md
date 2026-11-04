---
files:
  - plugin/bin/lib/issues/cross-repo-refs.js
  - plugin/bin/lib/issues/cross-repo-states.js
  - plugin/bin/resolve-foreign-blockers.js
  - plugin/bin/lib/issues/record-dependencies.js
  - plugin/skills/dispatch/queue-pull-script.md
  - plugin/skills/dispatch/blocked-exclusion-report.md
  - plugin/skills/dispatch/mcp-transport.md
  - plugin/bin/lib/dispatch/queue-order.js
  - plugin/bin/dispatch-resume.js
  - plugin/bin/lib/preflight-records/blocker-landing.js
  - plugin/bin/preflight-records.js
  - plugin/bin/lib/wrap-up/pack.js
  - plugin/bin/lib/issues/backlog.js
  - plugin/bin/lib/backlog-grant-gate/backlog-grant-gate.js
  - plugin/bin/materialize.js
---

# Block a Record on Another Repository's Issue

**Persona:** a maintainer whose record cannot start until an issue in a different repository is done (an upstream fix, a sibling service), working in a repo that dispatches records automatically.
**Goal:** declare that dependency once, see every surface hold the record while the foreign issue is open, and see it start on its own once that issue closes.
**Entry point:** a record body line `Blocked by owner/name#N`, or a native GitHub "blocked by" link to an issue in another repository.
**Success state:** while `owner/name#N` is open, or its state cannot be read, the record is excluded and named by that qualified ref. Once it closes, the next firing dispatches the record. A same-numbered issue in this repository never stands in for it.

## Steps

### 1. Declare the foreign blocker
- **URL:** `plugin/bin/lib/issues/cross-repo-refs.js` (`parseCrossRepoDependencies`); `plugin/bin/materialize.js` (the `blocked-by:` header)
- **Action:** Add `Blocked by upstream-org/lib#42` to the record body, or link that issue natively as a blocker. For a body line, the spec built from the record lists `upstream-org/lib#42`, repository included, in its `blocked-by:` header. A native-only link is not yet listed there; follow-up #5084 covers that.
- **Should feel:** Like declaring a local blocker. The same sentence form, with only the repository named in front of the number.
- **Should understand:** The qualified ref is a different issue from this repository's `#42`. No surface reads it as the bare number.
- **Red flags:** The header lists `#42`. Refine's dependency repair offers to "wire" `Blocked by #42`. The line is flagged as unwired prose.

### 2. Watch dispatch hold the record
- **URL:** `plugin/skills/dispatch/queue-pull-script.md` (body-text pass); `plugin/skills/dispatch/blocked-exclusion-report.md`; `plugin/bin/lib/issues/cross-repo-states.js` and `plugin/bin/resolve-foreign-blockers.js` (the batched state lookup); `plugin/bin/lib/issues/record-dependencies.js` (`partitionByOpenBodyBlockers`, `openBlockerRefs`)
- **Action:** Run `/claude-tweaks:dispatch` while `upstream-org/lib#42` is open. The queue pull looks up every foreign blocker's state in one batched call and excludes the record: `blocked by an open dependency: #N (blocked by upstream-org/lib#42)`. If the lookup fails, the line reads `upstream-org/lib#42 (state unreadable)`, and one `Warning:` line names the cause.
- **Should feel:** Predictable. The record waits and the report says exactly which outside issue it is waiting on.
- **Should understand:** Only an exact CLOSED state releases the record. Open and unreadable both hold it, so a network blip never lets it start early.
- **Red flags:** The record dispatches while the foreign issue is open. It is excluded as blocked by this repository's `#42`. An unreadable lookup with no `Warning:` line.

### 3. The same rule everywhere else
- **URL:** `plugin/bin/dispatch-resume.js`; `plugin/bin/preflight-records.js` and `plugin/bin/lib/preflight-records/blocker-landing.js` (`/flow` 2.7b); `plugin/bin/lib/wrap-up/pack.js` (newly unblocked); `plugin/bin/lib/issues/backlog.js` (funnel); `plugin/bin/lib/backlog-grant-gate/backlog-grant-gate.js` (headless grant pre-pass)
- **Action:**
  - `/claude-tweaks:dispatch resume #N` refuses and names `open upstream-org/lib#42`.
  - `/claude-tweaks:flow #N` stops at its blocker landing: the entry reads `open` with `via: cross-repository`, and the stop line names `upstream-org/lib#42`.
  - Wrap-up does not report `#N` as newly unblocked.
  - Backlog's funnel files `#N` under `granted` rather than `dispatchable`.
  - The headless grant pre-pass does not grant it `auto:build`.
- **Should feel:** Consistent. No surface contradicts another about whether the record is ready.
- **Should understand:** Every surface that classifies, counts or names blockers applies the dispatch rule, whether the link is native or a body line.
- **Red flags:** Any one surface reporting the record ready while dispatch excludes it.

### 4. From a gh-absent sandbox
- **URL:** `plugin/skills/dispatch/mcp-transport.md` (body-text pass states file); `plugin/skills/backlog/mcp-transport.md`; `plugin/skills/flow/multispec-preflight-failure.md`
- **Action:** In a cloud Routine with no `gh`, the agent reads `upstream-org/lib#42` with `issue_read` and writes `{ "upstream-org/lib#42": "closed" }` to a states file. It runs `export DISPATCH_FOREIGN_STATES={path}` at the top of the same Bash call as the pass. `/flow` takes the same map through `--blocker-states-json`. A state copied in any case counts.
- **Should feel:** Unblocked. The sandbox can still release the record once the foreign issue closes.
- **Should understand:** A ref left out of the file, or given `null`, still reads unreadable and holds the record. Supplying states can only release a record whose blocker really is closed.
- **Red flags:** Every foreign-blocked record excluded forever in a Routine although the agent wrote the states file, for example because the variable was set on an earlier line instead of exported. A ref missing from the file releasing the record.

### 5. The blocker closes
- **URL:** `plugin/bin/lib/dispatch/queue-order.js` (`cacheUsable`)
- **Action:** `upstream-org/lib#42` closes. The next `/claude-tweaks:dispatch` firing skips the queue-order cache, because the last persisted exclusion named a foreign blocker. It reads the CLOSED state and dispatches `#N`.
- **Should feel:** Automatic. Nobody has to touch the record after the outside issue closes.
- **Should understand:** A cache hit never replays an exclusion that names a foreign blocker, because the foreign issue can close without anything in this repository changing.
- **Red flags:** The record stays excluded after the foreign issue closes, until something unrelated in the queue changes.

## Origin
- Created during `/claude-tweaks:build` of record #4793 (2026-11-04): native and body-declared cross-repository blockers block unless exactly CLOSED, are named `owner/name#N` on every blocker surface, and can be supplied by gh-absent transports.
- Related records: #4553 (closed blocker that never landed), #3691 (gh-absent dispatch), #5084-#5087 (follow-ups filed from this build).
