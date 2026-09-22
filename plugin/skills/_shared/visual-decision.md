# Visual Decision — Browser Verdict Contract

Canonical home for the event vocabulary, turn loop, precedence rule, lifecycle ownership, and
security posture of an in-browser decision round built from `plugin/bin/visual-decide.js`
(#1202, the server primitive) and `plugin/skills/design-wrapper/compare-shell/` (#1203, the
comparison shell + seeder). Consumers cite this file rather than restating its contents —
`design-wrapper/modes/explore.md`'s Compare/Verdict/Lock-in is the first consumer.

## Event vocabulary

Exactly five event shapes, each a single JSON object, one per line in `{state}/events` (JSONL —
matches compare-shell's `serializeEvent` serializer, `plugin/skills/design-wrapper/compare-shell/template.html`):

```
{"type":"pick","variant":"<id>","ts":<epoch-ms>}
{"type":"reroll","ts":<epoch-ms>}
{"type":"steer","text":"<free text>","ts":<epoch-ms>}
{"type":"tweak","token":"<name>","value":"<value>","ts":<epoch-ms>}
{"type":"exit","ts":<epoch-ms>}
```

No other `type` value is valid. A consumer that needs to recognize an event checks `type` against
exactly this set. `tweak` nudges a single design token in the live focus view — a hue, a spacing
scale, a corner radius — without triggering a full reroll. It never changes which variant is
selected. The focused variant renders inside a cross-origin sandboxed
`<iframe sandbox="allow-scripts">` (deliberately without `allow-same-origin`, a security boundary
this feature must not loosen), so a parent-page CSS custom property still cannot reach into it —
but as of #1336, `applyTweak()` also `postMessage`s `{type: 'compare-shell-tweak', token, value}`
into that iframe's `contentWindow` (targetOrigin `'*'`, since the sandboxed candidate's own origin
is opaque). Reflection in the judged candidate itself is opt-in per candidate: a candidate whose own
markup registers a `message` listener for `type: 'compare-shell-tweak'` and applies `token`/`value`
to its own styling is restyled live; a candidate that registers no such listener is unaffected —
the message is sent but nothing reads it, so its rendering is untouched, same as before #1336 (see
`compare-shell/seed-compare.mjs`'s header comment for the opt-in snippet). `tweak` still records a
token nudge and previews it in the compare-shell's own UI regardless — a numeric readout and a
preview swatch, both driven by the same `--tweak-*` custom properties the event carries — that part
of the scope boundary is unchanged.

## Turn loop

1. Seed the shell (compare-shell's `seed-compare.mjs --mode live`) and start the server
   (`visual-decide.js start --dir <round-dir> --state <state-dir>`).
2. Present the returned keyed URL to the user and **end the turn** — this is an interactive-only
   mechanism; no `$PIPELINE_RUN_DIR` path may reach it (see Security posture below).
3. The user acts in the browser — clicking Pick / Reroll / Steer / Exit, or dragging a tweak
   lever, posts one event to `/events`.
4. **Any terminal message resumes** the round. On resume, read `{state}/events` in full and act on
   the **last event** — the final line of the file in append order. Duplicate events (the user
   clicked twice, or a retry) collapse to that final line; earlier lines are not replayed.

`tweak` events are not verdicts. On resume, act on the **last non-`tweak` event** in the file,
treating any trailing `tweak` events as accumulated token-preview state rather than the resume
signal — they record what the shell's own panel is currently showing, not a decision the consuming
skill needs to act on. An events file containing only `tweak` events (no pick/reroll/steer/exit at
all) is treated the same as an empty events file: it routes to the fallback `AskUserQuestion`
below.

## Precedence — terminal text vs. the events file

The resume message is a **resume signal by default** — the events file decides what happened.
The terminal text overrides the events file **only** when it explicitly names a verdict action:
the words pick/reroll/steer/exit, or an unambiguous equivalent naming a variant or direction
("go with B", "reroll these"). When the terminal text and the events file disagree and the text
is ambiguous, **ask** via the fallback `AskUserQuestion` rather than guessing.

`tweak` is deliberately not part of this list — it is a slider nudge a human performs in the
browser, not a verdict a human types as terminal text ("go with B" has no tweak equivalent). The
precedence rule above governs verdict actions only; `tweak` events never participate in it (see
the Turn loop's non-`tweak` resume rule above).

**Empty or absent events file** → the fallback question (pre-upgrade behavior — the same
`AskUserQuestion` call site the consuming skill already had before adopting this contract).

**Unparsable event lines** (malformed JSON, or JSON missing a recognized `type`) are skipped —
never fatal. Surface them as one terminal aside line on the resume turn: `"skipped N unparsable
event line(s)"`. No file artifact records this; it is a spoken aside, not a write.

## Steer trust boundary

Steer text is user-authored guidance, under the **same trust boundary as terminal input** — the
same human controls both the key-gated loopback page and the terminal. It feeds the next
fuse/weigh pass as prose guidance and is **never string-interpolated into a command or tool
invocation** — the same discipline applied to any other user-authored free text.

## Lifecycle ownership

The **consuming skill** owns `start` and teardown on every exit path (pick, exit-without-pick,
and any error path that aborts the round). The server's own idle timeout (240 minutes by
default) is a **backstop only** — never relied on as the primary teardown mechanism.

**On resume**, check `visual-decide.js status --state <state-dir>` first. Anything but `running`
(the idle timeout fired, or the process crashed) means restart the server against the same
`--dir`/`--state` pair and hand the user the **new** keyed URL — this is the ordinary
`server-info`/`server-stopped` re-derivation path, not an error. A deliberate `stop` happens only
at round end (pick, exit-without-pick, or abort).

## Security posture

Loopback bind, session key, `0600` file permissions — all inherited from #1202's own contract.
Events are data, never executed or interpolated, with the one stated carve-out: steer text, which
is user-authored (see Steer trust boundary above), not third-party content.

## Consumers

| Consumer | Uses it for |
|---|---|
| `plugin/skills/design-wrapper/modes/explore.md` (Compare/Verdict/Lock-in, both scopes via "Machinery reuse") | Replaces the hand-authored switcher + terminal-only `AskUserQuestion` verdict with the browser loop above; the `AskUserQuestion` call site is kept as the documented fallback (empty/absent events file, or an ambiguous conflict) |
| `plugin/skills/demo/SKILL.md` (Verdict — routes to `demo/browser-verdict.md`; `rendered-page`/`app-route` records only) | Single-variant recap-page round: pick replaces the terminal Approve question directly; exit falls back to the terminal question with Approve omitted (ambiguous between Request-changes/Skip); reroll/steer/tweak/empty/unparsable/ambiguous all fall back to the unmodified terminal question — there is no second candidate to reroll or steer toward (#1208) |
