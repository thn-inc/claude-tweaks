# Native Routing — the native track's dispatch rule and its reasoning

Read this when `SKILL.md`'s track resolution returns `ios`, `android`, or `adaptive`. A web-track run needs nothing here, which is why the whole file sits behind that one condition rather than inline in `SKILL.md`.

`SKILL.md` owns the track-resolution table itself — the operational decision every mode's Step 1 runs. This file owns everything downstream of a native result, plus the reasoning behind the table's two inferred rows. Neither restates the other.

## Native dispatch

Before planning, a mode dispatching on the native track reads the named platform's own upstream reference, under the Impeccable plugin root `impeccable-plugin.md`'s resolve call returns (`node "${CLAUDE_PLUGIN_ROOT}/bin/impeccable-engine.js" resolve`'s `pluginRoot` field — never claude-tweaks' own `${CLAUDE_PLUGIN_ROOT}`, which locates that CLI itself):

| Track platform | Read before planning |
|---|---|
| `ios` | `<root>/skills/impeccable/reference/ios.md` |
| `android` | `<root>/skills/impeccable/reference/android.md` |
| `adaptive` | **both** of the above |

That mapping is upstream's, not this wrapper's. `reference/adapt.native.md` instructs *"read the target platform's reference before planning if Setup hasn't already,"* and `reference/audit.native.md` names the files directly: *"Score against the platform reference(s): ios.md / android.md, both for `adaptive`."*

**There is no `reference/adaptive.md`.** A `reference/{platform}.md` filename template looks right and is wrong for exactly the value this wrapper infers most often — verified against the installed 4.0.2, whose `reference/` directory carries `ios.md`, `android.md`, `adapt.native.md`, and `audit.native.md` but no `adaptive.md`. The three-row table above is the mapping; `adaptive` resolving to two files rather than one is the whole reason it is written out instead of interpolated.

Beyond this mapping, do not restate upstream's routing here. Naming the platform is this wrapper's entire job; where upstream takes it from there — which of its `.native` references a given command reads, how it scores, what it emits — is upstream's to own and changes on upstream's release schedule, not this repository's.

The dispatch is a **prose instruction the agent follows**, matching how Layers 1-3 already work. It is not a shell call and not a slash-command invocation. The platform named is always one upstream accepts (`ios` / `android` / `adaptive`) — never a sentinel, never an empty value, never a bare "native."

## Why `null` + `mobile` resolves to `adaptive`

An earlier framing routed this case to "the native path, platform unnamed." That has nowhere to go: **upstream has no unnamed-native track.** Both `adapt.native.md` and `audit.native.md` open by requiring a target of `ios` / `android` / `adaptive`, and both instruct the reader to load that platform's reference before doing anything else. Handing either a record with no platform leaves the instruction unexecutable.

`adaptive` is the honest resolution rather than a placeholder standing in for a missing answer. Upstream's own `extractPlatform` already collapses a `Platform` section naming both native targets (`ios, android`, `ios and android`) to `adaptive` — and a bare `Surface: mobile` declaration, naming neither platform, makes the same statement: this is a native surface, and which of the two has not been narrowed.

It is recorded as **inferred**, never as declared. The correction path is a `Platform` section in the project's `PRODUCT.md`, which upstream reads and this wrapper then treats as authoritative via the track table's second row.

## Why `desktop` takes the web path

Upstream's platform enum has no desktop value — `extractPlatform` accepts exactly `web`, `ios`, `android`, `adaptive`, and returns `null` for everything else. So there is no native desktop track to route to, and inventing a `desktop` entry in upstream's enum would be this wrapper asserting a contract upstream does not have.

The assumption being made, stated rather than left implicit: **desktop surfaces in this system are assumed HTML-based** (Electron, Tauri, and similar), which the web-only detector and `live` mode both handle correctly. A genuinely native desktop surface — AppKit, WinUI, GTK — takes the web path too, and the web-only detector will find nothing meaningful in it. That is a known, accepted limitation of this routing, not an oversight in it. If it ever needs fixing, the fix is upstream's enum, not a fourth track here.

## Routing walkthrough

Verification for `SKILL.md`'s track-resolution table. The table is markdown an agent interprets — there is no JS surface to revert and no `tests/*design-wrapper*` file to add a case to, so the evidence is this walkthrough plus the greps recorded with it, not a `node --test` run. (`[IL-62]`'s revert-and-confirm applies to executable logic; the only executable surface in this area is `impeccable-plugin.md`'s resolver, which `tests/impeccable-plugin-contract.test.js` covers.)

One scenario per row, traced end to end:

**Row 1 — `platform: web`, `Surface: mobile`.** Track resolution reads a non-null `platform` and takes row 1: **web track**. The two values disagree, so the return carries `surface_track_override` naming both and which won, and a run with `$PIPELINE_RUN_DIR` set gets the same line in `decisions.md`. Layer 3 runs as always. `test` invokes the CLI and returns `pass` / `fail`; `live` is reachable. Everything downstream behaves exactly as it did before this record — the override is the only new artifact. *This is the row that keeps a stale `PRODUCT.md` from being invisible.*

**Row 2 — `platform: ios`, `Surface:` anything or absent.** **Native track**, platform named `ios`. `mobile`, `web`, and `desktop` all reach the same place; `backend` / `infra` never do, because Layer 2 already returned its skip. With a `Surface:` declared, Layer 3 is skipped — a SwiftUI diff matches none of its trigger extensions, so running it would return `non-frontend (sniff)` on the exact record this path exists for. With no `Surface:`, Layer 3 runs as the fallback, so an iOS project's backend-only diff still skips rather than being widened onto the design path. `test` returns `{skipped: "native surface — CLI detector is web-only"}`; `live` returns its own native skip; `review`, `polish`, `pre-build`, `survey`, and `shape` dispatch after reading `reference/ios.md`.

**Row 3 — `platform: null`, `Surface: web` / `desktop` / absent.** **Web track.** `null` is the common case by construction — `extractPlatform` returns it for a missing `Platform` section, for prose, for negations, and for any unrecognized value — so this row is what most projects, this repository included, actually take. Nothing about the web path changed: same Layer 3, same CLI invocation, same `live` availability.

**Row 4 — `platform: null`, `Surface: mobile`.** **Native track, platform inferred as `adaptive`.** *This is the row that fixes the reported bug in the case that actually occurs*, and the one to check first if the table is ever changed. It is reachable with **no Impeccable plugin installed, no `PRODUCT.md`, and no Layer 0 signals at all** — every one of those produces `platform: null`, which is this row's input rather than an obstacle to it. Expected outcome, stated explicitly: `test` returns `{skipped: "native surface — CLI detector is web-only", surface_track: "adaptive"}` and **not** `{result: "pass"}`; `live` returns its native skip; every other mode dispatches having read **both** `reference/ios.md` and `reference/android.md`.

### Web-path invariance

Every sentence in `SKILL.md` and `modes/*.md` mentioning `setup.platform` or a bare `platform` was enumerated by grep and read in place. Five sites mention it; **exactly one branches on it** — `SKILL.md`'s track-resolution table. The other four do not: `SKILL.md`'s Output contract surfaces the value, `modes/doctor.md` documents it in its return schema and sample (the engine's `doctor` verb reports its own, from the same `PRODUCT.md`), `modes/test.md` carries a pointer to the Output contract, and `modes/live.md`'s Step 1.5 names it as the input to a decision track resolution has already made.

So the invariance rests on that one table. Move `platform` between `null` and `web` with `Surface:` at any **web** value — `web`, `desktop`, or absent — and rows 3 and 1 land on the same web track, with the same Layer 3, the same CLI invocation, and the same `live` availability. The two values diverge at exactly one input, `Surface: mobile`, where row 4 goes native and row 1 does not; that divergence *is* this record, and `surface_track_override` is what keeps it from being silent. No web-surface record can reach it.

This is prose, so the evidence is the grep and the read — not a unit test. Re-run that grep when the table changes; a new file reading `platform` without appearing in the list of five is the regression to look for.
