---
files:
  - plugin/bin/friction-events.js
  - plugin/bin/lib/log-decision/append.js
  - plugin/skills/reflect/full-mode.md
---

# See a Run's Friction When Working East of UTC

**Persona:** a maintainer whose machine clock is east of UTC (for example Copenhagen, UTC+2 in summer). They run a `/claude-tweaks:flow` or a `/claude-tweaks:dispatch`-ed record and then reach `/claude-tweaks:wrap-up`.
**Goal:** the wrap-up's reflect Friction Lens reports the guard refusals, denials, and questions the run actually hit. It should not report a frictionless run because of where the machine sits on the globe.
**Entry point:** the run's Step 2.8 claim, which `log-decision.js` writes as the first `decisions.md` entry stamped with a local `HH:MM:SS` (e.g. `- AUTO 22:30:40 — Step 2.8: claimed #3442 …`).
**Success state:** `node plugin/bin/friction-events.js --run <run dir>` returns every in-vocabulary event logged after that claim, such as a `wd-guard-refusal` at `20:37:44Z`. Only events from before the claim are dropped (#2989).

## Steps

### 1. Claim the run: flow Step 2.8
- **URL:** `/claude-tweaks:flow #{n}` (or a dispatched first call), via `bin/claim-targets.js --run <run dir>`
- **Action:** the claim CLI writes the run's first `decisions.md` line. `log-decision`'s `hms()` stamps it in the machine's local time. The run dir's own name (`{YYYY-MM-DDTHHMMSS}-…`) carries the mint instant in UTC.
- **Should feel:** invisible. It's ordinary bookkeeping, and no timezone setting or flag is involved.
- **Should understand:** the two timestamps use different clocks on purpose: the run-id is UTC (`date -u`) and the log line is local wall-clock. The reader reconciles them, so the writer doesn't have to change.
- **Red flags:** the operator has to set `TZ=UTC` or change a policy key to get correct friction reporting.

### 2. Hit friction during the run: build/test phases
- **URL:** any refused Bash call, gate denial, `AskUserQuestion`, or contract violation inside the run's worktree
- **Action:** the hooks append events to the run's `events.jsonl` with ISO UTC `ts` values, e.g. a `wd-guard-refusal` at `2026-10-19T20:37:44Z`, seven minutes after a `22:30:40` local claim.
- **Should feel:** the same friction as always. Nothing about logging changes.
- **Should understand:** the event's UTC instant falls after the claim's instant. A claim at `22:30:40` in CEST is `20:30:40Z`.
- **Red flags:** an event's `ts` is written in local time. That would mean the writer changed, not the reader.

### 3. Read the friction at wrap-up: reflect Friction Lens
- **URL:** `/claude-tweaks:wrap-up` → reflect full mode → `node plugin/bin/friction-events.js --run <run dir>`
- **Action:** `computeClaimBoundary` reads the claim's `HH:MM:SS` as local time on the mint instant's local calendar day. If that lands before the mint, it rolls to the next local day by the date component, which is DST-safe. It then drops only events earlier than that boundary.
- **Should feel:** an accurate reflection. The Friction Lens names the refusals the maintainer remembers hitting.
- **Should understand:** before #3442 the claim time was read as UTC (`…T22:30:40Z`). Every event in a UTC+2 run then sat "before" the claim and was dropped as pre-claim noise, so the CLI printed `[]`. The #2989 exclusion still holds: events appended before the claim, by an unrelated session into a freshly minted dir, are still dropped.
- **Red flags:**
  - `friction-events.js` prints `[]` for a run whose `events.jsonl` visibly holds `wd-guard-refusal` / `gate-denial` lines after the claim time;
  - pre-claim events from an unrelated session reappear;
  - a run whose claim falls just after local midnight (for example, mint at 23:50 local and claim at 00:05) loses its first day's events.

## Origin
- Created during build of #3442
- Steps 1-3 cover behavior built or relied on in this session (step 3 is the change)
- Related specs: #2989 (pre-claim exclusion this fix corrects), #2783 (ad-hoc friction read on the same CLI — `see-an-ad-hoc-sessions-friction-at-wrap-up-2783.md`), #3404 (the UTC+2 run that surfaced it)
