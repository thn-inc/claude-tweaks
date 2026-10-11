# Criteria: Pre-launch Checklist (websites)

Shared, criteria-only fragment — what to flag when judging `focus=prelaunch` candidates from `bin/lib/code-health/candidates-prelaunch.js` (#2693). No workflow, no Next Actions. Consumed by `/claude-tweaks:code-health`'s prelaunch judgment lens (`skills/code-health/focus-mode.md`'s Criterion pinning table). One source of truth so every sweep applies identical calibration. Confidence floor: `medium`.

## What the generator hands you

Each candidate is `{ file, kind, evidence }` — `kind` is one of `missing-sitemap`, `missing-robots`, `missing-favicon`, `missing-custom-404`, `missing-meta-title`, `missing-meta-description`, `missing-og-image`, `img-missing-alt`, `oversized-image`. Per-page and per-image kinds carry the offending file. Site-level kinds (sitemap, robots, favicon, custom 404, OG image) are about something absent, so they carry the site's entry file (its shallowest `index.html`, else its root layout, else its shallowest page) — anchor such a finding as `{file}#{item id}`, e.g. `public/index.html#sitemap`. A candidate is a starting pointer, not a finding — judge it holistically.

The scan also carries a `checklist` array — one `{ id, label, group, status, evidence }` row per item below, on every firing. For automated items the generator's `status` means `pass` = no candidate raised under its stated coverage, `fail` = candidates raised; neither is a verdict until you judge (see Reporting). Manual items are always `manual`. Every row is `n/a` when the repo has no web pages (`notApplicable: true`) or discovery failed.

## The checklist — every item, every firing

| Item | Group | How it is checked |
|---|---|---|
| `sitemap` — sitemap.xml | automated | A `sitemap.xml`, a `sitemap.ts`/`.js`/`.mjs` route, or a `next-sitemap.config.*` |
| `robots` — robots.txt | automated | A `robots.txt` or a `robots.ts`/`.js`/`.mjs` route |
| `favicon` — Favicon | automated | A `favicon.*`/`icon.*`/`apple-icon.png` file, or a `rel="icon"` link in a page or layout |
| `custom-404` — Custom 404 page | automated | A `404.*`, `not-found.*`, or `+error.svelte` file |
| `meta-title` — Meta title on every page | automated | A title signal in each page or a layout wrapping it (Next.js, Nuxt, Astro, SvelteKit layout conventions) |
| `meta-description` — Meta description on every page | automated | A description signal in each page or a layout wrapping it |
| `og-image` — Open Graph image | automated | An `opengraph-image.*` file, an `og:image` tag, or an `openGraph:` config key |
| `alt-text` — Alt text on images | automated | Every `<img>`/`<Image>` tag in any shipped page, layout, or component carries an `alt` attribute |
| `image-size` — Compressed images | automated | No shipped raster image over 500 KB |
| `mobile-breakpoints` — Mobile breakpoints | manual | Load the key pages at phone width: no horizontal scroll, readable text, tappable targets |
| `form-loading-states` — Form and loading states | manual | Submit each form: disabled/pending state while in flight, a visible error on failure |
| `thank-you-page` — Thank-you / confirmation page | manual | Every conversion form lands on a confirmation the visitor can recognize |
| `privacy-policy` — Privacy policy | manual | A linked policy that names the data actually collected and who processes it |
| `terms` — Terms of service | manual | Linked terms, where the site sells, hosts accounts, or takes user content |
| `cookie-banner` — Cookie banner | manual | Consent shown before any non-essential cookie is set, where the audience requires it |
| `analytics` — Analytics | manual | The analytics tag fires on a real page view, and the policy discloses it |
| `contact-info` — Real contact info | manual | A reachable address, email, or form — not placeholder text |

The source list was described as 20 items; its body names these 17, and none were invented to reach the stated count.

## What to flag

- **`missing-sitemap` / `missing-robots`** — confirm the site does not generate them at build time from a config shape the generator does not recognize (a framework plugin, a deploy-platform setting) before filing.
- **`missing-favicon` / `missing-og-image`** — confirm no framework metadata convention supplies them (a `metadata.icons` export, a CMS-injected head) before filing.
- **`missing-custom-404`** — the host's default error page is what visitors see; flag it.
- **`missing-meta-title` / `missing-meta-description`** — read the page and its layouts; a title set through a helper the regex does not match is a false positive.
- **`img-missing-alt`** — a content image with no `alt` at all. `alt=""` is present, not missing.
- **`oversized-image`** — a raster asset over 500 KB that ships to visitors.

## What NOT to flag

- `img-missing-alt` on a decorative image that already carries `aria-hidden` or `role="presentation"`.
- `oversized-image` for a source asset that never ships (a design original, a file only used at build time).
- `missing-meta-title` / `missing-meta-description` on a redirect-only stub page.
- Any candidate on a repo that is not a website launching to the public — an internal tool or a component library's demo page has no launch to prepare for.

## Severity calibration

- **high** — `missing-custom-404`; `missing-meta-title` on a primary page (home, pricing, a landing page); `oversized-image` over 2 MB.
- **medium** — `missing-sitemap`, `missing-robots`, `missing-og-image`, `missing-meta-description`, `img-missing-alt` on a content image.
- **low** — `missing-favicon`; `oversized-image` between 500 KB and 2 MB.

## Scope boundary

This vertical owns exactly the 17-item checklist above. It does **not** own #2624's security-hardening (client secrets, ownership checks, AI-endpoint guards), #2622's pre-scale hardening (query performance, background jobs, caching, pooling, monitoring), or #2625's GDPR/backup-retention check. The `privacy-policy` and `cookie-banner` rows ask only whether the page and the banner exist and say the right things — not whether the data handling behind them complies.

## Reporting

The summary always renders every checklist row, never only the failures, as `| Item | Group | Status | Evidence |`, with automated rows kept visibly separate from manual rows (`manual` — a human should confirm). A run that lists only failures reads as "everything else passed", which overstates what a presence check did.

Reconcile each automated row with your verdicts before rendering it, so the status says what was filed rather than what the generator guessed:

- `pass` stays `pass` — "no gap found under the generator's stated coverage", never a guarantee.
- `fail` whose candidates you all rejected → `pass (N rejected: {reason})`.
- `fail` with at least one candidate filed → `fail`, with evidence naming the filed count and any rejected count.

## What this vertical never does

Findings from this criterion always propose a record for the supervised/granted build pipeline (`/claude-tweaks:specify` → `/claude-tweaks:build`) — never a direct edit to site files, and never a judgment of the manual items on the generator's behalf.
