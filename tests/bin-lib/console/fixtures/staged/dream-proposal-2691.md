# Dream pass — repeated failure across 29 sessions

**Pattern:** `Bash` / `cd` — this session is isolated in the worktree <path> workspaces<path> but this command names git in a for…

**Evidence bar:** met — 29 distinct sessions (window: last 14 days), 41 total occurrence(s).

## Quoted evidence

- Session `134430b8-0eaa-4542-b708-ff4db0a7c8ba` (2026-09-21T18:48:15.289Z):
  - Command: `cd "<path>" && P=<path> …`
  - Error: `This session is isolated in the worktree <path> but this command names git in a form too complex to verify …`
- Session `1fc83941-5f74-4403-9035-5ab510331868` (2026-10-01T15:16:48.590Z):
  - Command: `cd "<path>" && P="<path>" …`

## Proposal

This failure signature recurred across independent sessions. Consider whether it merits a
documented rule (a CLAUDE.md Don'ts entry, a skill's Gotchas note, or an auto-memory file) —
this proposal does not do that for you. **Nothing has been applied.**
