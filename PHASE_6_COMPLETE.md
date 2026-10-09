# Phase 6 complete: 2D by default, 3D by choice

The site is now 2D by default everywhere. **No WebGL runs unless the visitor asks for it.**

- **Home.** `/` is a new 2D landing page. Its first job is to sell the studio: who it's for, real work, why one person, the process, packages, then a call to action. It uses the "strata" layout, and its hero stone is pre-rendered from the real Three.js scene and turned by scroll.
- **The 3D story.** It now lives, unchanged, at `/potential` ("See the potential"), behind a gate that checks the device first. A visitor who passes and enters keeps 3D for the visit: live page views on content pages, remembered across reloads. "Back to 2D" in the nav leaves 3D at any time, without a reload.

Unlike earlier phases, this phase was built and measured on the owner's Windows machine, which has a real GPU. So:
- **Lighthouse "before" numbers** include the live scene loading during the run, which is why they're poor.
- **Benchmark pass.** The gate's real benchmark was exercised on that GPU: it passed at High, at about 60 fps.
- **Fixed-tier tests.** The scripted flows and audits still force SwiftShader (as in Phase 5), so they test the gate's fail path and the forced (`?tier=`) paths.

Branch: `phase-6-2d-default` (from `main`), one commit per step. Nothing was merged or deployed.

---

## What was built

### Step 2: the experience mode (`src/lib/scene-boot.ts`, `src/scene/quality.ts`)

**The mode.** `'2d' | '3d'` sits above the tiers.
- **2D is the default.** The tier settles on the poster at once, with the reason `experience-2d`.
- **What 2D never does:**
  - run `detectTier()` or the probe worker
  - prefetch the scene chunk
  - fetch the fissure atlas
  - create a canvas context
- **The check.** Every such path is gated by `sceneAllowed()` and the `pending` flag. The `no webgl` flow checks the network log of six first visits.

**Entering 3D.** `enterExperience()` runs only after a passed gate. Then the existing pipeline runs exactly as before:
- the tier cache
- the GPU check
- the step-down controller
- page views

**Persistence.**
- The mode is stored in `localStorage` as `monolith:experience`, written only as `'3d'` and only after a passed gate. Every access is wrapped in try/catch, so with storage blocked it's 2D on every page load.
- An inline script marks `html[data-experience]` and `html[data-entered]` before first paint, so the nav pill never flips after paint. `scene-boot` then owns both attributes and stamps them across ClientRouter swaps.

**Overrides.**
- `?tier=high|medium|lite` forces 3D at that tier, for tests, captures and the OG images.
- `?tier=poster` forces 2D.
- Reduced motion and save-data always mean 2D.
- No WebGL2 or a software renderer: the gate says why and fails (Step 4). If a stored 3D visit lands on such a device, the 3D pipeline settles on the poster, which leaves 3D and clears the stored choice.
- Reduced motion switched on mid-visit leaves 3D but keeps the stored choice: it overrides the choice only while it lasts.

**Exit.**
- `exitExperience()`, from "Back to 2D" in the nav, tears the scene down with the existing `teardownScene()`, clears the stored mode and leaves the page usable.
- Focus moves to the "See the potential" link that replaces the button.
- On `/potential` the gate panel returns, with a "Run the check" button.

**The stage on `/`.**
- `BaseLayout` takes `stage={false}`, which renders `<html data-stage="hidden">`. The persisted stage stays in the DOM, so ClientRouter navigation to and from `/potential` keeps working. The landing page paints its own basalt.
- When `/` is the first page of a visit, the stage's poster `<img>` is `loading="lazy"`, so the hidden stage downloads nothing. It loads when a page that shows it arrives.

**Content pages in 2D** look exactly as poster-tier pages did: the stage poster with its scrim.

**Scene-side additions** (the only ones):
- **The gate's benchmark hooks** on the scene handle:
  - `holdController(hold)`: no resolution, extras, haze or tier changes while held, at full scale
  - `measureFrames(ms)`: intervals between rendered frames, from rAF timestamps
- **The capture-only orbit:**
  - `capture.orbit` and `captureFrame(time, degrees)` in `src/scene/index.ts`
  - `ORBIT_CAPTURE` and `orbitCaptureAt()` in `src/scene/camera-path.ts`

Shaders, tier settings, the story camera path and chapter states are untouched.

### Step 3: the 3D story at `/potential`

**The move.** `src/pages/potential.astro` holds the story markup, `<Hud />`, the "short version" section and their styles, moved from the old `index.astro` unchanged. Every chapter id, `data-story-anchor`, `data-story-cta` and `data-hud-end` is kept, so `story.ts`, `story-map.ts` and the camera path work untouched.

**The page.**
- Title: "See the potential — Monolith Web Studio", with its own description and OG image (`og/potential.jpg`).
- It's in the sitemap automatically.

**What moved with it.**
- `story_progress` now fires on `/potential`; verified in the flows: `{"chapter":"the-core","index":4}`.
- Deep links are `/potential#the-lab`.
- `CHAPTERS` is unchanged and now describes `/potential`.

**`<Intro />` now shows only on `/potential`.** It depends on the scene: it opens on `monolith:scene-ready` or `monolith:poster` and exists to reveal the stone. So it never covers the landing page's hero text. Its once-per-session, direct-visit-only rules are unchanged.

### Step 4: the gate (`src/components/PotentialGate.astro`, `src/lib/gate.ts`)

**The panel.** It uses the copy from the spec verbatim:
- the eyebrow, the heading, the body and the footnote
- a three-row checklist with live status (Graphics support, Loading the scene, Frame-rate test), the last with a progress bar
- `Enter the stone`, disabled until the check passes
- `Stay in 2D`, linking to `/`

**The check.**
1. **Cheap signals first,** each failing at once with a plain reason and nothing downloaded:
   - reduced motion
   - save-data
   - `detectTierFast()` returning the poster
2. **`detectTier()`.** The poster fails (no WebGL 2, or a software renderer, each with its own line), and so does Lite.
3. **The scene starts** on the persistent canvas behind the panel, at the detected tier and the Arrival view, with its controller held at full scale.
4. **Two seconds of frame times** are measured once every layer is in (see Deviations). The verdict combines the rendered-frame intervals with the GPU's own frame time from the gpu-timer, where the extension exists. It passes if the median is ≤ 20 ms and the 95th percentile ≤ 34 ms.
   - The constants live in `quality.ts`: `GATE_MEDIAN_MS`, `GATE_P95_MS`, `GATE_BENCHMARK_MS`.
   - The verdict logic is `judgeFrames()`, also in `quality.ts`.
5. **High failing retries once at Medium.**
6. **Pass:** the button is enabled. Pressing it fades the panel out and hides it. Then the page returns to the top, 3D mode starts and is stored, the session's tier cache is written (ceiling = the passed tier), and focus moves to the story's heading.
7. **Fail:** the scene is torn down. The panel shows "Your device is better suited to the 2D site." with a one-line reason, and `Back to the 2D site` replaces the primary button.

**Behaviour.**
- Every status change is announced in an `aria-live="polite"` region.
- The whole gate works by keyboard, checked by `audit:manual`.
- Without JS, only the explanation and the way back show; the story below is plain HTML either way.
- On a real GPU (this machine) it passed at High at about 60 fps.
- The verdict is logged to the diagnostics as `gate verdict`, visible with `?fps` or `?debug`.

### Step 5: the 2D landing page (`src/pages/index.astro`)

The sections are those of the spec, in order, with its copy verbatim. Data comes from `site.ts` and the content entries where they already say the same thing:
- "From $699" is derived from `SERVICES[0].price`.
- The process comes from `PROCESS`, the packages from `SERVICES`, the hosting price from `CARE.price`.
- The Work panels' titles and summaries come from the content entries.

**Strata.**
- **Tokens.** `--basalt-2` (#13110F) and `--rule-ember` (#3A2A20) were added to `tokens.css`, and mirrored in `palette.ts` as UI-only keys.
- **Tones.** Sections alternate the two basalt tones.
- **Edges.** Each section after the hero overlaps the one above by 40px along its own jagged edge. The same points (x %, y px) draw the `clip-path` on the section's background layer and the 1.5px ember polyline. The SVG uses `preserveAspectRatio="none"` and `vector-effect="non-scaling-stroke"`, and sits outside the clipped layer so the stroke isn't cut in half.
- **The lava thread** runs at `left: clamp(18px, 3vw, 44px)`, from under the nav to the footer, with a 12px node per section.
- **Containers** are 1320px wide, padded `clamp(48px, 7vw, 112px)` / `clamp(20px, 4vw, 64px)`.
- **Type** uses only Sora 200/300/500 and JetBrains Mono 400/500, with fluid `clamp()` sizes.
- **Decoration.** Edges, the thread and the nodes are all `aria-hidden`.

**The sections.**
- **Hero.**
  - Two columns, wrapping on narrow screens.
  - The h1 is Sora 200 with "a template." in 500 and lava.
  - Three facts sit under a top rule.
  - The 4:5 orbit figure has corner ticks and a mono caption with the live readout (`aria-hidden`); the image's `alt` is empty.
  - On desktop the copy is sized to the viewport height, since the hero is pinned for a viewport.
- **Work.**
  - The SEQDVGC lead panel, with its cover through `astro:assets` (AVIF/WebP, responsive), the label, title, summary and tags, and "Read the case study →".
  - Allen Gillon below it.
  - Tigers Training Hub renders only when its entry is published. It is a draft, so Allen Gillon spans the full width.
  - Panels have a 1px `--rule-ember` border and a 6px radius.
  - The repeated "Read the case study" links carry the project name for screen readers.
- **Why me.** No founder photo exists yet, so the photo column is left out entirely; `src/assets/founder.jpg` will appear by itself once added. There are three reasons and "More about me →".
- **How it works.** Four columns from `PROCESS`, wrapping to two and then one, with the payment line.
- **Packages.** A new `PackageCard.astro`; `ServiceCard` leads with the description and has no button.
  - Eruption is highlighted: an ember border and the primary button.
  - The "See the potential" note sits under Eruption's list.
  - The hosting line closes the section.
- **The Core.** Centred, with the token-made ember glow, both buttons and the Lab link.

**Draft entry.** `src/content/work/tigers-training-hub.md` has `draft: true` and the fields the schema needs. Unknowns are bracketed placeholders, and the cover is the existing placeholder image. Drafts are excluded from production builds, so the placeholder gate never sees it.

**Nav.**
- The pill reads `SEE THE POTENTIAL · 3D`, with an ember dot, before Start a project. It appears in the bar and in the mobile menu, and reads `BACK TO 2D` in 3D mode.
- Its `aria-label` is "See the potential, 3D demo"; in 3D mode it's "Back to 2D".
- Breakpoints had to change to fit it; see "Earlier-phase behaviour that changed".

**SEO.**
- Home keeps `studio()` JSON-LD.
- New description: "Custom websites for South East Queensland businesses: fast, accessible and designed for you, from $699. One person, Dexter, from the first chat to well after launch."
- The OG image was regenerated with the new headline.

### Step 6: the pre-rendered orbit (`scripts/render-orbit.ts`, `npm run orbit`, `src/lib/orbit.ts`)

**Capture.** It reuses the poster tooling's deterministic capture on `/dev/scene`:
- High tier, frozen clock, full scale.
- A new `&orbit` mode with `window.__orbitFrame(time, degrees)`.
- The camera follows `ORBIT_CAPTURE`: fixed radius (42.5) and height. The stone fills about 70% of the 4:5 frame, with the lava's ground glow below and the sky above.
- 72 frames at 5° steps; the magma advances a constant 0.1 s per frame.

**Output** (`public/media/orbit/`):

| Set | Frames | Size | WebP quality | Total |
|---|---|---|---|---|
| Desktop | 72 × 960×1200 | | **q68** (q72 was 2.82 MB, over budget) | **2.66 MB** (budget 2.8) |
| Phone | 36 × 640×800 (every other angle, downscaled from the desktop renders) | | **q72** | **0.80 MB** (budget 1.0) |
| Frame 0 AVIF | desktop 24 KB, phone 14 KB | | | |

The manifest is `orbit.json`. `index.astro` imports it at build time, so the frame list needs no extra request.

**Playback.**
- **When it loads.** `orbit.ts` loads after first paint. Frames are fetched only after `load`, at idle, and not at all with save-data, reduced motion or 2g/3g; those visitors keep frame 0.
- **The still.** Frame 0 is a normal `<picture>` with width and height, so there's no CLS.
- **Fetch and decode.** Frames are fetched coarse to fine, so any angle soon has a near neighbour, and decoded with `createImageBitmap`, one per idle callback (see Performance). They're drawn to a 2D canvas over the picture, at the figure's size and DPR capped at 2.
- **The scrub.** A ScrollTrigger scrub drives it:
  - ≥ 900px: the hero pins for one viewport while the stone turns 180°.
  - Below 900px: no pin, and the stone turns 90° as the hero scrolls out.
- **Gaps.** The nearest loaded frame shows until the exact one arrives, and the readout follows the frame shown.
- **Lifecycle.** Nothing is drawn, fetched or decoded while the figure is off screen. Bitmaps are closed on `astro:before-swap`.

### Step 7: motion (`src/lib/landing.ts`)

- **The lava thread.** Its lit layer scales on Y with the page's scroll progress (`transform-origin: top`). Each node lights (opacity-only pseudo-elements) as its section's top passes 60% down the viewport, so 40% of it is showing.
- **Entrances** reuse `reveal.ts` (`data-reveal`, `data-reveal="lines"`).
- **Work panels.** On fine pointers only: a tilt of at most 3° and an ember glow under the pointer. Both come from `--mx`/`--my`, set by one delegated, rAF-throttled `pointermove`.
- **The Core's glow** rises in opacity with scroll as the section enters.
- **Only transform, opacity and clip-path are animated.**
- **Reduced motion:** no pin, no scrub, no tilt; the thread is fully lit and reveals show their final state. `audit:manual` checks it.

### Step 8: Eruption copy

- **`site.ts`.** Eruption's third line is now "Optional 3D, tuned to run smoothly on everyday phones, with a lighter fallback built in". It shows on `/`, `/services` and the `/potential` story's Core chapter.
- **`/services`.** The Eruption card carries the "See the potential" note plus the extra sentence. `ServiceCard` gained a default slot for it.

### Step 9: docs, tests, audits, assets

- **`CLAUDE.md`:**
  - job 1 rewritten (2D by default, the 3D showcase at `/potential`)
  - a new "Experience mode" non-negotiable (no WebGL without the visitor's choice)
  - `/potential` in the project structure
  - `npm run orbit` in the working conventions
- **`docs/ART_DIRECTION.md`:** a "2D landing (strata)" section covering the strata edges, the thread, the orbit hero and the rule that the stone image always comes from the real scene. It also adds the two new tokens and notes that the scroll story now lives at `/potential`.
- **`docs/PHASES.md`:** Phase 6 added. The stale "deploy preview on Vercel" line now says Cloudflare.
- **Tests and audits:** results below.
- **Assets:**
  - `npm run og` rendered 14 images, including `potential.jpg`.
  - `npm run posters` re-rendered with the scene unchanged: visually identical, though the bytes differ with this machine's encoder.
  - `npm run capture` now records the story on `/potential` and adds home screenshots at 1440 and 390.

---

## Earlier-phase behaviour that changed

| What | Before | Now, and why |
|---|---|---|
| Home page | The 3D scroll story | The 2D landing page. The story moved unchanged to `/potential` (the phase's purpose). |
| Default tier everywhere | GPU check after first paint, scene chunk prefetched, live scene where the GPU allows | The poster with reason `experience-2d`, and no WebGL code runs. The 3D pipeline is unchanged, but runs only in 3D mode. |
| A 3D-mode device that ends on the poster | Stayed on the poster | Leaves 3D mode and clears the stored choice, so the nav stops offering "Back to 2D" when there's no 3D. Reduced motion is the exception: it leaves 3D without forgetting the choice. |
| Session tier cache | Written by the GPU check and the controller | Also written at "Enter the stone", with the passed tier as the ceiling, so 3D never upgrades into a tier that failed the benchmark. |
| `<Intro />` | Direct visits to `/` | Direct visits to `/potential` only. It waits for the scene, so it belongs to the story. |
| Content-page reveals | Poster tier: simple fades; live tiers: line reveals | Line reveals in 2D too. The poster used to mean a weak device; now it's the default for almost everyone, and the reveals cost no WebGL. Reduced motion still never mounts them. |
| Stage | Visible on every page | Hidden on `/` (`html[data-stage="hidden"]`). Its poster is lazy when `/` is the first page. |
| Nav | Collapsed below 52rem; bar max 52rem | Collapses below **64rem**, and the bar is max **66rem**, to fit the new pill. Between 64rem and 80rem the pill shows as "3D". From 26rem down, the existing 320px compaction (smaller wordmark and CTA, tighter gaps) applies, and the Menu button shows only its icon; its name is still "Menu". Below 23rem the pill is in the menu only. Phase 5's 320px fixes are kept, and reflow passes at 320. |
| `ServiceCard` | No slot | A default slot and one more grid row, for the Eruption note on `/services`. |
| Eruption, third line | "Tuned to run smoothly on phones, with a fallback for older devices" | The Step 8 copy. |
| Concept entry (draft) | `order: 3` | `order: 4`, so Tigers Training Hub takes 3. |
| Analytics | `story_progress` on `/` | On `/potential`. `posterReason()` gained the `experience-2d` and `gate` categories, so 2D visits aren't counted as weak devices. |
| Home OG image | "Forged in fire. Built to stand." | The new headline. `/potential` has its own. |
| Scene | — | The benchmark hooks and the capture-only orbit (Step 2). Nothing a visitor sees in the 3D story changed. |
| `render-posters.mjs` | Default 30 s screenshot timeout | 300 s: the 1080×2160 portrait poster on SwiftShader took longer than 30 s on this machine. |
| Submission README | Home chapters | `/potential` chapters, plus the 2D home screenshots. |

---

## Deviations from the spec, and why

- **The h1's "ember" words are `--lava`, not `--ember`.** As text, `--ember` (#8E3214) is about 2.5:1 on basalt and fails WCAG AA. The art direction's accent phrase is lava, which is 6.4:1.
- **The panel "tags" are derived from the entry.** The work schema has no tags field, so they're the project's client type, year and decision areas (for example "Sporting club · 2026 · Design"). All are real facts from the entry.
- **The benchmark starts once every layer is in (L6),** within 8 s of the first frame, not exactly at the first frame. L2–L6 fade in over about 2.2 s after the first frame. Measuring from the first frame would mostly measure L1 alone, too cheap, and would pass devices that then struggle.
- **Forced tiers (`?tier=high|medium|lite`) pass the gate without the frame-rate test.** That row shows "Skipped: tier forced". Tests and captures must be deterministic on a software renderer. Graphics and loading still run for real at the forced tier.
- **The gate runs automatically when `/potential` loads.** The visitor chose to go there, and the spec's copy says "Before it starts, I'll run a quick check".
  - After "Back to 2D" on `/potential`, the check doesn't restart by itself: a "Run the check" button (copy not in the spec) offers it.
  - The auto-run is why Lighthouse scores `/potential` lower (below).
- **The orbit fetches only the frames the scroll can reach.** That's 37 of 72 on desktop (0–180°) and 10 of 36 on a phone (0–90°), about 1.4 MB and 0.2 MB, rather than every frame. All 72 are rendered and shipped, so the sweep can grow later without a re-render.
- **The loop isn't perfectly seamless at 355° → 0°.** The magma shaders aren't periodic in time, and changing them was out of scope. The seam is never reached by scrolling (the sweeps are 180° and 90°), and each frame steps the magma only 0.1 s.
- **The orbit was rendered with the GPU** (`CHROMIUM_ARGS="--enable-gpu --use-angle=d3d11"`) rather than SwiftShader, for speed. The capture is deterministic either way, and the script defaults to SwiftShader, like the posters.
- **The panels and cards on the landing page use a 6px radius,** as the spec says, against the art direction's 2px maximum. It's documented there as the landing's exception.
- **Lenis isn't used on the landing page.** Native scrolling with ScrollTrigger is lighter, and Lenis remains the 3D story's.
- **In 3D mode the nav doesn't link to `/potential`,** because the pill becomes "Back to 2D", as specified. The way back to the story in 3D is the Eruption notes on `/` and `/services`.
- **Two h1s on `/potential` while the gate shows:** "See the potential." on the gate, and the story's own heading, which had to stay unchanged. Once 3D is entered, the gate is gone.
- **The nav breakpoints changed** to fit the pill (table above). Below 23rem (368px) the pill is in the menu only, since the bar has no room left at 320–360px.

---

## Measurements

### Lighthouse, `/`, before and after

Three runs each, median, against `npm run serve:prod` (brotli, production headers), Lighthouse 12, Moto G Power emulation, simulated slow 4G. This machine has a GPU, so before Phase 6 the live scene loaded during the run.

| | Perf | A11y | BP | SEO | LCP | TBT | CLS |
|---|---|---|---|---|---|---|---|
| **Before**, mobile (Phase 5 home: the story) | 72 | 100 | 100 | 100 | 1.88 s | 1,544 ms | 0.014 |
| **After**, mobile (2D landing page) | **98** | **100** | **100** | **100** | **2.05 s** | **63 ms** | **0.012** |
| Before, desktop | 87 | 100 | 100 | 100 | 0.70 s | 291 ms | 0.008 |
| After, desktop | LH_D_HOME |

The first "after" build scored 87 (TBT 458 ms). The orbit decoded every arriving frame in one microtask burst, a 130 ms task (×4 in Lighthouse's CPU model). With the frames decoded one per idle callback and no redundant ScrollTrigger refreshes, it scores 98. Without the orbit at all it scored 98 with 10 ms of TBT, so the orbit now costs almost nothing.

### Lighthouse, other pages (mobile, after)

LH_TABLE

### Sizes

| | |
|---|---|
| Home initial JS (gz), excluding the lazily loaded landing and orbit scripts | **16.6 KB** (budget 100 KB) |
| Landing + orbit scripts, after first paint (gz) | about 45 KB, mostly the GSAP chunk shared with the reveals |
| `/potential` initial JS (gz) | 18.4 KB (the gate adds 1.8 KB) |
| Content pages initial JS (gz) | 16.0–16.6 KB |
| Scene chunk (gz), only after a passed gate or in 3D mode | 152.8 KB + layers 20.7 KB (unchanged) |
| Orbit assets | Desktop 2.66 MB / 72 frames (37 used), phone 0.80 MB / 36 frames (10 used), frame-0 AVIF 24 KB / 14 KB |

### Orbit scrub frame pacing (`?fps`, Chromium)

PACING

### Contrast (WCAG 2.2 AA) on both basalt tones

| Text colour | on `--basalt` | on `--basalt-2` |
|---|---|---|
| `--bone` | 16.35 | 15.51 |
| `--ash-soft` | 11.58 | 10.98 |
| `--ash` | 8.72 | 8.27 |
| `--lava` (accent words, mono numbers, links' arrows) | 6.37 | 6.04 |
| `--lava-hot` (link hover) | 11.06 | 10.49 |

Primary buttons (basalt text on lava) are 6.37. axe found no contrast violations in any mode.

### Tests and audits

| | Result |
|---|---|
| `npm run test:flows` (Chromium, desktop and phone) | **18/18**, 0 CSP violations, 0 console errors. Flows: no webgl, tiers, gate pass, gate fail, story, deep link, round trip (2D and 3D), contact, lab |
| `npm run audit:a11y` | **124 audits, 0 violations**, 0 CSP, 0 console errors. Modes: high, lite, 2d, static, no-JS; desktop and phone; `/potential` at its gate and inside the story |
| `npm run audit:manual` | **All checks pass:** reflow at 320, 200% zoom, text spacing, keyboard (incl. the gate and the nav pill in the bar and the mobile menu), link text, reduced motion, no-JS, forced colours |
| `npm run build` / `STRICT_CONTENT=1 npm run build` | STRICT |
| Hardcoded hex in new or modified components | None (tokens only; shader colours stay in `palette.ts`) |
| New dependencies | None. Lighthouse was run through `npx`, not added to the project. |

**Firefox and WebKit:** not run. As in Phase 5, they aren't installed here. The suite supports them unchanged (`BROWSER=firefox|webkit`).

---

## What the owner still has to supply

1. **Founder photo.** Save it as `src/assets/founder.jpg`. The "Why me" section shows it automatically; until then the photo column is left out, not shown as a box.
2. **Tigers Training Hub.**
   - Add the screenshots (and the walkthrough) to `src/content/work/tigers-training-hub.md`: its cover, gallery and the bracketed client name, year, challenge and decisions.
   - Then remove `draft: true`. Its home-page panel ("See the walkthrough →") and case study appear on the next build. The placeholder gate fails a production build while any bracket remains.
   - Re-run `npm run og` once its title or content is final.
3. **ABN.** Set `SITE.abn` in `src/lib/site.ts`; the footer shows it once set.

## What Phase 7 needs to know

The planned "style studies" Lab entry is next.
- **Lab entries.** Add one to `src/content/lab/`. Lab pages are content pages: in 2D they show the poster (no WebGL); in 3D mode their live view runs.
- **Interactive demos** (`demo:` in the entry, `src/lab/demos.ts`) still wait for the tier to settle, so in 2D they show their still. A demo that should run in 2D would need its own opt-in. Nothing may start WebGL without the visitor's choice.
- **New pages default to 2D.** Use `stage={false}` only for pages that paint their own full background, as the landing page does.
- **After any change to the scene's look,** re-run `npm run orbit` (dev server running), `npm run posters` and `npm run og`. The orbit's framing is `ORBIT_CAPTURE` in `camera-path.ts`.
- **Gate thresholds and tiers** are `GATE_*` in `quality.ts`. The verdict and its numbers are in the diagnostics (`?fps` → Load).
- **`FLOWS=…` filter.** `npm run test:flows` takes `FLOWS=gate pass,round trip` to run a subset.
- **Real-device check before launch:** the gate on a mid-range phone (it should fail politely) and on a recent laptop (it should pass), and the orbit scrub on an iPhone (Safari) and an Android phone.
