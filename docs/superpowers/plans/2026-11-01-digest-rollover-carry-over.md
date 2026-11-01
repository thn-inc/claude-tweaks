# Digest Rollover Carry-Over Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A digest rollover carries every trusted live entry into the new container, so clustering, expiry and dedup keep working, and a failure at any point loses nothing.

**Architecture:** `plugin/bin/lib/health-core/materiality-digest.js` gains a pure carry-over planner over comment objects, sharing `isTrustedComment`. `plugin/skills/tidy/digest-sweep.md` gains the ordered, re-runnable procedure that drives it. The original timestamp survives as one more trailing line marker, `<!-- materiality-first-seen: {ISO} -->`.

**Tech Stack:** Node 18+ CommonJS, `node --test`, skill markdown.

**Spec:** `.claude-tweaks/pipelines/2026-11-01T190941-record-4848/work/4848-spec.md` (worktree copy), record #4848.

## Global Constraints

- Rollover stays Stage at every tier.
- A carried entry keeps its line, fingerprint, provenance and original timestamp.
- Trusted means `isTrustedComment` from `plugin/bin/lib/issues/comment-trust.js`. A planted line is never carried.
- Never `gh issue list --search` to find the replacement: `_shared/github-write-transport.md` bans the search index for find-by-marker lookups (#1016, #1079, #1089).
- Comment body cap: under 60,000 characters, the convention `tidy/console-backfill.md` already uses.
- Scope and edit discipline: touch only what the task requires. Report a pre-existing bug as a follow-up, do not fold it in.
- Never `git stash`. Commit messages use `refs #4848`, never `closes`/`fixes`.

## Probes already run (2026-11-01, live #1426)

- `gh issue view 1426 --json comments` returned 102 of 102 comments: it walks every page. REST `gh api repos/thn-inc/claude-tweaks/issues/1426 --jq .comments` printed `102`. `gh api --paginate .../comments --jq length` printed `100` then `2`, one value per page, so a REST read needs `--paginate --slurp`.
- The trailing-marker regex in Task 1 over the live comments: 735 entry lines, 638 marked, 97 live, 97 distinct, 0 live lines with a `→` in their last 50 characters. An independent loose count (`/→\s*\S+\s*$/`) also gives 638 marked and 97 live. The record's 711/633/78 were the same issue before sibling sessions appended.
- Real shapes the fixtures must include: `… — {run-id} → #3900` (no fingerprint), `… <!-- materiality-fingerprint: x --> → #4413` (marker after the comment), a live line with `→` inside the finding, 7 of 735 lines with no fingerprint, provenance that is a skill name (`harness-health`) or free text (`reflect full mode, /flow #1153 wrap-up`), and non-entry `Note:` lines in the same comment.
- Run-ids are UTC (`2026-11-01T190941` minted at `19:09:31Z`), so the run-id date parses as UTC.
- `git grep isPinned|issue pin` over `plugin/` has no hit: no reader keys on the pin.
- 349 open issues, so `--state open --limit 1000` is a sized window.

## Review Focus

1. A rerun after a partial failure: already-carried lines (including one since marked `→`) are not posted twice. Pinned in Task 1.
2. A second rollover of an already-carried line keeps its first timestamp rather than re-stamping. Pinned in Task 1.
3. A live set larger than one comment splits at a line boundary under the cap. Pinned in Task 1.
4. An unfinished rollover found by the next sweep, including the state with no open `digest` issue, resumes rather than no-oping. Pinned in Task 2.
5. A promotion or expiry staged before the rollover and approved after it marks the carried copy, not the closed issue's line. Pinned in Task 2.

---

### Task 1: Carry-over planner

**Role:** integration

**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/health-core/materiality-digest.js`
- Test: `tests/bin-lib/health-core/materiality-digest.test.js`

**Interfaces:**
- Produces, all exported from `materiality-digest.js`:
  - `MATERIALITY_FIRST_SEEN_PREFIX = 'materiality-first-seen'`
  - `selectCarryOverEntries(comments) -> { entries: [{ line: string, key: string }], skipped: string[] }`. `line` is the line to post, first-seen marker included.
  - `materialityEntryDate(line: string, commentCreatedAt?: string) -> Date | null`
  - `planCarryOver(oldComments, newComments, { maxChars = 60000 } = {}) -> { live: number, carried: number, pending: string[], bodies: string[], skipped: string[] }`

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/health-core/materiality-digest.test.js`, with these names and assertions. Build lines with `materialityEntryLine` unless the shape is the point. Comment objects carry `{ body, authorAssociation, createdAt }`.

  - `AC1.1: selectCarryOverEntries selects only trusted live lines`: one `MEMBER` comment holding a live line, a `→ #12` line, a `<!-- materiality-fingerprint: x --> → #13` line and a `→ expired` line; one `CONTRIBUTOR` comment holding a live line. The selected lines are exactly the first live line. `skipped` has one entry naming the untrusted comment.
  - `selectCarryOverEntries keeps a live line with a mid-finding arrow, a fingerprint-less live line, and ignores non-entry lines`: `- [tests] a → b — f.js — Defer-reason: x — run` and a no-marker line are selected. `Note: …` and `---` are not. CRLF bodies give the same result.
  - `selectCarryOverEntries drops a bare-string element and reports it`: a string array element holding a fingerprint marker is not selected, and `skipped` has `BARE_STRING_SKIP_NOTE`'s text.
  - `selectCarryOverEntries collapses an exact duplicate line across comments`.
  - `selectCarryOverEntries stamps the comment createdAt and keeps an existing stamp`: a fresh line gets ` <!-- materiality-first-seen: 2026-08-24T18:35:16Z -->` appended, the rest byte-identical. A line already stamped `2026-01-01T00:00:00Z` in a comment created later keeps that value and gets no second marker.
  - `AC2.1: a carried entry still dedups against the new container`: `isMaterialityDuplicate([{ body: planCarryOver(old, []).bodies[0], authorAssociation: 'MEMBER' }], ENTRY) === true`.
  - `AC3.1: a carried entry's expiry age comes from its original timestamp, not the new comment's`: a skill-provenance line (`provenance: 'harness-health'`) in a comment created `2026-01-01T00:00:00Z`, carried; `materialityEntryDate(carriedLine, '2026-11-01T00:00:00Z').toISOString() === '2026-01-01T00:00:00.000Z'`.
  - `materialityEntryDate reads a run-id from provenance as UTC ahead of any other source`: line with provenance `2026-08-24T183516-tidy-standalone` and a comment date of `2026-11-01T00:00:00Z` gives `2026-08-24T18:35:16.000Z`, marked or not, and also when the line carries a first-seen marker of a different date.
  - `materialityEntryDate falls back to the comment date, and returns null with nothing parseable`: skill provenance plus comment date gives the comment date; skill provenance, no comment date gives `null`; a first-seen marker holding `not-a-date` is ignored.
  - `planCarryOver posts only what the new container lacks`: `planCarryOver(old, [])` has `live: 2, carried: 0, pending.length: 2`. After posting `bodies` as a `MEMBER` comment, `live: 2, carried: 2, pending: [], bodies: []`. It stays so when the carried line has since gained `→ #99` in the new container.
  - `planCarryOver ignores an untrusted comment in the new container`: the same lines posted by a `CONTRIBUTOR` leave `carried: 0`, so a planted copy cannot pass the count.
  - `planCarryOver splits bodies at line boundaries under maxChars`: with `{ maxChars: 200 }` and three 90-character lines, every body is at most 200 characters, each line appears whole, and no line is lost. A single line over the cap gets its own body rather than being cut.
  - `trustedMaterialityTexts output is unchanged` is already covered by the existing tests. Leave them as they are.

- [ ] **Step 2: Run to verify the tests fail**

  Run: `node --test tests/bin-lib/health-core/materiality-digest.test.js`
  Expected: FAIL, `selectCarryOverEntries is not a function`, with every pre-existing test still passing.

- [ ] **Step 3: Implement in `materiality-digest.js`**

  Pinned details, since the tests alone leave them open:

  ```js
  const ENTRY_LINE = /^- \[[^\]]+\] /;
  // A marker is trailing only when nothing but HTML comments follows it: `→` inside a finding stays live.
  const TRAILING_MARK = /\s*→ (?:expired|#?\d+)((?:\s*<!--.*?-->)*)\s*$/;
  const FIRST_SEEN = new RegExp(`\\s*<!-- ${MATERIALITY_FIRST_SEEN_PREFIX}: (\\S+?) -->`);
  const RUN_ID_DATE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2})(\d{2})(\d{2})(?:-|$)/;
  ```

  - Trust: `isTrustedComment` per element. Skip notes follow `trustedMaterialityTexts`'s rule: a bare string with a fingerprint marker gets `BARE_STRING_SKIP_NOTE`, an untrusted comment with a fingerprint marker gets `untrustedSkipNote`. Factor that loop into one private function both call, so the filter is shared and `trustedMaterialityTexts`'s output does not change.
  - Split bodies on `/\r?\n/`.
  - `key` is the line with its first-seen marker removed and `TRAILING_MARK` replaced by `$1`, trimmed. Selection dedupes on `key`, and `planCarryOver` compares `key`s against every entry line of the trusted new comments, marked or live.
  - The stamp source is `comment.createdAt || comment.created_at`. No date means no stamp.
  - `materialityEntryDate` provenance is the text after the line's last ` — `, with HTML comments and any trailing mark removed. Order: run-id date, then a valid first-seen marker, then `commentCreatedAt`, then `null`.
  - A top-level string passed to `selectCarryOverEntries` selects nothing: rollover is `github-issues` only, and `[].concat(s)` already routes it through the bare-string rule.
  - Extend the file header comment by one sentence naming the carry-over helpers and `tidy/digest-sweep.md`'s rollover as their caller.

- [ ] **Step 4: Run to verify the tests pass**

  Run: `node --test tests/bin-lib/health-core/materiality-digest.test.js`
  Expected: PASS, 0 failures.

- [ ] **Step 5: Real-input probe**

  Run, from the worktree:
  `gh issue view 1426 --json comments --jq .comments > "$PIPELINE_RUN_DIR/evidence/digest-1426-comments.json"` (`mkdir -p` the directory first), then a scratch script that calls `planCarryOver(read, [])` and prints `live`, `pending.length` and `bodies.length`. Independently count the same file: trusted entry lines minus those matching `/→\s*\S+\s*$/`. The two must be equal. Then feed `bodies` back as one `MEMBER` comment per body and assert `pending.length === 0` and `carried === live`. Log both counts per the AC-evidence rule: `log-decision.js --section "/build" --status AUTO --step "AC evidence"`.

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
- Modify: `docs/skill-graph.md`
- Test: `tests/materiality-floor-conformance.test.js`

Reader inventory, from the comment read call sites (`--json comments`, `/comments`, `get_comments`), not the marker literal:

| Site | Read | Classification |
|---|---|---|
| `tidy/digest-sweep.md` Cluster promotion, Expiry, Bootstrap-race repair | `gh issue view {n} --json comments` | Paginated. Rule stated once in the new section |
| `_shared/materiality-floor.md` Dedup | `gh issue view {n} --json comments` | Paginated. Add the pointer in this task |
| `tidy/console-backfill.md:62` | `gh issue view {n} --json comments --jq .comments` | Paginated. No change |
| `bin/lib/console/backfill-dispose.js`, `reflect-apply.js`, `review/step3-routing.md`, `review/step3-tiebreak.md`, the health sweeps | Take comments from their caller or cite the floor's Dedup | No read of their own. No change |
| `_shared/github-write-transport.md:28` | `?per_page=100` single page on `gh`, paged on MCP | Generic row, not a digest reader. No change: the new section names the digest forms |
| `_shared/health-filing-digest.md` | The drain-rate cap digest, a different container | Not a reader of this value. No change |

**Interfaces:**
- Consumes: `planCarryOver`, `materialityEntryDate` from Task 1.

- [ ] **Step 1: Write the failing conformance tests** in `tests/materiality-floor-conformance.test.js`:

  ```js
  const rollover = () => SWEEP.slice(SWEEP.indexOf('### Container rollover'));

  test('AC4.1: digest-sweep.md orders the rollover so a failure loses nothing', () => {
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
  });

  test('AC4.2: digest-sweep.md verifies the carried count before the close and stops on a mismatch', () => {
    const r = rollover();
    assert.ok(r.includes('`pending` is `0` and `carried` equals `live`'));
    assert.ok(r.includes('A mismatch stops here'));
    assert.ok(r.indexOf('Remove `digest` from the old issue') < r.indexOf('add it to the replacement'), 'label removal must precede the add');
  });

  test('AC4.3: digest-sweep.md states the threshold rationale and the true-count read', () => {
    const r = rollover();
    assert.ok(r.includes('compacts promoted and expired lines out of every sweep'));
    assert.ok(r.includes('truncates'));
    assert.ok(r.includes('--jq .comments'));
    assert.ok(r.includes('--paginate --slurp'));
    assert.ok(r.includes('`get_comments`'));
  });

  test('digest-sweep.md resumes an unfinished rollover before its no-op, and finds it without the search index', () => {
    const start = SWEEP.indexOf('**Resume an unfinished rollover.**');
    assert.ok(start !== -1, 'resume paragraph must exist');
    assert.ok(start < SWEEP.indexOf('### Bootstrap-race repair'), 'resume must run before the procedures it would otherwise race');
    assert.ok(SWEEP.includes('(continues #{old})'));
    assert.ok(SWEEP.includes('no `--search`'));
  });

  test('digest-sweep.md Expiry dates a carried line through materialityEntryDate', () => {
    const expiry = SWEEP.slice(SWEEP.indexOf('### Expiry'), SWEEP.indexOf('### Container rollover'));
    assert.ok(expiry.includes('materialityEntryDate'));
    assert.ok(expiry.includes('materiality-first-seen'));
  });

  test('a proposal approved after a rollover marks the carried copy', () => {
    assert.ok(rollover().includes('marks the carried copy in the current container'));
  });

  test('every rollover restatement carries the carry-over, not a bare bootstrap', () => {
    const row = TIDY_SKILL.split('\n').find((l) => l.startsWith('| **Rollover digest container**'));
    assert.ok(row.includes('carry every trusted live entry'));
    assert.ok(!row.includes('bootstrap a fresh issue'));
    assert.ok(!FLOOR.includes('it bootstraps the\nreplacement in the same move'));
    assert.ok(!TIDY_RECORDS.includes('it bootstraps the replacement in the same move'));
    assert.ok(FLOOR.includes('materiality-first-seen'));
    const tier = TIDY_STEP6_AUTO.split('\n').find((l) => l.startsWith('| **Rollover digest container**'));
    assert.match(tier, /\| Stage \| Stage \| Stage — /);
  });
  ```

- [ ] **Step 2: Run to verify they fail**

  Run: `node --test tests/materiality-floor-conformance.test.js`
  Expected: FAIL on each new test, every pre-existing test still passing.

- [ ] **Step 3: Edit `digest-sweep.md`**

  a. Replace the opening `No-ops silently…` sentence's start so the file opens the section with this paragraph, keeping the existing no-op text after it (the test `no-ops silently` still pins it):

  ```markdown
  **Resume an unfinished rollover.** `github-issues` only. Before the no-op check below, list open issues (`gh issue list --state open --limit 1000 --json number,title,labels`, no `--search`: `_shared/github-write-transport.md`'s list-then-filter rule) and filter client-side for a title ending `(continues #{old})` whose `{old}` issue is still open. A match is a rollover a failure interrupted, whichever step it reached, even when no open issue carries `digest` any more. Propose finishing it with the `Rollover digest container` action, whatever the comment count.
  ```

  b. In `### Expiry`, replace `(parsed from each entry's `{provenance}` — a run-id's ISO timestamp, or the comment/edit timestamp when provenance names a skill instead of a run)` with:

  ```markdown
  (`materialityEntryDate(line, comment.createdAt)` in `bin/lib/health-core/materiality-digest.js`: a run-id's ISO timestamp from `{provenance}`, else the `<!-- materiality-first-seen: {ISO} -->` marker a rollover stamped, else the comment's timestamp)
  ```

  c. Replace the whole `### Container rollover` section with:

  ````markdown
  ### Container rollover

  `github-issues` only — a file has no analogous limit. When the digest issue reaches 100 comments, propose the `Rollover digest container` action, Stage at every tier (`step-6-auto.md`). Read the true count from REST, `gh api repos/{owner}/{repo}/issues/{n} --jq .comments` (`issue_read` get mode on MCP). The threshold does two jobs: a rollover compacts promoted and expired lines out of every sweep's read, since only live lines move, and 100 is where `gh issue list --json comments` truncates, so a reader that slipped onto that form would start missing entries from there on.

  **Every digest read is paginated.** `gh issue view {n} --json comments` walks every page; REST needs `gh api --paginate --slurp repos/{owner}/{repo}/issues/{n}/comments`; MCP `issue_read` in `get_comments` mode needs `perPage: 100`, then `page` 2, 3, … until a page returns fewer than 100. Never `gh issue list --json comments` for this container.

  On approval, read everything fresh, since the proposal holds no copy of the entries. Apply after any `Propose digest cluster` or `Expiry summary` approved in the same run, so their markers keep those lines out of the carry. A proposal of either kind approved after a rollover marks the carried copy in the current container, never the closed issue's line. Each step below is safe to re-run from the top:

  1. **Create the replacement** titled `{old title} (continues #{old})` without the `digest` label, unless the resume list above already found it. Its body says it is a digest container continuing `#{old}`.
  2. **Carry.** Save both issues' comment objects with the paginated read, then run:

     ```bash
     node -e "const fs=require('fs');const [root,oldF,newF,dir]=process.argv.slice(1);const {planCarryOver}=require(root+'/bin/lib/health-core/materiality-digest.js');const read=(f)=>JSON.parse(fs.readFileSync(f,'utf8'));const p=planCarryOver(read(oldF),read(newF));fs.mkdirSync(dir,{recursive:true});const paths=p.bodies.map((b,k)=>{const f=dir+'/carry-'+k+'.md';fs.writeFileSync(f,b);return f;});console.log(JSON.stringify({live:p.live,carried:p.carried,pending:p.pending.length,skipped:p.skipped,paths},null,1))" "${CLAUDE_PLUGIN_ROOT}" "{OLD}" "{NEW}" "{CARRYDIR}"
     ```

     Then post each printed `paths` file to the replacement. The planner selects trusted live lines only, sharing `isTrustedComment`, so a planted line is never carried, and it leaves out what the replacement already holds, so a re-run never posts a line twice. Name each `skipped` note in the sweep report. Each carried line keeps its text, fingerprint and provenance, plus a `materiality-first-seen` marker holding its comment's timestamp, so expiry's age read survives the move.
  3. **Verify the count.** Re-read the replacement and re-run the fence. Continue only when `pending` is `0` and `carried` equals `live`. A mismatch stops here: the old issue still holds `digest` and every entry, so routing and the sweep carry on as before, and the report names both numbers.
  4. **Move the label.** Remove `digest` from the old issue first, then add it to the replacement, so two open `digest` issues never exist for bootstrap-race repair to merge. If an open `digest` issue appeared while the label was off (a routing skill's lazy bootstrap), carry its live lines too, then close it with a pointer comment, before the add. Unpin the old issue and pin the replacement. A pin failure is reported and never stops the rollover, since no reader keys on the pin.
  5. **Catch late appends.** A router that read the label before step 4 may have posted to the old issue. Re-run steps 2 and 3 once more.
  6. **Close the old issue** with a summary comment stating the carried count and pointing at the replacement. Its comment history stays the archive for everything it held, marked lines and non-entry notes included.
  ````

- [ ] **Step 4: Edit the restatements** with exactly these replacements:

  - `tidy/SKILL.md:144` Execution column: `Create the replacement, carry every trusted live entry, verify the count, move the `digest` label + pin, then close with a summary comment — `digest-sweep.md``.
  - `tidy/step-6-auto.md:70` reason: `Stage — closes one issue, opens another, carries its live entries and moves a label: outward-facing, never auto-applied per the reversibility floor`.
  - `tidy/step-1-records.md:85`: replace `and it bootstraps the replacement in the same move — so this shape must not race it` with `and it carries the live entries into the replacement before it closes anything. An open issue titled `… (continues #{old})` with `{old}` still open is that rollover's unfinished replacement, not yet labeled: `Keep` it too, with the same reason, so this shape must not race it`.
  - `_shared/materiality-floor.md` Container, the sentence ending `and it bootstraps the replacement in the same move.`: replace with `and it carries the live entries into the replacement before it closes anything.`
  - `_shared/materiality-floor.md` Entry format: after the `consolebackfill-item` paragraph, add: `A line a rollover carried (`tidy/digest-sweep.md`) carries one more trailing marker, `<!-- materiality-first-seen: {ISO} -->`, holding the timestamp of the comment it came from; its fields and fingerprint are unchanged, so Dedup still matches it in the new container.`
  - `_shared/materiality-floor.md` Dedup: after `never bare bodies.` add ` The read is paginated (`tidy/digest-sweep.md`'s Container rollover).`
  - `docs/skill-graph.md:249`: in `digest-sweep.md`'s digest reads list, change `(bootstrap-race merge, cluster promotion, expiry — #3766)` to `(bootstrap-race merge, cluster promotion, expiry — #3766; rollover carry-over — #4848)`.
  - `docs/skill-graph.md:658`: change `bootstrap-race repair, cluster promotion, expiry —` to `bootstrap-race repair, cluster promotion, expiry, container rollover —`.

- [ ] **Step 5: Run to verify the tests pass**

  Run: `node --test tests/materiality-floor-conformance.test.js tests/tidy-residue-markers.test.js tests/tidy-console-backfill-conformance.test.js`
  Expected: PASS, 0 failures. Then run the fence from step 3c against `$PIPELINE_RUN_DIR/evidence/digest-1426-comments.json` and an empty `[]` file with `CLAUDE_PLUGIN_ROOT` set to this worktree's `plugin`, and confirm it prints the counts from Task 1's probe plus one written `paths` file. Log it with the AC-evidence rule.

- [ ] **Step 6: Commit**

  ```bash
  git add plugin/skills/tidy/digest-sweep.md plugin/skills/tidy/SKILL.md plugin/skills/tidy/step-6-auto.md plugin/skills/tidy/step-1-records.md plugin/skills/_shared/materiality-floor.md docs/skill-graph.md tests/materiality-floor-conformance.test.js
  git commit -m "Carry live entries through digest rollover — refs #4848"
  ```

## Known limit

Between steps 1 and 4 the replacement carries no `digest` label, so `/specify`'s drain (`specify/next-mode.md`'s `EXCLUDE` set, label-keyed) can see it as a backlog record if a failure strands it. Step 1's `Keep` clause covers `/tidy`, and the next sweep's resume finishes the move. Widening the label-keyed excludes to a title match is a separate decision; see the ledger row.
