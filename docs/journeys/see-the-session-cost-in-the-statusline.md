---
files:
  - plugin/bin/claude-tweaks-statusline.js
  - tests/statusline.test.js
---

# See the Session Cost in the Statusline

**Persona:** A developer using Claude Code with the claude-tweaks statusline wired in. They want to know roughly what the current session has cost so far, without opening the hub.
**Goal:** A glanceable running figure in the statusline, with no extra step and no file to maintain.
**Entry point:** Any session where Claude Code sends `cost.total_cost_usd` on stdin. The statusline re-renders around every tool call and reads the figure from that payload.
**Success state:**
- A `$0.42`-style segment appears once the session has cost at least half a cent, before the hub segment and before `acct:`.
- It is plain text with or without `NO_COLOR`.

## Steps

### 1. Send a message and see the figure appear
- **URL:** the Claude Code statusline.
- **Action:** Send a message and let the agent answer.
- **Should feel:** Unremarkable. A small `$0.0x` shows up before the hub segment.
- **Should understand:** The number is Claude Code's own client-side list-price estimate for this session. It is not a bill, and it is not the hub's priced figure. Whether Claude Code populates the figure on a subscription (Max/Pro) session is undocumented; the segment is simply absent when the figure is missing or zero.
- **Red flags:**
  - `$0.00` showing. A session that has cost nothing, or less than half a cent, shows no segment.
  - A `$` followed by an escape sequence under `NO_COLOR`. The segment is plain text either way.

### 2. Keep working and watch it climb
- **URL:** the Claude Code statusline.
- **Action:** Keep working across several turns.
- **Should feel:** Steady and compact. The figure grows without the line getting wider.
- **Should understand:** It shows two decimals under `$10` (`$9.99`), one decimal from `$10` (`$10.0`), and none from `$100` (`$100`). The choice of precision is made on the raw value.
- **Red flags:**
  - The segment after `acct:`. It always sits just before it.
  - The figure going backwards within one session.

### 3. Clear the session and see it vanish
- **URL:** the Claude Code statusline.
- **Action:** Run `/clear`.
- **Should feel:** Like a fresh start. The segment disappears until the new session has cost half a cent.
- **Should understand:** The figure resets with the session, because Claude Code resets it. The statusline keeps no running total of its own.
- **Red flags:**
  - The old figure surviving a `/clear`.

## Origin
- Created during build of the session-hub phase 2 plugins lane (cost segment, `renderCost`).
