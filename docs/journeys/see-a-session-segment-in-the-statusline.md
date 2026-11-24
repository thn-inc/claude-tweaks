---
files:
  - plugin/bin/claude-tweaks-statusline.js
  - tests/statusline.test.js
---

# See a Session Segment in the Statusline

**Persona:** A developer who runs a tool beside Claude Code that knows something about each session, such as cc-router's agent and its Session Hub.
**Goal:** That tool's one-line status for this session shows at the end of the statusline, and the statusline knows nothing about the tool.
**Entry point:** Any session whose `session_id` has a file at `~/.claude/statusline/segments/<session id>.json`, shaped `{ "text", "stale_text", "at", "ttl_s" }`. It is always under the user's home, never under `CLAUDE_CONFIG_DIR`, so one writer serves every account.
**Success state:**
- The file's `text` shows after `acct:` while `at` plus `ttl_s` seconds is still in the future, and `stale_text` shows after that.
- With no file, there is no segment.

## Steps

### 1. Start a session the writer knows about
- **URL:** the Claude Code statusline.
- **Action:** Start a session while the writer runs. cc-router's agent rewrites the file every 2 s with `ttl_s: 10`.
- **Should feel:** Like part of the line. `hub ✓` shows at the end, and Ctrl/Cmd+click on it opens the session on the hub.
- **Should understand:** The text is the writer's. The statusline only checks it and shows it.
- **Red flags:**
  - The segment before `acct:`. It always comes last.
  - A segment in a session that has no file.

### 2. Stop the writer
- **URL:** the Claude Code statusline.
- **Action:** Stop the writer, then wait more than `ttl_s` seconds.
- **Should feel:** Honest. The segment changes to `stale_text` (`hub offline` for cc-router) instead of freezing on the last fresh text.
- **Should understand:** A file that is not rewritten in time counts as stale.
- **Red flags:**
  - `hub ✓` still showing a minute after the agent stopped.

### 3. A bad file stays harmless
- **URL:** the Claude Code statusline.
- **Action:** Put control characters other than an OSC 8 link or an SGR code in the file's `text`, or more than 40 visible characters.
- **Should feel:** Like nothing happened. That file renders no segment, and the rest of the line is unchanged.
- **Should understand:** The file is untrusted input. Under `NO_COLOR`, SGR codes are stripped and the link stays.
- **Red flags:**
  - A cleared screen, a moved cursor, or a bell from the statusline.

## Origin
- Created when the generic session segment reader (`renderSessionSegment`) shipped. It is the plugin side of the Session Hub design's status line extension point.
