# Digest Rollover Carry-Over Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A digest rollover carries every trusted live entry and a tombstone for every promoted or expired entry into the new container, so clustering, expiry and dedup behave the same afterwards, and a failure at any point loses nothing.

**Architecture:** `plugin/bin/lib/health-core/materiality-digest.js` gains a pure planner over two issues' comment objects, sharing `isTrustedComment` and refusing any other input shape, plus a pure replacement-identity classifier. `plugin/skills/tidy/digest-sweep.md` gains the ordered, re-runnable procedure that drives them. The original timestamp survives as one more trailing line marker, `<!-- materiality-first-seen: {ISO} -->`. A tombstone is a line of only the source line's dedup markers (`materiality-fingerprint`, and `consolebackfill-item` when present), so `isMaterialityDuplicate` and `heldDigestComment` read it unchanged. The replacement's identity is a `<!-- digest-rollover-of: {old} -->` line in its body from a trusted author; the title is never identity.

**Tech Stack:** Node 18+ CommonJS, `node --test`, skill markdown.

**Spec:** `.claude-tweaks/pipelines/2026-11-01T194531-record-4848/work/4848-spec.md`, record #4848. Its `## Decisions` section is binding: a rollover preserves every signal a dedup or sweep reads, so what is suppressed before a rollover is suppressed after it.

**Prior attempts:** two plan reviews stopped earlier runs before any code. This plan folds in their findings (`.claude-tweaks/pipelines/2026-11-01T192521-record-4848/evidence/plan-review-findings.md`).

## Global Constraints

- Rollover stays Stage at every tier.
- A carried entry keeps its line, fingerprint, provenance and original timestamp.
- A tombstone keeps every dedup marker from its source line, with no entry line. `isMaterialityDuplicate` reads it. `heldDigestComment` reads it. The active-set read ignores it because it has no entry line.
- Trusted means `isTrustedComment` from `plugin/bin/lib/issues/comment-trust.js`. A planted line or marker is never carried and never counts as carried.
- Timestamp preservation applies to `github-issues` only. `local-files` has no rollover, and its expiry dating is unchanged.
- A title alone never identifies a replacement.
- Never `gh issue list --search` to find the replacement: `_shared/github-write-transport.md` bans the search index for find-by-marker lookups.
- Comment body cap: under 60,000 characters, the convention `tidy/console-backfill.md` already uses.
- `plugin/bin/lib/health-core/materiality-digest.js` stays pure: no `fs`, no I/O.
- Scope and edit discipline: "Commit tests only where the task asks for them or the repo already keeps tests for this kind of change, sized like the neighboring test files; scratch checks stay scratch. Touch only what the task requires — a pre-existing bug you notice is a follow-up to report, not a fix to fold in, unless the task cannot work without it. Don't reformat or "improve" adjacent code; edit in place rather than rewrite when the result is the same."
- Never `git stash`. Commit messages use `refs #4848`, never `closes`/`fixes`, and end with `Claude-Session: https://claude.ai/code/session_017vXcAdZdS51NVdkaca5Yj3`.

## Probes run (2026-11-01, live #1426, snapshot at `$PIPELINE_RUN_DIR/evidence/digest-1426-comments.json`)

- `gh issue view 1426 --json comments --jq .comments` returned 102 flat objects, every one with `body`, `authorAssociation`, `createdAt`, `id` (node id) and `url` ending `#issuecomment-{numeric}`. REST `gh api repos/thn-inc/claude-tweaks/issues/1426` returned `comments: 102`, `author_association: "MEMBER"`, `state: "open"`, and `labels` as objects with `.name`.
- `gh issue list --label digest --state open --json number,comments --jq ".[0].comments|length"` printed `100` for those 102: this read truncates.
- `gh issue list --state open --limit 500 --json number,title,labels,body` returned 349 rows carrying `body` but no author association, so a trust check needs the REST read per candidate.
- `gh api --paginate --slurp ... --jq` is refused by `gh`, and `--paginate --slurp` without it yields an array of pages. The procedure's only comment read is therefore `gh issue view`, and a nested array is exactly what planning refuses.
- Independent count over an earlier snapshot of the same 102 comments: 735 trusted entry lines; 638 marked; 97 live, 97 distinct, 2 of them with no fingerprint; 5 marked lines with no fingerprint; 728 distinct fingerprints, 95 on live lines, so **633 tombstones**; 8 `consolebackfill-item` markers, all on marked lines. Task 1 Step 5 recounts the current snapshot independently.
- The container's comments also carry `<!-- agent-claim: … -->` and `<!-- agent-claim-release: … -->` markers. They are not dedup markers: a tombstone never carries them, so tombstones read a fixed marker list, never "every HTML comment".
- Real shapes the fixtures must include: `… — {run-id} → #3900` (no fingerprint), `… <!-- materiality-fingerprint: x --> → #4413` (mark after the comment), a live line with `→` inside the finding, provenance that is a skill name (`harness-health`) or free text (`reflect full mode, /flow #1153 wrap-up`), and non-entry lines in the same comment.
- Run-ids are UTC (`2026-11-01T190941` minted at `19:09:31Z`), so a run-id date parses as UTC.
- `gh issue edit --remove-label` on an absent label fails the whole edit, so the label move reads labels first.
- Verified live on a throwaway issue: `gh api -X PATCH repos/{owner}/{repo}/issues/comments/{id} -F body=@{file}` writes the file's bytes (read back equal, `{owner}`, `@…` and digits left literal), and `gh issue pin`/`unpin` both succeed.

## Review Focus

1. A second rollover: tombstones (with their `consolebackfill-item` markers) and first-seen stamps from the first one carry again, unchanged. Pinned in Task 1.
2. A live set larger than one comment splits at a line boundary under the cap, and a re-run after only some bodies posted posts only the rest. Pinned in Task 1.
3. A flat single-page read (30 of 102 comments) is shape-valid but incomplete: the count check refuses it. Pinned in Task 1.
4. An interrupted label move: step 4 removes the label before adding it, so an interruption between the two leaves neither issue holding `digest`. The spec's resume rule requires one of them to hold it, so this state is not resumed: `classifyRolloverResume` returns `stalled` and the sweep names it for a human, with any bootstrapped issue to clear first and the command that finishes it. Pinned in Tasks 1 and 2.
5. A stranded replacement, before it holds the label, is not shaped by `/specify`'s drain or staled by `/tidy`. Both exemptions rest on the same trusted verdict, never the title and never the bare line. Pinned in Task 2.

---

### Task 1: Carry-over planner and replacement identity

**Role:** integration

**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/health-core/materiality-digest.js`
- Test: `tests/bin-lib/health-core/materiality-digest.test.js`, `tests/bin-lib/console/backfill-dispose.test.js`

**Interfaces:**
- Consumes: `isTrustedComment`, `commentAssociation`, `untrustedSkipNote` from `../issues/comment-trust`; `parseMaterialityFingerprints` in the same file.
- Produces, all exported from `materiality-digest.js`:
  - `MATERIALITY_FIRST_SEEN_PREFIX = 'materiality-first-seen'`
  - `DIGEST_REPLACEMENT_PREFIX = 'digest-rollover-of'`
  - `CarryOverInputError` (extends `Error`, `name === 'CarryOverInputError'`)
  - `selectCarryOverEntries(comments) -> { entries: [{ line: string, key: string, fingerprint: string|null }], skipped: string[] }`. `line` is the line to post, first-seen marker included. Throws `CarryOverInputError` on a malformed input.
  - `materialityEntryDate(line: string, commentCreatedAt?: string) -> Date | null`
  - `planCarryOver(oldComments, newComments, { oldCommentCount, maxChars = 60000 }) -> { live, carried, pending: string[], tombstones, tombstonesCarried, tombstonesPending: string[], unfingerprintedMarked, markerEdits: [{ commentId: string, body: string }], bodies: string[], verified: boolean, skipped: string[] }`
  - `digestReplacementMarker(oldNumber) -> string`, exactly `<!-- digest-rollover-of: {old} -->`
  - `classifyRolloverResume(candidates, oldIssue) -> { state: 'none'|'resume'|'stalled'|'finished', replacement: number|null, extras: number[] }`. `candidates` and `oldIssue` are REST issue objects (`number`, `body`, `author_association`, `state`, `labels: [{ name }]`).

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
  - `AC8.1 (marker half): a tombstone keeps a consolebackfill-item marker`: a marked line ending `<!-- materiality-fingerprint: fp1 --> <!-- consolebackfill-item: item1 --> → expired`. The posted tombstone line holds both markers and no `- [`, and neither `agent-claim` nor `materiality-first-seen`. A comment body holding `<!-- agent-claim: {"runId":"x"} -->` contributes no tombstone. A marked line stamped `materiality-first-seen` tombstones without the stamp.
  - `a tombstone has no entry line and fits under the comment-size cap`: every body line holding only markers fails `/^- \[/`; with `{ maxChars: 200 }` and 20 tombstones every body is at most 200 characters, each body starts with a plain-text header line, and the union of markers across bodies is all 20.
  - `a fingerprint with both a live and a marked line is carried live, with no tombstone`.
  - `a marked line sharing a live line's fingerprint still tombstones its own consolebackfill-item marker`: the tombstone holds only the item marker, and `verified` needs it.
  - `a marked line with no fingerprint is counted in unfingerprintedMarked, not tombstoned`.
  - `a second rollover carries tombstones and stamps again`: roll A to B, then B to C. `isMaterialityDuplicate` against C is true for a promoted finding from A, C's bodies still hold that finding's `consolebackfill-item` marker, `tombstones` matches, and the live line's first-seen value is A's comment date.
  - `AC6.1: planning refuses a paged, wrapped or malformed input rather than returning an empty plan`: `assert.throws` with `{ name: 'CarryOverInputError' }` for each of: `[[c1, c2], [c3]]` (slurped pages), `{ comments: [c1] }` (wrapped), `null`, a JSON string, `[]` as the old side, `['- [a] b']` (bare bodies), `[{ body: 'x' }]` (no association), `[{ authorAssociation: 'MEMBER' }]` (no body), `[{ body: 'x', authorAssociation: 'MEMBER' }]` (no date), and on the new side the same shapes other than `[]`. `selectCarryOverEntries` refuses the same element shapes.
  - `planCarryOver refuses a truncated read`: `oldCommentCount` of `old.length + 1`, `NaN`, or omitted throws `CarryOverInputError`. `[]` on the new side is valid.
  - `AC7.1: a re-run after each interruption point posts nothing twice`: with `{ maxChars: 200 }` and enough lines for 3+ bodies. Nothing posted: `verified === false`, `pending` holds all. After posting `bodies[0]` only: `bodies` no longer holds any line from it. After posting all: `pending: []`, `tombstonesPending: []`, `bodies: []`, `markerEdits: []`, `verified: true`, `carried === live`, `tombstonesCarried === tombstones`. Unchanged when re-planned a second time.
  - `AC7.2: a promotion on the old issue mid-rollover reaches the carried copy`: post everything, then mark the old line `→ #99`. Re-plan: `verified === false`, `bodies: []`, and `markerEdits` holds one entry whose `commentId` is the numeric id from the new comment's `url` and whose `body` has the carried line ending in ` → #99`, every other line byte-identical. Applying that body gives `markerEdits: []`, `verified: true`, and `selectCarryOverEntries` no longer selects it. The same holds for `→ expired` and for a fingerprint-less line.
  - `AC10.1: a re-plan after posting returns no marker edit for a key that is still live on the old issue`: old holds both a live and a `→ #12` line with one fingerprint. Post `bodies`, re-plan: `markerEdits: []`, `verified: true`, and the carried line is still selected as live.
  - `a mark made only on the carried copy counts as carried`: the new container's copy gains `→ #99`, the old line stays live. `carried === live`, `markerEdits: []`, `bodies: []`.
  - `planCarryOver ignores an untrusted comment in the new container`: the same lines and tombstones posted by a `CONTRIBUTOR` leave `carried: 0`, `tombstonesCarried: 0`, `verified: false`, so a planted copy cannot pass the count.
  - `planCarryOver splits bodies at line boundaries under maxChars`: with `{ maxChars: 200 }` and three 90-character lines, every body is at most 200 characters, each line appears whole, and none is lost. A single line over the cap gets its own body rather than being cut.
  - `AC9.1: an issue merely titled like a replacement, with no trusted marker line, is never resumed`: `classifyRolloverResume` over a candidate titled `Digest (continues #123)` with no marker gives `{ state: 'none', replacement: null, extras: [] }`. The same holds for the marker in a `CONTRIBUTOR`'s body, for the marker naming a different number, and for the marker inside a longer line (`see <!-- digest-rollover-of: 123 --> here`).
  - `classifyRolloverResume resumes on the marker plus the digest label on either issue`: old open holding `digest`, candidate without it: `resume`. Old open without it, candidate holding it: `resume`.
  - `classifyRolloverResume names a stalled label move`: neither issue holding `digest` gives `stalled` with `replacement` set, whether old is open or closed. A candidate titled like a replacement never reaches this state without the trusted marker.
  - `classifyRolloverResume treats a closed old issue with a labeled replacement as finished`: `finished`, and `extras` still lists any higher-numbered match. A closed old issue still holding `digest`, with a replacement lacking it, is `resume`.
  - `classifyRolloverResume picks the lowest-numbered of several and lists the others as extras`: candidates 12, 10, 11 give `replacement: 10`, `extras: [11, 12]`, and an untrusted candidate numbered 9 is left out of both.
  - `classifyRolloverResume refuses a non-array candidate list and a non-object old issue` with `CarryOverInputError`.
  - Real-shape fixture test `planCarryOver handles the shapes found on the live digest`, covering the shapes under Probes.
  - Leave every existing test as it is. `trustedMaterialityTexts`'s output must not change.

  In `tests/bin-lib/console/backfill-dispose.test.js`, mirroring the existing test around line 615 and reusing its `plan`, `workList` and item helpers: `AC8.1 (held half): a tombstone keeps a promoted console-backfill finding held against the new container`. Take the real line the plan produces for the finding, the fixture line carrying both markers, and mark it ` → expired`. Run `planCarryOver` from a comment holding it, and pass the resulting `bodies` as `MEMBER` comments for `digestComments` to the case where only the item marker can match (the existing test's `after` item, whose claim changed so its fingerprint differs). Assert the same duplicate outcome the existing test asserts for the unrolled line.

- [ ] **Step 2: Run to verify the tests fail**

  Run: `node --test tests/bin-lib/health-core/materiality-digest.test.js tests/bin-lib/console/backfill-dispose.test.js`
  Expected: FAIL, `selectCarryOverEntries is not a function`, with every pre-existing test still passing.

- [ ] **Step 3: Implement in `materiality-digest.js`**

  Pinned details, since the tests alone leave them open:

  ```js
  const ENTRY_LINE = /^- \[[^\]]+\] /;
  // A mark is trailing only when nothing but HTML comments follows it: `→` inside a finding stays live.
  const TRAILING_MARK = /\s*(→ (?:expired|#?\d+))((?:\s*<!--.*?-->)*)\s*$/;
  const RUN_ID_DATE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2})(\d{2})(\d{2})(?:-|$)/;
  // The markers a dedup or sweep reads. A fixed list: the container's comments also hold agent-claim markers.
  const DEDUP_MARKER = /<!-- (?:materiality-fingerprint|consolebackfill-item): \S+? -->/g;
  ```

  - Shape check, shared by both exported readers: the input is an array; each element is a non-array object with a string `body`, a non-null `commentAssociation`, and a string `createdAt` or `created_at`. Anything else throws `CarryOverInputError` naming the index and what is missing. A comment that passes the shape but fails `isTrustedComment` is skipped with `untrustedSkipNote` when its body holds a fingerprint marker, the rule `trustedMaterialityTexts` already applies.
  - Split bodies on `/\r?\n/`.
  - `key` is the fingerprint when the line has one, else the line with its first-seen marker and trailing mark removed, trimmed. Selection dedupes on `key`.
  - Tombstones: walk the old side's trusted lines in order, skipping live entry lines. For each other line, take its `DEDUP_MARKER` matches, minus the markers on any old live entry line, minus markers an earlier tombstone already took. A non-empty remainder is one tombstone. This makes the new container's dedup set a superset of the old one's, and it carries an earlier rollover's tombstones because they are non-entry lines holding markers.
  - `tombstones` counts those tombstones. A tombstone is carried when every marker in it is on some line of the new side's trusted bodies, whether a tombstone line or a marked or live entry line. `tombstonesPending` holds one line per uncarried tombstone: its missing markers only, space-joined, so a re-run posts nothing twice.
  - Old side `oldCommentCount`: `Number.isInteger` and equal to `oldComments.length`, and the array non-empty. Otherwise throw.
  - `carried` counts old live keys present on any new trusted entry line, marked or live. A new tombstone alone does not count a live key as carried.
  - `markerEdits`: for each old marked line whose `key` is not also on an old live line, and is on a new trusted entry line with no trailing mark, append ` {mark}` to that line in that comment's body. One entry per comment, all its edits applied. `commentId` is the digits after `issuecomment-` in `url`/`html_url`, else a numeric `id`. With none, throw `CarryOverInputError`.
  - `bodies`: pending live lines first, chunked at line boundaries under `maxChars`, a lone over-cap line in its own body. Then tombstones, one per line, each chunk opening with `Fingerprint-only tombstones: promoted or expired findings kept for dedup (tidy/digest-sweep.md's Container rollover).`
  - `verified` is `pending` and `tombstonesPending` empty, `markerEdits` empty, `carried === live`, `tombstonesCarried === tombstones`.
  - `materialityEntryDate` provenance is the text after the line's last ` — `, with HTML comments and any trailing mark removed. Order: run-id date, then a valid first-seen marker, then `commentCreatedAt`, then `null`.
  - `classifyRolloverResume`: a candidate qualifies when `isTrustedComment(candidate)` and a whole line of its `body` (split on `/\r?\n/`, trimmed) equals `digestReplacementMarker(oldIssue.number)`. No qualifier: `none`. Otherwise `replacement` is the lowest number, `extras` the rest ascending. Neither `oldIssue` nor the chosen replacement has a `digest` label: `stalled`. `oldIssue.state` not `open` (compare case-insensitively) and the replacement has the label: `finished`. Otherwise `resume`.
  - Extend the file header comment by one sentence naming the carry-over helpers and `tidy/digest-sweep.md`'s rollover as their caller.

- [ ] **Step 4: Run to verify the tests pass**

  Run: `node --test tests/bin-lib/health-core/materiality-digest.test.js tests/bin-lib/console/backfill-dispose.test.js`
  Expected: PASS, 0 failures.

- [ ] **Step 5: Real-input probe**

  Run a scratch script (uncommitted, in the session scratchpad) that loads `/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-11-01T194531-record-4848/evidence/digest-1426-comments.json`, and first computes an independent count with its own regexes, not the module's: comment count, trusted entry lines, marked and live, distinct fingerprints, fingerprints on live lines, and `consolebackfill-item` markers. Then call `planCarryOver(read, [], { oldCommentCount: read.length })` and reconcile `live`, `tombstones`, `unfingerprintedMarked` against the independent count. Expected on the numbers under Probes unless the snapshot has moved: `live: 97`, `tombstones: 633`, `unfingerprintedMarked: 5`, `verified: false`, every body under 60,000 characters. Feed `bodies` back as one `MEMBER` comment per body and re-plan: `pending: 0`, `tombstonesPending: 0`, `verified: true`. Then assert that the old side's trusted `materiality-fingerprint` set is a subset of the new side's, and the same for `consolebackfill-item`, by counting with the scratch regexes.

  Write the output to `/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-11-01T194531-record-4848/evidence/planner-1426-probe.txt` with a plain Bash redirect, then log it with `log-decision.js --section "/build" --status AUTO --step "AC evidence" --text-file {text-file}`, one line naming the real-input probe, the command shape, the counts and that path.

- [ ] **Step 6: Commit**

  ```bash
  git add plugin/bin/lib/health-core/materiality-digest.js tests/bin-lib/health-core/materiality-digest.test.js tests/bin-lib/console/backfill-dispose.test.js
  git commit -m "Add digest carry-over planner — refs #4848"
  ```

### Task 2: Rollover procedure and prose sweep

**Role:** integration

**Review risk:** high

**Files:**
- Modify: `plugin/skills/tidy/digest-sweep.md` (7,303 B against the 52,500 B rail)
- Modify: `plugin/skills/tidy/SKILL.md:144` (43,256 B)
- Modify: `plugin/skills/tidy/step-6-auto.md:70` (50,615 B, 1,885 B of headroom: this row grows by under 150 B)
- Modify: `plugin/skills/tidy/step-1-records.md:85` (38,551 B)
- Modify: `plugin/skills/_shared/materiality-floor.md` (13,364 B)
- Modify: `plugin/skills/specify/next-mode.md:187-198` (24,724 B)
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

Stale-prose sweep, from `grep -rnE "bootstraps the|bootstrap a fresh|fresh digest|closed comment|rollover"` over `plugin/skills`, `docs/skill-graph.md`, `docs/journeys`, `README.md`: `tidy/digest-sweep.md:93` (`closed comment's history` describes expiry's own comment, no change), `tidy/console-backfill.md:84` (points at `digest-sweep.md`, no change), `tidy/SKILL.md:94` (lists the four procedures, no change), `_shared/materiality-floor.md:163` (`no rollover needed` for local-files, no change), `docs/journeys/absorb-a-capture-into-an-existing-record.md:19` (example text, no change), plus the edits below. `grep -rnF -e "bootstraps the" -e "bootstrap a fresh" -e "parsed from each entry" tests` returned no hits, so no test pins the text being replaced.

**Interfaces:**
- Consumes: `planCarryOver`, `materialityEntryDate`, `classifyRolloverResume`, `digestReplacementMarker` from Task 1.

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
    assert.ok(r.includes('consolebackfill-item'));
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

  test('digest-sweep.md resumes an unfinished rollover before its no-op, by trusted body marker, never by title', () => {
    const start = SWEEP.indexOf('**Resume an unfinished rollover.**');
    assert.ok(start !== -1, 'resume paragraph must exist');
    assert.ok(start < SWEEP.indexOf('No-ops silently'), 'resume must run before the no-op that would otherwise skip it');
    assert.ok(SWEEP.includes('<!-- digest-rollover-of: {old} -->'));
    assert.ok(SWEEP.includes('classifyRolloverResume'));
    assert.ok(SWEEP.includes('no `--search`'));
    assert.ok(SWEEP.includes('A title alone never identifies a replacement'));
    assert.ok(SWEEP.includes('`stalled`'), 'the interrupted label move must be named');
    assert.ok(SWEEP.includes('list open `digest` issues first'), 'a stalled move must look for a bootstrapped issue before naming the add');
    assert.ok(SWEEP.includes('`finished`') && SWEEP.includes('propose finishing when `verified` is `false` or `extras` is non-empty'), 'a closed old issue must be re-checked, not ignored');
  });

  test('digest-sweep.md re-lists before creating, picks the lowest-numbered, and closes the others after carrying', () => {
    const r = rollover();
    assert.ok(r.includes('Re-list immediately before creating'));
    assert.ok(r.includes('lowest-numbered'));
    assert.ok(r.includes('`extras`'));
  });

  test('digest-sweep.md skips the carry for a zero-comment issue and re-reads the count after the close', () => {
    const r = rollover();
    assert.ok(r.includes('A digest issue with zero comments has nothing to carry'));
    const close = r.indexOf('Close the old issue');
    const recount = r.indexOf('Re-read its true comment count');
    assert.ok(recount !== -1 && close < recount, 'the post-close recount must follow the close');
    assert.ok(r.includes('name any gap that remains in the report'));
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

  test('tidy Shape 1 keeps an unfinished rollover replacement by its trusted body marker', () => {
    assert.ok(TIDY_RECORDS.includes('`<!-- digest-rollover-of: {old} -->`'));
    assert.ok(TIDY_RECORDS.includes('`classifyRolloverResume`'));
    assert.ok(!TIDY_RECORDS.includes('(continues #{old})'));
  });
  ```

  In `tests/specify-digest-guard.test.js`:

  ```js
  test("next-mode.md's bare drain skips an unfinished digest rollover replacement by its body marker, not its title", () => {
    const src = read('plugin/skills/specify/next-mode.md');
    assert.ok(src.includes('--json number,title,labels,createdAt,body --limit 500'), 'the drain fetch must read the body');
    assert.ok(src.includes('/^<!-- digest-rollover-of: (\\d+) -->\\s*$/m'), 'body-marker read missing from the bare-drain filter');
    assert.ok(src.includes('digestRolloverOf'), 'a marker hit must reach the trust check, not be dropped by the filter');
    assert.ok(src.includes('`classifyRolloverResume`'), 'the marker alone never exempts: the trust check must decide');
    assert.ok(!src.includes('continues #'), 'a title never exempts a record');
  });
  ```

- [ ] **Step 2: Run to verify they fail**

  Run: `node --test tests/materiality-floor-conformance.test.js tests/specify-digest-guard.test.js`
  Expected: FAIL on each new test, every pre-existing test still passing.

- [ ] **Step 3: Edit `digest-sweep.md`**

  a. Under `## Digest sweep (Step 5.6)`, before the `No-ops silently…` paragraph, add:

  ````markdown
  **Resume an unfinished rollover.** `github-issues` only. Before the no-op check below, list open issues (`gh issue list --state open --limit {window} --json number,body`, no `--search`, `{window}` sized per `_shared/github-write-transport.md`'s "Sizing the list-then-filter window") and filter client-side for a whole body line `<!-- digest-rollover-of: {old} -->`. A title alone never identifies a replacement. For each distinct `{old}`, read `{old}` and every matching candidate through REST (`gh api repos/{owner}/{repo}/issues/{n}`, `issue_read` get mode on MCP), since only that read carries the author association, save them to `{CANDIDATES}` (a flat array) and `{OLDISSUE}`, and run, with `{plugin-root}` this plugin's root as a literal path:

  ```bash
  node -e "const fs=require('fs');const [root,c,o]=process.argv.slice(1);const {classifyRolloverResume}=require(root+'/bin/lib/health-core/materiality-digest.js');const read=(f)=>JSON.parse(fs.readFileSync(f,'utf8'));console.log(JSON.stringify(classifyRolloverResume(read(c),read(o))))" "{plugin-root}" "{CANDIDATES}" "{OLDISSUE}"
  ```

  `resume` is a rollover a failure interrupted, whichever step it reached: propose finishing it with the `Rollover digest container` action, whatever the comment count, using the printed `replacement`. `stalled` means step 4 stopped between removing the label and adding it, so neither issue holds `digest`: it is never resumed automatically. Name both issues in the sweep report as a stalled label move, and list open `digest` issues first (`gh issue list --label digest --state open --json number`): a routing skill may have bootstrapped one while the label was off, and adding the label beside it would leave two. Name each one found with step 4's stranded-issue handling, to run before the add, then `gh issue edit {replacement} --add-label digest` as the command that lets the next sweep finish the rollover. `finished` means the old issue closed and the replacement holds the label, but an interruption can still have stopped before the post-close recount: re-run the carry fence against the closed issue with its true count, and propose finishing when `verified` is `false` or `extras` is non-empty. `none` needs nothing.
  ````

  b. In `### Expiry`, replace `(parsed from each entry's `{provenance}` — a run-id's ISO timestamp, or the comment/edit timestamp when provenance names a skill instead of a run)` with:

  ```markdown
  (on `github-issues`, `materialityEntryDate(line, comment.createdAt)` in `bin/lib/health-core/materiality-digest.js`: a run-id's ISO timestamp from `{provenance}`, else the `<!-- materiality-first-seen: {ISO} -->` marker a rollover stamped, else the comment's timestamp. On `local-files`, the age comes from `{provenance}`'s run-id timestamp, or the edit timestamp when provenance names a skill instead of a run)
  ```

  c. Replace the whole `### Container rollover` section with:

  ````markdown
  ### Container rollover

  `github-issues` only — a file has no analogous limit. When the digest issue reaches 100 comments, propose the `Rollover digest container` action, Stage at every tier (`step-6-auto.md`). Read the true count from REST, `gh api repos/{owner}/{repo}/issues/{n} --jq .comments` (`issue_read` get mode on MCP). The threshold does two jobs: a rollover compacts promoted and expired lines out of every sweep's read, since a live line moves whole and a marked line moves as markers only, and 100 is where `gh issue list --json comments` truncates, so a reader that slipped onto that form would start missing entries from there on.

  **Every digest read is paginated.** `gh issue view {n} --json comments --jq .comments` walks every page and prints one flat array, the shape the planner below takes. On MCP, `issue_read` in `get_comments` mode needs `perPage: 100`, then `page` 2, 3, … until a page returns fewer than 100, joined into one flat array. Never `gh issue list --json comments` for this container.

  On approval, read everything fresh, since the proposal holds no copy of the entries. Apply after any `Propose digest cluster` or `Expiry summary` approved in the same run, so their markers land before the carry reads them. A proposal of either kind approved after a rollover marks the carried copy in the current container, never the closed issue's line. Each step below is safe to re-run from the top, and a re-run converges by fingerprint:

  1. **Create the replacement** without the `digest` label, unless it already exists. Re-list immediately before creating, the same list and filter as **Resume an unfinished rollover** above, since a retry or a second session may have made one. With several matches, use the lowest-numbered: it is the printed `replacement`, and the printed `extras` are closed in step 4. Title it `{old title} (continues #{old})`, dropping any earlier `(continues #…)` suffix from `{old title}`. Its body's first line is exactly `<!-- digest-rollover-of: {old} -->`, followed by a sentence saying it is a digest container continuing `#{old}`.
  2. **Carry.** Save both issues' comments with the read above and the old issue's true count, then run:

     ```bash
     node -e "const fs=require('fs');const [root,oldF,newF,count,dir]=process.argv.slice(1);const {planCarryOver}=require(root+'/bin/lib/health-core/materiality-digest.js');const read=(f)=>JSON.parse(fs.readFileSync(f,'utf8'));const p=planCarryOver(read(oldF),read(newF),{oldCommentCount:Number(count)});fs.mkdirSync(dir,{recursive:true});const paths=p.bodies.map((b,k)=>{const f=dir+'/carry-'+k+'.md';fs.writeFileSync(f,b);return f;});const edits=p.markerEdits.map((e,k)=>{const f=dir+'/edit-'+k+'.md';fs.writeFileSync(f,e.body);return {commentId:e.commentId,path:f};});console.log(JSON.stringify({live:p.live,carried:p.carried,pending:p.pending.length,tombstones:p.tombstones,tombstonesCarried:p.tombstonesCarried,tombstonesPending:p.tombstonesPending.length,unfingerprintedMarked:p.unfingerprintedMarked,verified:p.verified,skipped:p.skipped,paths,edits},null,1))" "{plugin-root}" "{OLD}" "{NEW}" "{COUNT}" "{CARRYDIR}"
     ```

     A non-zero exit is a refused read: a paged, wrapped, malformed or short array, never an empty plan. Re-read and re-run; it is never `live: 0`. A digest issue with zero comments has nothing to carry: when its true count is 0, skip steps 2 and 3 for it and go to step 4. Otherwise post each printed `paths` file to the replacement (`gh issue comment {replacement} --body-file "{path}"`), and apply each printed `edits` entry with `gh api -X PATCH repos/{owner}/{repo}/issues/comments/{commentId} -F body=@"{path}"`: a line promoted or expired on the old issue during an interruption gets the same mark on its carried copy, and a key still live on the old issue gets no edit. `_shared/github-write-transport.md` has no MCP row for a comment edit, so with `gh` absent report the pending edits and stop at step 3's mismatch. The planner selects trusted lines only, sharing `isTrustedComment`, so a planted line is never carried, and it leaves out what the replacement already holds, so a re-run never posts anything twice. Name each `skipped` note in the sweep report, and `unfingerprintedMarked`: a marked line with no fingerprint has nothing to carry. A carried line keeps its text, fingerprint and provenance, plus a `materiality-first-seen` marker holding its comment's timestamp, so expiry's age read survives the move. A promoted or expired entry moves as a fingerprint-only tombstone: its `materiality-fingerprint` and `consolebackfill-item` markers with no entry line, split across comments as needed. `isMaterialityDuplicate` and console backfill's held check read it and the active-set read ignores it, so a rollover never changes which findings dedup suppresses.
  3. **Verify the count.** Re-read the replacement and re-run the fence, which compares both the live-entry count and the tombstone count against the old issue. Continue only when `verified` is `true`. A mismatch stops here: the old issue still holds `digest` and every entry, so routing and the sweep carry on as before, and the report names the numbers.
  4. **Move the label.** Read both issues' labels first, since `gh issue edit --remove-label` on an absent label fails the whole edit. Remove `digest` from the old issue first, if it holds it, then add it to the replacement, if it lacks it, so two open `digest` issues never exist for bootstrap-race repair to merge. Before the add, handle every other open issue the move would strand: any open `digest` issue that appeared while the label was off (a routing skill's lazy bootstrap) and every `extras` issue from step 1. Run steps 2 and 3 with it as the old side (or skip them at a true count of 0), then close it with a pointer comment naming the replacement. A title alone never gives an issue the label: only the replacement step 1 identified gets it. Unpin the old issue and pin the replacement. A pin failure is reported and never stops the rollover, since no reader keys on the pin.
  5. **Catch late appends.** A router that read the label before step 4 may have posted to the old issue, and a staged approval may have marked it. Re-run steps 2 and 3 once more.
  6. **Close the old issue.** Post a summary comment stating both carried counts and pointing at the replacement, read the true count `{C}`, then close it. Its comment history stays the archive for everything it held, marked lines and non-entry notes included. Re-read its true comment count: if it rose above `{C}`, a router posted after the last read, so run steps 2 and 3 with the closed issue as the old side and that new count, and name any gap that remains in the report.
  ````

- [ ] **Step 4: Edit the restatements** with exactly these replacements:

  - `tidy/SKILL.md:144` Execution column: `Create the replacement, carry every trusted live entry and a tombstone per promoted or expired entry, verify both counts, move the `digest` label + pin, then close with a summary comment — `digest-sweep.md``.
  - `tidy/step-6-auto.md:70` reason: `Stage — closes one issue, opens another, carries its entries and moves a label: outward-facing, never auto-applied per the reversibility floor`.
  - `tidy/step-1-records.md:85`: replace `and it bootstraps the replacement in the same move — so this shape must not race it` with `and it carries the entries into the replacement before it closes anything. An open issue whose body holds a whole line `<!-- digest-rollover-of: {old} -->`, with `{old}` still open and `classifyRolloverResume` (`digest-sweep.md`) returning `resume` or `stalled` for it, is that rollover's unfinished replacement, not yet labeled: `Keep` it too, with the same reason, so this shape must not race it. The line alone proves nothing, since anyone can write it: without that verdict the issue is an ordinary record`.
  - `specify/next-mode.md:187`: add `body` to the fetch: `gh issue list --state open --json number,title,labels,createdAt,body --limit 500 > "$RAW"`.
  - `specify/next-mode.md`'s bare-drain filter: change the predicate and output to
    ```js
    const eligible = records.filter((r) =>
      !r.labels.some((l) => EXCLUDE.has(l.name) || l.name.startsWith('needs:'))
    ).map(({ body, ...r }) => {
      const hit = /^<!-- digest-rollover-of: (\d+) -->\s*$/m.exec(body || '');
      return hit ? { ...r, digestRolloverOf: Number(hit[1]) } : r;
    });
    console.log(JSON.stringify(eligible));
    ```
    The fence is a double-quoted `node -e`, in which `\d`, `$/` and `\s` pass through to node unchanged. Directly after the fence, add: `A candidate carrying `digestRolloverOf` may be a digest rollover's unfinished replacement, not yet labeled. Before shaping it, read it and that `{old}` through REST and run `classifyRolloverResume` (`tidy/digest-sweep.md`'s Resume an unfinished rollover): with `{old}` still open and a `resume` or `stalled` verdict, drop it from the drain. Any other verdict makes it an ordinary record, since the line alone proves nothing.`
  - `_shared/materiality-floor.md` Container, the sentence ending `and it bootstraps the replacement in the same move.`: replace with `and it carries the entries into the replacement before it closes anything.`
  - `_shared/materiality-floor.md` Entry format: after the `consolebackfill-item` paragraph, add: `A line a rollover carried (`tidy/digest-sweep.md`, `github-issues` only) carries one more trailing marker, `<!-- materiality-first-seen: {ISO} -->`, holding the timestamp of the comment it came from; its fields and fingerprint are unchanged, so Dedup still matches it in the new container. A promoted or expired entry moves as a fingerprint-only tombstone, its `materiality-fingerprint` and `consolebackfill-item` markers alone on a line: Dedup and console backfill's held check match it, and with no entry line it is never in the active set.`
  - `_shared/materiality-floor.md` Dedup: after `never bare bodies.` add ` The read is paginated (`tidy/digest-sweep.md`'s Container rollover).`
  - `docs/skill-graph.md:249`: in `digest-sweep.md`'s digest reads list, change `(bootstrap-race merge, cluster promotion, expiry — #3766)` to `(bootstrap-race merge, cluster promotion, expiry — #3766; rollover carry-over — #4848)`.
  - `docs/skill-graph.md:658`: change `bootstrap-race repair, cluster promotion, expiry —` to `bootstrap-race repair, cluster promotion, expiry, container rollover —`.

- [ ] **Step 5: Run to verify the tests pass**

  Run: `node --test tests/materiality-floor-conformance.test.js tests/specify-digest-guard.test.js tests/tidy-residue-markers.test.js tests/tidy-console-backfill-conformance.test.js`
  Expected: PASS, 0 failures.

  Then run the planner fence from step 3c against `/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-11-01T194531-record-4848/evidence/digest-1426-comments.json` and an empty `[]` file, with `{plugin-root}` this worktree's `plugin` and `{COUNT}` `102`, and with `{COUNT}` empty (a non-zero exit expected). Run the resume fence from step 3a against a two-element scratch array (one trusted marker body naming 1426, one untrusted) and a REST read of #1426. Write the output to `/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-11-01T194531-record-4848/evidence/fence-1426-probe.txt` with a plain Bash redirect, expecting `live: 97`, `tombstones: 633`, `verified: false`, at least one written `paths` file, and `state: "resume"`. Log it with the AC-evidence rule.

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
| AC8.1 | Task 1 `AC8.1 (marker half)`, `AC8.1 (held half)` |
| AC9.1 | Task 1 `AC9.1`, plus Task 2's procedure and exemption tests |
| AC10.1 | Task 1 `AC10.1` |
