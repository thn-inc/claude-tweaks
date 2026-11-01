# Digest Rollover Carry-Over Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A digest rollover carries every trusted live entry and a fingerprint-only tombstone for every promoted or expired entry into the new container, so clustering, expiry and dedup behave the same afterwards, and a failure at any point loses nothing.

**Architecture:** `plugin/bin/lib/health-core/materiality-digest.js` gains a pure planner over two issues' comment objects, sharing `isTrustedComment` and refusing any other input shape. `plugin/skills/tidy/digest-sweep.md` gains the ordered, re-runnable procedure that drives it. The original timestamp survives as one more trailing line marker, `<!-- materiality-first-seen: {ISO} -->`. A tombstone is the existing `<!-- materiality-fingerprint: {fp} -->` marker alone on its line, so `isMaterialityDuplicate` reads it unchanged.

**Tech Stack:** Node 18+ CommonJS, `node --test`, skill markdown.

**Spec:** `.claude-tweaks/pipelines/2026-11-01T192521-record-4848/work/4848-spec.md`, record #4848.

## Global Constraints

- Rollover stays Stage at every tier.
- A carried entry keeps its line, fingerprint, provenance and original timestamp.
- A tombstone is the marker with no entry line. `isMaterialityDuplicate` reads it. The active-set read ignores it because it has no entry line.
- Trusted means `isTrustedComment` from `plugin/bin/lib/issues/comment-trust.js`. A planted line or marker is never carried and never counts as carried.
- Timestamp preservation applies to `github-issues` only. `local-files` has no rollover, and its expiry dating is unchanged.
- Never `gh issue list --search` to find the replacement: `_shared/github-write-transport.md` bans the search index for find-by-marker lookups.
- Comment body cap: under 60,000 characters, the convention `tidy/console-backfill.md` already uses.
- Scope and edit discipline: commit tests only where the task asks for them or the repo already keeps tests for this kind of change. Touch only what the task requires. Report a pre-existing bug as a follow-up, do not fold it in.
- Never `git stash`. Commit messages use `refs #4848`, never `closes`/`fixes`, and end with `Claude-Session: https://claude.ai/code/session_017vXcAdZdS51NVdkaca5Yj3`.

## Probes run (2026-11-01, live #1426, snapshot at `$PIPELINE_RUN_DIR/evidence/digest-1426-comments.json`)

- `gh issue view 1426 --json comments --jq .comments` returned 102 flat objects, every one with `body`, `authorAssociation`, `createdAt`, `id` (node id) and `url` ending `#issuecomment-{numeric}`. REST `gh api repos/thn-inc/claude-tweaks/issues/1426 --jq .comments` printed `102`.
- `gh issue list --label digest --state open --json number,comments --jq ".[0].comments|length"` printed `100` for those 102: this read truncates.
- `gh api --paginate --slurp ... --jq` is refused by `gh` (`--slurp` is not supported with `--jq`), and `--paginate --slurp` without it yields an array of pages. The procedure's only read is therefore `gh issue view`, and a nested array is exactly what planning refuses.
- Independent count over the snapshot: 735 trusted entry lines; 638 marked by both the Task 1 regex and the loose `/→\s*\S+\s*$/`; 97 live, 97 distinct, 2 of them with no fingerprint; 5 marked lines with no fingerprint; 728 distinct fingerprints, 95 on live lines, so **633 tombstones**. No non-entry line holds a marker today.
- Real shapes the fixtures must include: `… — {run-id} → #3900` (no fingerprint), `… <!-- materiality-fingerprint: x --> → #4413` (mark after the comment), a live line with `→` inside the finding, provenance that is a skill name (`harness-health`) or free text (`reflect full mode, /flow #1153 wrap-up`), and non-entry lines in the same comment.
- Run-ids are UTC (`2026-11-01T190941` minted at `19:09:31Z`), so a run-id date parses as UTC.
- `gh issue edit --remove-label` on an absent label fails the whole edit, so the label move reads labels first.
- Unverified: `gh api -X PATCH repos/{owner}/{repo}/issues/comments/{id} -F body=@{file}` has no read-only form. `gh api --help` documents `-F key=@path` as reading the value from a file, and the task's review should not take this as run.

## Review Focus

1. A second rollover: tombstones and first-seen stamps from the first one carry again, unchanged. Pinned in Task 1.
2. A live set larger than one comment splits at a line boundary under the cap, and a re-run after only some bodies posted posts only the rest. Pinned in Task 1.
3. A flat single-page read (30 of 102 comments) is shape-valid but incomplete: the count check refuses it. Pinned in Task 1.
4. An unfinished rollover found by the next sweep, including one with no open `digest` issue, resumes rather than no-ops. Pinned in Task 2.
5. A stranded replacement, before it holds the label, is not shaped by `/specify`'s drain or staled by `/tidy`. Pinned in Task 2.

---

### Task 1: Carry-over planner

**Role:** integration

**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/health-core/materiality-digest.js`
- Test: `tests/bin-lib/health-core/materiality-digest.test.js`

**Interfaces:**
- Consumes: `isTrustedComment`, `commentAssociation`, `untrustedSkipNote` from `../issues/comment-trust`; `parseMaterialityFingerprints` in the same file.
- Produces, all exported from `materiality-digest.js`:
  - `MATERIALITY_FIRST_SEEN_PREFIX = 'materiality-first-seen'`
  - `CarryOverInputError` (extends `Error`, `name === 'CarryOverInputError'`)
  - `selectCarryOverEntries(comments) -> { entries: [{ line: string, key: string, fingerprint: string|null }], skipped: string[] }`. `line` is the line to post, first-seen marker included. Throws `CarryOverInputError` on a malformed input.
  - `materialityEntryDate(line: string, commentCreatedAt?: string) -> Date | null`
  - `planCarryOver(oldComments, newComments, { oldCommentCount, maxChars = 60000 }) -> { live, carried, pending: string[], tombstones, tombstonesCarried, tombstonesPending: string[], unfingerprintedMarked, markerEdits: [{ commentId: string, body: string }], bodies: string[], verified: boolean, skipped: string[] }`

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/health-core/materiality-digest.test.js`, with these names and assertions. Build lines with `materialityEntryLine` unless the shape is the point. A comment helper yields `{ body, authorAssociation: 'MEMBER', createdAt, url: '…#issuecomment-{n}' }`, and every `planCarryOver` call passes `{ oldCommentCount: old.length }`.

  - `AC1.1: selectCarryOverEntries selects only trusted live lines`: one `MEMBER` comment holding a live line, a `→ #12` line, a `<!-- materiality-fingerprint: x --> → #13` line and a `→ expired` line; one `CONTRIBUTOR` comment holding a live line. The selected lines are exactly the first live line (first-seen marker aside). `skipped` has one entry naming the untrusted comment.
  - `selectCarryOverEntries keeps a live line with a mid-finding arrow and a fingerprint-less live line, and ignores non-entry lines`: `- [tests] a → b — f.js — Defer-reason: x — run` and a no-marker line are selected. `Note: …`, `---` and a tombstone line are not. CRLF bodies give the same result.
  - `selectCarryOverEntries collapses a duplicate fingerprint across comments`.
  - `selectCarryOverEntries stamps the comment createdAt and keeps an existing stamp`: a fresh line gets ` <!-- materiality-first-seen: 2026-08-24T18:35:16Z -->` appended, the rest byte-identical. A line already stamped `2026-01-01T00:00:00Z` in a comment created later keeps that value and gets no second marker.
  - `AC2.1: a carried entry still dedups against the new container`: `isMaterialityDuplicate([{ body: planCarryOver(old, [], opts).bodies[0], authorAssociation: 'MEMBER' }], ENTRY) === true`.
  - `AC3.1: a carried entry's expiry age comes from its original timestamp, not the new comment's`: a skill-provenance line (`provenance: 'harness-health'`) in a comment created `2026-01-01T00:00:00Z`, carried; `materialityEntryDate(carriedLine, '2026-11-01T00:00:00Z').toISOString() === '2026-01-01T00:00:00.000Z'`.
  - `materialityEntryDate reads a run-id from provenance as UTC ahead of any other source`: provenance `2026-08-24T183516-tidy-standalone` and a comment date of `2026-11-01T00:00:00Z` gives `2026-08-24T18:35:16.000Z`, marked or not, and also when the line carries a first-seen marker of a different date.
  - `materialityEntryDate falls back to the comment date, and returns null with nothing parseable`: skill provenance plus comment date gives the comment date; skill provenance, no comment date gives `null`; a first-seen marker holding `not-a-date` is ignored.
  - `AC5.1: a promoted and an expired finding are still duplicates against the new container, and neither is in the active set`: old holds one `→ #12` line and one `→ expired` line, each with a fingerprint, plus one live line. Post `bodies` as a `MEMBER` comment. `isMaterialityDuplicate(newComments, PROMOTED) === true` and the same for `EXPIRED`. `selectCarryOverEntries(newComments).entries` is exactly the live line. `tombstones === 2`.
  - `a tombstone has no entry line and fits under the comment-size cap`: every body line holding only a marker fails `/^- \[/`; with `{ maxChars: 200 }` and 20 tombstones every body is at most 200 characters, each body starts with a plain-text header line, and the union of markers across bodies is all 20.
  - `a fingerprint with both a live and a marked line is carried live, with no tombstone`.
  - `a marked line with no fingerprint is counted in unfingerprintedMarked, not tombstoned`.
  - `a second rollover carries tombstones and stamps again`: roll A to B, then B to C. `isMaterialityDuplicate` against C is true for a promoted finding from A, `tombstones` matches, and the live line's first-seen value is A's comment date.
  - `AC6.1: planning refuses a paged, wrapped or malformed input rather than returning an empty plan`: `assert.throws` with `{ name: 'CarryOverInputError' }` for each of: `[[c1, c2], [c3]]` (slurped pages), `{ comments: [c1] }` (wrapped), `null`, a JSON string, `[]` as the old side, `['- [a] b']` (bare bodies), `[{ body: 'x' }]` (no association), `[{ authorAssociation: 'MEMBER' }]` (no body), `[{ body: 'x', authorAssociation: 'MEMBER' }]` (no date), and on the new side the same shapes other than `[]`. `selectCarryOverEntries` refuses the same element shapes.
  - `planCarryOver refuses a truncated read`: `oldCommentCount` of `old.length + 1`, `NaN`, or omitted throws `CarryOverInputError`. `[]` on the new side is valid.
  - `AC7.1: a re-run after each interruption point posts nothing twice`: with `{ maxChars: 200 }` and enough lines for 3+ bodies. Nothing posted: `verified === false`, `pending` holds all. After posting `bodies[0]` only: `bodies` no longer holds any line from it. After posting all: `pending: []`, `tombstonesPending: []`, `bodies: []`, `markerEdits: []`, `verified: true`, `carried === live`, `tombstonesCarried === tombstones`. Unchanged when re-planned a second time.
  - `AC7.2: a promotion on the old issue mid-rollover reaches the carried copy`: post everything, then mark the old line `→ #99`. Re-plan: `verified === false`, `bodies: []`, and `markerEdits` holds one entry whose `commentId` is the numeric id from the new comment's `url` and whose `body` has the carried line ending in ` → #99`, every other line byte-identical. Applying that body gives `markerEdits: []`, `verified: true`, and `selectCarryOverEntries` no longer selects it. The same holds for `→ expired` and for a fingerprint-less line.
  - `a mark made only on the carried copy counts as carried`: the new container's copy gains `→ #99`, the old line stays live. `carried === live`, `markerEdits: []`, `bodies: []`.
  - `planCarryOver ignores an untrusted comment in the new container`: the same lines and tombstones posted by a `CONTRIBUTOR` leave `carried: 0`, `tombstonesCarried: 0`, `verified: false`, so a planted copy cannot pass the count.
  - `planCarryOver splits bodies at line boundaries under maxChars`: with `{ maxChars: 200 }` and three 90-character lines, every body is at most 200 characters, each line appears whole, and none is lost. A single line over the cap gets its own body rather than being cut.
  - Real-shape fixture test `planCarryOver handles the shapes found on the live digest`, covering the shapes under Probes.
  - Leave every existing test as it is. `trustedMaterialityTexts`'s output must not change.

- [ ] **Step 2: Run to verify the tests fail**

  Run: `node --test tests/bin-lib/health-core/materiality-digest.test.js`
  Expected: FAIL, `selectCarryOverEntries is not a function`, with every pre-existing test still passing.

- [ ] **Step 3: Implement in `materiality-digest.js`**

  Pinned details, since the tests alone leave them open:

  ```js
  const ENTRY_LINE = /^- \[[^\]]+\] /;
  // A mark is trailing only when nothing but HTML comments follows it: `→` inside a finding stays live.
  const TRAILING_MARK = /\s*(→ (?:expired|#?\d+))((?:\s*<!--.*?-->)*)\s*$/;
  const RUN_ID_DATE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2})(\d{2})(\d{2})(?:-|$)/;
  ```

  - Shape check, shared by both exported readers: the input is an array; each element is a non-array object with a string `body`, a non-null `commentAssociation`, and a string `createdAt` or `created_at`. Anything else throws `CarryOverInputError` naming the index and what is missing. A comment that passes the shape but fails `isTrustedComment` is skipped with `untrustedSkipNote` when its body holds a fingerprint marker, the rule `trustedMaterialityTexts` already applies.
  - Split bodies on `/\r?\n/`.
  - `key` is the fingerprint when the line has one, else the line with its first-seen marker and trailing mark removed, trimmed. Selection dedupes on `key`.
  - Tombstones: every fingerprint in the old side's trusted bodies (`parseMaterialityFingerprints`), minus the fingerprints on old live entry lines. Using all markers, not only marked lines, is what makes the new container's dedup set a superset of the old one's, and it carries an earlier rollover's tombstones.
  - Old side `oldCommentCount`: `Number.isInteger` and equal to `oldComments.length`, and the array non-empty. Otherwise throw.
  - `carried` counts old live keys present on any new trusted entry line, marked or live. A new tombstone alone does not count a live key as carried.
  - `tombstonesCarried` counts tombstone fingerprints present anywhere in the new trusted bodies, whether on a tombstone line or a marked or live entry line.
  - `markerEdits`: for each old marked line whose `key` is on a new trusted entry line with no trailing mark, append ` {mark}` to that line in that comment's body. One entry per comment, all its edits applied. `commentId` is the digits after `issuecomment-` in `url`/`html_url`, else a numeric `id`. With none, throw `CarryOverInputError`.
  - `bodies`: pending live lines first, chunked at line boundaries under `maxChars`, a lone over-cap line in its own body. Then tombstones, one per line, each chunk opening with `Fingerprint-only tombstones: promoted or expired findings kept for dedup (tidy/digest-sweep.md's Container rollover).`
  - `verified` is `pending` and `tombstonesPending` empty, `markerEdits` empty, `carried === live`, `tombstonesCarried === tombstones`.
  - `materialityEntryDate` provenance is the text after the line's last ` — `, with HTML comments and any trailing mark removed. Order: run-id date, then a valid first-seen marker, then `commentCreatedAt`, then `null`.
  - No `fs` or other I/O: the module stays pure. Extend the file header comment by one sentence naming the carry-over helpers and `tidy/digest-sweep.md`'s rollover as their caller.

- [ ] **Step 4: Run to verify the tests pass**

  Run: `node --test tests/bin-lib/health-core/materiality-digest.test.js`
  Expected: PASS, 0 failures.

- [ ] **Step 5: Real-input probe**

  Run a scratch script (uncommitted, in the session scratchpad) that loads `/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-11-01T192521-record-4848/evidence/digest-1426-comments.json`, calls `planCarryOver(read, [], { oldCommentCount: read.length })`, and prints the counts. Expected, matching the independent count under Probes: `live: 97`, `tombstones: 633`, `unfingerprintedMarked: 5`, `verified: false`, every body under 60,000 characters. Feed `bodies` back as one `MEMBER` comment per body and re-plan: `pending: 0`, `tombstonesPending: 0`, `carried: 97`, `tombstonesCarried: 633`, `verified: true`. Then assert that `isMaterialityDuplicate` over the fed-back comments is true for every one of the 728 fingerprints, by composing the check from `parseMaterialityFingerprints` over both sides (old set is a subset of new set).

  Write the output to `$PIPELINE_RUN_DIR/evidence/planner-1426-probe.txt` with a plain Bash redirect, then log it with `log-decision.js --section "/build" --status AUTO --step "AC evidence" --text-file {text-file}`, one line naming the real-input probe, the command shape, the counts and that path.

- [ ] **Step 6: Commit**

  ```bash
  git add plugin/bin/lib/health-core/materiality-digest.js tests/bin-lib/health-core/materiality-digest.test.js
  git commit -m "Add digest carry-over planner — refs #4848"
  ```

### Task 2: Rollover procedure and prose sweep

**Role:** transcription

**Files:**
- Modify: `plugin/skills/tidy/digest-sweep.md` (7,303 B against the 52,500 B rail)
- Modify: `plugin/skills/tidy/SKILL.md:144` (43,256 B)
- Modify: `plugin/skills/tidy/step-6-auto.md:70` (50,615 B, 1,885 B of headroom: this row grows by under 150 B)
- Modify: `plugin/skills/tidy/step-1-records.md:85` (38,551 B)
- Modify: `plugin/skills/_shared/materiality-floor.md` (13,364 B)
- Modify: `plugin/skills/specify/next-mode.md:194-197`
- Modify: `docs/skill-graph.md` (lines 249 and 658)
- Test: `tests/materiality-floor-conformance.test.js`, `tests/specify-digest-guard.test.js`

Reader inventory, from the comment read call sites (`--json comments`, `/comments`, `get_comments`), not the marker literal:

| Site | Read | Classification |
|---|---|---|
| `tidy/digest-sweep.md` Cluster promotion, Expiry, Bootstrap-race repair | `gh issue view {n} --json comments` | Paginated. Rule stated once in the new section |
| `_shared/materiality-floor.md` Dedup | `gh issue view {n} --json comments` | Paginated. Add the pointer in this task |
| `tidy/console-backfill.md:62` | `gh issue view {n} --json comments --jq .comments` | Paginated. No change |
| `bin/lib/console/backfill-dispose.js`, `reflect-apply.js`, `review/step3-routing.md`, `review/step3-tiebreak.md`, the health sweeps | Take comments from their caller or cite the floor's Dedup | No read of their own. No change |
| `_shared/github-write-transport.md:28` | `?per_page=100` single page on `gh`, paged on MCP | Generic row, not a digest reader. No change: the new section names the digest forms |
| `_shared/health-filing-digest.md` | The drain-rate cap digest, a different container | Not a reader of this value. No change |

Stale-prose sweep, from `grep -rnE "bootstraps the|bootstrap a fresh|fresh digest|closed comment|rollover"` over `plugin/skills`, `docs/skill-graph.md`, `docs/journeys`, `README.md`: `tidy/digest-sweep.md:93` (`closed comment's history` describes expiry's own comment, no change), `tidy/console-backfill.md:84` (points at `digest-sweep.md`, no change), `tidy/SKILL.md:94` (lists the four procedures, no change), `_shared/materiality-floor.md:163` (`no rollover needed` for local-files, no change), `docs/journeys/absorb-a-capture-into-an-existing-record.md:19` (example text, no change), plus the edits below. Before editing, run `grep -rnF -e "bootstraps the" -e "bootstrap a fresh" -e "parsed from each entry" tests` and treat any hit as a pin to re-point in this task.

**Interfaces:**
- Consumes: `planCarryOver`, `materialityEntryDate` from Task 1.

- [ ] **Step 1: Write the failing conformance tests** in `tests/materiality-floor-conformance.test.js`:

  ```js
  const rollover = () => SWEEP.slice(SWEEP.indexOf('### Container rollover'));

  test('AC4.1: digest-sweep.md names the ordering, the count verification before the close, and the threshold rationale', () => {
    const r = rollover();
    const order = [
      'without the `digest` label',
      'post each printed `paths` file',
      'Verify the count',
      'Move the label',
      'Close the old issue',
    ].map((s) => r.indexOf(s));
    assert.ok(order.every((i) => i !== -1), `missing a step: ${order}`);
    assert.deepEqual([...order].sort((a, b) => a - b), order, `steps out of order: ${order}`);
    assert.ok(r.includes('Continue only when `verified` is `true`'));
    assert.ok(r.includes('A mismatch stops here'));
    assert.ok(r.includes('compacts promoted and expired lines out of every sweep'));
    assert.ok(r.includes('truncates'));
  });

  test('digest-sweep.md verifies both counts, carries tombstones, and refuses a bad read', () => {
    const r = rollover();
    assert.ok(r.includes('both the live-entry count and the tombstone count'));
    assert.ok(r.includes('fingerprint-only tombstone'));
    assert.ok(r.includes('A non-zero exit is a refused read'));
    assert.ok(r.indexOf('Remove `digest` from the old issue') < r.indexOf('add it to the replacement'), 'label removal must precede the add');
  });

  test('digest-sweep.md reads the true count and paginates every digest read', () => {
    const r = rollover();
    assert.ok(r.includes('gh api repos/{owner}/{repo}/issues/{n} --jq .comments'));
    assert.ok(r.includes('gh issue view {n} --json comments --jq .comments'));
    assert.ok(r.includes('`get_comments`'));
    assert.ok(r.includes('Never `gh issue list --json comments`'));
  });

  test('digest-sweep.md resumes an unfinished rollover before its no-op, and finds it without the search index', () => {
    const start = SWEEP.indexOf('**Resume an unfinished rollover.**');
    assert.ok(start !== -1, 'resume paragraph must exist');
    assert.ok(start < SWEEP.indexOf('No-ops silently'), 'resume must run before the no-op that would otherwise skip it');
    assert.ok(SWEEP.includes('(continues #{old})'));
    assert.ok(SWEEP.includes('no `--search`'));
  });

  test('digest-sweep.md Expiry dates a github-issues line through materialityEntryDate and leaves local-files alone', () => {
    const expiry = SWEEP.slice(SWEEP.indexOf('### Expiry'), SWEEP.indexOf('### Container rollover'));
    assert.ok(expiry.includes('materialityEntryDate'));
    assert.ok(expiry.includes('materiality-first-seen'));
    assert.ok(expiry.includes('On `local-files`, the age comes from'));
  });

  test('a re-run reaches a mark made on the old issue, and a later approval marks the carried copy', () => {
    const r = rollover();
    assert.ok(r.includes('apply each printed `edits` entry'));
    assert.ok(r.includes('marks the carried copy in the current container'));
  });

  test('every rollover restatement carries the carry-over, not a bare bootstrap', () => {
    const row = TIDY_SKILL.split('\n').find((l) => l.startsWith('| **Rollover digest container**'));
    assert.ok(row.includes('carry every trusted live entry and a tombstone per promoted or expired entry'));
    assert.ok(!row.includes('bootstrap a fresh issue'));
    assert.ok(!FLOOR.includes('it bootstraps the\nreplacement in the same move'));
    assert.ok(!TIDY_RECORDS.includes('it bootstraps the replacement in the same move'));
    assert.ok(FLOOR.includes('materiality-first-seen'));
    assert.ok(FLOOR.includes('fingerprint-only tombstone'));
    const tier = TIDY_STEP6_AUTO.split('\n').find((l) => l.startsWith('| **Rollover digest container**'));
    assert.match(tier, /\| Stage \| Stage \| Stage — /);
  });

  test('tidy Shape 1 keeps an unfinished rollover replacement', () => {
    assert.ok(TIDY_RECORDS.includes('`… (continues #{old})` with `{old}` still open'));
  });
  ```

  In `tests/specify-digest-guard.test.js`:

  ```js
  test("next-mode.md's bare drain skips an unfinished digest rollover replacement", () => {
    const src = read('plugin/skills/specify/next-mode.md');
    assert.ok(src.includes('!/\\(continues #\\d+\\)$/.test(r.title)'), 'title exclusion missing from the bare-drain filter');
  });
  ```

- [ ] **Step 2: Run to verify they fail**

  Run: `node --test tests/materiality-floor-conformance.test.js tests/specify-digest-guard.test.js`
  Expected: FAIL on each new test, every pre-existing test still passing.

- [ ] **Step 3: Edit `digest-sweep.md`**

  a. Under `## Digest sweep (Step 5.6)`, before the `No-ops silently…` paragraph, add:

  ```markdown
  **Resume an unfinished rollover.** `github-issues` only. Before the no-op check below, list open issues (`gh issue list --state open --limit {window} --json number,title,labels`, no `--search`, `{window}` sized per `_shared/github-write-transport.md`'s "Sizing the list-then-filter window") and filter client-side for a title ending `(continues #{old})` whose `{old}` issue is still open. A match is a rollover a failure interrupted, whichever step it reached, even when no open issue carries `digest` any more. Propose finishing it with the `Rollover digest container` action, whatever the comment count.
  ```

  b. In `### Expiry`, replace `(parsed from each entry's `{provenance}` — a run-id's ISO timestamp, or the comment/edit timestamp when provenance names a skill instead of a run)` with:

  ```markdown
  (on `github-issues`, `materialityEntryDate(line, comment.createdAt)` in `bin/lib/health-core/materiality-digest.js`: a run-id's ISO timestamp from `{provenance}`, else the `<!-- materiality-first-seen: {ISO} -->` marker a rollover stamped, else the comment's timestamp. On `local-files`, the age comes from `{provenance}`'s run-id timestamp, or the edit timestamp when provenance names a skill instead of a run)
  ```

  c. Replace the whole `### Container rollover` section with:

  ````markdown
  ### Container rollover

  `github-issues` only — a file has no analogous limit. When the digest issue reaches 100 comments, propose the `Rollover digest container` action, Stage at every tier (`step-6-auto.md`). Read the true count from REST, `gh api repos/{owner}/{repo}/issues/{n} --jq .comments` (`issue_read` get mode on MCP). The threshold does two jobs: a rollover compacts promoted and expired lines out of every sweep's read, since a live line moves whole and a marked line moves as a fingerprint only, and 100 is where `gh issue list --json comments` truncates, so a reader that slipped onto that form would start missing entries from there on.

  **Every digest read is paginated.** `gh issue view {n} --json comments --jq .comments` walks every page and prints one flat array, the shape the planner below takes. On MCP, `issue_read` in `get_comments` mode needs `perPage: 100`, then `page` 2, 3, … until a page returns fewer than 100, joined into one flat array. Never `gh issue list --json comments` for this container.

  On approval, read everything fresh, since the proposal holds no copy of the entries. Apply after any `Propose digest cluster` or `Expiry summary` approved in the same run, so their markers land before the carry reads them. A proposal of either kind approved after a rollover marks the carried copy in the current container, never the closed issue's line. Each step below is safe to re-run from the top, and a re-run converges by fingerprint:

  1. **Create the replacement** titled `{old title} (continues #{old})` without the `digest` label, unless the resume list above already found it. Its body says it is a digest container continuing `#{old}`.
  2. **Carry.** Save both issues' comments with the read above and the old issue's true count, then run, with `{plugin-root}` this plugin's root as a literal path:

     ```bash
     node -e "const fs=require('fs');const [root,oldF,newF,count,dir]=process.argv.slice(1);const {planCarryOver}=require(root+'/bin/lib/health-core/materiality-digest.js');const read=(f)=>JSON.parse(fs.readFileSync(f,'utf8'));const p=planCarryOver(read(oldF),read(newF),{oldCommentCount:Number(count)});fs.mkdirSync(dir,{recursive:true});const paths=p.bodies.map((b,k)=>{const f=dir+'/carry-'+k+'.md';fs.writeFileSync(f,b);return f;});const edits=p.markerEdits.map((e,k)=>{const f=dir+'/edit-'+k+'.md';fs.writeFileSync(f,e.body);return {commentId:e.commentId,path:f};});console.log(JSON.stringify({live:p.live,carried:p.carried,pending:p.pending.length,tombstones:p.tombstones,tombstonesCarried:p.tombstonesCarried,tombstonesPending:p.tombstonesPending.length,unfingerprintedMarked:p.unfingerprintedMarked,verified:p.verified,skipped:p.skipped,paths,edits},null,1))" "{plugin-root}" "{OLD}" "{NEW}" "{COUNT}" "{CARRYDIR}"
     ```

     A non-zero exit is a refused read: a paged, wrapped, malformed or short array, never an empty plan. Re-read and re-run; it is never `live: 0`. Then post each printed `paths` file to the replacement (`gh issue comment {replacement} --body-file "{path}"`), and apply each printed `edits` entry with `gh api -X PATCH repos/{owner}/{repo}/issues/comments/{commentId} -F body=@"{path}"`: a line promoted or expired on the old issue during an interruption gets the same mark on its carried copy. `_shared/github-write-transport.md` has no MCP row for a comment edit, so with `gh` absent report the pending edits and stop at step 3's mismatch. The planner selects trusted lines only, sharing `isTrustedComment`, so a planted line is never carried, and it leaves out what the replacement already holds, so a re-run never posts anything twice. Name each `skipped` note in the sweep report, and `unfingerprintedMarked`: a marked line with no fingerprint has nothing to carry. A carried line keeps its text, fingerprint and provenance, plus a `materiality-first-seen` marker holding its comment's timestamp, so expiry's age read survives the move. A promoted or expired entry moves as a fingerprint-only tombstone: the marker with no entry line, split across comments as needed. `isMaterialityDuplicate` reads it and the active-set read ignores it, so a rollover never changes which findings dedup suppresses.
  3. **Verify the count.** Re-read the replacement and re-run the fence, which compares both the live-entry count and the tombstone count against the old issue. Continue only when `verified` is `true`. A mismatch stops here: the old issue still holds `digest` and every entry, so routing and the sweep carry on as before, and the report names the numbers.
  4. **Move the label.** Read both issues' labels first, since `gh issue edit --remove-label` on an absent label fails the whole edit. Remove `digest` from the old issue first, if it holds it, then add it to the replacement, if it lacks it, so two open `digest` issues never exist for bootstrap-race repair to merge. If an open `digest` issue appeared while the label was off (a routing skill's lazy bootstrap), run steps 2 and 3 against it too, then close it with a pointer comment, before the add. Unpin the old issue and pin the replacement. A pin failure is reported and never stops the rollover, since no reader keys on the pin.
  5. **Catch late appends.** A router that read the label before step 4 may have posted to the old issue, and a staged approval may have marked it. Re-run steps 2 and 3 once more.
  6. **Close the old issue** with a summary comment stating both carried counts and pointing at the replacement. Its comment history stays the archive for everything it held, marked lines and non-entry notes included.
  ````

- [ ] **Step 4: Edit the restatements** with exactly these replacements:

  - `tidy/SKILL.md:144` Execution column: `Create the replacement, carry every trusted live entry and a tombstone per promoted or expired entry, verify both counts, move the `digest` label + pin, then close with a summary comment — `digest-sweep.md``.
  - `tidy/step-6-auto.md:70` reason: `Stage — closes one issue, opens another, carries its entries and moves a label: outward-facing, never auto-applied per the reversibility floor`.
  - `tidy/step-1-records.md:85`: replace `and it bootstraps the replacement in the same move — so this shape must not race it` with `and it carries the entries into the replacement before it closes anything. An open issue titled `… (continues #{old})` with `{old}` still open is that rollover's unfinished replacement, not yet labeled: `Keep` it too, with the same reason, so this shape must not race it`.
  - `specify/next-mode.md`'s bare-drain filter: change the predicate to
    ```js
    const eligible = records.filter((r) =>
      !r.labels.some((l) => EXCLUDE.has(l.name) || l.name.startsWith('needs:'))
      && !/\(continues #\d+\)$/.test(r.title)
    );
    ```
    The fence is a double-quoted `node -e`, in which `\(`, `\d` and `$/` pass through to node unchanged.
  - `_shared/materiality-floor.md` Container, the sentence ending `and it bootstraps the replacement in the same move.`: replace with `and it carries the entries into the replacement before it closes anything.`
  - `_shared/materiality-floor.md` Entry format: after the `consolebackfill-item` paragraph, add: `A line a rollover carried (`tidy/digest-sweep.md`, `github-issues` only) carries one more trailing marker, `<!-- materiality-first-seen: {ISO} -->`, holding the timestamp of the comment it came from; its fields and fingerprint are unchanged, so Dedup still matches it in the new container. A promoted or expired entry moves as a fingerprint-only tombstone, the `materiality-fingerprint` marker alone on its line: Dedup matches it, and with no entry line it is never in the active set.`
  - `_shared/materiality-floor.md` Dedup: after `never bare bodies.` add ` The read is paginated (`tidy/digest-sweep.md`'s Container rollover).`
  - `docs/skill-graph.md:249`: in `digest-sweep.md`'s digest reads list, change `(bootstrap-race merge, cluster promotion, expiry — #3766)` to `(bootstrap-race merge, cluster promotion, expiry — #3766; rollover carry-over — #4848)`.
  - `docs/skill-graph.md:658`: change `bootstrap-race repair, cluster promotion, expiry —` to `bootstrap-race repair, cluster promotion, expiry, container rollover —`.

- [ ] **Step 5: Run to verify the tests pass**

  Run: `node --test tests/materiality-floor-conformance.test.js tests/specify-digest-guard.test.js tests/tidy-residue-markers.test.js tests/tidy-console-backfill-conformance.test.js`
  Expected: PASS, 0 failures.

  Then run the fence from step 3c against `$PIPELINE_RUN_DIR/evidence/digest-1426-comments.json` and an empty `[]` file, with `{plugin-root}` this worktree's `plugin` and `{COUNT}` `102`, and with `{COUNT}` empty (a non-zero exit expected). Write the output to `$PIPELINE_RUN_DIR/evidence/fence-1426-probe.txt` with a plain Bash redirect, expecting `live: 97`, `tombstones: 633`, `verified: false` and at least one written `paths` file. Log it with the AC-evidence rule.

- [ ] **Step 6: Commit**

  ```bash
  git add plugin/skills/tidy/digest-sweep.md plugin/skills/tidy/SKILL.md plugin/skills/tidy/step-6-auto.md plugin/skills/tidy/step-1-records.md plugin/skills/_shared/materiality-floor.md plugin/skills/specify/next-mode.md docs/skill-graph.md tests/materiality-floor-conformance.test.js tests/specify-digest-guard.test.js
  git commit -m "Carry live entries and tombstones through digest rollover — refs #4848"
  ```

## Spec coverage

| Clause | Covered by |
|---|---|
| AC1.1 | Task 1 `AC1.1` |
| AC2.1 | Task 1 `AC2.1` |
| AC3.1 | Task 1 `AC3.1` |
| AC4.1 | Task 2 `AC4.1` |
| AC5.1 | Task 1 `AC5.1` |
| AC6.1 | Task 1 `AC6.1` |
| AC7.1 | Task 1 `AC7.1`, `AC7.2` |
