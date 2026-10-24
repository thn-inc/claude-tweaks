# Refused Proposals — the hard deferral gate at record creation

Read by `wrap-up/review-console.md` ("On approval" step 7, and step 10 for a Reflection insights
Defer/Capture row), `flow/multispec-review-console.md` (step 2 / Queue writes), and
`wrap-up/ledger-narrowing-auto-file.md` — before creating ANY `Q#` queue-write proposal.
Enforces `_shared/deferral-gate.md`'s hard gate: no record proposal without a valid
`Defer-reason:`.

## The check

Read the staged file's header block (the lines before the first blank line) and locate the line
matching `^Defer-reason: ` **by key, never by position** (`_shared/deferral-gate.md`, "Where the
reason lives"). Validate the value at runtime against the closed vocabulary:

```bash
node -e "process.exit(require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/record.js').DEFER_REASONS.includes(process.argv[1])?0:1)" -- "$VALUE"
```

A Reflection insights row has no header block of its own: `$VALUE` is the reason its Recommended
cell names (`Defer — {reason}`, `Capture — {reason}`).

Missing line (or no reason in the cell), or exit 1 → **refuse**: do not create the record.

## The refused row

Render the item under **Refused — no defer reason** — positioned immediately after the Queue
writes section, before Memory updates, in both consoles; renders only when non-empty — with the
staged path and the offending value (or "absent"). Log:

```
REFUSED {time} — Queue write {Q#}: no valid Defer-reason on {staged path}; kept staged.
```

The row has **no default**. It is excluded from Approve all, from `consoleAutoResolve`, and from
`queueWriteAutoFile` — no policy lever bypasses it. The only ways out: a human edits the staged
file's header and re-runs the console for that run, or drops it via Override → Skip.

## Ledger origin

When the refused proposal came from a ledger item (`staged/ledger-record-*.md`): set that item's
status back to `open` with note `proposal refused — no defer reason`, so the ledger's own
nothing-left-behind gate resurfaces it on the next resolve; delete the staged file (the ledger
item is the durable trace). A refused proposal with **no** ledger origin (a leftover section, a
reflect tangential) stays staged in its run dir and dies with it at `close-run` unless a human
rescues it — by design: the summary's refused-count line is the signal, and the reasonless
deferral should have been a fix.

Under `--dry-run`, the check still runs (it is a read); the ledger status flip is previewed, not
applied. A *failed* create (transport error on a valid proposal) is not a refusal — it renders in
Queue writes as today.
