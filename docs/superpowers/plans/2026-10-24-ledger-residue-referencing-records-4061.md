# reconcile ledger-residue claims parity with tidy's orphan-ledger rule but skips the referencing-record check (#4061) Implementation Plan

**Goal:** `ledger-residue` applies tidy's referencing-record keep rule, so a background removal PR never deletes a ledger an open work record still names.

**Spec:** `.claude-tweaks/pipelines/2026-10-24T173116-record-4061/work/4061-spec.md` (materialized from GitHub issue #4061)

**Design (decided — implement exactly this):** the ledger is **skipped with a named reason**. The PR-body alternative is rejected because tidy closes the referencing records in the same approved action, and a detached background check may not close records without approval. A kept ledger is reported, and `/claude-tweaks:tidy` resolves it (ledger delete plus Close rows), the same as the existing `ledger-has-open-rows` keep.

---

### Task 1: Add tidy's referencing-record keep rule to `classifyLedgerCandidate` and align the docs

**Files:**
- Modify: `plugin/bin/lib/reconcile/ledger-residue.js`
- Modify: `docs/reconcile-checks.md`
- Test: `tests/bin-lib/reconcile/ledger-residue.test.js`

- [ ] **Step 1: Failing test** — in `tests/bin-lib/reconcile/ledger-residue.test.js`:
  - Import the new exports `referencingRecords` and `defaultListOpenRecords` alongside the existing ones.
  - Add `const noRecords = () => [];` next to `noRuns`/`noPrs`, and pass `listOpenRecords: noRecords` to **every existing** `ledgerResidue({...})` call whose ledger clears the local keep checks (the loader is otherwise the real `gh`). This applies to AC1.1, the "only the removable ledger" test, the removal-PR tests, the dry-run, branch-exists, pr-create, commit-tree, push and refExists tests. Calls that never reach the loader (no residue, local-check skips only, fetch/git failures) may omit it.
  - Update the `classifyLedgerCandidate` order test's helper to `const c = (text, runDirNames = [], loadOpenRecords = () => []) => classifyLedgerCandidate({ path: p, text, runDirNames, loadOpenRecords });`, extend its title with `, record scan, referencing record`, and add these assertions after the `run-live` ones:
    - `c(ledgerText(), [], undefined)` → `'record-scan-failed'` (an omitted loader fails closed, never passes)
    - `c(ledgerText(), [], () => null)` → `'record-scan-failed'`
    - `c(ledgerText(), [], () => 'gh-absent')` → `'gh-absent'`; same for `'network-failure'`
    - `c(ledgerText(), [], () => [{ number: 5, body: `see ${p}`, labels: [] }])` → `'referenced-by-open-record'`
    - a loader that throws when called is never called when an earlier check already kept the ledger: `c(ledgerText(), ['2026-10-22T000000-record-9001'], () => { throw new Error('must not load'); })` → `'run-live'`
  - New test `referencingRecords: namedTarget path, ledger filename, or feature slug in an open record's body`. Use `p = 'docs/plans/2026-10-22-widget-cache-ledger.md'` and assert the returned array of numbers, ascending:
    - body containing the full path `docs/plans/2026-10-22-widget-cache-ledger.md` → matched
    - body containing only the filename `2026-10-22-widget-cache-ledger.md` → matched
    - body containing only the slug `widget-cache` → matched
    - a `by:docs-health` record (`labels: [{ name: 'by:docs-health' }]`) whose body's first line is `**Doc:** docs/plans/2026-10-22-widget-cache-ledger.md | ...` → matched (namedTarget path)
    - an unrelated body → not matched; a record with a non-string/absent body → not matched and not thrown
    - `referencingRecords(p, [{number: 9, body: 'widget-cache'}, {number: 3, body: 'widget-cache'}])` → `[3, 9]`
  - New integration test (the AC test): `referencing record: an open record naming the ledger path keeps it — skipped with the reason and the record numbers, nothing pushed`. Use `makeRepo()` (ledger `LEDGER`), `listRunDirs: noRuns`, `listOpenRecords: () => [{ number: 42, body: `Ledger \`${LEDGER}\` still has follow-ups`, labels: [] }]`, and `listRemovalPrs`/`refExists`/`createPr` all `mustNotCall(...)`. Assert `r.failure === null`, `r.entries` deep-equals `[{ path: LEDGER, kind: 'ledger', action: 'skip', reason: 'referenced-by-open-record', records: [42] }]`, and `originRefs(origin)` is `['refs/heads/main']`.
  - New integration test: `the open-record list is fetched at most once per pass, and not at all when every ledger is kept locally`. Use two removable ledgers plus a counting loader → 1 call. Reuse the tidy-alignment fixture (all kept locally) with `listOpenRecords: mustNotCall('listOpenRecords')`.
  - New unit test for `defaultListOpenRecords(root, exec)`. When there is no CLAUDE.md (github-issues path), a fake `exec` returning `JSON.stringify([{ number: 1, body: 'b', labels: [] }])` gives that array, and the fake was invoked as `gh` with args including `'issue', 'list', '--state', 'open'` and `'--json', 'number,body,labels'`. A fake throwing `Object.assign(new Error('spawn gh ENOENT'), { code: 'ENOENT' })` gives `'gh-absent'`. One throwing `new Error('HTTP 502')` gives `'network-failure'`. Non-array JSON gives `'network-failure'`. Under `work-backend: local-files` (write a temp root's `CLAUDE.md` containing `work-backend: local-files` and a `specs/7-foo.md` record with body text `see x`), `exec` must not be called (`mustNotCall`) and the result is `[{ number: 7, body: <record body>, labels: [] }]`. A missing `specs/` dir gives `[]`.
  - In the `QUIET_SKIP_REASONS` test, add `'referenced-by-open-record'` and `'record-scan-failed'` to the **not-quiet** list (both need a human or `/tidy`, so both surface at SessionStart).
  - Run `node --test tests/bin-lib/reconcile/ledger-residue.test.js` — the new tests FAIL (`referencingRecords is not a function` / reason mismatches).

- [ ] **Step 2: Implement** in `plugin/bin/lib/reconcile/ledger-residue.js`:
  - Requires: `const { namedTarget } = require('../issues/named-target');`, `const { queryRecords } = require('../issues/local-store');`, `const { readWorkBackend } = require('../work-backend');`.
  - `referencingRecords(ledgerPath, records)` (pure, exported). `records` is an array of `{ number, body, labels }`. A record references the ledger when `namedTarget(record)` returns `{ path }` equal to `ledgerPath`, OR its body (only when `typeof body === 'string'`) contains `path.posix.basename(ledgerPath)` OR `ledgerFeatureSlug(ledgerPath)` as a substring. Containing the basename covers the full path too. This mirrors `plugin/skills/tidy/scan-procedures.md`'s "referencing record" pass word for word. Return the matching `number`s sorted ascending.
  - `classifyLedgerCandidate({ path, text, runDirNames, loadOpenRecords })` keeps every existing check in its existing order, then after `run-live` (cheap local checks first, so the record list is never fetched for a ledger already kept) adds:
    ```js
    const records = typeof loadOpenRecords === 'function' ? loadOpenRecords() : null;
    if (records === 'gh-absent' || records === 'network-failure') return records;
    if (!Array.isArray(records)) return 'record-scan-failed';
    if (referencingRecords(ledgerPath, records).length > 0) return 'referenced-by-open-record';
    return null;
    ```
    Update the function's comment to name `loadOpenRecords` (a zero-arg loader returning the open-record array, `'gh-absent'`/`'network-failure'`, or `null` on any other failure; omitted fails closed).
  - `defaultListOpenRecords(root, exec = execFileSync)` (exported):
    - When `readWorkBackend(root) === 'local-files'`: `try { return queryRecords(path.join(root, 'specs')).map((r) => ({ number: r.id, body: r.body, labels: r.facets.origin ? [`by:${r.facets.origin}`] : [] })); } catch { return null; }`. `queryRecords` already excludes closed records and returns `[]` for a missing dir.
    - Otherwise: `sharedPrimitives.runClassified(() => { const prs = JSON.parse(exec('gh', ['issue', 'list', '--state', 'open', '--limit', '10000', '--json', 'number,body,labels'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: sharedPrimitives.GH_TIMEOUT_MS, maxBuffer: sharedPrimitives.LARGE_MAX_BUFFER_BYTES, windowsHide: true })); if (!Array.isArray(prs)) throw new Error('gh issue list returned a non-array'); return prs; }, classifyExecError, { retryOnTimeout: true })`. Name the inner variable `issues`, not `prs`. `maxBuffer` is required, because open-issue bodies overflow the 1 MB default.
  - `ledgerResidue({...})` gains an injectable `listOpenRecords` param (default `defaultListOpenRecords`). Before the candidate loop, add `let openRecords; const loadOpenRecords = () => { if (openRecords === undefined) openRecords = listOpen(root); return openRecords; };` (memoized: at most one fetch per pass, none when no ledger clears the local checks). Pass `loadOpenRecords` into `classifyLedgerCandidate`. When the reason is `'referenced-by-open-record'`, record the skip as `skip(p, reason, { records: referencingRecords(p, openRecords) })`; every other reason stays `skip(p, reason)`.
  - Add `referencingRecords` and `defaultListOpenRecords` to `module.exports`.
  - `QUIET_SKIP_REASONS`: unchanged. Both new reasons surface, while `gh-absent`/`network-failure` are already quiet.
  - `prBody`: change `'Each has no open row and no live run directory.'` to `'Each has no open row, no live run directory, and no open work record referencing it.'`.
  - Header comment (lines 17-27): rewrite the "Removable residue follows tidy's orphan-ledger rule" paragraph so it states the full keep rule the code now applies. Add, after the `run-live` attribution sentence, that an open work record referencing the ledger keeps it (`referenced-by-open-record`, carrying the record numbers): its `namedTarget` path equals the ledger path, or its body contains the ledger's filename or `{feature}` slug, as in tidy. The open-record list is read once per pass, and only when a ledger clears every earlier check. It comes from `gh issue list --state open`, or `specs/` under `work-backend: local-files`. A failed read keeps every such ledger (`record-scan-failed`, or the classified `gh-absent`/`network-failure`). State the one deliberate difference from tidy: tidy deletes the ledger and closes the referencing records in one approved action, while this unattended check never closes a record, so it keeps the ledger and leaves it to `/claude-tweaks:tidy`.

  In `docs/reconcile-checks.md`'s `## Ledger residue (#3812)` section:
  - Add two rows to the "Kept when | Reason" table after the `run-live` row: `| the open-record list could not be read | \`record-scan-failed\` (or the classified \`gh-absent\` / \`network-failure\`) |` and `| an open work record references it | \`referenced-by-open-record\` (the entry carries \`records\`) |`.
  - After the "Attribution follows tidy…" paragraph, add a paragraph stating the referencing-record rule exactly as in the header comment: the match, the once-per-pass lazy read, the two sources, and the fail-closed read. Also state the deliberate difference from tidy (tidy closes the records with the delete, while this check only keeps the ledger and leaves it to `/claude-tweaks:tidy`, because a background check never closes a record).
  - Leave the "Surfacing" paragraph's quiet list unchanged. Add a clause after it saying `referenced-by-open-record` and `record-scan-failed` are not quiet, so they surface at SessionStart.

- [ ] **Step 3: Run** `node --test tests/bin-lib/reconcile/ledger-residue.test.js` — PASS (output redirected to a `.txt` file, foreground). Then prove discrimination by commenting out the `referenced-by-open-record` return in a scratch copy only, never in place in the shared worktree. The cheapest proof: `git show HEAD:plugin/bin/lib/reconcile/ledger-residue.js` is the pre-change module and the AC test fails against it. Report the observed failure.

- [ ] **Step 4: Commit** — one commit: `Keep residue ledgers an open record references — reconcile ledger-residue applies tidy's referencing-record rule` with body `refs #4061`.

---

## Self-review

- **Spec coverage:** Deliverable 1 → Step 2's `classifyLedgerCandidate` rule plus the skip carrying `records`. Deliverable 2 → parity is now implemented, so the header and docs describe the keep rule as the code applies it, and name the one deliberate action difference. AC1 → Step 1's integration AC test, with discrimination proved in Step 3. AC2 → Step 2's header and docs edits describe the same keep rule. AC3 → `npm test` runs centrally in /build Common Step 5.
- **Placeholders:** none.
