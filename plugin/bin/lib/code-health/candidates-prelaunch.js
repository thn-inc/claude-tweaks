'use strict';

// candidates-prelaunch.js — deterministic pre-launch checklist generator for
// code-health's `focus=prelaunch` scoping mode (see skills/code-health/
// focus-mode.md). Reports pass/fail/needs-manual-check for every item on the
// 17-item pre-launch checklist (#2693): 9 automated presence/pattern checks
// plus 8 items that can only be judged by a human. Candidates are INPUT to
// the judge (skills/code-health/SKILL.md Step 5) — this generator never
// concludes anything on its own, never fixes anything, and never edits site
// files.
//
// Scope boundary vs. sibling records: this vertical owns exactly the
// 17-item pre-launch checklist above. #2624's security-hardening (secrets/
// ownership/AI-endpoint guards), #2622's pre-scale hardening (query/
// background-job/caching/pooling/monitoring), and #2625's GDPR/backup-
// retention check are out of scope here — no overlapping category is
// claimed by more than one of these verticals. See `criteria-prelaunch.md`
// for the judging side of this same boundary statement.
//
// Coverage (stated explicitly, never implied total — IL-110):
//   - Page discovery is a path/extension heuristic (`listPageFiles` below)
//     — a page shape this repo doesn't recognize (an unusual framework's
//     routing convention) is invisible to every per-page check, and a
//     non-page file that happens to match one of these shapes (e.g. a
//     `page.ts` helper file outside App Router) is a possible false
//     positive candidate site. Files under test/fixture/example/dependency/
//     build-output directories are never pages or scanned images, and
//     plain `.html` files count as pages only alongside an `index.html` —
//     so a repo whose only HTML is fixtures or a standalone template is
//     "not applicable", not a site missing every launch item.
//     Recognized page shapes: plain HTML, `pages/` routing (Next.js pages
//     router, Nuxt, Astro), Next.js App Router `page.*`, SvelteKit
//     `+page.svelte`.
//   - Meta detection (title, description, Open Graph image, favicon) is a
//     regex text signal against source, never a render — a value injected
//     only at runtime (a client-side `document.title = ...`, a meta tag
//     written by a script this generator doesn't execute) is invisible, and
//     a title set through a helper the pattern doesn't match reads as
//     missing. A page's layouts count: Next.js `layout.*`/`_app.*`/
//     `_document.*` and SvelteKit `+layout.svelte` for their own subtree,
//     Nuxt `layouts/*`/`app.vue` and Astro `src/layouts/*` for every page.
//   - Alt text is checked on every `<img>`/`<Image>` tag in any shipped
//     markup-bearing file (pages, layouts, components), by attribute
//     presence only — `alt="image"` passes.
//   - Site-level items (sitemap, robots, favicon, custom 404, OG image)
//     check presence of a recognized file/tag shape, never content quality
//     — a `sitemap.xml` with zero URLs, or a `robots.txt` that disallows
//     everything, both read as "present".
//   - Image size is raw file bytes on disk, never visual compression
//     quality or dimensions — a well-compressed 600 KB hero image and a
//     poorly-compressed 600 KB icon are flagged identically.
//   - The 8 manual items (mobile breakpoints, form/loading states,
//     thank-you page, privacy policy, terms, cookie banner, analytics,
//     real contact info) are never machine-judged — every firing lists them
//     as `status: 'manual'` for a human to check, regardless of repo
//     contents.
//   - Discovery reuses `candidates-dead-code.js`'s `listTrackedFiles` — same
//     git-ls-files discovery, same `.gitignore` handling, same
//     discoveryFailed/discoveryReason IL-115 distinction — but with no
//     extension filter, since this vertical needs non-source files
//     (`robots.txt`, `sitemap.xml`, image assets) that the source-only view
//     excludes.

const fs = require('fs');
const path = require('path');
// `./focus-generators` first: requiring `./candidates-dead-code` first from
// a direct entry leaves sibling verticals bound to an in-progress exports
// object (candidates-abstraction-police.js's header documents the order).
const { registerGenerator } = require('./focus-generators');
const { listTrackedFiles } = require('./candidates-dead-code');

const IMAGE_SIZE_LIMIT_BYTES = 500 * 1024;

// The 17-item checklist, in the exact order the record names them. Ruling
// (count): the record's AC says "all 20 items", but its body names only
// these 17 — no source for the other 3 is available, so none are invented
// (see criteria-prelaunch.md).
// `kind` is the candidate `kind` this item's fail status matches against —
// present only for automated items, one-to-one with each.
const CHECKLIST_ITEMS = [
  { id: 'sitemap', label: 'sitemap.xml', group: 'automated', kind: 'missing-sitemap' },
  { id: 'robots', label: 'robots.txt', group: 'automated', kind: 'missing-robots' },
  { id: 'favicon', label: 'Favicon', group: 'automated', kind: 'missing-favicon' },
  { id: 'custom-404', label: 'Custom 404 page', group: 'automated', kind: 'missing-custom-404' },
  { id: 'meta-title', label: 'Meta title on every page', group: 'automated', kind: 'missing-meta-title' },
  { id: 'meta-description', label: 'Meta description on every page', group: 'automated', kind: 'missing-meta-description' },
  { id: 'og-image', label: 'Open Graph image', group: 'automated', kind: 'missing-og-image' },
  { id: 'alt-text', label: 'Alt text on images', group: 'automated', kind: 'img-missing-alt' },
  { id: 'image-size', label: 'Compressed images', group: 'automated', kind: 'oversized-image' },
  { id: 'mobile-breakpoints', label: 'Mobile breakpoints', group: 'manual' },
  { id: 'form-loading-states', label: 'Form and loading states', group: 'manual' },
  { id: 'thank-you-page', label: 'Thank-you / confirmation page', group: 'manual' },
  { id: 'privacy-policy', label: 'Privacy policy', group: 'manual' },
  { id: 'terms', label: 'Terms of service', group: 'manual' },
  { id: 'cookie-banner', label: 'Cookie banner', group: 'manual' },
  { id: 'analytics', label: 'Analytics', group: 'manual' },
  { id: 'contact-info', label: 'Real contact info', group: 'manual' },
];

const PAGE_EXTS = new Set(['.jsx', '.tsx', '.js', '.ts', '.vue', '.svelte', '.astro', '.mdx', '.md']);
const ALT_SCAN_EXTS = new Set(['.jsx', '.tsx', '.js', '.mdx', '.vue', '.svelte', '.astro', '.html', '.htm']);
const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.tiff']);

// A `title:`/`description:` key counts only with a string value, so a CSS
// `.title:hover` rule or a `title: string` type annotation is not a signal.
// A `title=`/`description=` prop on a capitalized component is the Astro
// layout-component idiom (`<Layout title="Home">`).
const TITLE_RE = /<title[\s>]|<Head[\s>]|<Helmet[\s>]|useHead\s*\(|useSeoMeta\s*\(|generateMetadata|(^|[\s{,])title\s*:\s*['"`]|<[A-Z][\w.]*\s[^>]*\btitle=/;
const DESC_RE = /name\s*[:=]\s*["']description["']|(^|[\s{,])description\s*:\s*['"`]|<[A-Z][\w.]*\s[^>]*\bdescription=/;
// An `<img`/`<Image` tag: the name must be followed by whitespace or `/`,
// so a TypeScript generic `useRef<Image>` is not a tag, and `{...}`
// attribute expressions (one level of nesting) may contain `>`, as in an
// `onLoad={() => ...}` arrow.
const ALT_TAG_RE = /<(img|Image)(?=[\s/])(?:[^<>{}]|\{(?:[^{}]|\{[^{}]*\})*\})*>/g;
const ALT_ATTR_RE = /\s(:|v-bind:)?alt\s*=/;

// Directory segments whose contents never ship as the site itself — test
// suites, fixtures, examples, dependencies, and build output. Pages and
// images under them are neither evidence that a repo is a website nor
// launch defects of one.
const NON_SITE_SEGMENT_RE = /(^|\/)(tests?|__tests__|spec|e2e|cypress|fixtures|__fixtures__|examples?|node_modules|vendor|dist|build|out|coverage|\.storybook)\//;

// A file is a "page" for this checklist's purposes — see the plan's
// Detection rule 2 for the exact shape. `.md`/`.mdx` count only under
// `src/pages/` (Astro's convention); every other recognized extension needs
// only a `pages/` directory segment anywhere in the path.
function isPageFile(rel) {
  if (NON_SITE_SEGMENT_RE.test(rel)) return false;
  const base = path.basename(rel);
  const ext = path.extname(rel);
  if (ext === '.html' || ext === '.htm') return true;
  if (/^page\.(jsx|tsx|js|ts|mdx)$/.test(base)) return true; // Next.js App Router
  if (base === '+page.svelte') return true; // SvelteKit
  if (!PAGE_EXTS.has(ext)) return false;
  if (rel.includes('/pages/api/') || rel.startsWith('pages/api/')) return false;
  if (base.startsWith('_')) return false;
  if (ext === '.md' || ext === '.mdx') return /(^|\/)src\/pages\//.test(rel);
  return /(^|\/)pages\//.test(rel);
}

// A standalone `.html` file (a template, an exported report) is not a
// site on its own: plain-HTML pages count only when the set also holds an
// `index.html`/`index.htm`, the one file every static site has.
// Framework-routed pages (`pages/`, App Router `page.*`) need no such
// anchor — the routing convention already says "this is a site".
function listPageFiles(files) {
  const pages = files.filter(isPageFile);
  const hasHtmlIndex = pages.some((f) => /^index\.html?$/.test(path.basename(f)));
  return hasHtmlIndex ? pages : pages.filter((f) => !/\.html?$/.test(f));
}

// The directory whose pages a layout file wraps, or null when `rel` is not
// a layout. Next.js `layout.*`/`_app.*`/`_document.*` and SvelteKit
// `+layout.svelte` wrap their own directory subtree; Nuxt `layouts/*`,
// Astro `src/layouts/*`, and Nuxt's `app.vue` wrap every page (`''`).
function layoutScope(rel) {
  const base = path.basename(rel);
  if (/^layout\.(jsx|tsx|js|ts|mdx)$/.test(base)
    || /^_app\.(jsx|tsx|js|ts)$/.test(base)
    || /^_document\.(jsx|tsx|js|ts)$/.test(base)
    || base === '+layout.svelte') return dirOf(rel);
  if (/(^|\/)layouts\/[^/]+\.(vue|astro|svelte|jsx|tsx|js|ts)$/.test(rel) || base === 'app.vue') return '';
  return null;
}

// The one real file site-level candidates are anchored to (code-health
// anchors are `relfile#Symbol`, and `areaId` is that file's directory):
// the shallowest `index.html`, else the shallowest layout, else the
// shallowest page.
function siteEntryFile(pageFiles, layoutFiles) {
  const byDepth = (a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b);
  const htmlIndexes = pageFiles.filter((f) => /^index\.html?$/.test(path.basename(f))).sort(byDepth);
  return htmlIndexes[0] || [...layoutFiles].sort(byDepth)[0] || [...pageFiles].sort(byDepth)[0];
}

function dirOf(rel) {
  const d = path.dirname(rel);
  return d === '.' ? '' : d;
}

// True when `layoutDir` is the same directory as, or a directory ancestor
// of, `pageDir` — including the repo root (`''`), which covers every page.
function isAncestorOrSame(layoutDir, pageDir) {
  if (layoutDir === pageDir) return true;
  if (layoutDir === '') return true;
  return pageDir.startsWith(`${layoutDir}/`);
}

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length;
}

// Site-level presence checks: each looks for a recognized file shape first
// (`findByFile`, over every discovered file — not just pages/layouts), and
// for `favicon`/`og-image` also falls back to a text signal in any read
// page/layout file (`findByText`). Returns the matched file for pass-case
// evidence, or a `missing-<id>` candidate when neither finds anything.
const SITE_LEVEL_CHECKS = [
  {
    id: 'sitemap',
    kind: 'missing-sitemap',
    label: 'sitemap.xml',
    shortList: 'sitemap.xml, sitemap.ts/js/mjs, next-sitemap.config.js',
    findByFile(files) {
      for (const f of files) {
        const base = path.basename(f);
        if (base === 'sitemap.xml') return f;
        if (/(^|\/)sitemap\.(ts|js|mjs)$/.test(f)) return f;
        if (/^next-sitemap\.config\.(js|cjs|mjs)$/.test(base)) return f;
      }
      return null;
    },
  },
  {
    id: 'robots',
    kind: 'missing-robots',
    label: 'robots.txt',
    shortList: 'robots.txt, robots.ts/js/mjs',
    findByFile(files) {
      for (const f of files) {
        const base = path.basename(f);
        if (base === 'robots.txt') return f;
        if (/(^|\/)robots\.(ts|js|mjs)$/.test(f)) return f;
      }
      return null;
    },
  },
  {
    id: 'favicon',
    kind: 'missing-favicon',
    label: 'Favicon',
    shortList: 'favicon.ico/svg/png, icon.ico/svg/png, apple-icon.png, or a <link rel="icon"> tag',
    findByFile(files) {
      for (const f of files) {
        const base = path.basename(f);
        if (/^(favicon\.(ico|svg|png)|icon\.(ico|svg|png)|apple-icon\.png)$/.test(base)) return f;
      }
      return null;
    },
    findByText(text) {
      return /rel=["'](shortcut )?icon["']/i.test(text);
    },
  },
  {
    id: 'custom-404',
    kind: 'missing-custom-404',
    label: 'Custom 404 page',
    shortList: '404.html/htm/jsx/tsx/js/ts/vue/svelte/astro/md/mdx, not-found.jsx/tsx/js/ts, or +error.svelte',
    findByFile(files) {
      for (const f of files) {
        const base = path.basename(f);
        if (/^404\.(html|htm|jsx|tsx|js|ts|vue|svelte|astro|md|mdx)$/.test(base)) return f;
        if (/^not-found\.(jsx|tsx|js|ts)$/.test(base)) return f;
        if (/(^|\/)\+error\.svelte$/.test(f)) return f;
      }
      return null;
    },
  },
  {
    id: 'og-image',
    kind: 'missing-og-image',
    label: 'Open Graph image',
    shortList: 'opengraph-image.*, an og:image meta tag, or an openGraph: config key',
    findByFile(files) {
      for (const f of files) {
        const base = path.basename(f);
        if (/^opengraph-image\./.test(base)) return f;
      }
      return null;
    },
    findByText(text) {
      return /og:image|openGraph\s*:/.test(text);
    },
  },
];

function findSiteLevel(check, files, contentsByFile) {
  const byFile = check.findByFile(files);
  if (byFile) return byFile;
  if (check.findByText) {
    for (const [file, text] of contentsByFile) {
      if (check.findByText(text)) return file;
    }
  }
  return null;
}

function notApplicableChecklist(reason) {
  return CHECKLIST_ITEMS.map((item) => ({ id: item.id, label: item.label, group: item.group, status: 'n/a', evidence: reason }));
}

// The rich-shape scan — registered under 'prelaunch' in FOCUS_GENERATORS.
function scanPrelaunch(rootDir) {
  const discovery = listTrackedFiles(rootDir);
  if (discovery.discoveryFailed) {
    return {
      candidates: [],
      scannedFiles: 0,
      skippedFiles: [],
      discoveryFailed: true,
      discoveryReason: discovery.reason,
      notApplicable: false,
      checklist: notApplicableChecklist('discovery failed'),
    };
  }

  const pageFiles = listPageFiles(discovery.files);
  if (pageFiles.length === 0) {
    return {
      candidates: [],
      scannedFiles: discovery.files.length,
      skippedFiles: [],
      discoveryFailed: false,
      notApplicable: true,
      notApplicableReason: 'no web pages detected',
      checklist: notApplicableChecklist('no web pages detected'),
    };
  }

  // Every later check reads only files that could ship as the site — a
  // `tests/fixtures/robots.txt` must not satisfy the site's robots item.
  const siteFiles = discovery.files.filter((f) => !NON_SITE_SEGMENT_RE.test(f));
  const ancestorFiles = siteFiles.filter((f) => layoutScope(f) !== null);
  // Pages and layouts for the meta checks, plus every markup-bearing site
  // file for the alt scan — most `<img>` tags live in components, not pages.
  const altScanFiles = siteFiles.filter((f) => ALT_SCAN_EXTS.has(path.extname(f)));
  const textFiles = [...new Set([...pageFiles, ...ancestorFiles, ...altScanFiles])].sort();

  const skippedFiles = [];
  const contentsByFile = new Map();
  for (const rel of textFiles) {
    let buf;
    try {
      buf = fs.readFileSync(path.join(rootDir, rel));
    } catch {
      skippedFiles.push({ file: rel, reason: 'unreadable' });
      continue;
    }
    if (buf.includes(0)) {
      skippedFiles.push({ file: rel, reason: 'binary-or-nul' });
      continue;
    }
    contentsByFile.set(rel, buf.toString('utf8'));
  }

  const entryFile = siteEntryFile(pageFiles, ancestorFiles);

  const candidates = [];
  const passEvidenceById = {};

  // Site-level presence.
  for (const check of SITE_LEVEL_CHECKS) {
    const found = findSiteLevel(check, siteFiles, contentsByFile);
    if (found) {
      passEvidenceById[check.id] = found;
    } else {
      candidates.push({
        file: entryFile,
        kind: check.kind,
        evidence: `${check.label} not found (looked for: ${check.shortList})`,
      });
    }
  }

  // Per-page meta: title and description, own text or an ancestor layout.
  for (const page of pageFiles) {
    const ownText = contentsByFile.get(page);
    let titleOk = ownText ? TITLE_RE.test(ownText) : false;
    let descOk = ownText ? DESC_RE.test(ownText) : false;
    if (!titleOk || !descOk) {
      const pageDir = dirOf(page);
      for (const layout of ancestorFiles) {
        if (titleOk && descOk) break;
        if (!isAncestorOrSame(layoutScope(layout), pageDir)) continue;
        const layoutText = contentsByFile.get(layout);
        if (!layoutText) continue;
        if (!titleOk && TITLE_RE.test(layoutText)) titleOk = true;
        if (!descOk && DESC_RE.test(layoutText)) descOk = true;
      }
    }
    const evidenceFor = (what) => `${page} has no ${what} signal in itself or an ancestor layout`;
    if (!titleOk) candidates.push({ file: page, kind: 'missing-meta-title', evidence: evidenceFor('title') });
    if (!descOk) candidates.push({ file: page, kind: 'missing-meta-description', evidence: evidenceFor('description') });
  }
  passEvidenceById['meta-title'] = `${pageFiles.length} page(s) checked`;
  passEvidenceById['meta-description'] = `${pageFiles.length} page(s) checked`;

  // Alt text: every read markup-bearing site file — pages, layouts, and
  // components alike.
  let altScanned = 0;
  for (const [file, text] of contentsByFile) {
    if (!ALT_SCAN_EXTS.has(path.extname(file))) continue;
    altScanned += 1;
    ALT_TAG_RE.lastIndex = 0;
    let m;
    while ((m = ALT_TAG_RE.exec(text))) {
      const tag = m[0];
      if (!ALT_ATTR_RE.test(tag)) {
        const line = lineOf(text, m.index);
        const shown = tag.replace(/\s+/g, ' ');
        candidates.push({ file, kind: 'img-missing-alt', evidence: `${file}:${line} ${shown} has no alt attribute` });
      }
      if (m.index === ALT_TAG_RE.lastIndex) ALT_TAG_RE.lastIndex += 1;
    }
  }
  passEvidenceById['alt-text'] = `${altScanned} file(s) checked`;

  // Image size: every tracked/untracked-unignored image file, regardless of
  // whether it's a "page" — a hero image lives under public/assets, not a
  // page path.
  let imagesScanned = 0;
  for (const f of siteFiles) {
    if (!IMAGE_EXTS.has(path.extname(f).toLowerCase())) continue;
    imagesScanned += 1;
    let stat;
    try {
      stat = fs.statSync(path.join(rootDir, f));
    } catch {
      skippedFiles.push({ file: f, reason: 'unreadable' });
      continue;
    }
    if (stat.size > IMAGE_SIZE_LIMIT_BYTES) {
      const kb = Math.round(stat.size / 1024);
      candidates.push({ file: f, kind: 'oversized-image', evidence: `${f} is ${kb} KB (limit 500 KB)` });
    }
  }
  passEvidenceById['image-size'] = `${imagesScanned} image(s) checked`;

  candidates.sort((a, b) => (a.file === b.file ? a.evidence.localeCompare(b.evidence) : a.file.localeCompare(b.file)));

  const checklist = CHECKLIST_ITEMS.map((item) => {
    if (item.group === 'manual') {
      return { id: item.id, label: item.label, group: item.group, status: 'manual', evidence: 'needs manual check — see criteria-prelaunch.md' };
    }
    const matching = candidates.filter((c) => c.kind === item.kind);
    if (matching.length > 0) {
      return { id: item.id, label: item.label, group: item.group, status: 'fail', evidence: `${matching.length} candidate(s)` };
    }
    return { id: item.id, label: item.label, group: item.group, status: 'pass', evidence: passEvidenceById[item.id] || 'no issues found' };
  });

  return {
    candidates,
    scannedFiles: discovery.files.length,
    skippedFiles,
    discoveryFailed: false,
    notApplicable: false,
    checklist,
  };
}

// Spec-pinned Data/API Surface signature — a bare array, mirroring the
// sibling verticals' direct entry point for unit tests / a future
// non-focus-mode caller.
function candidatesPrelaunch(rootDir) {
  return scanPrelaunch(rootDir).candidates;
}

registerGenerator('prelaunch', scanPrelaunch);

module.exports = {
  scanPrelaunch,
  candidatesPrelaunch,
  CHECKLIST_ITEMS,
  IMAGE_SIZE_LIMIT_BYTES,
  listPageFiles,
};
