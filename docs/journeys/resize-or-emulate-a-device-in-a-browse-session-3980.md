---
files:
  - plugin/skills/browse/SKILL.md
  - plugin/skills/browse/playwright-cli-reference.md
  - plugin/skills/help/reference-card.md
---

# Resize or Emulate a Device in a `/browse` Session

**Persona:** A claude-tweaks user checking a responsive layout by hand. They type `/claude-tweaks:browse` and read its greyed-out argument hint to find how to set a viewport or a phone profile. Earlier, the hint offered `set viewport 1280x800` and `set device "iPhone 14"`, but `playwright-cli` has neither command.
**Goal:** Open a page at a specific viewport size or under a device profile, using only forms the installed `playwright-cli` accepts.
**Entry point:** `/claude-tweaks:browse https://example.com --device "iPhone 15"` or `/claude-tweaks:browse --session pricing-page-review resize 1280 800`. The forms come from the hint, the `## Input` table, or `/claude-tweaks:help`'s reference card.
**Success state:**
- The session is open at the requested size, or under the requested device.
- Every command the skill ran is one listed in `playwright-cli --help`.
- No "unknown command" error appears.

## Steps

### 1. Read the argument hint
- **URL:** the terminal hint shown after typing `/claude-tweaks:browse`, or the `/claude-tweaks:browse` row of `plugin/skills/help/reference-card.md`
- **Action:** Find the viewport/device group: `[resize <w> <h>|--device "<name>"]`.
- **Should feel:** Trustworthy. The hint names real CLI vocabulary (`resize`, `--device`), not a retired backend's verbs.
- **Should understand:** The hint and the reference card's `Takes` cell are the same string. `tests/argument-hint-mirrors.test.js` pins them together.
- **Red flags:** `set viewport` or `set device` anywhere in the hint or the card.

### 2. Resize the viewport mid-session
- **URL:** an open named session, for example `pricing-page-review`
- **Action:** Ask for `resize 1280 800`. The skill runs `playwright-cli -s=pricing-page-review resize 1280 800`.
- **Should feel:** Immediate. The same session resizes, with no re-open.
- **Should understand:** Width and height are two separate arguments, not one `1280x800` token.
- **Red flags:** The skill translates the request into `set viewport 1280x800` and the CLI rejects it.

### 3. Emulate a device profile
- **URL:** a fresh session at the target URL
- **Action:** Ask for `https://example.com --device "iPhone 15"`. The skill opens the session with `playwright-cli -s=<name> open https://example.com --device="iPhone 15"`.
- **Should feel:** Predictable. The device is part of opening the session, so the first snapshot is already the mobile layout.
- **Should understand:**
  - `--device` takes effect only when the session opens. No command switches the device mid-session, so to change it, close the session and re-open it.
  - `open --mobile` emulates a generic mobile device when no specific model matters.
  - The mapping is in `plugin/skills/browse/playwright-cli-reference.md`'s Operation vocabulary table.
- **Red flags:**
  - The skill runs a `set device` command.
  - The skill tries to switch the device on an already-open session without re-opening it.

## Origin
- Created during the build of #3980. The browse skill's argument hint, `## Input` rows and anti-pattern row still advertised the retired backend's `set viewport <wxh>`/`set device "<name>"` forms. #3843 had already fixed the same stale `set viewport` call in `plugin/agents/qa-agent.md`.
- Verified against `playwright-cli` 0.1.21. `--help` lists `resize <w> <h>`, and `--help open` lists `--device` and `--mobile`.
