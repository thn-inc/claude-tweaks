---
files:
  - plugin/skills/_shared/github-pr-scan-acceptance.md
  - plugin/skills/_shared/trust-table.md
  - tests/acceptance-scan-server-filter.test.js
---

# Run Tidy's Acceptance Scans on a Large Repo

**Persona:** a maintainer of a repo with several thousand issues who runs `/claude-tweaks:tidy` every few days. Until now, every run ended with a warning that the `[acceptance-gap]` and `[parent-gate]` results might be incomplete, so they had stopped trusting those two scopes.

**Goal:** both scopes cover every record they are meant to judge, and stay quiet when they do. A warning appears only when a result really is truncated, and it names a remedy that will actually help.

**Entry point:** `/claude-tweaks:tidy` Step 4.8, which runs `_shared/github-pr-scan-acceptance.md`'s `acceptance-gap` and `parent-gate` scopes.

**Success state:** each of the two closed-record date slices and the parent-gate state map comes back under its cap of 1000, with no truncation warning. On this repo the slices returned about 226 and 551 rows, and the state map about 254. Because each slice has its own cap, the 31-day undisposed set as a whole can exceed 1000. A bad, unsubstituted or calendar-invalid placeholder stops the scope loudly rather than reporting zero rows.

## Steps

### 1. The acceptance-gap scope fetches only the closed records it can flag
- **URL:** `github-pr-scan-acceptance.md`, `## Scope: \`acceptance-gap\``, the "Record set" paragraph and the closed-record fence
- **Action:**
  - The scan agent resolves three placeholders as literals: `{since-date}` (now minus 31 days), `{mid-date}` (now minus 15 days) and `{resolved-limit}`.
  - It then runs two fetches: an older slice `closed:$SINCE..$MID` and a newer slice `closed:>$MID`.
  - Both slices filter server-side with the same exclusions: `-reason:\"not planned\" -reason:duplicate -label:demo:approved -label:demo:changes-requested -label:demo:pending -label:accept:approved -label:accept:changes-requested -label:accept:pending` — both acceptance-label spellings (`_shared/work-record.md`), since `dispositionState` reads either as a disposition.
  - The node block merges the two slices by issue number, then applies the 30-day cutoff.
- **Should feel:** proportionate: the scan asks GitHub only for what `needsBackstop` could ever flag, in pieces small enough that each one fits under the search ceiling.
- **Should understand:**
  - The server excludes only records that `needsBackstop` already rejects.
  - The client-side 30-day cutoff, `needsBackstop` and the oversight floor still run unchanged on the merged set.
  - The server date is one day wider than the client cutoff on purpose.
  - The inclusive `A..B` range plus `>B` covers `>=A` exactly, with no gap and no overlap. On this repo the counts were 226 + 551 = 777. The merge by number still absorbs a record that shows up in both slices.
- **Red flags:**
  - A `-label:risk:` or `-label:size:` qualifier in either slice's search. The oversight floor is risk-OR-size and fails closed on unscored records, which a search query cannot express.
  - A positive `reason:completed` qualifier, which would drop records closed with no recorded reason.
  - Slices whose exclusions differ, or a single unsliced `closed:>=$SINCE` fetch, which caps the whole window at 1000 again.

### 2. Under native work-links, the parent-gate map holds only sub-issues
- **URL:** `## Scope: \`parent-gate\``, the `### \`work-links\` resolution` section (now above `### Fetch limit`) and the state-map fence
- **Action:** the agent resolves `work-links` first, then substitutes `{state-map-search}` and runs the state map. The substitution is `has:parent-issue` under `native`, and empty under `body-text`.
- **Should feel:** the map is sized to the question, not to the whole repo.
- **Should understand:**
  - An empty search keeps the ordinary listing, which has no 1000-result ceiling. Body-text repos are unchanged.
  - A sub-issue missing from the map defaults to `OPEN`, which is the safe direction. That happens through truncation (warned) or, under `native`, through search-index lag (unwarned, and corrected on the next run).
- **Red flags:**
  - `has:parent-issue` substituted on a `body-text` repo. Task-list children are not native links, so every sub-issue would read `OPEN`; the empty-state-map warning names this cause.
  - The rule placed below the fence it governs.

### 3. A real truncation still warns, with an honest remedy
- **URL:** each fetch's node warning block: each closed-record date slice, the state map, and the three label-filtered parent fetches
- **Action:** a fetch, or one closed-record slice, whose row count reaches `Math.min(backlog-fetch-limit, 1000)` prints its WARNING. A slice's warning names its own date range, its row count and its cap. The maintainer reports it verbatim beside the scope's rows.
- **Should feel:** trustworthy. Silence means nothing was truncated, and a warning means act. Search-index lag can still hide a record changed seconds before the run; the next run picks it up.
- **Should understand:**
  - GitHub caps searched and label-filtered lists at 1000 whatever `--limit` says, so a limit set above 1000 still warns at 1000. Each warning says that raising the limit past 1000 does not help.
  - A closed-record slice warns only when that slice alone reaches its cap. The two slices together can hold more than 1000 records without any warning.
- **Red flags:**
  - An `=== LIMIT` comparison, which stays silent at the ceiling once the limit is above 1000.
  - A warning that recommends raising the limit when the ceiling is the cause.
  - A closed-record warning keyed on the merged total rather than on each slice. It would fire on a complete result, and could not say which slice is truncated.

### 4. A bad placeholder stops the scope instead of passing silently
- **URL:** the opening guard statements of each node block (the `SINCE` and `MID` guards, and the `STATE_SEARCH` guard), plus the sentence after each fence
- **Action:** each of these throws before the scope writes its output file (which was emptied first):
  - a `{since-date}` that is empty, unsubstituted, calendar-invalid or too recent
  - a `{mid-date}` that is empty, unsubstituted, calendar-invalid, not later than `{since-date}`, or not earlier than today
  - an unknown `{state-map-search}`
- **Should feel:** loud. A mistake costs one visibly failed scope, never a silently clean one.
- **Should understand:** the scope then reports no rows at all and quotes the error. Later blocks never read a missing or stale file.
- **Red flags:** zero `[acceptance-gap]` or `[parent-gate]` rows reported after a guard threw, as though the scope were clean.

## Origin

Built by `/claude-tweaks:flow` record #4469 (run `2026-10-30T045550-spec-4469-4466`). Updated by record #4598 (run `2026-10-31T061110-record-4598`), which split the closed-record fetch into two date slices.

Step 1's quoted search updated during build of #4610: it also excludes the three `accept:*` labels.
