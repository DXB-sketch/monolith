# Phase 5 complete: Performance, accessibility and launch

The site is ready to launch once the owner's content, accounts and domain are in.

- **Audits:** every audit passes its launch target, apart from the documented exceptions below.
- **Content gate:** production builds refuse to ship while placeholders remain.
- **SEO and sharing:** structured data, sitemap, robots and per-page sharing images are in place.
- **Privacy, security and caching:** analytics are cookieless and send no personal data. Security and caching headers are configured, and the CSP is tested in every tier.
- **LAUNCH.md** walks the owner through every step that needs their accounts or decisions, in order.
- **Submission:** screenshots and a recording are rendered in `submission/`.

Nothing a visitor would call a feature was added and the design is unchanged. The audit fixes that touch the page are invisible at normal sizes (pixel-compared; see Step 5).

As in earlier phases, all measurements were taken in this container, which has **no GPU**. WebGL runs on SwiftShader, so the live tiers are far slower here than on real hardware, and the default tier here is Poster (software renderer). Lighthouse numbers below are therefore Poster-tier page loads, which is also what Lighthouse sees on real devices: its first paint and LCP happen before any 3D code runs.

**Nothing was merged, no production setting was changed and no domain was touched.** Those steps are in `LAUNCH.md` §3–4.

---

## What was done

### Step 1: branch and deployment hygiene

- **Production branch.** The Vercel project already deploys production from `main` (the `monolith-git-main…` alias), so the Phase 1 issue is resolved. `LAUNCH.md` §4 has the owner confirm it, and gives the merge and rollback steps.
- **Branch state.** `claude/new-session-behumn` is **0 commits behind `main`** and merges cleanly (`git merge-tree`); the build passes on it. PR [DXB-sketch/monolith#6](https://github.com/DXB-sketch/monolith/pull/6) carries Phases 4 and 5.
- **`site` from `PUBLIC_SITE_URL`** (`astro.config.mjs`), with `https://monolith.example` as the fallback. Until it is set, the placeholder gate lists `[DOMAIN]`.
- **Dev route out of production.** The scene viewer moved from `src/pages/dev/[view].astro` to `src/dev/scene.astro`, and is injected only when `astro dev` runs. Production output has no `/dev/*` route and no `_view_` chunk.

### Step 2: placeholder gate (`src/integrations/placeholder-report.ts`)

- **What it scans.** After every build, the gate scans the built HTML (titles, meta, alt text, JSON-LD and Open Graph included) and the sources of the on-demand `/contact` page. It prints the missing items grouped by page.
- **Strict mode.** With `VERCEL_ENV=production` or `STRICT_CONTENT=1`, the build **fails** with that list. Preview and local builds only warn. Verified both ways: a strict build exits 1, a normal build passes with the warning.
- **Drafts.** A `draft` flag (default `false`) was added to the `work` and `lab` schemas. Draft entries are left out of every listing, route and the sitemap (they still show in `astro dev`), so the unchosen concept can be shipped as a draft.
- **Current list:** 28 distinct placeholders across 13 pages plus the site URL (the build prints them; `LAUNCH.md` §1 says where each lives). It includes the Privacy page's `[REVIEW BEFORE LAUNCH]` flag and `[DOMAIN]`.

### Step 3: SEO and sharing

- **Titles and descriptions.**
  - Titles are "Page — Monolith Web Studio". Home is "Monolith Web Studio — Wamuran, Queensland". Case studies are "SEQDVGC: case study — …", the concept is labelled "a concept", and Lab entries are "…: a Lab experiment".
  - Every page has its own description.
- **Canonical URLs** come from `PUBLIC_SITE_URL`, without a trailing slash (as in the sitemap). The 404 and the thank-you page get `noindex` and no canonical.
- **Sitemap and robots.**
  - `@astrojs/sitemap` covers every indexable page, including on-demand `/contact`, and excludes `/dev/`, `/api/` and `/contact/thanks`.
  - `robots.txt` allows everything except `/dev/` and `/api/`, and points to `sitemap-index.xml`.
  - Previews stay `noindex` through Vercel's own header.
- **JSON-LD** (`src/lib/structured-data.ts`):
  - **Home:** `ProfessionalService` with name, URL, logo, email, description and image. The address is locality only (Wamuran, QLD, AU, no street address). Area served is South East Queensland, Moreton Bay, Sunshine Coast and Brisbane. `sameAs` is emitted only for real `https://` profile links (none yet).
  - **Case studies:** `CreativeWork`. It has name, description, URL and image, plus `dateCreated` only when the year is a real four-digit year. The creator is the studio, by `@id`, and concepts carry `genre: Concept`.
  - **Breadcrumbs:** `BreadcrumbList` on case studies and Lab entries.
  - **Validation:** every block was checked against the schema.org vocabulary (current release): types, properties allowed on each type, and value ranges. Result: **8 blocks, 0 errors**.
- **Open Graph and Twitter images** (`npm run og`, `scripts/render-og.ts`).
  - One 1200×630 JPEG per page (12 images, **39–59 KB** each).
  - Each is rendered from that page's own camera view on the High tier with the poster tooling's deterministic capture, with the page's own headline in Sora and the wordmark.
  - Output is byte-identical between runs.
  - Re-run after headline or title changes (`LAUNCH.md` §1).
- **Icons** (`npm run icons`): SVG, ICO (16 and 32 px), Apple touch icon (180 px), 192 px, 512 px and a maskable 512 px, all rendered from `favicon.svg`. `site.webmanifest` uses the palette's basalt.
- **Language:** `lang="en-AU"`. An Australian-spelling sweep of every page's visible text found nothing to change.

### Step 4: performance

- **Fixed:**
  - **Lab demo started on devices kept on the poster.** It read the tier at page load, which on a direct visit is still pending (the GPU check runs after first paint). On a software renderer, then, it ran WebGL on the main thread: Lighthouse TBT 0.9–2.5 s, Performance 68–72. It now waits for the tier to settle (`src/pages/lab/[slug].astro`).
  - **Headers:** caching and compression (below).
- **Checked, no change needed:**
  - **Fonts:** Sora 200/300 preloaded, Sora 500 and JetBrains Mono on demand, all `font-display: swap`, Latin subsets.
  - **Images:** responsive AVIF/WebP with dimensions.
  - **Bundles:** no unused JS or CSS in the initial bundles.
  - **Cal.com:** still only on "Book a call", confirmed in the network logs.
- **Caching** (all routes, written by `src/integrations/security-headers.ts`):

  | Path | Cache-Control |
  |---|---|
  | `/_astro/*` (hashed), `/fonts/*` | `public, max-age=31536000, immutable` |
  | `/posters/*`, `/textures/*` (atlas), `/og/*`, `/media/*`, `/models/*`, icons | `public, max-age=2592000, stale-while-revalidate=86400` (30 days: regenerated under the same names) |
  | HTML, on-demand pages, everything else | `public, max-age=0, must-revalidate` |

### Step 5: accessibility

`npm run audit:a11y` runs axe across every page type, scene mode, size and form state. `npm run audit:manual` scripts the manual checks. Fixes:

- **Thank-you page heading order:** `h1` jumped to the booking `h3`. The booking heading now follows the page's level.
- **Two "Prefer to talk?" regions on `/contact` after sending:** the success message's booking region has its own accessible name, with no visual change.
- **Reflow at 320 px** (horizontal scrolling):
  - The nav's wordmark, "Start a project" and the menu button didn't fit. They now tighten slightly below 22rem, the breakpoint the nav already used for this.
  - In the home Lab chapter, the display heading's longest word plus the panel padding was wider than the screen. The panel and face-card padding is now smaller below 22rem.
- **Text-spacing overrides at 390 px** widened the page. Headings now use `overflow-wrap: anywhere`, so a word breaks only when it can't fit, and a long word no longer stretches its grid track.

These layout changes were pixel-compared at 1440, 768 and 390 px on ten pages. No visible differences; the only changed pixels are in the blurred backdrop behind the fixed nav.

### Step 6: cross-browser (`npm run test:flows`)

The flows are:
- tiers: default, plus forced `?tier=lite` and `?tier=high`
- the home story scroll, with its analytics
- a deep link
- a navigation round trip that checks the canvas persists
- the whole contact form with Resend mocked, checking the events carry no personal data
- the Lab demo, forced Lite. The demo itself refuses software renderers (its Phase 3 check), so here the flow verifies the still is shown; its live controls need a real GPU

Every flow fails on any CSP violation, page error or console error. The suite is written for Chromium, Firefox and WebKit. Fixed here: a CSP violation on every navigation, the ClientRouter's `data:` script sentinel (see Step 8).

### Step 7: analytics (`src/lib/analytics.ts`)

- **Vercel Web Analytics and Speed Insights** through their Astro components. Both are cookieless with first-party scripts (`/_vercel/…`), sending a page view per ClientRouter navigation.
- **Custom events.** Each sends only the fields listed; never anything typed.

  | Event | When | Data |
  |---|---|---|
  | `scene_tier` | Once per visit: 5 s after the live scene's first frame (so an early step down counts), when the poster is decided, or when the page is first hidden | `tier` (high, medium, lite, poster, pending), `live`, and for the poster `reason` as a short category (reduced-motion, save-data, no-webgl2, software-renderer, weak-gpu, detection-failed, no-first-frame, context-lost, scene-error, forced, other). GPU strings are never sent. |
  | `story_progress` | Once per home visit: leaving the story by link (before-swap) or the page being hidden | `chapter` (arrival … the-core, the-dive), `index` 0–5 |
  | `cta_click` | Any "Start a project" button or "Book a call" (one delegated listener) | `button`, `placement` (nav, footer or section), `page` |
  | `contact_step` | Each new step reached | `step`, `name` (the step id) |
  | `contact_submit` | A successful send | none |
  | `sound_on` | Sound switched on by the toggle | `page` |
  | `intro_skipped` | An input opened the intro early (flagged by the intro's inline script, read by the main bundle) | none |

- **Verified in the flows** (events read from the analytics queue): `story_progress {"chapter":"the-core","index":4}`, `cta_click {"button":"start_project","placement":"plain","page":"/"}`, four `contact_step` events, `contact_submit`, and none of the typed name, email, business or message anywhere in the queue.
- **Never blocking.** Calls queue on `window.va` and the analytics script sends them, so nothing awaits them; with no script (local, analytics off, blocked) they are no-ops. `LAUNCH.md` §6 explains how to read them.

### Step 8: security (`src/integrations/security-headers.ts`)

The headers are written straight into the Build Output config (`.vercel/output/config.json`). They apply to static and on-demand responses alike, without relying on `vercel.json` being merged. (The adapter is always the first integration, so its config exists by then.)

**Content-Security-Policy:**

```
default-src 'self';
script-src 'self' 'sha256-…' 'sha256-…' https://app.cal.com https://cal.com;
style-src 'self' 'unsafe-inline' https://app.cal.com https://cal.com;
img-src 'self' data: blob:;
font-src 'self';
media-src 'self';
connect-src 'self' https://app.cal.com https://cal.com;
frame-src https://app.cal.com https://cal.com;
worker-src 'self' blob:;
manifest-src 'self';
object-src 'none';
base-uri 'self';
form-action 'self';
frame-ancestors 'none'
```

- **Scripts:**
  - No `'unsafe-inline'` and no `'unsafe-eval'`.
  - The two inline scripts (the early `js`/intro flags and the intro's opener) are allowed by **SHA-256 hashes**, computed from the built pages at build time.
  - Module scripts are never inlined (`assetsInlineLimit` for `.js`). An inline module script made the ClientRouter add a `data:` script on every navigation, which the policy refused.
- **`blob:`:** for the worker that probes WebGL off the main thread (`worker-src`) and the fissure atlas decoded from a Blob (`img-src`).
- **Cal.com:** only for the booking embed. A custom booking domain in `src/lib/site.ts` is added automatically.
- **Styles keep `'unsafe-inline'`.** Style attributes in the markup, the ClientRouter's transition styles and Cal.com's embed all need it.
- **Other headers:**
  - `Strict-Transport-Security: max-age=63072000; includeSubDomains` (no `preload`; see `LAUNCH.md` §3)
  - `X-Content-Type-Options: nosniff`
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - `Permissions-Policy`: camera, microphone, geolocation, payment, USB, serial, HID, MIDI, motion sensors, display capture and topics all denied
  - `X-Frame-Options: DENY`
  - `Cross-Origin-Opener-Policy: same-origin`
- **Tested under the policy:** every axe and flow run uses these exact headers (`npm run serve:prod` applies the Build Output routes the way Vercel does). That covers High, Lite, Poster, static and no-JS; the intro; the Lab page; the contact form, including no-JS, errors and success; and "Book a call". **0 CSP violations.**
- **Contact endpoint** (`npm run test:contact`, production build, Resend mocked): validation, the size limit, the rate limit, the honeypot, the signed timing token, the origin check, provider failure, HTML escaping and clean logs **all pass**.
- **Secrets:** the client output was searched for `RESEND_API_KEY`, `CONTACT_*`, `api.resend.com`, `re_…` keys and `SECRET`. Nothing found; the only hits were inside Three.js's `texture_compression` strings.
- **npm audit:**
  - `http-cache-semantics` was patched (minor).
  - `path-to-regexp` under `@vercel/routing-utils` (build-time only) is pinned to 6.3.0 with an `overrides` entry: the patched release in the same major.
  - **Remaining:** `braces` (high, ReDoS). Every version is affected and no fix exists. It is reached only through `eslint-plugin-astro` → `fast-glob`, dev-time lint tooling that never ships or runs on the server. npm's suggested "fix" is a downgrade of `eslint-plugin-astro`, so it was not taken.

### Step 9: Privacy page (`/privacy`)

- **Content.** Plain English, in the first person, covering only what the site does:
  - the brief goes to me by email through Resend
  - the draft in session storage
  - the two-minute no-JS cookie
  - the in-memory address check for spam
  - Vercel's cookieless analytics and Speed Insights, and the exact custom events
  - Cal.com (only on demand, under its own policy)
  - hosting
  - deletion requests via the studio email
- **No claims** of certifications or compliance.
- **Flagged** `[REVIEW BEFORE LAUNCH]`, so the gate lists it.
- **Linked** from the footer and from the contact form's details step ("These details come to me by email so I can reply. How the site handles your details."). It has its own OG image.

### Step 10: submission assets (`npm run capture`, `submission/`)

**Deterministic capture.** The capture runs on the production build with the High tier forced (Lite for phone).
- Once a page has loaded, its clock (`performance.now`, `Date.now`, the rAF timestamp) is frozen, then moved on exactly 1/60 s per frame.
- CSS and view-transition animations are paused and stepped by hand.
- Dynamic resolution is held at full scale.

So a software renderer produces the same smooth output a GPU would.

The outputs (see `submission/README.md`):
- **Screenshots:** each home chapter plus the dive, Work, a case study, Services and Contact, at 1600×1200 and 2560×1440, and phone at 390×844 (Lite, 3×).
- **Recording:** 1920×1080 at 60 fps, in MP4 (H.264) and WebM (VP9). It runs from the home story into a case study through its card, back, and on through the Core and the dive.

The award checklist is in `LAUNCH.md` §6.

### Step 11: `LAUNCH.md`

The owner's checklist, in order:
1. content (with the gate's list)
2. Resend, environment variables, analytics
3. the domain, `www` redirect, HTTPS and the HSTS preload note
4. the merge, the production branch and rollback
5. real-device checks, including a screen-reader script for VoiceOver and NVDA/Narrator
6. after launch: Search Console, Business Profile, reading the analytics, awards

---

## Audit results

### Lighthouse

Three runs per page, median shown, against the production build via `npm run serve:prod`.
- **Before:** the start of Phase 5 (Phase 4 plus Step 3), served without compression.
- **After:** the final build, served with brotli as Vercel's CDN does. A mobile "after" set without compression is included, so the code change can be seen apart from the server change.
- **404:** audited at `/404`, because Lighthouse refuses to load a document returned with status 404.

**Mobile** (Moto G Power emulation, simulated slow 4G):

| Page | Before: Perf / LCP / TBT | After, uncompressed: Perf / LCP | **After: Perf / A11y / BP / SEO** | **After: LCP / TBT / CLS** |
|---|---|---|---|---|
| Home | 97 / 2.25 s / 56 ms | 96 / 2.41 s | **99 / 100 / 100 / 100** | **1.93 s / 37 ms / 0** |
| Work | 92 / 3.05 s / 21 ms | 96 / 2.48 s | **99 / 100 / 100 / 100** | **2.04 s / 41 ms / 0** |
| Case study | 96 / 2.33 s / 99 ms | 95 / 2.63 s | **97 / 100 / 100 / 100** | **2.39 s / 57 ms / 0** |
| Services | 97 / 2.25 s / 79 ms | 97 / 2.40 s | **99 / 100 / 100 / 100** | **1.93 s / 18 ms / 0** |
| About | 93 / 2.90 s / 18 ms | 96 / 2.49 s | **99 / 100 / 100 / 100** | **1.87 s / 8 ms / 0** |
| Lab | 98 / 2.26 s / 0 ms | 97 / 2.40 s | **99 / 100 / 100 / 100** | **1.89 s / 25 ms / 0** |
| Lab entry | **68** / 2.54 s / **2465 ms** | 96 / 2.46 s | **98 / 100 / 100 / 100** | **2.08 s / 67 ms / 0** |
| Contact | 97 / 2.41 s / 12 ms | 97 / 2.43 s | **98 / 100 / 100 / 100** | **2.03 s / 55 ms / 0** |
| Privacy | (new) | 97 / 2.40 s | **99 / 100 / 100 / 100** | **1.88 s / 0 ms / 0** |
| 404 | n/a (status 404) | 96 / 2.41 s | **99 / 100 / 100 / 63†** | **1.88 s / 68 ms / 0** |

**Desktop:** every page scores **100 / 100 / 100 / 100**, except the 404's SEO (63†). LCP is 0.49–0.61 s, TBT 0–33 ms and CLS ≤ 0.008. Before, the Lab entry was 72 (TBT 862 ms) and everything else was already 100.

† The 404's only SEO "failure" is `is-crawlable`: it carries `noindex`, deliberately, because a "page not found" page must not be indexed. Removing it would raise the score and be wrong, so it stays (see Deviations).

**Home, slow 4G and 4× CPU (mid-range Android):**
- **Setup:** applied throttling (562.5 ms RTT, 1.47 Mbps down, 4× CPU slowdown), 412×823 at 1.75×, first visit (intro on). Three runs.
- **Method:** Lighthouse's filmstrip (frames about 1.4 s apart), plus in-page observers for exact times.

| Milestone | Time (median) |
|---|---|
| Poster image loaded | 1.61 s (before first paint, so the poster is there at first paint) |
| First paint = FCP = LCP (the hero text) | 1.76 s (Lighthouse: 1.90 s) |
| Intro end (fully open) | 2.15 s |
| Tier settled | 2.84 s: Poster (software renderer) |
| `load` | 3.27 s |
| Live scene | Not here: the container's software renderer is ruled out, by design. On a real mid-range Android the scene chunk starts after this point (Phase 2.5: prefetched about 1 s after `load`). |

### axe (`npm run audit:a11y`)

| Mode | Sizes | Pages and states | Before | After |
|---|---|---|---|---|
| High (`?tier=high`) | desktop | 11 pages + form error, details step, sent, book a call | thank-you heading order; `/contact` sent: duplicate region name | **0** |
| Lite (`?tier=lite`) | desktop | same | (same two) | **0** |
| Poster (default here) | desktop, phone | same + open mobile menu | (same two) | **0** |
| Static (reduced motion) | desktop, phone | same | (same two) | **0** |
| No-JS | desktop, phone | 11 pages + the server-side error round trip | not run (the first run crashed: axe needs JS) | **0** |

That is **116 audits: 0 violations, 0 CSP violations, 0 console errors**. Tags: WCAG 2.0, 2.1 and 2.2 A/AA plus best practice.

A first-run contrast failure on `/work` at High was measured mid-reveal (elements at 43–56% opacity, slowed by the software renderer). It passes once reveals finish, and the audit now waits for them.

### Manual checks, scripted (`npm run audit:manual`)

| Check | Result |
|---|---|
| Reflow at 320 px, 11 pages | Before: home and nav overflowed (332 px). **After: pass** |
| 200% zoom (720 px viewport), 11 pages | pass |
| Text-spacing overrides (WCAG 1.4.12), 1440 and 390 px | Before: home overflowed at 390 px (410 px). **After: pass** |
| Keyboard, 11 pages: skip link first, every stop visible with a focus indicator, no traps | pass |
| Keyboard: mobile menu (opens, Tab enters, Escape closes, focus returns) | pass |
| Keyboard: the whole contact form (radios, Next, Enter to advance, send, focus to the success heading), Book a call | pass |
| Keyboard: sound toggle (`aria-pressed`) | pass |
| Keyboard: Lab demo sliders | not testable here: the demo declines software renderers (the still is shown); the sliders are native range inputs |
| Link text out of context, 11 pages | pass |
| Reduced motion: no infinite animations, all content visible | pass |
| No-JS: all content visible | pass |
| Forced colours: content visible, focus outline present (screenshots reviewed: text gets backplates, form and panel borders show) | pass |
| Headings and landmarks | covered by axe (`heading-order`, `landmark-*`, `page-has-heading-one`, `region`) |

The screen-reader test is a manual script for the owner (`LAUNCH.md` §5).

### Cross-browser (`npm run test:flows`)

| Flow | Chromium desktop | Chromium phone | Firefox | WebKit |
|---|---|---|---|---|
| Tiers | default → Poster; `?tier=lite` → Lite (live); `?tier=high` → High (live) | same | not run* | not run* |
| Home story + analytics | pass | pass | not run* | not run* |
| Deep link `/#the-lab` | pass | pass | not run* | not run* |
| Round trip home → work → case → back → back → forward, canvas persists | pass (after the CSP fix) | pass | not run* | not run* |
| Contact, Resend mocked, no personal data in events | pass | pass | not run* | not run* |
| Lab page (forced Lite; the demo declines software renderers, so the still is checked) | pass | pass | not run* | not run* |

\* **Firefox and WebKit aren't installed in this container,** and its rules don't allow downloading browser builds. The suite supports both engines unchanged. Running it is the first item under "Outstanding", and `LAUNCH.md` §5 covers it.

---

## Sizes

| | |
|---|---|
| Initial JS, content pages (gz) | 16.7–17.5 KB; Contact 20.0 KB (Phase 4: 13.2 KB; +3.5 KB is Analytics and Speed Insights) |
| Home, everything loaded in the first seconds (gz) | 63.6 KB, of which the story and GSAP chunks (about 46 KB) load after first paint |
| Scene chunk (gz), lazily loaded on live tiers | 151.0 KB (+ layers chunk 20.5 KB) |
| Posters / OG images / fonts | 200 KB / 632 KB (12 images) / 100 KB |
| Submission screenshots / recording | 30 JPEGs, 7.6 MB / 35.2 s at 1920×1080, 60 fps: MP4 (H.264) 20.5 MB, WebM (VP9) 12.9 MB |

---

## Deviations from the spec, and why

- **The 404 page's SEO score is 63, not 100.** The only failing audit is "page is blocked from indexing", caused by its intentional `noindex`. A 404 must not be indexed.
- **Firefox and WebKit were not run.** See above. The suite is ready for them.
- **Open Graph images are generated by a script, not inside `astro build`.** Rendering 12 WebGL frames on the build machine would add minutes to every Vercel build, and needs a browser there. So `npm run og` renders them from the dev server, and they're committed to `public/og/` (byte-identical between runs). The spec's "at build time with the poster tooling" is otherwise met: it is the poster tooling, deterministic, one image per page.
- **The contact form gained a one-line privacy note and link** on its details step. Step 9 asks for a link from the form, and this is the smallest form of it.
- **Lighthouse "after" runs use a compressing local server.** Vercel serves brotli; the old local server didn't. An uncompressed "after" set is included so both effects are visible.
- **The no-JS axe mode serves pages without their scripts** rather than disabling JavaScript. axe itself needs JavaScript to run. What the page gets is identical.

## Outstanding before launch

1. **Content:** fill every placeholder (`LAUNCH.md` §1). Production builds fail until then.
2. **Privacy page:** the owner reviews it and removes the flag.
3. **Accounts, keys, domain, merge:** `LAUNCH.md` §2–4.
4. **Firefox and WebKit:** on a machine with the browsers, run `npx playwright install firefox webkit`, then `npm run build`, `npm run serve:prod`, and `BROWSER=firefox npm run test:flows` and `BROWSER=webkit npm run test:flows`. Also test on a real iPhone (Safari) and Android (Chrome) during `LAUNCH.md` §5.
5. **The Lab demo's live mode and sliders:** check on a device with a GPU (`/lab/light-through-stone`).
6. **Real-device numbers:** frame rates and Core Web Vitals on real hardware (`?fps`, then Speed Insights after launch).
7. **Screen-reader pass:** the owner runs the script in `LAUNCH.md` §5.
8. **Regenerate after content changes:** run `npm run og` and `npm run capture`. The current OG images and submission assets show placeholder text.
9. **Custom analytics events** may depend on the Vercel plan (`LAUNCH.md` §2).

## For anyone continuing

- `npm run serve:prod` is the local production stand-in: real function, real headers, CDN-like compression, mocked Resend and analytics. The audit scripts all assume it on port 4600.
- **New inline scripts** get their CSP hashes automatically. **New third-party origins** must be added to `contentSecurityPolicy()` in `src/integrations/security-headers.ts`, and `npm run test:flows` will fail until they are.
- **A page-specific inline script on the on-demand `/contact` page** would not be hashed (only built pages are scanned). Keep scripts there as modules, which are never inlined.

## Addendum: hosting moved to Cloudflare

After Phase 5, at the owner's request, hosting moved from Vercel to Cloudflare and the Cal.com booking embed was removed (calls are arranged by email). Real content replaced every placeholder. What changed, for anyone continuing:

- **Adapter:** `@astrojs/cloudflare` (one Worker, `monolith`, with static assets; `wrangler.jsonc`). Pages are prerendered as before; `/contact` and `/api/contact` run on demand in the Worker. `html_handling: "drop-trailing-slash"` keeps the no-trailing-slash canonical URLs.
- **Headers:** `_headers` (written at build time) covers static assets; Cloudflare doesn't apply it to Worker responses, so `src/middleware.ts` sets the same headers on the on-demand pages and hashes their inline scripts at run time. The policy lives in one place, `src/lib/security-policy.ts`, so the last note above about unhashed inline scripts on `/contact` no longer applies.
- **Analytics:** Cloudflare Web Analytics (cookieless, injected at the edge). It has no custom events, so `src/lib/analytics.ts` now only raises `monolith:analytics` DOM events; nothing is sent. Speed Insights is replaced by Web Analytics' Core Web Vitals. Item 9 above is moot.
- **Placeholder gate:** strict on Cloudflare builds of `main` (`WORKERS_CI_BRANCH`), or with `STRICT_CONTENT=1`. Builds of other branches send `X-Robots-Tag: noindex`.
- **Local tooling:** `npm run serve:prod` and `npm run test:contact` run the built Worker in workerd through wrangler's `unstable_startWorker`, with Resend mocked. `test:flows` reads the DOM events instead of Vercel's queue.
- **Contact endpoint:** the client IP comes from `cf-connecting-ip`; an oversized body is now drained before the refusal, since workerd otherwise drops the connection.
