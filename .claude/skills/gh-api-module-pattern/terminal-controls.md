# Third-party text from gh is stripped before it prints

Read from `SKILL.md` when a `gh` call returns text another party wrote — a CI job log, an issue or PR body, a comment — and that text can reach stdout or stderr.

Strip terminal control sequences other than SGR colour before printing: OSC (window title, clipboard, hyperlink), non-SGR CSI (cursor moves, screen clears) and C0/C1 controls, keeping tabs. A log or body is attacker-writable, and an unstripped OSC 52 write or cursor move reaches the operator's terminal as if this tool had sent it.

**Worked example (#5369).** The CI job-log download in `plugin/bin/lib/verify/ci-source.js` passes `--allow-escape-sequences` (`LOG_ESCAPE_FLAG`), because gh 2.103.3 refuses to print a log that carries escapes. That flag let OSC and cursor sequences reach the printed failing region until review lens 3b caught it. `stripTerminalControls` (called from `normalizeCiLog`) fixed it in ee9542a39. Its unit test and `perf/ci-log-controls-linearity.test.js` pin the behavior and keep the scan linear.

**The rule pairs with the flag.** Any call that adds `--allow-escape-sequences`, or reads raw bytes some other way, also runs the output through a stripper before printing. A fake-runner test feeds it an OSC and a cursor-move sequence and asserts that neither survives.
