# Page tidy's acceptance-gap closed fetch past the 1000-result search ceiling (#4598) Implementation Plan

**Goal:** Split `_shared/github-pr-scan-acceptance.md`'s `acceptance-gap` closed-record fetch into date slices, each under GitHub search's 1000-result ceiling, merged number-keyed before the client-side 30-day cutoff, with a per-slice cap warning.

**Spec:** `.claude-tweaks/pipelines/2026-10-31T061110-record-4598/work/4598-spec.md` (materialized from GitHub issue #4598)

---

### Task 1: Slice the acceptance-gap closed-record fetch by date and pin it

**Files:**
- Modify: `plugin/skills/_shared/github-pr-scan-acceptance.md`
- Test: `tests/acceptance-scan-server-filter.test.js`

**Design (probed 2026-10-31 on this repo):** `closed:2026-09-30..2026-10-16` returned 226 and `closed:>2026-10-16` returned 551, against 777 for `closed:>=2026-09-30` with the same exclusions — an inclusive `A..B` range plus `>B` partitions `>=A` exactly. So:

- Keep the `{since-date}` resolution sentence and its 31-day one-liner unchanged. Add a `{mid-date}` placeholder resolved the same way as its own call, with `15` in place of `31` (`new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)`).
- The fence runs two fetches, both `gh issue list --state closed --limit "$LIMIT" \` with `--search` on the next line carrying the identical exclusions (`-reason:\"not planned\" -reason:duplicate -label:demo:approved -label:demo:changes-requested -label:demo:pending`): the older slice `closed:$SINCE..$MID` into its own raw file, the newer slice `closed:>$MID` into another. Both raw paths resolved through `session-tmp-resolve.js` like today's `$RAW`.
- The node block: guard `SINCE` exactly as today (first statement, unchanged line); add a `MID` guard (YYYY-MM-DD, later than `SINCE`, earlier than today) that throws with a message naming the `{mid-date}` placeholder; then per slice, `const CAP = Math.min(LIMIT, 1000);` and a warning only when *that slice's* length `>= CAP`, naming the slice's date range, its row count and the cap, and an honest remedy (below 1000 raise `backlog-fetch-limit`; at 1000 that slice alone reaches the search ceiling and the scope cannot be complete). Merge the two slices number-keyed (a `Map` keyed on `number`, so a record seen in both slices counts once), then apply the existing 30-day `closedAt` cutoff and write `$CLOSED`.
- Update the prose: the "Record set" paragraph and the `### Fetch limit` closed-record half say the fetch is sliced, each slice capped at `min(limit, 1000)`, warning per slice; the guard-failure sentence after the fence covers either guard (`since-date` or `mid-date`).
- Update `tests/acceptance-scan-server-filter.test.js`: the existing tests that assume one `--search "closed:>=$SINCE …"` fetch move to the sliced shape (every closed fetch carries `--search`, every slice's search string carries exactly the needsBackstop exclusions and no positive reason / oversight floor); add tests pinning (a) the two slice qualifiers `closed:$SINCE..$MID` and `closed:>$MID`, each against a frozen pre-change control (the current single-fetch fence, frozen verbatim), (b) a per-slice ceiling warning (the old whole-fetch `raw.length >= CAP` test is gone), (c) the number-keyed merge before the cutoff, and (d) the `MID` guard throws on bad values and passes a good one, with an inverted-polarity go-red control — the same discrimination discipline the file already uses.

- [ ] **Step 1: Failing test** — write the test(s) the spec's `## Acceptance Criteria` describe.
- [ ] **Step 2: Implement** — satisfy every `## Deliverables` checkbox against the files above.
- [ ] **Step 3: Run** the test(s) from Step 1 — PASS (`node --test tests/acceptance-scan-server-filter.test.js`).
- [ ] **Step 4: Commit** — one commit, message drawn from the spec title, `refs #4598`.

---

## Self-review

- **Spec coverage:** Deliverable 1 (date slices, number-keyed merge before the cutoff) and Deliverable 2 (per-slice cap warning) are Step 2; AC 1 (a >1000 undisposed set returns every record, no warning — holds while each slice stays under its cap) and AC 2 (the test pins the sliced fetch and a per-slice ceiling warning with a frozen pre-change control) are Steps 1 and 3.
- **Placeholders:** none.
