# review mode — Step 3.6: Read the direction contract and record its seed key

Loaded by `review.md` Step 3.6 — the full locate-parse-record procedure; the gate and the three-outcome summary stay in `review.md`.

This is the one point in the pipeline where a **built artifact** and its **work record** are both in
hand. Impeccable records a direction contract in the relevant surface brief's `## Direction
contract` section, before the code; the seed key in that contract is the only thing that makes a
build's direction reproducible, since Impeccable 4.x is deliberately non-deterministic by dice.
Nothing recovers it later — by the time anyone asks, the artifact exists and the intent behind it
is only inferable from the result.

Run the locate-and-parse procedure in `../../_shared/design-contract.md` over the **file list Step 2
already resolved**. Do not discover files again, and do not widen the list — a contract outside the
changed set belongs to work this review is not looking at.

That procedure returns one of three outcomes and this step handles each:

- **No contract** — the ordinary case. Do nothing at all: no record write, no log line, nothing
  added to the return. Most reviews are not of design work.
- **Malformed** — do not write anything to the record, and log the `SCANNED` entry that procedure
  specifies. A partial contract must never become a partial `Design-seed:`.
- **Contract found** — continue below.

**Resolve the record.** The seed belongs on the work record, not in a cache. Read `record:` from the
materialized header of `<spec>` (`{run-dir}/work/{n}-spec.md`, or its `spec-{N}/` equivalent —
`skills/flow/materialize.md` owns that format). If `<spec>` is not a materialized record file — a
path-driven or standalone `/claude-tweaks:review` with no record behind it — there is no record to
write to: skip the write, carry the contract into the return, and stop here. That is not a failure;
it is a review of work that no record is tracking.

**Write `Design-seed:` onto the record body.** Only when the parse produced a seed. Re-fetch the
body immediately before writing rather than reusing one fetched earlier in this run — a record's
body is shared mutable state that `/claude-tweaks:dispatch`, `/claude-tweaks:tidy`, or a concurrent
session can have changed since. Then insert or update the line inside the body's **leading metadata
block** (before the first blank line), beside `Surface:`/`Design-intent:`/`Ui-stack:`, per
`skills/specify/spec-template.md`:

- **`work-backend: github-issues`** — read-modify-write the body through
  `../../_shared/github-write-transport.md` (which routes around an absent `gh`), preserving every
  other byte of the body.
- **`work-backend: local-files`** — `readRecord`/`writeRecord` (`bin/lib/issues/local-store.js`).

Three rules on the write itself:

1. **Never write the line empty.** No seed means no line — the contract-without-a-seed case is legal
   upstream ("when the seed dealt stagings"), and an empty `Design-seed:` would be indistinguishable
   from a parse that silently failed.
2. **A differing existing value is overwritten, not duplicated**, and the overwrite is logged with
   both values. A re-roll legitimately changes the seed, so the newest build's key is the true one —
   but two records of one field is how a reproduction attempt picks the wrong die.
3. **An identical existing value is not rewritten at all** — no API call, no log entry. Re-running
   `/claude-tweaks:review` on an unchanged build must not churn the record.

Log one `AUTO` entry to `{run-dir}/decisions.md` (`../../_shared/auto-decision-log.md`) for a write,
naming the record, the artifact the contract came from, and the seed. Reversibility is high: the
line is one edit to a record body.

**Never gate on any of this.** A failed record write, an absent record, an unreadable artifact — each
degrades to "no seed recorded" and the review continues. This step is provenance capture; it has no
opinion on the review verdict and can never change `result`, which stays `advisory`.
