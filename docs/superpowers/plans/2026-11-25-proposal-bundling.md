# Review Console Proposal Bundling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Before a run's Review Console creates anything, bundle the run's staged record proposals that share a Key File (within one landing class) into one `staged/bundle-{n}.md` proposal with a per-finding checklist, so N related follow-ups file as one record.

**Architecture:** A pure library (`plugin/bin/lib/console/bundle.js`) classifies, groups (via `groupByFileOverlap` with backlog-computed hubs) and composes bundles; a gh-free CLI (`plugin/bin/bundle-proposals.js`) enumerates the run's staged proposals, stages each bundle, moves members out of `staged/` into a sibling `bundled/` directory, rewrites member ledger rows, logs one `AUTO` line per bundle, and supports `--unbundle`. Fingerprint extraction gains a multi-marker reader so dedup maps see every member's marker. Console prose runs the CLI once per console, before ledger-narrowing auto-file and before `console.json` is written.

**Tech Stack:** Node 18+ CommonJS, `node --test`, markdown skill prose.

**Spec:** `.claude-tweaks/pipelines/2026-11-25T111524-record-6283/work/6283-spec.md` (record #6283)

Scope keywords: extractFingerprint, groupByFileOverlap, CANONICAL_PREFIXES, ledger-narrowing-auto-file

## Global Constraints

- The bundler CLI never calls `gh` (spec Deliverable "Bundler CLI").
- Hub threshold: `max(HUB_PATH_MIN_COUNT=3, ceil(n × HUB_PATH_FRACTION=0.1))` over the open-backlog records — the same constants `groupByFileOverlap` uses.
- Size guard default: `GROUP_SIZE_GUARD_DEFAULT = 10` (from `grouping.js`); oversized groups are chunked into consecutive bundles in manifest order; a trailing chunk of 1 is a singleton.
- `plugin/skills/flow/multispec-review-console.md` must stay below 52,500 bytes (`wc -c`), currently 52,479 B.
- Bundles never carry an `auto:*` or `bot:*` label; `by:*` only when every member shares the same one.
- Bundling adds no stop in `auto` mode; `queueWriteAutoFile`/`consoleAutoResolve` treat a bundle like any `Q#`.
- Scope and edit discipline: "Commit tests only where the task asks for them or the repo already keeps tests for this kind of change, sized like the neighboring test files; scratch checks stay scratch. Touch only what the task requires — a pre-existing bug you notice is a follow-up to report, not a fix to fold in, unless the task cannot work without it. Don't reformat or "improve" adjacent code; edit in place rather than rewrite when the result is the same."
- Maturity `established`: for any task modifying pre-existing behavior, write a full characterization test covering edge cases before changing it.
- Run tests per file: `node --test {file}`; every `git`/`node` command uses absolute paths inside the worktree, one plain command per Bash call.

## Review Focus

1. A member proposal whose body quotes another record's `work-fingerprint` marker (defused or inside a fence) — `extractFingerprints(bundleBody)` must return only the trailing-block markers (Task 4 test).
2. A crash between staging the bundle and retiring members — a rerun must not create a second bundle for already-bundled members nor lose any member (Task 5: rerun idempotency test, and retire order bundle-first).
3. A `ledger-record-*` member whose ledger row cannot be found — it must stay a singleton, never be retired with a stale ledger Resolution (Task 5 test).
4. Members whose staged file has CRLF line endings or no trailing newline — header parsing (`Labels:`, `Type:`, `Title:`) must still work (Task 4 test).
5. An open-backlog snapshot that is an empty array (fresh-but-empty) — treated as unreadable: exit 4, nothing written (Task 5 test).

---

### Task 1: `groupByFileOverlap` accepts external hubs; `backlogHubPaths`

**Files:**
- Modify: `plugin/bin/lib/issues/grouping.js` (`groupByFileOverlap` ~line 60; exports line 637)
- Test: `tests/bin-lib/issues/grouping.test.js`

**Interfaces:**
- Produces: `groupByFileOverlap(items, { hubPaths?: Set<string>, hubPathMinCount?, hubPathFraction? }) -> string[][]` (ids); `backlogHubPaths(openRecords: Array<{body, labels}>, options?: { hubPathMinCount?, hubPathFraction? }) -> Set<string>` — counts `extractKeyFiles(record)` paths, threshold `max(minCount, ceil(openRecords.length × fraction))`, reusing `computeHubPaths`.

- [ ] **Step 1: Write failing tests** in `grouping.test.js`:
  - `groupByFileOverlap with hubPaths: a path in hubPaths never bridges, a path not in it bridges even when 3 items share it` — items `a,b,c` all with `x.js`; with `{ hubPaths: new Set() }` → `[['a','b','c']]`; without options → three singletons (x.js is a computed hub at n=3).
  - `backlogHubPaths: a path cited by >= max(3, ceil(n*0.1)) open records is a hub` — 4 records with `### Key Files` bodies citing `hot.js` in 3 and `cold.js` in 2 → `new Set(['hot.js'])`; 40 records with `hot.js` in 3 → empty set (threshold 4).
- [ ] **Step 2: Run** `node --test tests/bin-lib/issues/grouping.test.js` — Expected: FAIL (`backlogHubPaths is not a function`; hubPaths test groups differ).
- [ ] **Step 3: Implement** — `options.hubPaths instanceof Set` replaces the computed set; otherwise unchanged. Export `backlogHubPaths`.
- [ ] **Step 4: Run** the same command — Expected: PASS, including every pre-existing test (AC 15's "no hubPaths → same groups as before").
- [ ] **Step 5: Commit** `git add` both files; message `Add external hub paths to file-overlap grouping — refs #6283`.

### Task 2: Multi-marker fingerprints and every-marker dedup maps

**Files:**
- Modify: `plugin/bin/lib/issues/record-fingerprint.js` (add `extractFingerprints`, export)
- Modify: `plugin/bin/lib/issues/record.js` (both re-export lists, lines ~40 and ~61)
- Modify: `plugin/bin/lib/console/finding-filing.js` (`fingerprintMap`, line 279)
- Modify: `plugin/bin/lib/console/backfill-dispose.js` (`withFingerprint` line 217; staged-kind lookup ~line 451)
- Modify: `plugin/skills/specify/record-creation.md` (Idempotency map snippets lines 37 and 56)
- Test: `tests/bin-lib/issues/record-fingerprint.test.js` (create if absent — check `tests/bin-lib/issues/` for the existing record fingerprint tests first and add there instead), `tests/bin-lib/console/finding-filing.test.js`, `tests/bin-lib/console/backfill-dispose.test.js`

**Interfaces:**
- Produces: `extractFingerprints(body: string) -> string[]` — every marker in body order (work HTML-comment, legacy HTML-comment, plain-text `work-fingerprint:` lines), deduped (first occurrence keeps its position); `[]` for non-string/empty. `extractFingerprint` unchanged (first-wins contract).
- Produces: `fingerprintMap(rows)` maps **every** marker of each row to its number; first record wins per marker.

- [ ] **Step 1: Write failing tests:**
  - `extractFingerprints returns every marker in body order, deduped` — body with `<!-- work-fingerprint: a -->\nwork-fingerprint: a\n<!-- work-fingerprint: b -->\nwork-fingerprint: b` → `['a','b']`; legacy `<!-- code-health-fingerprint: c -->` included; `extractFingerprint` on the same body → `'a'`.
  - `extractFingerprints ignores defused markers` — `defuse('<!-- work-fingerprint: z -->')` + real marker `y` → `['y']`.
  - `fingerprintMap maps every marker of a bundle body to its record` — row `{ number: 7, body: <markers a,b> }` → `{ a: 7, b: 7 }`; an earlier row holding `b` keeps `b`.
  - backfill-dispose: `a staged Queue-writes proposal whose second marker already maps to an existing record reuses that record` — staged text with markers `m1,m2`, existingIssues row `#42` carrying only `m2` → disposition reuse `{ number: 42 }`.
- [ ] **Step 2: Run** each test file — Expected: FAIL.
- [ ] **Step 3: Implement.** In `backfill-dispose.js`, `withFingerprint` additionally returns `fingerprints: extractFingerprints(text)` (empty when minted); the staged-kind lookup checks `checkFingerprint(known, f)` for each of those after `filedRecordOf` returns null, first hit wins. Keep the proposal's `fingerprint` (identity) first-wins. Leave `preflight-records.js` and `materialize.js` on `extractFingerprint`. In `record-creation.md` replace each `const fp = extractFingerprint(x.body); if (fp && !(fp in map)) map[fp] = …;` with a loop over `extractFingerprints(x.body)` doing the same per marker, and import `extractFingerprints` instead.
- [ ] **Step 4: Run** the three test files plus `node --test tests/bin-lib/console/console-filings-cli.test.js` and any test that greps `record-creation.md` (`git grep -l "record-creation.md" -- tests`) — Expected: PASS.
- [ ] **Step 5: Commit** — `Read every fingerprint marker in dedup maps — refs #6283`.

### Task 3: `bundle-` console prefix

**Files:**
- Modify: `plugin/bin/lib/console/resolve.js` (`SECTION_MAP`, `CANONICAL_PREFIXES`)
- Test: `tests/bin-lib/console/resolve.test.js` (the "classifyStagedItem maps every known prefix" table)

**Interfaces:**
- Produces: `classifyStagedItem('bundle-1.md', text)` → `{ section: SECTIONS.QUEUE }`.

- [ ] **Step 1: Add the known-prefix case** `['bundle-1.md', SECTIONS.QUEUE]` (match the table's existing shape).
- [ ] **Step 2: Run** `node --test tests/bin-lib/console/resolve.test.js` — Expected: FAIL (`unmapped-prefix`).
- [ ] **Step 3: Implement** a new row `[/^bundle-/, SECTIONS.QUEUE]` placed with the other QUEUE rows (after `premise-satisfied-`), and `'bundle-'` in `CANONICAL_PREFIXES` beside `'premise-satisfied-'`. Per the `review-console-section-addition` project skill this is "a new prefix in an existing section": only these two sites plus the test move.
- [ ] **Step 4: Run** `resolve.test.js`, `tests/bin-lib/console/staged-id-producers.test.js`, `tests/console-resolve-conformance.test.js` — Expected: PASS.
- [ ] **Step 5: Commit** — `Route bundle- staged proposals to Queue writes — refs #6283`.

### Task 4: Bundler library `bundle.js`

**Files:**
- Create: `plugin/bin/lib/console/bundle.js`
- Test: `tests/bin-lib/console/bundle.test.js`

**Interfaces:**
- Consumes: Task 1 `groupByFileOverlap(items, { hubPaths })`, `GROUP_SIZE_GUARD_DEFAULT`, `extractKeyFilesSection`; Task 2 `extractFingerprint`, `defuse`; `specShapedBody`, `recordPayload` (`plugin/bin/lib/issues/record.js`); risk-flag readers/writer from `plugin/bin/lib/issues/record-risk-flags.js` (never hand-type the `Risk-flags:` line); `findNearDuplicates`/`isRelatedCandidate`/`isStrongNearDuplicate` from `plugin/bin/lib/issues/near-duplicate.js`.
- Produces:
  - `parseProposal(name: string, text: string) -> { name, title, type, labels: string[], deferReason, body, keyFiles: string[], fingerprint: string|null } | null` — header = lines up to the first blank line (CRLF tolerated); `null` when no `Title:` header.
  - `classifyLandingClass(labels: string[]) -> 'ready' | 'needs-definition' | 'parked' | null` — Closed rule: `parked` without `ready` → `parked`; `needs:definition` without `ready` → `needs-definition`; `ready` with neither → `ready`; anything else (including ready+parked, ready+needs:definition, none) → `null`.
  - `planBundles(proposals: Array<ParsedProposal & { key: string }>, { hubPaths: Set<string>, groupSizeGuard?: number }) -> { bundles: Array<{ class, members: ParsedProposal[], sharedPaths: string[] }>, singletons: ParsedProposal[], skipped: Array<{ key, reason }> }` — input order is manifest order; `parked` → singleton; `null` class → singleton plus skipped `{ reason: 'singleton: unrecognized landing class' }`; group per class with `groupByFileOverlap(items.map(p => ({ id: p.key, keyFiles: p.keyFiles })), { hubPaths })`; members of a group kept in manifest order; chunk into consecutive slices of at most `groupSizeGuard` (default `GROUP_SIZE_GUARD_DEFAULT`); a slice of 1 is a singleton. `sharedPaths`: non-hub, non-directory paths cited by 2+ members of the bundle, sorted.
  - `composeBundle(bundle, { openRecords?: Array }) -> { title, type, labels: string[], deferReason, text }` — `text` is the full staged file (header lines `Title:`/`Type:`/`Labels:`/`Defer-reason:`, blank line, body).
- Composition rules (spec Technical Approach + AC 7):
  - Title: `Bundle: {N} follow-ups touching {sharedPaths[0]}`.
  - Type: the members' shared `Type:` value, else `task`.
  - Labels: `risk:` max over members that carry one (low<medium<high; omitted if none), `size:` max likewise; `ready` + scoring for class `ready`; `needs:definition` and no `risk:`/`size:` for class `needs-definition`; a `by:*` label only when every member carries the same one; never `auto:*`/`bot:*`.
  - Defer-reason: the value most members share; tie → first member's.
  - Body via `specShapedBody`: `header` = one `**Related:** #N` line per near-duplicate hit against `openRecords` (strong or related candidate) when given, plus the union `Risk-flags:` line written through the risk-flags writer; `currentState` = per member `### {title}` + `Source: staged/{name}` + its body passed through `defuse`; `deliverables` = one `- [ ] {title} — Defer-reason: {deferReason} (staged/{name})` per member; `acceptanceCriteria` (ready) = per member `### {title}` + that member's `## Acceptance Criteria` section text (defused), or `openQuestion` (needs-definition) = per member `### {title}` + its `## Open Question` text; `releaseNote` = members' Release Note sentences joined, else `No user-visible change.`; `keyFiles` = union of member key files in first-seen order (`change: 'modify'`); `filedBy: 'review console proposal bundling'`; `provenance: { origin: 'review console bundle of {N} staged proposals', deferReason }`; `footer: '_Filed by \`review console proposal bundling\` via specShapedBody._'`.
  - Trailing marker block: for each member with a fingerprint, in member order, `<!-- work-fingerprint: {fp} -->\nwork-fingerprint: {fp}`.

- [ ] **Step 1: Write failing tests** in `bundle.test.js` (fixtures composed with `recordPayload` + `specShapedBody` so headers match real producers):
  - `AC1: 5 ready proposals, 3 sharing one Key File → 1 bundle of 3 and 2 singletons`.
  - `AC2: parked and needs:definition proposals sharing a Key File with ready ones never join the ready bundle; parked stays a singleton`.
  - `AC3: two needs:definition proposals sharing a file → one bundle whose text has "## Open Question" listing both questions and whose labels exclude "ready"`.
  - `AC4: a 12-member group with groupSizeGuard 10 → bundles of 10 and 2 in manifest order; a 11-member group → 10 + 1 singleton`.
  - `AC5: a file cited by 3 run proposals but below the backlog hub threshold bundles them; the same file in hubPaths does not bridge`.
  - `AC6/AC15: extractFingerprints(bundle text) returns every member marker in member order; extractFingerprint returns the first; a member body quoting a marker (raw, defused, or fenced) adds nothing`.
  - `AC7: labels = highest risk, size >= largest member, shared Type else task, Defer-reason majority (tie → first member)`.
  - `AC17: classifyLandingClass — parked → parked; ready+parked → null; ready+needs:definition → null; no Labels → null`.
  - `Review Focus 4: CRLF header parses`.
- [ ] **Step 2: Run** `node --test tests/bin-lib/console/bundle.test.js` — Expected: FAIL (module not found).
- [ ] **Step 3: Implement** `bundle.js` (pure: no fs, no process).
- [ ] **Step 4: Run** the same command — Expected: PASS.
- [ ] **Step 5: Commit** — `Add the proposal bundling library — refs #6283`.

Proof(public-contract): the staged-file contract an older console reads stays valid — Task 5's AC 8 test runs the current `resolveAll` and a copy of `classifyStagedItem` with the `bundle-` row removed over a bundled run dir and asserts no retired member is classified and the bundle routes to Pending review, and Task 2 keeps `extractFingerprint`'s first-wins return pinned by its existing tests.

### Task 5: Bundler CLI `bundle-proposals.js`

**Files:**
- Create: `plugin/bin/bundle-proposals.js`
- Test: `tests/bin-lib/console/bundle-proposals-cli.test.js`

**Interfaces:**
- Consumes: Task 4 (`parseProposal`, `classifyLandingClass`, `planBundles`, `composeBundle`); Task 1 `backlogHubPaths`; `refusedStagedNames`, `SHADOW_DUP_RE` (`resolve.js`); `writeStagedItem`/`resolveTarget` (`plugin/bin/lib/stage-item/write.js`, the `--allocate` path); `settleRow` (`plugin/bin/lib/stage-item/ledger.js`) and `resolveLedgerPath` (`plugin/bin/lib/wrap-up/ledger-write.js`) exactly as `hooks.js`'s `runLedgerRow` uses them; `appendEntry`/`formatEntry` (`plugin/bin/lib/log-decision/append.js`); `queryRecords` (`plugin/bin/lib/issues/local-store.js`) for `--local`.
- Produces (follow the `gh-api-module-pattern` project skill's `cli-wrapper-contract.md`: `run(argv, deps)` + `realDeps`, entry guard, run-dir anchoring guard):
  - `node plugin/bin/bundle-proposals.js --run <run-dir> (--records-json <path> | --local) [--ledger <path>] [--group-size-guard <n>]` → stdout one JSON line `{ bundles: [{ path, class, members: [<member staged path relative to --run>], sharedPaths }], singletons: [<paths>], skipped: [{ path, reason }] }`.
  - `node plugin/bin/bundle-proposals.js --run <run-dir> --unbundle bundle-{n}.md [--ledger <path>]` → restores every member and removes the bundle.
  - Exit codes: 0 success (including nothing to bundle); 2 malformed invocation; 3 run dir not anchored or a write failed; 4 open-backlog records unreadable, not an array, or an empty array (nothing written, nothing logged).
- Behavior:
  - Enumerate: `{run}/spec-*/staged/` (spec dirs in `manifest.yml` order when readable — reuse the reader in `plugin/bin/lib/run-manifest/` or `plugin/bin/lib/wrap-up/pack.js`; else numeric `N` order), then `{run}/staged/`; filenames sorted within a dir. Input set: `.md` files named `leftover-*`, `ledger-record-*`, `review-followup-*`, or any `.md` whose header carries `Title:` plus `Type:` or `Labels:`; excluded: `.shadow-dup*`, `ledger-record-sdd-ruling-*`, `bundle-*`, files carrying a `Bundled-into:` header line, and each dir's `refusedStagedNames(decisions.md)`. An unreadable or unparseable member → `skipped` with a reason, left in place.
  - Empty input set → exit 0, print `{ bundles: [], singletons: [], skipped: [] }`, write and log nothing.
  - `ledger-record-*` member: locate its ledger row by the row whose Resolution names its staged path (spec-qualified `spec-{N}/staged/{name}` in a multi-spec run, else `staged/{name}`); none found (or no ledger resolves) → the member is a singleton and `skipped` gets `{ reason: 'singleton: ledger row not found' }` before planning.
  - Per bundle, in order: (1) stage `bundle-{n}.md` in `{run}/staged/` via `writeStagedItem` with allocate (request `bundle-1`); (2) for each member write `{memberDir}/bundled/{name}` = `Bundled-into: staged/bundle-{n}.md` + (ledger members) `Ledger-row: {ledgerPath}#{row}` + `Ledger-resolution-was: {original}` header lines prepended to the original text, then delete `{memberDir}/staged/{name}`; (3) settle each ledger member's row with status unchanged and Resolution = original with its staged-path token replaced by `staged/bundle-{n}.md`; (4) append one `AUTO` entry to `{run}/decisions.md`, section `/wrap-up`, step `Proposal bundling`: `bundled staged/bundle-{n}.md ({class}) from {member paths, comma-joined}; shared: {sharedPaths, comma-joined}`, `Reversibility: high`.
  - `--unbundle`: for each `bundled/` file whose `Bundled-into:` names the bundle, write the original text back to `staged/{name}`, restore its ledger row's Resolution from `Ledger-resolution-was:`, delete the `bundled/` copy; delete `staged/bundle-{n}.md`; one `AUTO` line `un-bundled staged/bundle-{n}.md → {member paths}`, `Reversibility: high`.

- [ ] **Step 1: Write failing tests** (temp run dirs under the anchoring rule — copy how `tests/bin-lib/console/console-filings-cli.test.js` or `shadow-dup-proposal.test.js` build an anchored run dir; call `run(argv, deps)` in-process):
  - `AC8: after bundling, resolveAll/classifyStagedItem see the bundle and no member; with the bundle- row removed from a SECTION_MAP copy the bundle classifies unmapped-prefix and still no member; every staged path a member's original STAGED decisions.md line names no longer exists under staged/; a scan for Title:/Type:/Labels: headers under staged/ finds only the bundle and singletons`.
  - `AC10: each bundled ledger-record member's ledger row Resolution names staged/bundle-1.md`.
  - `AC11/AC18: one AUTO line per bundle naming the bundle path, its members, the shared paths, and Reversibility: high`.
  - `AC12: empty set → exit 0, no write, no log; a malformed member stays a singleton in skipped; unreadable --records-json → exit 4, nothing written; Review Focus 5 / AC17: --records-json holding [] → exit 4`.
  - `AC14: a second run over the same dir is a no-op (no new bundle, no member re-staged)`.
  - `AC16 (un-bundle): --unbundle restores every member's staged file byte-for-byte and its original ledger Resolution, removes the bundle, logs one AUTO line`.
  - `Review Focus 3: a ledger-record member with no ledger row stays a singleton and is not retired`.
  - `multi-spec: members in spec-1/staged and spec-2/staged bundle into {run}/staged/bundle-1.md and retire into their own spec-N/bundled/`.
- [ ] **Step 2: Run** `node --test tests/bin-lib/console/bundle-proposals-cli.test.js` — Expected: FAIL.
- [ ] **Step 3: Implement** the CLI.
- [ ] **Step 4: Run** the test file plus `node --test tests/bin-lib/console/staged-id-producers.test.js` — Expected: PASS.
- [ ] **Step 5: Commit** — `Add the bundle-proposals console CLI — refs #6283`.

### Task 6: Carrying a bundle settles every member's ledger row

**Files:**
- Modify: `plugin/bin/console-resolve.js` (`setItem` guard ~line 629, `carryItem` ~line 524-550, usage text ~line 169, header comment ~line 117)
- Test: `tests/bin-lib/console/ledger-carry.test.js`

**Interfaces:**
- Produces: `console-resolve.js --run <dir> --set-item bundle-{n}.md --resolution carried --reason <text> --ledger <path>` (control mode) settles every ledger row naming `staged/bundle-{n}.md` `deferred` with `carried to the acceptance packet as {factId}` — one decision fact for the bundle, one settle per member row. A `ledger-record-*` id keeps its exactly-one-row rule.

- [ ] **Step 1: Write failing test** `a carried bundle settles every ledger row naming it` — ledger with rows #1, #2 naming `staged/bundle-1.md`, console.json item `bundle-1.md` resolved `apply`; control mode on → exit 0, both rows `deferred` with the carried text; and `--ledger on a non-bundle, non-ledger-record id still exits 2`.
- [ ] **Step 2: Run** `node --test tests/bin-lib/console/ledger-carry.test.js` — Expected: FAIL (exit 2 `--ledger applies only to a ledger-record-* item`).
- [ ] **Step 3: Implement** — accept `bundle-` ids with `--ledger`; for them allow `found.rows.length >= 1` and settle each row; update usage/header text.
- [ ] **Step 4: Run** `ledger-carry.test.js` and `tests/bin-lib/console/control-mode-cli.test.js` — Expected: PASS.
- [ ] **Step 5: Commit** — `Settle every member ledger row when a bundle is carried — refs #6283`.

### Task 7: Console wiring prose

**Files:**
- Create: `plugin/skills/wrap-up/proposal-bundling.md`
- Modify: `plugin/skills/wrap-up/review-console.md` (new short `## Proposal bundling (runs before ledger narrowing)` section directly above `## Ledger narrowing auto-file`)
- Modify: `plugin/skills/flow/multispec-review-console.md` (one-line pointer in "When to run the consolidated console" before step 2's reads; trim at least as many bytes elsewhere in the file)
- Modify: `plugin/skills/wrap-up/ledger-narrowing-auto-file.md`
- Modify: `plugin/skills/_shared/ledger-format.md` (beside the `Keep`/`Defer` bullets ~line 271-272)
- Test: `tests/proposal-bundling-conformance.test.js`

**Interfaces:**
- Consumes: Task 5 CLI and exit codes; Task 6 carry route.

- [ ] **Step 1: Write failing conformance test** asserting: `proposal-bundling.md` contains the CLI invocation `bin/bundle-proposals.js" --run`, a `log-decision.js … --status SKIP` command whose text names the bundler exit (`condition: bundle-proposals.js exited {code}`), the `--unbundle` Override route, and the `--set-item bundle-{n}.md --resolution carried` route; `review-console.md` cites `proposal-bundling.md` before its `ledger-narrowing-auto-file.md` citation; `ledger-narrowing-auto-file.md` contains `Bundled-into:` and states it runs after bundling; `multispec-review-console.md` cites `proposal-bundling.md` and is under 52,500 bytes (AC 13); `ledger-format.md` names `staged/bundle-{n}.md` for a bundled member's Resolution.
- [ ] **Step 2: Run** `node --test tests/proposal-bundling-conformance.test.js` — Expected: FAIL.
- [ ] **Step 3: Write the prose.**
  - `proposal-bundling.md`: runs once per console (single-spec: the run dir; multi-spec: the parent dir, once), before ledger-narrowing auto-file and before `console-resolve.js` writes `console.json`, skipped under `--dry-run`. Records file: `work-backend: github-issues` → the session record snapshot (`record-snapshot.js`'s `snapshotPath`, refreshed by `_shared/record-queue-fetch.md`'s read-fresh-or-fetch block) as `--records-json`; `local-files` → `--local`. Pass the run's ledger path as `--ledger` when one exists. Any non-zero exit: bundle nothing, log one Degrade-trace `SKIP` (`condition: bundle-proposals.js exited {code} → fallback: every proposal files individually`), proceed. A bundle renders as one `Q#` row (its title names the member count). Override offers `un-bundle {Q#}` (human-present only) → `--unbundle`. A bundle whose create fails or is carried under control mode → `console-resolve.js --set-item bundle-{n}.md --resolution carried --reason '{why}' --ledger "{ledger}" --run "{run}"` (settles every member row).
  - `review-console.md`: two-sentence section citing `proposal-bundling.md`.
  - `multispec-review-console.md`: one pointer line; trim redundant words elsewhere to stay below 52,500 B.
  - `ledger-narrowing-auto-file.md`: it runs after proposal bundling; skips a proposal carrying `Bundled-into:` and any `decisions.md` line whose staged path no longer resolves to a creatable proposal file.
  - `ledger-format.md`: a bundled `ledger-record-*` member's Resolution names `staged/bundle-{n}.md`; a bundle whose create fails or is carried settles every member's row through the `--set-item bundle-{n}.md … --ledger` route.
- [ ] **Step 4: Run** the conformance test plus every test that pins these files (`git grep -l -e "review-console.md" -e "multispec-review-console.md" -e "ledger-narrowing-auto-file.md" -e "ledger-format.md" -- tests`) and the rail tests (`git grep -l "RAIL_BYTES" -- tests`) — Expected: PASS.
- [ ] **Step 5: Commit** — `Run proposal bundling before the Review Console files records — refs #6283`.
