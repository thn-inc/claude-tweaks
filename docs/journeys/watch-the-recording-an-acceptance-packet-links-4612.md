---
files:
  - plugin/bin/acceptance-packet.js
  - plugin/bin/lib/walkthrough/record.js
  - plugin/bin/lib/walkthrough/redact.js
  - plugin/bin/lib/walkthrough/exposure.js
  - plugin/bin/lib/wrap-up/packet-gather.js
  - plugin/bin/lib/wrap-up/packet-render.js
  - plugin/bin/lib/wrap-up/packet-links.js
  - plugin/skills/_shared/acceptance-packet.md
  - plugin/skills/wrap-up/verification-brief.md
---

# Watch the Recording an Acceptance Packet Links

**Persona:** A maintainer accepting a story-backed web change from a finished run, reading its packet on a pull request in a public repository, who wants to see the feature in use before accepting it and did not ask anyone to record it.
**Goal:** See the happy path as an animated GIF without running it, with nothing secret-shaped reaching the public packet.
**Entry point:** The packet's `Recording` section, written by `/claude-tweaks:wrap-up`'s Verification brief through `acceptance-packet.js`'s `snapshot`, `gather` and `render` verbs.
**Success state:** The maintainer has the GIF open from the path the packet names, or has read one line saying why there is none. The packet holds no image, in any repository visibility.

## Steps

### 1. The run records with no request — `acceptance-packet.js snapshot`
- **URL:** `node plugin/bin/acceptance-packet.js snapshot --run {run-dir} ...`
- **Action:** Nothing. Wrap-up's snapshot runs while the QA screenshots are still on disk. It reads the screenshots the run's happy-path stories already wrote, encodes them, and writes `packet-inputs/walkthrough.gif` under the run directory.
- **Should feel:** Free: no flag to remember, no browser run and no server started for it.
- **Should understand:** Negative stories are left out, so error screens never enter the GIF. A story with fewer frames than steps records nothing rather than a GIF with a gap in it. A destination git would track records nothing either, since the GIF is unredacted pixels.
- **Red flags:** A second Playwright session during wrap-up; a frame from a break-it story in the GIF; `walkthrough.gif` showing up in `git status`.

### 2. Read the Recording section on the packet
- **URL:** The pull request's acceptance packet, section `Recording`
- **Action:** Read the line naming the local path, its `once archived:` location, and any `redacted values: {n}` count.
- **Should feel:** Honest about reach: a path to open on the machine that ran it, plainly not a public asset.
- **Should understand:** Captions, story titles, link text and failure messages render with the whole value replaced by `[redacted]`, key names kept. Redaction is text only and best effort. Keeping the GIF local and linked, never embedded, is the control that carries the exposure rule, so stories run against seed data and throwaway credentials.
- **Red flags:** Markdown image syntax or an `img` tag anywhere in the packet; a raw token or e-mail address in the section or in a risk proof citing it; `raw.githubusercontent.com` in any link.

### 3. Open the GIF, wherever it is now
- **URL:** The named path, relative to the main checkout root
- **Action:** Open the first path. When it is gone, open the `once archived:` path, since the run directory moves to `pipelines/archive/{run-id}/` at close.
- **Should feel:** Stable: a link read a week later still resolves by one known rule.
- **Should understand:** A worktree holds neither path, so read from the main checkout. When neither location holds the file on the main checkout, the GIF is gone, and the section's other facts still stand.
- **Red flags:** A reader in a worktree concluding the GIF is gone; a packet pointing at a path that matches neither location.

### 4. Read why there is no recording, when there is none
- **URL:** The same section, and `Couldn't test`
- **Action:** Read the reason after `not recorded:` (`no-local-base-url`, `no-happy-path-screenshots` or `encoder-failed`) and the `failure:` line under it when there is one. A plain `not recorded` with no reason means no story ran (`no-story`).
- **Should feel:** Like a decision that was made, not a step someone forgot.
- **Should understand:** Each reason but `no-story` also appears under `Couldn't test`, because a recording was expected and could not be made. A link the credential rule refused renders `recording withheld: link contained a credential-shaped value` instead. `encoder-failed` also covers a write the snapshot held: when git does not ignore the destination, or cannot say whether it does, no GIF is written and the `failure:` line names the path, so the encoder may never have run.
- **Red flags:** An empty section; `no-story` listed under `Couldn't test`; a GIF from an earlier snapshot still linked next to a `not recorded` line.

## Origin
- Created during build of #4612 (automatic walkthrough recording, redaction, and retiring the public demo-evidence route)
- Related specs: #4612, #4611
