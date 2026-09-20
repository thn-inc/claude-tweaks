# Step 7 — Browser / playwright-cli (detailed procedure)

*Core Bootstrap step — order-dependent, so later steps may assume earlier ones completed; runs unconditionally and idempotently, acting only on missing state. Gated by `version-check.md` in this directory.*

Browser integration lets Claude Code interact with web pages — useful for testing UIs, running QA stories, scraping docs, and verifying deployments. The single supported backend is `playwright-cli`.

See `_shared/browser-detection.md` for the detect / install / verify procedure (the detection command, the exact install-note text to print, and the auto-mode no-install rule).

Init-specific contract:

- Run detection on every `/init` invocation.
- If `playwright-cli` is missing, surface the install hint and **continue** — never block init on a missing browser. Browser features are optional; all other skills work without them and degrade gracefully.
- Do not prompt for backend choice — there is only one backend.
