# Demo Step 2 — Browser Verdict

Referenced by `skills/demo/SKILL.md` Step 2's `### Verdict` subsection. Read only when this
record's Observation plan is a `rendered-page`/`app-route` surface **and** browser tools resolve
— a `cli`/`flow`/`diff` plan, or a run with no browser tools, goes straight to `SKILL.md`'s
terminal question and never reads this file. In the body below, "the terminal question below" and
"Validate above" refer to `SKILL.md`'s `### Verdict` fallback `AskUserQuestion` and its Show-first
walkthrough's **Validate** step.

**Browser verdict (optional, `rendered-page`/`app-route` only):** applies only to the URL surfaces
Validate above already gates on — `cli`/`flow`/`diff` plans go straight to the terminal question
below; there is no browser session already in play for them, and opening one solely to click a
button is pure overhead over just asking. Follows `_shared/visual-decision.md`'s contract —
cited here, never restated.

Available whenever browser tools resolve (the same gate Validate uses above — unavailable → skip
straight to the terminal question below, no error). Compose a single-variant `layout`-scope
manifest: one variant, whose one file is a small recap page (this record's title, an "Open {entry
point}" link, and the `### Confirmed`/design-contract text already rendered above) — **not** a
live embed of the entry point itself. Show already handed that to the human directly, and
compare-shell's manifest schema requires a real local file per variant, never an arbitrary origin.
Seed it live (`seed-compare.mjs --manifest <manifest.json> --mode live --out <demo-dir>/index.html`),
start the server (`visual-decide.js start --dir <demo-dir> --state <demo-dir>/.vd-state`), present
the keyed URL, and end the turn — the contract's turn loop takes over from here.

On resume, read `{state}/events` and act on the last non-tweak event per the contract's Turn loop:

- **Pick** (the round's only variant) — Approve, applied immediately via Step 3's Approve action.
  The browser round **replaces** the terminal question for this outcome.
- **Exit** — ambiguous between Request changes and Skip (the contract's vocabulary has no way to
  say which) — **falls back** to the terminal question below, with the Approve option omitted
  since the explicit exit signal already rules it out.
- **Reroll / Steer** — not meaningful here: one built artifact, not N candidates to reroll or
  steer toward another one. Falls back to the full terminal question below, unchanged.
- **Tweak** — never a verdict, per the contract's Turn loop; the hue/spacing/corner-radius sliders
  are compare-shell's fixed shared UI and preview against nothing meaningful on a recap page with
  no design candidate in play. Trailing tweak events are ignored on resume exactly as the contract
  specifies.
- **Empty or absent events file, an unparsable-only file, or an ambiguous terminal-text/events-file
  conflict** — the contract's own documented fallback: the terminal question below, unchanged.

Stop the server (`visual-decide.js stop --state <demo-dir>/.vd-state`) before proceeding to Step
3, on every exit path — pick, exit, or any error that aborts the round — per the contract's
Lifecycle ownership; never rely on the idle timeout. This is a fresh server per verdict attempt,
never reused across records or across a re-demo of the same one.

**No auto-mode path reaches this.** `/claude-tweaks:demo` has no `$PIPELINE_RUN_DIR` to begin
with — it is never invoked from within an `auto`-mode pipeline (`## Component-Skill Contract`
below) — so this whole browser-verdict path is structurally unreachable from `auto`, the same
constraint `_shared/visual-decision.md` requires of every consumer.
