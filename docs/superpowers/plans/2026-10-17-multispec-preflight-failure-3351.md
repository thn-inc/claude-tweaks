# Multi-spec Step 3 Pre-flight Failure Ruling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `/flow` multi-spec Validation step 3 an explicit ruling for a failed `preflight-records.js` call, and give the CLI a `gh`-free `--records-json` input so cloud runs get real record data.

**Architecture:** `bin/preflight-records.js` gains `--records-json <path>`: a validated array of already-fetched records replaces `fetchIssues`, with no `gh` call at all; under `work-links: native` it falls back to body-text `blockedBy` and flags `nativeLinksUnchecked: true`. The ruling (retry-once-then-STOP on exit 1, STOP on exit 2, the `--records-json` path without `gh`, a logged `SKIP` for unchecked native links) lives in a new `flow/multispec-preflight-failure.md`, cited from `multi-spec.md` step 3 — `multi-spec.md` is at its read budget — and the merge gate and waves fallback point back to it.

**Tech Stack:** Node 18+ CommonJS, `node --test`, Markdown skill prose.

**Spec:** `.claude-tweaks/pipelines/2026-10-17T095806-spec-3351/work/3351-spec.md`

Scope keywords: records-json, nativeLinksUnchecked

Consumer classification (Check B with the broader keyword `preflight-records` matched 17 files; none change): the CLI change is additive — a new optional flag, and an envelope key present only on the new path — so every existing caller keeps its exact behavior. `plugin/skills/dispatch/SKILL.md`, `plugin/skills/flow/multispec-freshness.md`, `plugin/bin/resolve-blockers.js`, `plugin/bin/lib/backlog-grant-gate/backlog-grant-gate.js`, `plugin/bin/lib/issues/native-dependencies.js`, `plugin/bin/lib/repo-resolve.js`, `plugin/bin/lib/preflight-records/{merge-gate,waves}.js` (+ their tests), the three `docs/journeys/*` files and `docs/skill-graph.md` only cite or share primitives with the CLI. `tests/flow-claim-preflight.test.js` is a content pin, honored by Global Constraints. `plugin/skills/flow/claim-targets.md` has the same unhandled-non-zero-exit gap, but for a never-gate warning — out of scope per the spec's Gotchas and reported separately.

Waived AC11.1: `npm test` runs once, centrally, in /build's Common Step 5 — not as a task test.

## Global Constraints

- `plugin/skills/flow/multi-spec.md` must stay `< 20480` bytes (pinned by `tests/flow-ledger-creation-timing-conformance.test.js:114`, `tests/run-dir-timestamp-utc.test.js:95`, `tests/timing-prose-conformance.test.js:14`). Merge base: 19,957 bytes → 522 bytes of headroom. Measure with `wc -c` after every edit.
- `tests/flow-claim-preflight.test.js` pins `multispec-merge-gate.md` to keep a line matching `/preflight-records\.js[^\n]*--merge-gate/` and `multispec-parallel-waves.md` to keep `/preflight-records\.js[^\n]*--waves/` — do not break either onto two lines.
- Every new `plugin/skills/flow/*.md` file must be listed in `docs/plugin-structure.md`'s `| flow | … |` row (`tests/flow-subfile-table-completeness.test.js`).
- CLI exit vocabulary unchanged: 0 success, 1 a fetch/native GraphQL call failed, 2 malformed invocation. Every `--records-json` input problem is exit 2; the `--records-json` path can never exit 1 (it fetches nothing).
- No silent fallback in either direction: `--records-json` never shells out to `gh` when the file is bad; the `gh` path never switches to body text when the native call fails.
- The `nativeLinksUnchecked` key appears in the envelope only when true (only on the `--records-json` + `native` path).
- Degrade clauses cite their conventions, never restate them uncited: `_shared/github-write-transport.md` (MCP `issue_read` get-mode row — the `gh`-absent read), `flow/materialize.md`'s `--record-json` paragraph (#1459 — reshape to `gh issue view`'s field names), `dispatch/mcp-transport.md` (#2523 — native links have no MCP equivalent), `_shared/session-tmp-root.md` (temp file path).

## Review Focus

- A records file whose `labels` are bare strings rather than `{name}` objects — must produce the same facets as the `{name}` shape (`parseRecordFacets` accepts both); covered by the Task 1 label-shape test.
- A records file carrying an extra record not named on the command line — must be exit 2, never silently included in `overlapGroups`; covered by Task 1's "number not requested" case.
- `--records-json` combined with an explicit `--work-links native` flag (not just policy-resolved native) — same degrade, same flag; covered by Task 1's native test, which passes the flag explicitly.
- A `--waves` dependency cycle on the `--records-json` path — must still exit 2 with the cycle message, as on the `gh` path; covered by Task 1's cycle test.
- A reader of the ruling who sees exit 1 under `parallel` — the waves re-run without `--waves` is the one retry, never a third call; pinned by Task 2's conformance test.

---

### Task 1: `--records-json` input on `bin/preflight-records.js`

**Files:**
- Modify: `plugin/bin/preflight-records.js` (header comment, `USAGE`, `parseArgs`, `realDeps`, `run`)
- Modify: `plugin/bin/lib/preflight-records/preflight-records.js` (add and export `issuesFromRecordsJson`)
- Test: `tests/bin-lib/preflight-records/preflight-records.test.js`

**Interfaces:**
- Produces: `issuesFromRecordsJson(raw: unknown, numbers: number[]) -> { ok: Map<number, issue> } | { error: string }` in `plugin/bin/lib/preflight-records/preflight-records.js` — `raw` is the parsed JSON; `ok` is the same Map shape `fetchIssues` returns (`number → {number, title, body, labels}`). Error strings: `"--records-json must be a JSON array"`, `"--records-json entry {i} is missing a numeric \"number\""`, `"--records-json entry #{n} is missing a string \"body\""`, `"--records-json lists #{n} more than once"`, `"--records-json is missing requested #{n}"`, `"--records-json lists #{n}, which was not requested"`.
- Produces: CLI flag `--records-json <path>`; envelope `{ records, overlapGroups, workLinks, nativeLinksUnchecked?, mergeGate?, waves? }`; stderr degrade line `preflight-records.js: --records-json makes no gh call — native blocked-by links unchecked; blockedBy read from record bodies (work-links: body-text)`.
- Produces: `deps.readFile(path) -> string` seam (real: `fs.readFileSync(path, 'utf8')`).

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/preflight-records/preflight-records.test.js`, after the existing CLI tests. Extend `cliDeps` with an optional `files = {}` map and `readFile: (p) => { if (!(p in files)) throw new Error(`ENOENT: ${p}`); return files[p]; }`. Use a runner that throws `must not call gh` for every `--records-json` test.
  - `AC1.1: --records-json under body-text yields the gh-path envelope and never calls the runner` — run `['720','721']` through the gh path (fixtures from test (a)) and `['720','721','--records-json','/r.json']` with the same two issues in `files['/r.json']`; `assert.deepEqual` the two parsed envelopes; runner call count 0 on the second.
  - `AC2.1: --records-json under native makes zero runner calls, reads blockedBy from bodies, flags nativeLinksUnchecked` — pass `--work-links native` explicitly; body `Blocked by #700`; assert `env.workLinks === 'body-text'`, `env.nativeLinksUnchecked === true`, `env.records['720'].blockedBy` deep-equals `[700]`, stderr matches `/native blocked-by links unchecked/`.
  - `AC2.2: a gh-path envelope carries no nativeLinksUnchecked key` — the gh native fixture from test (b); `assert.equal('nativeLinksUnchecked' in env, false)`; same for a body-text gh run.
  - `AC3.1: --records-json with --merge-gate and --waves computes mergeGate and waves from the file` — two records, #721 body has `## Deliverables` line `` - #720 must be merged to `main` first `` plus `Blocked by #720`; pass `--merge-gate --waves --integration-branch main`; assert `env.mergeGate.deferred` includes `721` and `Array.isArray(env.waves.waves)`.
  - `AC4.1: each malformed --records-json input exits 2, names the problem, never calls the runner` — table-driven over: missing file (`/nope.json` absent → stderr `/cannot read --records-json/`), unparseable (`'{'` → `/not valid JSON/`), non-array (`'{}'` → `/must be a JSON array/`), entry without `number` (`/missing a numeric "number"/`), entry without `body` (`/missing a string "body"/`), duplicate number (`/more than once/`), requested number absent (`/missing requested #721/`), extra number (`/not requested/`). Each: exit 2, `out.length === 0`, runner never called.
  - `AC5.1: a trailing bare --records-json exits 2` — `run(['720','--records-json'], deps)` → 2, stderr `/missing value for --records-json/`; also `['720','--records-json','--waves']` → 2.
  - `--records-json accepts bare-string labels` — labels `['ready','risk:low']` vs `[{name:'ready'},{name:'risk:low'}]` produce deep-equal `facets`.
  - `--records-json with a --waves dependency cycle exits 2` — #720 `Blocked by #721`, #721 `Blocked by #720`, `--waves` → 2, stderr `/dependency cycle/`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/bin-lib/preflight-records/preflight-records.test.js`
Expected: FAIL — the new tests fail with `unknown argument: --records-json` (exit 2 where 0 is expected, or the wrong stderr text); the existing tests pass.

- [ ] **Step 3: Implement.** In the lib, add `issuesFromRecordsJson` with the exact error strings above (validate shape, then duplicates, then requested-but-missing, then extra). In the CLI: `parseArgs` accepts `--records-json` with the same guard `--integration-branch` uses (`typeof v !== 'string' || !v.trim() || v.startsWith('--')` → `{ error: 'missing value for --records-json' }`); `realDeps.readFile`; in `run`, after number validation, when `opts.recordsJson` is set: read via `deps.readFile` (throw → `preflight-records.js: cannot read --records-json {path}: {message}`, exit 2), `JSON.parse` (throw → `preflight-records.js: --records-json {path} is not valid JSON: {message}`, exit 2), `issuesFromRecordsJson` (error → `preflight-records.js: {error}`, exit 2); skip repo resolution, `fetchIssues` and `fetchNativeDependencies` entirely; resolve `workLinks` as today, and when it is `native` print the degrade line, report `workLinks: 'body-text'`, set `nativeLinksUnchecked: true`, and pass `dependencies: null`. The tail (`buildRecords`, `buildOverlapGroups`, merge gate, waves with its cycle → exit 2) is shared with the `gh` path — restructure so both paths feed one tail rather than duplicating it. Add `[--records-json <path>]` to `USAGE` and a `#3351:` paragraph to the header comment naming the gh-absent caller, the exit-2 posture and the native degrade. (`docs/plugin-structure.md` is updated in Task 2.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/preflight-records/preflight-records.test.js tests/bin-lib/preflight-records/merge-gate.test.js tests/bin-lib/preflight-records/waves.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/preflight-records.js plugin/bin/lib/preflight-records/preflight-records.js tests/bin-lib/preflight-records/preflight-records.test.js
git commit -m "Add --records-json to preflight-records.js — gh-free record input, native links flagged unchecked (#3351)"
```

### Task 2: The Step 3 failure ruling

**Files:**
- Create: `plugin/skills/flow/multispec-preflight-failure.md`
- Modify: `plugin/skills/flow/multi-spec.md` (Validation steps 3, 4, 5 — lines 16-20)
- Modify: `plugin/skills/flow/multispec-merge-gate.md` (Procedure step 1's non-zero-exit paragraph and its `SKIP` command, lines 23-27)
- Modify: `plugin/skills/flow/multispec-parallel-waves.md` ("No plan." paragraph, line 34)
- Modify: `docs/plugin-structure.md` (line 100's `| flow | … |` row — add `multispec-preflight-failure.md` after `multispec-preflight-sweep.md`; line 176 CLI line — add `[--records-json <path>]` to the usage and one clause: `--records-json` reads already-fetched records with no `gh` call, flagging `nativeLinksUnchecked` under native; line 54 lib description — one clause naming `issuesFromRecordsJson`)
- Create: `tests/multispec-preflight-failure-conformance.test.js`

**Interfaces:**
- Consumes: Task 1's `--records-json <path>` flag, `nativeLinksUnchecked` envelope key and exit vocabulary.
- Produces: the sub-file name `multispec-preflight-failure.md` and its `SKIP` step id `Step 1 native dependency links (skipped)`.

- [ ] **Step 1: Write the failing conformance test** `tests/multispec-preflight-failure-conformance.test.js` (style of `tests/multispec-boundary-freshness.test.js`: `node:test`, `assert`, read files under `plugin/skills/flow/`):
  - `AC6.1: the ruling sub-file states all five branches` — the sub-file matches each of: `/exit 0/i`; `/exit 1[\s\S]*?re-run[^\n]*once/i` and `/STOP[^\n]*before[^\n]*claim/i`; `/exit 2[\s\S]*?no retry/i`; `/--records-json/` and `/issue_read/`; `/nativeLinksUnchecked/` and `/--step "Step 1 native dependency links \(skipped\)"/`; and cites `/github-write-transport\.md/`, `/mcp-transport\.md/`, `/#1459/`.
  - `AC6.2: multi-spec.md step 3 points to the ruling` — the step-3 line (`/^3\. \*\*Pre-flight\*\*.*$/m`) matches `/multispec-preflight-failure\.md/`.
  - `AC6.3: steps 4 and 5 state the exit-0 precondition` — the lines starting `4. **Dependency-aware ordering**` and `5. **Conflict detection**` each match `/exit-0/i`.
  - `AC7.1: multi-spec.md stays under its 20,480-byte read budget` — `Buffer.byteLength(text, 'utf8') < 20480` (the three existing budget tests are the authority; this one names the AC).
  - `AC8.1: the merge gate no longer proceeds unsplit on a non-zero exit` — `multispec-merge-gate.md` does not match `/proceed unsplit with the full target list/` and matches `/multispec-preflight-failure\.md/`.
  - `AC9.1: the waves fallback is step 3's single retry` — the "No plan." paragraph (`/\*\*No plan\.\*\*[^\n]*/`) matches `/single retry|one retry/i` and `/multispec-preflight-failure\.md/`.
  - `AC10.1: docs/plugin-structure.md's preflight-records CLI line names --records-json` — the line matching `/^node plugin\/bin\/preflight-records\.js/m` also matches `/--records-json/`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/multispec-preflight-failure-conformance.test.js`
Expected: FAIL — `ENOENT` on `multispec-preflight-failure.md` and the AC6.2/6.3/8.1/9.1/10.1 assertions fail; AC7.1 passes (19,957 < 20,480).

- [ ] **Step 3: Write `plugin/skills/flow/multispec-preflight-failure.md`.** Opening line: loaded by `multi-spec.md` Validation step 3, before Step 2.8's claim, when the call exits non-zero or `gh` is unavailable. Sections, in order:
  1. **Transport** — `gh` present: step 3's call as written. `gh` unavailable (`_shared/github-write-transport.md`'s routing): fetch each target via MCP `issue_read` (get mode) — reuse step 1's already-fetched records where present — reshape each to `gh issue view`'s `{number,title,body,labels,url}` (`flow/materialize.md`'s `--record-json` paragraph, #1459), write the array to a session-scoped temp file (`_shared/session-tmp-root.md`), and add `--records-json {file}` to the same call. That path makes no `gh` call, so it never exits 1.
  2. **Exit 0** — proceed; steps 4, 4a, 4b and 5 read the envelope.
  3. **Exit 1 (`gh` transport)** — re-run the identical call once; a second exit 1 is a **STOP before claiming**, naming every failing record from stderr. Under `parallel`, `multispec-parallel-waves.md`'s re-run without `--waves` is that one retry — never a third call. Nothing to tear down: no claim, worktree or run-dir write exists yet from this run. Under a `/claude-tweaks:dispatch` bundle the STOP is that bundle's failed run.
  4. **Exit 2** — **STOP before claiming**, no retry, quoting stderr (an invocation bug, an unresolvable owner/repo under `native`, or a `--waves` cycle step 4 would hard-fail anyway).
  5. **`nativeLinksUnchecked: true`** — proceed; ordering and the merge-state gate run on body-text `blocked-by` only. Once the parent run directory exists (after Step 3's Manifesto write, as `multispec-merge-gate.md` times its own entries), write one `SKIP`, verbatim:
     ```
     node "${CLAUDE_PLUGIN_ROOT}/bin/log-decision.js" --run "$PIPELINE_RUN_DIR" --section "/flow" --status SKIP --step "Step 1 native dependency links (skipped)" --text "condition: gh unavailable under work-links: native, preflight-records.js --records-json reported nativeLinksUnchecked → fallback: blocked-by read from record bodies only; native-only links are invisible, so cross-record ordering and the merge-state gate ran on body-text dependencies (dispatch/mcp-transport.md, #2523)." --reversibility n/a
     ```
     (Verified by shape: same flags as `multispec-merge-gate.md`'s existing `SKIP`; a live run is blocked by `log-decision.js`'s anchoring guard outside a real run dir.)
  6. **Never** — never read a stopped run as "no dependencies"; never fall back to body text when the `gh`-path native call fails (that is exit 1).

- [ ] **Step 4: Point the siblings at it.**
  - `multi-spec.md` step 3: append one sentence — `` On a non-zero exit, or with no `gh`, follow `multispec-preflight-failure.md` in this skill's directory. `` Step 4: prefix the body with `Exit-0 envelope only —`. Step 5: same prefix. Then `wc -c plugin/skills/flow/multi-spec.md` must print a value `< 20480`.
  - `multispec-merge-gate.md` Procedure step 1: keep its first sentence (the one carrying `preflight-records.js --merge-gate`) unchanged; replace the non-zero-exit paragraph and its `SKIP` code block with: a non-zero exit never reaches this gate — step 3's ruling (`multispec-preflight-failure.md`) stops the run first; under `nativeLinksUnchecked` the gate evaluates on body-text `blocked-by` only, covered by that file's `SKIP`. Keep the following "Stop here" line only if it still reads correctly; the step 2-4 numbering stays.
  - `multispec-parallel-waves.md` "No plan.": the re-run without `--waves` is step 3's single retry (`multispec-preflight-failure.md`); if that re-run also exits non-zero, step 3's STOP applies. Keep the existing `Step 1 parallel waves (skipped)` `SKIP` block — it still records that waves were dropped.
  - `docs/plugin-structure.md`: line 100, add `multispec-preflight-failure.md` to the flow row; lines 176 and 54 as listed in Files.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test tests/multispec-preflight-failure-conformance.test.js tests/flow-claim-preflight.test.js tests/flow-subfile-table-completeness.test.js tests/flow-ledger-creation-timing-conformance.test.js tests/run-dir-timestamp-utc.test.js tests/timing-prose-conformance.test.js tests/multi-spec-config-scaffold.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 6: Commit**

```bash
git add plugin/skills/flow/multispec-preflight-failure.md plugin/skills/flow/multi-spec.md plugin/skills/flow/multispec-merge-gate.md plugin/skills/flow/multispec-parallel-waves.md docs/plugin-structure.md tests/multispec-preflight-failure-conformance.test.js
git commit -m "Rule multi-spec Step 3 pre-flight failures — retry-once STOP, gh-free records path, logged native degrade (#3351)"
```

### Final verification

`npm test` (AC11.1) runs centrally in Common Step 5, not inside either task.
