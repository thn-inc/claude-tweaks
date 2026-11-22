# Materiality Floor — routing legitimately-deferred, below-floor findings to a digest

Applied strictly **after** `_shared/deferral-gate.md`: an item first attempts fix-now, and only
an item that fails fix-now and carries a valid `Defer-reason:` from that gate's closed vocabulary
reaches this floor. The floor never decides whether to fix — it only decides which container a
*legitimately-deferred* item lands in. Citing this file as a reason to skip a fix, or to defer
without a valid `Defer-reason:`, is a misuse of both contracts; `_shared/deferral-gate.md`'s hard
gate still applies unchanged.

## The floor

Route to the digest only when the item would be filed at **all three**: `size:low` AND
`priority:low` AND `risk:low` (`_shared/work-record.md`'s Label taxonomy table — Risk/Size/Priority
rows), judged at filing time by the routing skill itself — not read off an existing label, since
most filing paths never stamp `priority:*` (it is an optional family; only `/backlog refine`,
`/backlog attention`, `/dispatch`, and `/specify`'s `next` mode write it). The routing skill judges
all three axes as it would score a fresh filing, including the unstamped priority axis. An axis the
routing skill genuinely cannot judge, or judges ambiguously, counts as **not low** — the floor
fails toward filing an ordinary issue, never toward the digest.

## Overrides

Checked in this order, ahead of the floor; the first that applies decides:

1. Human-typed `/capture` input files as an ordinary issue and is out of this contract's scope
   entirely — human input is intent, never exhaust, and never routes to the digest.
2. A finding carrying severity `high` or `critical` files as an ordinary issue. The three axes
   score the record's filing size, not the finding's severity, so without this a small fix to a
   high-severity finding could be digested where no gate that blocks on it (release Step 3's
   `high-severity finding` token) ever looks again.
3. An agent-raised item whose `Defer-reason:` is listed in policy key `deferral-digest-reasons`
   (default empty; `_shared/policy-schema-deferral-routing.md`) goes to the digest whatever its
   three axes, rule `policy-reason`. This relies on the digest lifecycle in `tidy/digest-sweep.md`:
   a promotion proposal, filed on approval, once three entries share an area, expiry after 90 days
   un-promoted. Changing either changes this policy's effect.
4. `Defer-reason: tangential` files as an ordinary issue — a tangential finding is a new idea the
   finding suggests, not residue of the current work.

## Applying the floor

`bin/deferral-route.js` is the floor's code home (its test pins the two sections above
byte-equal). Every site routing an item that carries a gate `Defer-reason:` runs it instead of
applying this prose. The five health sweeps (no gate reason) apply this prose directly; the
tiebreak can't-tell digest, the console-backfill values and ledger narrowing follow their own rules:

`node "${CLAUDE_PLUGIN_ROOT}/bin/deferral-route.js" --defer-reason {reason} [--severity {severity}] --size {size} --priority {priority} --risk {risk} [--evidence '{evidence}'] [--run "$PIPELINE_RUN_DIR"] (--agent-raised | --human)`

`--severity` only when the item has one, lowercase (`critical`, `high`, `medium`, `low`, `info`);
each axis `low`, `medium` or `high` as the site scores it.
`--evidence` only when the item carries an `Evidence: test:…` or `Evidence: ref:…` line
(`_shared/deferral-gate.md`'s "Where the reason lives"), passing that line's value; otherwise omit
the flag — a finding's file-and-line `Evidence:` pointer is not one. The value comes from text the plugin did not write, so it is single-quoted and reaches the command line only when it matches, exactly and in full, `test:` followed by one or more characters from `A-Z a-z 0-9 . _ / -`, or `ref:#` followed by digits, or `ref:IL-` followed by digits; any other value is never put on the command line: omit the flag, so the item counts as carrying no evidence. `--run` only when a run directory resolves (`_shared/pipeline-run-dir.md`); otherwise
omit it, since the command refuses a blank `--run`. Every routing site passes `--agent-raised`: no
typed input reaches one. It prints `verdict` (`file`, `digest` or `refused`) and `rule`.

**Two frictions after the floor (#5933).** An agent-raised item the rules above would file, on rule
`tangential` or `not-low`, meets two policy checks in this order, both off by default
(`_shared/policy-schema-deferral-routing.md`). With `filed-record-evidence: required`, an item whose
`Defer-reason:` is `pre-existing-outside-diff`, `genuinely-larger` or `tangential` and whose call
passes no valid `--evidence` goes to the digest, rule `no-evidence`. With `run-filed-record-cap: {n}`
and `--run`, an item goes to the digest, rule `run-cap`, once the run's agent-raised calls have given `{n}` `file` verdicts;
a `high` or `critical` severity still files, and counts. The tally belongs to the run directory the
call names: in a multi-spec run each member's `spec-{N}/` directory keeps its own tally.
The cap is first come, first served within a run: route each item once, when it comes up (a repeated
call for the same item counts again), and
never hold items back or rank them to choose which ones file.

On `digest` the label a human sees, and the words of a ledger Resolution, follow `rule` — the
digest-label table every routing site cites:

| `rule` | Label | Ledger Resolution |
|---|---|---|
| `floor` | "Digest — below floor" | `below the materiality floor — digested at {where}` |
| `policy-reason` | "Digest — policy (`deferral-digest-reasons`)" | `digested by policy (deferral-digest-reasons) at {where}` |
| `no-evidence` | "Digest — no evidence (`filed-record-evidence`)" | `digested without evidence (filed-record-evidence) at {where}` |
| `run-cap` | "Digest — run cap (`run-filed-record-cap`)" | `digested over the run cap (run-filed-record-cap) at {where}` |

`{where}` is the digest comment URL on `work-backend: github-issues`, or `specs/digest.md` on `local-files`.

## Entry format

```
- [{area}] {one-line finding} — {file refs} — Defer-reason: {value} — {provenance} <!-- materiality-fingerprint: {fp} -->
```

A line console backfill writes for a finding (`tidy/console-backfill.md`) carries one more marker after the materiality marker, `<!-- consolebackfill-item: {fp} -->`, so its next pass finds the line after a claim-heuristic change; `{provenance}` stays the bare run id. A line the live console's unattended resolution writes for a can't-tell `drop` (`bin/console-filings.js`'s `digestFile`) carries `<!-- console-finding: {fp} -->` in the same position, which Dedup also matches.

A line a rollover carried (`tidy/digest-sweep.md`, `github-issues` only) carries one more trailing
marker, `<!-- materiality-first-seen: {ISO} -->`, holding the timestamp of the comment it came
from; its fields and fingerprint are unchanged, so Dedup still matches it in the new container. A
promoted or expired entry moves as a fingerprint-only tombstone, its `materiality-fingerprint`,
`consolebackfill-item` and `console-finding` markers alone on a line: Dedup and console backfill's held check match it,
and with no entry line it is never in the active set.

`{area}` is the subsystem the finding belongs to, written as a stable, low-cardinality, lowercase
token: the skill name (`tidy`, `review`), the `bin/lib/` module (`issues`, `hooks`), or the
top-level tree (`docs`, `tests`) the `{file refs}` sit under — never a sentence and never a
slash-prefixed command name. `tidy/digest-sweep.md`'s cluster promotion groups on this field by
exact match, so improvised per-run phrasings of the same area (`tidy` vs `/tidy` vs `the tidy
skill`) silently keep a real cluster below the ≥3 threshold forever.

`{provenance}` is the pipeline run-id when a run directory resolves (`$PIPELINE_RUN_DIR`'s
basename), else the invoking skill's name. The entry itself is the durable audit trail — a
no-run-dir routing is never unlogged.

`{fp}` is the entry's dedup fingerprint (`materialityFingerprint` in
`bin/lib/health-core/materiality-digest.js`), a stable hash of `{area}` + the finding text
(whitespace/case-normalized) + the file refs (order-independent) — see "Dedup" below.
The Review Console's can't-tell finding filings reuse the same `fingerprintFromBasis`, prefix
`consolefinding` (`bin/lib/console/finding-filing.js`: lens, path, normalized claim, no line number).

### Dedup

A finding a scheduled sweep re-encounters on every firing must fold into its existing entry, not
append a fresh one on each run — the un-deduped entry count would otherwise cross
`tidy/digest-sweep.md`'s cluster-promotion threshold (≥3 entries sharing one `{area}`) purely
from repetition, promoting a genuinely low-value, repeatedly-recurring finding into a first-class
issue and inverting this floor's entire purpose. Before routing a candidate entry, the routing
skill calls `isMaterialityDuplicate(existingComments, candidate)`
(`bin/lib/health-core/materiality-digest.js`). On `github-issues` the caller passes the open digest
issue's comment *objects*, each with its `body` and author association (`authorAssociation` from
`gh issue view {n} --json comments`, `author_association` from REST and MCP), never bare bodies. The
read is paginated (`tidy/digest-sweep.md`'s Container rollover). Only a comment whose author is
`OWNER`, `MEMBER`, or `COLLABORATOR` counts (`_shared/pr-run-comments.md`'s Trusted authors,
implemented by `bin/lib/issues/comment-trust.js`), so a marker planted by any other commenter
cannot suppress a finding: it is routed as new. The
run's output names each skipped marker comment (`trustedMaterialityTexts(existingComments).skipped`).
On `local-files` the caller passes the current file body, a single-writer string that is trusted.
A match means the finding is already present and un-promoted — skip the append entirely, write no
new entry, and do not count it a second time toward the cluster-promotion threshold. No match means
route it via `materialityEntryLine(candidate)`, which composes the Entry-format line above with its
fingerprint marker embedded. This is the materiality-digest analog of the pre-existing drain-rate cap
digest's own dedup mechanism (`_shared/health-filing-digest.md`'s `expandDigestFingerprints`) —
a parallel mechanism, not a shared one, since the two digests dedup against different containers
(cap digest: embedded checklist items folded into the issue-index; materiality digest: entries
scattered across a rolling issue's comment history) and answer different questions (drain-rate
throttling vs. below-floor deferral).

### Direct-filing producers' `Defer-reason:` value

The five health sweeps (`ci-health`, `code-health`, `docs-health`, `harness-health`,
`journey-health`) never route through `_shared/deferral-gate.md` — they file spec-shaped issues directly (`recordPayload`/
`specShapedBody`), so a below-floor finding of theirs reaches this file with no
`Defer-reason:` value from that gate's closed vocabulary to write. `Defer-reason: direct-filing-sweep`
is this Entry format's own documented value for exactly that producer class — a below-floor
finding a proactive, non-gate-routed sweep discovered on its own, not a deferral of fix-now work
this pipeline was already doing. Deliberately **not** added to `bin/lib/issues/record.js`'s
`DEFER_REASONS` (the closed vocabulary `_shared/deferral-gate.md` owns and
`tests/deferral-gate-conformance.test.js` pins): it is not a fix-now-failure reason at all, it is
a producer-class marker specific to this Entry format field, so widening the gate's own closed
vocabulary for it would blur a distinction the gate exists to keep — every other value in that
vocabulary except `needs-verification` (the filed verification task's reason, below) answers "why
did fix-now fail for an item this pipeline was already working on." A future
non-gate-routed adopter of this floor uses the same value.

### Tiebreak can't-tell value

A review finding that the independent tiebreak could neither confirm nor refute is the resolver's
`digest` outcome at severity `low` or `info`, and — at `unattended` (#4679) — at medium or higher
when the tiebreak recommended `drop`. `/claude-tweaks:review`'s Step 3.7
(`review/step3-tiebreak.md`) routes it here with `Defer-reason: tiebreak-cant-tell`, and the
console's entry line carries a `<!-- console-finding: {fp} -->` marker, so a re-appearance in a
later run dedupes to the existing entry by fingerprint. Like `direct-filing-sweep`, the digest
entry's value is an Entry-format value only. Deliberately **not** in `DEFER_REASONS` — an unverified
finding never failed fix-now, so no gate reason describes the digest entry. Every other
unattended can't-tell item files as a task instead, with `Defer-reason: needs-verification`: that
value is in `DEFER_REASONS` because it is the filed verification task's reason (the bounded check
that settles the finding), not a fix-now failure. #4679 reverses #3949's ruling that every
can't-tell item files regardless of its recommendation: of 53 `needs:definition` records, 50 were these filings, 41
carried `Recommendation: drop`, and the other 9 each settled in under a minute by an agent with
quoted evidence (measured 2026-10-31). Dedup and Digest URL and count surfacing apply unchanged.

### Console backfill values

`/claude-tweaks:tidy --console-backfill` (`tidy/console-backfill.md`) settles the unresolved items
closed runs left in their Review Consoles, and digests three kinds with a value of its own:
`console-backfill-no-claim` (a stored line with no recoverable claim),
`console-backfill-unmapped-kind` (a staged file no filing shape fits), and
`console-backfill-confirmed-low` (a tiebreak-confirmed finding at severity `low` or `info`). A
can't-tell finding digests as `tiebreak-cant-tell`, above. A reflect observation or convention
staged with no `**Destination:**` line digests as `reflect-no-destination`, at the live console
(`bin/reflect-apply.js`) and in this backfill alike. All four are Entry-format values only, like the
two before them. Deliberately **not** in `DEFER_REASONS`: none is a fix-now failure.
Dedup and Digest URL and count surfacing apply unchanged; `bin/lib/console/backfill-dispose.js`
owns the table.

### Digest URL and count surfacing

Every routing skill's own summary output states the number of findings routed to the digest
this run — the digest activity must be visible in the caller's own output, not only in the
digest issue itself. A run that routes one or more findings states the digest comment URL
alongside the count; a run that routes none still states the count, as `0`, rather than
omitting the line — an omitted line is indistinguishable from a caller that forgot to check,
so silence is never the zero-case signal. Adopters cite this paragraph rather than restating
it. The five health sweeps additionally fold their own count into the existing
drain-rate-cap throttle line (`_shared/health-filing-digest.md`'s SUMMARIZE step) as a distinct
`materiality: K` field, never combined with that line's own `digested: M` (cap-digest) count —
the two mechanisms answer different questions and a reader diagnosing either needs its own
number.

## Container

**`work-backend: github-issues`:** one pinned rolling issue labeled `digest`. Before routing, list
open `digest`-labeled issues (`gh issue list --label digest --state open`); create one only when
none exists, bootstrapping the label first (`_shared/label-bootstrap.md`). Route by posting one
comment per run, aggregating that run's below-floor items — one comment URL per run, never one
comment per item. All writes go through `_shared/github-write-transport.md`. Routing appends are
append-only; the one sanctioned exception is the `/tidy` digest sweep's promotion/expiry marker
edits (`tidy/digest-sweep.md`). A creation race that leaves two open `digest` issues is repaired
by that same sweep: merge the newer issue's trusted comments into the older, then close the newer.

**The digest issue is a container, not a work record.** It carries no stage label by design, so
every record-scoped sweep that reads the open-issue queue classifies it as an ordinary backlog
record (`bin/lib/issues/record-buckets.js`'s `isBacklog` — stage `backlog` is the no-label
default). Every such sweep exempts a `digest`-labeled issue the same way `/tidy`'s Shape 1 already
exempts `parent-issue` (`tidy/step-1-records.md`): a digest issue is never shaped, scored,
promoted, or closed as a record. Without that exemption the container is `isBacklog` forever and
crosses any staleness threshold, where Shape 1's default recommendation is `Delete or Promote` —
closing the container out from under every entry it holds. Only the digest sweep's own lifecycle
(`tidy/digest-sweep.md`'s 100-comment rollover) ever closes a digest issue, and it carries the
entries into the replacement before it closes anything. While a rollover is in flight the
replacement holds no label yet and the old issue has lost its own, so each is exempt by a trusted
body marker instead (`tidy/step-1-records.md`'s Shape 1, `specify/next-mode.md`'s bare drain).

**`work-backend: local-files`:** `specs/digest.md`, entries appended in place (single-writer
backend, no rollover needed). Promotion marks the entry line with a trailing `→ {id}`. Expiry
moves entry lines to an `## Archived {YYYY-MM-DD}` section at the bottom of the same file.

## Audit line

When a run directory resolves, routing additionally logs, per `_shared/auto-decision-log.md` — the
existing `AUTO` status, no new status word:

```
AUTO {time} — materiality-floor: {item} routed below floor ({defer-reason}, rule={rule}) → digest. Reversibility: high (entry remains promotable or re-filable from the digest at any time).
```

This is bookkeeping, not decision-worthy — no Review Console row per entry.

## Expiry is not skipped work

An expired entry already passed the deferral gate (fix-now was attempted and refused for a stated
reason) and sat un-promoted for 90 days. Archival is a logged retention decision reachable only
through that gate — the distinction that separates it from the silent skipping CLAUDE.md's "No
implicit deferrals" rule forbids. `tidy/digest-sweep.md` performs this archival; see that file for
the exact promotion and expiry procedures.
