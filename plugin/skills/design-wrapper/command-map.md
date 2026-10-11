# Command Map — Impeccable Commands by Category

Reference table for every Impeccable command, categorized by how the wrapper dispatches it. Every category in the table below is active.

## Categories

| Category | Meaning |
|----------|---------|
| **Phase-fixed (pre-spec)** | Run automatically before a spec is decomposed, when frontend is detected (`/specify` shape pre-step) |
| **Refinement set (polish phase)** | Run automatically in the polish phase whenever frontend is detected (`/flow` polish). Each dispatch carries the job-statement suffix — see "Step 1 — Refinement set" below. |
| **Phase-fixed (review phase)** | Run automatically during review whenever frontend is detected (`/review`) |
| **Suggestion-driven** | Run when an `audit` finding's own `suggestion` field names them (`/flow` polish) |
| **Intent-driven** | Run only when the record's `Design-intent:` body-metadata line (lifted into the materialized header — spec 20) declares a matching intent (`/flow` polish) |
| **Manual-only** | Surfaced as `survey` recommendations; never auto-dispatched. Aggressive creative drift makes them user-discretion. |
| **Never (in flow)** | Available only as standalone manual commands; never auto-invoked by the wrapper |

## Full command map

| Impeccable command | Category | When wrapper invokes |
|--------------------|----------|----------------------|
| `shape` | Phase-fixed (pre-spec) | `/specify` shape pre-step (`shape` mode) |
| `polish` | Refinement set (polish phase) | `/flow` polish, always when frontend |
| `clarify` | Refinement set (polish phase) | `/flow` polish, always when frontend |
| `harden` | Refinement set (polish phase) | `/flow` polish, always when frontend |
| `critique` | Phase-fixed (review phase) | `/review` (`review` mode) |
| `audit` | Phase-fixed (review phase) | `/review` (`review` mode) |
| `typeset` | Suggestion-driven | Only when an `audit` finding's `suggestion` names it |
| `layout` | Suggestion-driven | Only when an `audit` finding's `suggestion` names it |
| `adapt` | Suggestion-driven | Only when an `audit` finding's `suggestion` names it |
| `optimize` | Suggestion-driven | Only when an `audit` finding's `suggestion` names it |
| `bolder` | Intent-driven | When `design-intent: bold` is declared |
| `quieter` | Intent-driven | When `design-intent: quiet` is declared |
| `distill` | Intent-driven | When `design-intent: minimal` is declared (intent-only to avoid conflict with `/simplify`) |
| `delight` | Intent-driven | When `design-intent: delightful` is declared (paired with `animate`) |
| `animate` | Intent-driven | When `design-intent: delightful` is declared (paired with `delight`) |
| `onboard` | Intent-driven | When `design-intent: onboarding` is declared |
| `colorize` | Manual-only | Not auto-dispatched — surfaced as a `survey` recommendation only |
| `overdrive` | Manual-only | Not auto-dispatched — surfaced as a `survey` recommendation only |
| `extract` | Manual-only | Not auto-dispatched by this wrapper — surfaced as a `survey` recommendation, and also by `/claude-tweaks:tidy` Step 5.5's cross-spec pattern scan (same Design Quality category recurring across 3+ specs) |
| `init` | Never (in flow) | Runs once via `/init` Impeccable setup phase (formerly `teach`, now a deprecated alias); never auto from `/flow` |
| `document` | Never (in flow) | Manual standalone only; `explore` mode's identity-scope Lock-in invokes `document --seed` interactively, after an explicit pick, with the chosen direction in context — never from a pipeline, and this wrapper still writes nothing outside `docs/plans/` |
| `live` | Never (in flow) | Manual standalone only |
| `hooks` | Never (in flow) | Manual — one-time per-worktree consent toggle (`hooks on\|off\|status`); never auto-invoked. See `skills/build/worktree-setup.md` for the per-worktree consent note. |

**The Suggestion-driven label marks a command's only automatic path, not the limit of what a `suggestion` can reach.** An `audit` finding may name any command in this table, and the wrapper dispatches whatever it names — including a command whose row here reads Intent-driven. The label identifies the commands that have no *other* automatic route into a dispatch. The Manual-only rows are the sole commands a `suggestion` cannot auto-dispatch; a finding naming one of those is staged instead (see "Step 2 — Suggestion-driven" below).

Upstream's `craft` is absent from this table deliberately, not by oversight: at the pinned version it is a deprecated compatibility alias for an ordinary Impeccable new-work request and adds no behavior of its own, so the wrapper has nothing to categorize. Do not re-add a row for it while that remains upstream's description.

## Review dispatch — what the wrapper invokes in `review` mode

The wrapper's `review` mode invokes exactly two commands:

1. `/impeccable:impeccable critique <files>` — qualitative critique pass
2. `/impeccable:impeccable audit <files>` — heuristic audit pass

Both run on the changed UI files resolved by the preconditions (Layer 3 sniff). Outputs are merged into a normalized findings list and returned to `/review` as `result: advisory`. The audit findings are also written to `docs/plans/...-audit.json` for later consumption by `polish` mode.

The wrapper's `test` mode (Phase 1) invokes the deterministic CLI exactly as specified in `impeccable-cli.md` ("Invocation"), and derives `pass` / `fail` from its "Advisory-to-result mapping". The flags and the parse are deliberately not restated here — three copies of this contract is what let it drift.

The CLI is not part of the LLM command map — it's a separate Node binary. See `impeccable-cli.md` for invocation details.

## Polish-mode dispatch — refinement set + suggestion-driven + intent-driven

The `polish` mode is the only wrapper mode that modifies code. Its dispatch logic:

### Step 1 — Refinement set (always invoked when frontend)

Run on the changed UI files every polish phase:

| Command | Purpose |
|---------|---------|
| `/impeccable:impeccable polish <files>` | Final design system alignment |
| `/impeccable:impeccable clarify <files>` | UX copy improvement |
| `/impeccable:impeccable harden <files>` | Error handling, i18n, edge cases |

These three are deterministic enough that running them on every frontend polish phase is net-positive, and they never depend on audit signal. What they are **not** is an open-ended restyling sweep. Every refinement-set dispatch appends a fixed job-statement suffix to the target argument, after the file list — the same mechanism as the `animate` Frequency Gate below:

> "This is a scoped refinement of already-built, already-reviewed code — not a new-work, redesign, or visual-identity request. Improve what is already here on its own terms: anything you add must inherit the surrounding file's existing tokens, component patterns, and conventions rather than replace them. Do not introduce a new visual direction, restyle code the change under review did not touch, or widen scope beyond the files named above."

**Why the suffix is not the job-type inference this wrapper rejects.** It is a fixed constant about a *pipeline phase*, not a per-record lookup over a job-type enum: the polish phase runs only after `/review` has passed on already-built code, so every invocation of it is definitionally a scoped refinement. The wrapper reads nothing about the record to decide the suffix, and there is no branch in which it is varied or omitted.

**Pinned-copy / skip overrides and scope restriction (#2743).** Before any refinement-set command dispatches, `modes/polish.md`'s Step 2.5 applies first: a command named in the record's `Polish-skip:` body-metadata line is not dispatched (staged instead, `kind: "skipped-by-record"`); when the record declares `Polish-scope: record-created`, the target file list is further restricted to files this branch added, not every file the diff touched; and when the record's pinned-copy list is non-empty, every surviving dispatch's target argument also carries the pinned-copy suffix, appended **after** the job-statement suffix above. This file does not restate the derivation, the file-scope mechanic, or the exact suffix text — see `modes/polish.md` Step 2.5 (and Step 4 for the scope filter) for all three.

### Step 2 — Suggestion-driven (driven by each audit finding's own `suggestion`)

Read the audit findings cache written by `review` mode (`docs/plans/...-audit.json`). When no audit cache exists, this step is a no-op — Step 1 and Step 3 still run.

Impeccable's `audit` names its own best-fit remediation on **every** finding it reports: `audit.md`'s per-issue template carries a **Suggested command** field drawn from the full command palette. The wrapper reads that field and dispatches the command it names. It derives a command from nothing else — not the finding's `category`, not its `rule`, not keyword-matching its `description`.

The rules below govern the dispatch. They apply to **every** finding, whatever its category:

1. **Manual-only findings are staged, not dispatched.** If the `suggestion` names one of the manual-only commands (see the Full command map table above for current membership), do not dispatch it. Append it to `staged_suggestions` instead (see `modes/polish.md` Step 5), so the user still sees it at the Wrap-Up Review Console without the pipeline silently applying an aggressive creative change. Any other named command dispatches normally.

2. **Same command, one dispatch, union of files.** When several findings name the **same** command, dispatch it once with the union of the affected files, de-duplicated.

3. **Different commands, one dispatch each, scoped to their own findings.** When findings name **different** commands (e.g. one suggests `bolder`, another `delight`), dispatch each named command once, each scoped to the union of the files whose findings named it.

4. **A finding with no usable `suggestion` is staged as an unclassified observation.** When the field is absent, empty, or names something that is not a command in the Full command map table, append an entry to `staged_suggestions` carrying the finding's `id`, `category`, and `description` (see `modes/polish.md`'s Output to caller for the entry shape) and log it to the decision log. It is **never** mapped to a command by keyword — that is the mechanism this section replaced, and reintroducing it here under another name would defeat the change — and it is never silently dropped.

**`category` is not a dispatch key.** A finding's `category` field (e.g. `slop`, per `impeccable-cli.md`'s schema table) is better than keyword-matching `description`, but only inside the keyword-matching model this section removed. It carries through as metadata on a staged entry so a human can group related findings at the Review Console. It selects no command.

**Pinned-copy / skip overrides (#2743).** The same `modes/polish.md` Step 2.5 check applies here: a `suggestion`-named command in the record's `Polish-skip:` line is staged (`kind: "skipped-by-record"`, same staging shape as rule 1 above) rather than dispatched, and a non-empty pinned-copy list appends its suffix to the dispatch's target argument. See Step 2.5 for both.

### Step 3 — Intent-driven

Read `Design-intent:` from the record's body-metadata line (lifted into the materialized header — spec 20; written by `/specify`). For each declared intent value, dispatch the matching command(s) on the changed UI files. Multiple intents (comma-separated, e.g., `design-intent: bold, delightful`) trigger multiple dispatches. The value `none` or missing skips intent dispatch entirely.

| `design-intent:` value | Commands invoked |
|------------------------|------------------|
| `bold` | `/impeccable:impeccable bolder <files>` |
| `quiet` | `/impeccable:impeccable quieter <files>` |
| `minimal` | `/impeccable:impeccable distill <files>` (intent-only — avoids conflict with `/simplify`) |
| `delightful` | `/impeccable:impeccable delight <files>` + `/impeccable:impeccable animate <files>` |
| `onboarding` | `/impeccable:impeccable onboard <files>` |
| `none` (or missing) | No intent commands run |

**Multi-intent ordering.** When multiple intents dispatch, run them in the order declared by the user. The pairing for `delightful` (`delight` first, then `animate`) is fixed — `delight` adds personality content (empty states, microcopy), `animate` adds motion to the interactions; reversing them risks animating placeholder content. The intent dispatches share the polish phase's single re-verify cap (one re-verify cycle per `/flow` run regardless of how many intent commands ran).

**Frequency Gate guardrail (`animate` only).** Every `animate` dispatch — the `design-intent: delightful` path, and equally a suggestion-driven dispatch when an audit finding's `suggestion` names `animate` — appends a fixed guidance suffix to the target argument, after the file list:

> "Apply a frequency gate before animating: keyboard-initiated actions and actions triggered 100+ times per day get no animation (instant state change only); daily/occasional actions get subtle, fast motion; rare (monthly-or-less) actions may receive expressive motion. Decide whether to animate first, using this gate — then apply your own duration/easing rules."

This is a fixed guardrail, not creative drift — same category as Impeccable's own mandatory `prefers-reduced-motion` rule baked into every `animate` call. It does not depend on audit signal or `design-intent` value to apply; append it every time this wrapper dispatches `animate`. `delight` does not carry this suffix: `delight` covers content and personality (copy, illustration, celebratory moments) with its own restraint framework, and a trigger-frequency gate keyed to "keyboard-initiated → never" would conflict with moments `delight` deliberately wants to celebrate (e.g. a first-time keyboard-shortcut reveal).

**Pinned-copy / skip overrides (#2743).** Same `modes/polish.md` Step 2.5 check: an intent-named command in the record's `Polish-skip:` line is staged (`kind: "skipped-by-record"`) rather than dispatched, and a non-empty pinned-copy list appends its suffix after the Frequency Gate suffix above when both apply to the same `animate` dispatch — pinned-copy is always last.

**Manual-only commands.** The manual-only commands (see the Full command map table above for current membership; `extract`'s row there also notes its `/claude-tweaks:tidy` Step 5.5 surfacing) are not intent-driven — they remain manual-only, surfaced only as `survey`-mode recommendations when their "would help" criteria match. This keeps the auto-dispatch surface conservative — manual-only commands produce the most aggressive creative drift (`overdrive` especially), so they require explicit user invocation rather than auto-dispatch from `Design-intent:` body-metadata.

## Survey mode

`survey` mode inspects rendered screenshots (when invoked from `/visual-review`) or the full diff (when invoked from `/flow`'s pipeline summary) to **recommend** which creative commands the user might want to run manually. It never invokes commands directly — pure read-only output.

The recommendation set spans both intent-driven commands (`bolder`, `quieter`, `distill`, `delight`, `animate`, `onboard`) and the manual-only commands (see the Full command map table above for current membership). Survey is the surfacing channel for the manual-only set — without it, `colorize` and `overdrive` would have no automatic discoverability (`extract`'s additional discoverability channel is noted on its row in the Full command map table above).

Output feeds the "Creative Opportunities" blocks in `/visual-review` and `/flow` pipeline summary. Recommendations the user previously declined for the same spec are suppressed via the declined-recommendations cache (see `modes/survey.md`).

### Survey "would help" criteria → command mapping

Each observation maps to one creative command:

| Observation | Suggested command | Rationale snippet |
|-------------|-------------------|-------------------|
| Page reads as generic — pure black on white, no visual personality | `bolder` | Typography/color hierarchy lacks confidence |
| Visual weight imbalanced — multiple competing high-contrast elements | `quieter` | Reduce noise so the primary action wins |
| Component clutter — many small UI elements doing redundant work | `distill` | Strip to essence; intent-only avoids `/simplify` overlap |
| Empty state shows only "No items" or similar bare text | `delight` | Empty states are personality opportunities |
| Page has interactive controls (toggles, hovers) but no transitions | `animate` | Static interactions feel unpolished — but skip if the control is keyboard-initiated or fires 100+ times/day |
| Heavy monochrome — no strategic accent color | `colorize` | Strategic color anchors attention |
| First-run flow with no guidance or progressive disclosure | `onboard` | First-run UX is a teaching surface |
| Long-form content with weak hierarchy — wall of text, no pull-quotes | `extract` | Surface key content from prose |
| Existing strong design that could push further (intentional polish) | `overdrive` | Aggressive creative push — user-discretion |

## Why this categorization exists

- **Phase-fixed** commands are deterministic enough that always running them at their phase is net-positive.
- The **refinement set** is the polish phase's phase-fixed membership, named separately because its dispatches carry the job-statement suffix that keeps them scoped to refinement.
- **Suggestion-driven** commands are too noisy to run unconditionally — they run only when an audit finding names them, and the finding names them itself rather than the wrapper re-deriving a command from the finding's text.
- **Intent-driven** commands are creative direction — running them without explicit intent produces non-deterministic creative drift across runs.
- **Never (in flow)** commands either set up shared context once (`init`) or are fundamentally manual (`document`, `live`, `hooks`). `document`'s one scripted caller — `explore` mode's Lock-in — is no exception: see its row above.
