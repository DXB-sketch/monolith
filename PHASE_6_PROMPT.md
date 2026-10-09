Read CLAUDE.md and PHASE_5_COMPLETE.md (including its "Addendum: hosting moved to Cloudflare") before doing anything else. Then read docs/BRIEF.md and docs/ART_DIRECTION.md.

You are starting Phase 6: 2D by default, 3D by choice.

Phases 1–5 (plus 2.5) are complete and merged to `main`. The site is a scroll-driven 3D story (Arrival, Face I, Face II, The Lab, The Core) rendered by the persistent WebGL stage in `src/components/SceneStage.astro`, booted by `src/lib/scene-boot.ts` with the tiers in `src/scene/quality.ts`. Content pages use the same persistent canvas with their own camera views (`src/scene/views.ts`). Hosting is Cloudflare Workers. Real content is in place and the strict build passes.

Why this phase exists: on real devices the live scene still struggles on too many phones and laptops, and a laggy showcase hurts a studio that sells performance. The owner has decided:

1. The default experience everywhere is 2D. No WebGL runs unless the visitor asks for it.
2. The home page is redesigned as a 2D landing page whose first job is to sell the studio: who it's for, real work, why one person, process, packages, then a call to action. It must still look award-level.
3. The existing 3D story is kept intact as an opt-in showcase called "See the potential", behind a performance check.
4. The monolith in the 2D hero is not drawn by hand. It is pre-rendered from the real Three.js scene as an image sequence and scrubbed by scroll.

This changes the site's direction, so this phase also updates CLAUDE.md and docs/ART_DIRECTION.md to match. Explain every change to earlier-phase behaviour in the completion file, as CLAUDE.md requires.

---

PHASE 6 GOAL: The site is fast and convincing on every device in 2D by default, with the full 3D story one deliberate click away for devices that can run it smoothly.

By the end of Phase 6:
- A first visit to any page loads no WebGL code: no scene chunk, no GPU-detection worker, no fissure atlas.
- `/` is the new 2D landing page described in Step 5, with the pre-rendered orbit hero.
- `/potential` contains the current 3D story, unchanged in look, behind a gate that benchmarks the device first.
- "See the potential" is in the nav (desktop and mobile menu) and on the Eruption package.
- A visitor who passes the gate and enters 3D keeps 3D mode on content pages for the visit (existing live page views), and can switch back to 2D from the nav at any time.
- The strict build, axe audits, flows and Lighthouse budgets all pass.

---

STEP 1 — Branch and baseline

- Create the branch `phase-6-2d-default` from `main`.
- Run `npm run build` and `npm run serve:prod`. Record Lighthouse mobile scores for `/` before any change, for comparison in the completion file.
- Commit at the end of each step below.

STEP 2 — Experience mode: 2D default, 3D opt-in (`src/lib/scene-boot.ts`, `src/scene/quality.ts`)

Add an experience mode above the existing tier system: `'2d' | '3d'`.

- **Default is `'2d'`.** In 2D mode, scene-boot does none of the following:
  - run `detectTier()` or the WebGL probe worker
  - prefetch the scene chunk
  - fetch the fissure atlas
  - create the canvas context
  
  The tier stays `'poster'` with the recorded reason `experience-2d`.
- **`'3d'` is entered** only when the gate (Step 4) passes and the visitor presses "Enter the stone". Then run the existing pipeline exactly as it works today: tiers, the step-down controller and page views.
- **Persistence:** store the mode in `localStorage` (key `monolith:experience`), wrapped in try/catch. It is only stored as `'3d'` after a passed gate. If storage is unavailable, mode resets to 2D per page load.
- **Test overrides:** `?tier=high|medium|lite` still forces 3D with that tier (needed by `test:flows`, `capture` and `og`). `?tier=poster` forces 2D.
- **Reduced motion, save-data, no WebGL2 or a software renderer:** these always mean 2D, and the gate says why (Step 4).
- **Exit:** a "Back to 2D" control in the nav while in 3D mode. It tears down the scene with the existing `teardownScene()`, clears the stored mode and leaves the page usable without a reload.
- **Content pages in 2D** keep today's poster-tier look: the stage poster with its scrim. Do not build new per-page posters in this phase.
- **On `/` in 2D** the stage poster is not shown. The landing page paints its own basalt background. Hide the stage on the home route with a data attribute rather than removing the persisted element, so ClientRouter navigation to and from `/potential` keeps working.

STEP 3 — Move the 3D story to `/potential`

- Create `src/pages/potential.astro`. Move the current story markup from `src/pages/index.astro` into it unchanged:
  - the `.story` container with its five chapters
  - `<Hud />`
  - the `.plain` "short version" section
  - their styles
- Keep every chapter id, `data-story-anchor`, `data-story-cta` and `data-hud-end`, so `src/lib/story.ts`, `src/scene/story-map.ts` and the camera path work untouched.
- `/potential` always shows its content as real HTML, whether or not 3D is running. Before the gate passes (or if it fails), the page shows the gate panel at the top and the story below it on the poster, exactly as poster-tier visitors see the current home today.
- Give it its own title ("See the potential — Monolith Web Studio") and description, and add it to the sitemap.
- Update anything that assumed the story lives on `/`:
  - `story_progress` analytics now fire on `/potential`
  - deep links (`/#the-lab` becomes `/potential#the-lab`)
  - `scripts/test-flows.ts`, `scripts/audit-a11y.ts`, `scripts/audit-manual.ts`, `scripts/capture-submission.ts`, `scripts/render-og.ts`
- `CHAPTERS` in `src/lib/site.ts` stays as it is; it now describes `/potential`.
- `<Intro />` in `BaseLayout.astro`: if it depends on the scene or the story, show it only on `/potential`. If it doesn't, keep it but make sure it never delays the landing page's hero text. State which in the completion file.

STEP 4 — The gate (top of `/potential`)

A panel (new component `src/components/PotentialGate.astro`) with:

- Eyebrow: `FULL 3D · OPTIONAL · HIGH PERFORMANCE`
- Heading: `See the potential.`
- Body: `This is the Molten Core: a real-time 3D scroll story built at the very top end of what a browser can do. It runs best on a recent laptop, desktop or flagship phone. Before it starts, I'll run a quick check so it only plays where it plays smoothly.`
- A three-row checklist with live status: Graphics support / Loading the scene / Frame-rate test. The frame-rate row has a progress bar.
- Buttons: `Enter the stone` (disabled until the check passes) and `Stay in 2D` (links to `/`).
- Footnote: `If your device doesn't pass, you'll go straight back to 2D. Nothing's wrong with it; this scene is deliberately extreme. 3D stories I build for clients are made much lighter than this one.`

Check logic:

1. **Cheap signals first.** If any of these apply, fail at once with a plain-English reason, and do not load the scene chunk:
   - `prefersReducedMotion()`
   - save-data
   - `detectTierFast()` returns poster
2. **Otherwise:** run `detectTier()`. If the result is `poster` or `lite`, fail. Lite is not offered here: the showcase is only worth showing at Medium or High.
3. **Load the scene chunk and start it** on the persistent canvas at the detected tier, at the Arrival view, behind the gate panel. Hold the dynamic-resolution controller at full scale during the test.
4. **Benchmark for 2 seconds after the first frame.** Measure frame times with rAF timestamps, using `src/scene/gpu-timer.ts` where available.
   - Pass if the median frame time is ≤ 20 ms and the 95th percentile is ≤ 34 ms.
   - Write the thresholds as named constants in `quality.ts`.
5. **If it passes at High but fails, retry once at Medium** before failing.
6. **Pass:** enable the button. Pressing it sets mode `'3d'`, fades the gate out and starts the story.
7. **Fail:** tear the scene down, show the reason (`Your device is better suited to the 2D site.` plus one short line on why), and turn the primary button into `Back to the 2D site`.

General rules for the gate:
- Announce status changes in an `aria-live="polite"` region.
- The whole gate works by keyboard.
- With JavaScript off, show only the explanation and a link back.

STEP 5 — The new 2D landing page (`src/pages/index.astro`)

Rebuild the page as the sections below, in this order. It is static HTML plus light scripts, with no Three.js import anywhere in its graph. Reuse existing components and data where they fit:
- `SERVICES`, `CARE`, `PROCESS`, `SITE`, `CTA` from `src/lib/site.ts`
- `getWork()` / `toProject()` from `src/lib/work.ts`
- `ServiceCard` only if it can match this layout; otherwise write a new `PackageCard.astro`

Use the copy below verbatim unless the data in `site.ts` already says the same thing, in which case read it from `site.ts`.

**Layout system: "strata"**
- Sections alternate two basalt tones. Add `--basalt-2` (≈ #13110F) and `--rule-ember` (≈ #3A2A20) to `tokens.css`, and check contrast for every text colour used on both.
- Each section after the hero overlaps the previous one by 40px. Its top edge is a jagged `clip-path` polygon in percentages, with a matching 1.5px ember polyline drawn by an inline SVG (`preserveAspectRatio="none"`, `vector-effect="non-scaling-stroke"`). Give each section a different polygon.
- The lava thread is a 2px vertical line in the left gutter (`left: clamp(18px, 3vw, 44px)`) running from under the nav to the footer. Each section has a 12px node on the thread.
- Content containers: `max-width` about 1320px, left padding `clamp(48px, 7vw, 112px)` so text clears the thread, and right padding `clamp(20px, 4vw, 64px)`.
- Fluid type with `clamp()`. Use only Sora 200/300/500 and JetBrains Mono 400/500. No new font weights.

**Section 0: Hero** (`id="top"`)

Two columns that wrap to one on narrow screens: copy, then the orbit figure.
- Eyebrow: `CUSTOM WEBSITES · SOUTH EAST QUEENSLAND`
- h1 (Sora 200, with the last two words in 500 and ember): `Your business deserves better than a template.`
- Lead: `I design and build fast, accessible, custom websites for cafés, clubs, tradies, makers and local brands. You deal with me, the person doing the work, from the first chat to well after launch.`
- Buttons: `Start a project` (primary → `CTA.href`) and `See the work` (ghost → `#work`).
- Three facts in a row with a top rule:
  - `From $699` / `LAUNCH SITES`
  - `Under 2 weeks` / `FOR SIMPLER SITES`
  - `2 months` / `OF FREE FIXES`
- Orbit figure (Step 6): aspect ratio 4:5, with thin corner ticks. A mono caption along the bottom reads `SCROLL TO TURN THE STONE` on the left and a live angle readout (`000°`) on the right. The readout is `aria-hidden`; the figure has `alt=""` because it is decorative.

**Section 1: Work** (`id="work"`)
- Eyebrow `01 — WORK`. Heading `Real projects for real local clients.` Link `All case studies →` to `/work`.
- **Lead panel: SEQDVGC.** Full width. Cover image on the left (`src/assets/work/seqdvgc-cover.png` via `astro:assets`, responsive AVIF/WebP). On the right:
  - the label `CLUB WEBSITE · EVENTS + BOOKINGS`
  - the project title from the content entry
  - the entry's summary
  - tags
  - `Read the case study →`
- **Two panels below, side by side:**
  - Allen Gillon (label `MUSICIAN · BRIBIE ISLAND`, from its content entry).
  - Tigers Training Hub (label `WEB APP · FOOTBALL CLUB`, text: `Real software, not a brochure: a training hub web app built for the club's coaches and players.`, link `See the walkthrough →`). Add `src/content/work/tigers-training-hub.md` with `draft: true` and the fields the schema needs. The home page renders this panel only when the entry is published. While it's a draft, Allen Gillon's panel spans the full width. Do not invent screenshots; the owner will add them and flip the draft flag.
- Labels are mono, the rest Sora. Panels have a 1px rule border and a 6px radius.

**Section 2: Why me** (`id="about"`)
- Two columns: a founder photo and copy.
  - Use `src/assets/founder.jpg` if it exists. If it doesn't, leave the photo column out entirely; never show a placeholder box.
- Eyebrow `02 — WHY ME`. Heading: `One person.` followed by `Start to finish.` in weight 500.
- Body: `I'm Dexter, a Bribie Island local who's been building websites for about four years. Monolith is just me, on purpose. No account managers, no hand-offs, no wondering who's actually working on your site.`
- Three rows, each with a name and a line:
  - `You talk to the builder`: `Every question goes straight to the person who can answer it.`
  - `Fast and accessible`: `Built to load quickly on any phone and work for every visitor.`
  - `It's yours`: `After launch everything moves into your ownership, and you can update it yourself.`
- Link `More about me →` to `/about`.

**Section 3: How it works** (`id="process"`)
- Eyebrow `03 — HOW IT WORKS`. Heading `Four steps. No surprises.`
- Four columns from `PROCESS`, numbered 01–04 in ember mono, wrapping to two and then one.
- Mono line under them: `50% to start, 50% after launch. Bank transfer, PayID or card. Payment plans available.`

**Section 4: Packages** (`id="packages"`)
- Eyebrow `04 — PACKAGES`. Heading `Pick a starting point.`
- Three cards from `SERVICES`. Each shows:
  - the package label in mono
  - the name
  - the price
  - the `included` list
  - a button: `Start with Ember`, `Start with Flow`, `Talk about Eruption` → `CTA.href`
- Eruption is the highlighted card, with an ember border and its button primary. Under its list: `Want to see how far it can go? See the potential, a high-performance 3D demo that needs a powerful device. Client builds are made lighter.` Here "See the potential" links to `/potential`.
- Mono line under the cards: `Prefer not to deal with hosting? I can manage hosting and your domain for ` + the price range from `CARE`.

**Section 5: The Core** (`id="the-core"`)
- Centred. An ember glow rises from the bottom edge: a radial gradient made from tokens.
- Eyebrow `05 — THE CORE`. h2 `Forged in fire.` followed by `Built to stand.` (500, ember).
- Body: `Tell me a little about your business and I'll come back to you with ideas, a price and a timeframe. No pressure, no jargon.`
- Buttons: `Start a project` (primary) and the email address as a `mailto:` link.
- Small mono link: `CURIOUS WHAT ELSE I'VE BEEN BUILDING? VISIT THE LAB →` to `/lab`.

**Nav** (`src/components/Nav.astro`)
- Add a pill link `SEE THE POTENTIAL · 3D` with a small ember dot, before `Start a project`, linking to `/potential`. Add the same to the mobile menu.
- In 3D mode the pill reads `BACK TO 2D` and switches modes (Step 2).
- Keep everything Phase 5 fixed for 320px reflow. Below the nav's existing narrow breakpoint, the pill shortens to `3D`, with an `aria-label` of `See the potential, 3D demo`.

**SEO and structured data**
- Home keeps `studio()` JSON-LD.
- Update the home description to match the new hero.
- Regenerate the home OG image (Step 9).

STEP 6 — Pre-rendered orbit (`scripts/render-orbit.ts`, `npm run orbit`)

Render the monolith from the real scene. Do not draw it.

**Capture**
- Reuse the deterministic capture approach from `scripts/capture-submission.ts` and the `/dev/scene` route used by `scripts/render-posters.mjs`: High tier, frozen clock, full resolution scale.
- Add a capture-only camera mode to the dev route: a slow orbit around the stone.
  - Fixed radius and height, framed so the stone fills about 70% of a 4:5 frame, with ground glow and sky visible.
  - Add it as a named path in `camera-path.ts`, used only by capture. Do not change the story's path.
- Frames: 72 at 5° steps covering 360°, with the magma animation advanced at a constant step, so the loop is seamless.

**Output** (in `public/media/orbit/`)
- Desktop: 72 frames at 960×1200, WebP at quality about 72.
- Phone: 36 frames (every other angle) at 640×800.
- Frame 0 also as AVIF for both sizes.
- A manifest JSON with the counts, sizes and file names.
- Budget: desktop set ≤ 2.8 MB total, phone set ≤ 1.0 MB. Lower the quality until both fit, and record the final numbers.

**Playback** (`src/lib/orbit.ts`, loaded after first paint)
- Frame 0 is a normal `<picture>` in the hero. It may be the LCP image, but the h1 must still paint first. Give it width and height so there's no CLS.
- After `load`, during idle time, fetch the remaining frames. Skip this when `saveData`, `prefersReducedMotion()` or `navigator.connection.effectiveType` is 2g or 3g; those visitors keep frame 0.
- Decode with `createImageBitmap` and draw to a `<canvas>` overlaying the picture (2D context, sized to the figure at device pixel ratio capped at 2).
- Drive the frame index with ScrollTrigger `scrub`:
  - Desktop (≥ 900px wide): pin the hero for one viewport of scroll while the stone turns 180°.
  - Below 900px: no pin, and the stone turns 90° as the hero scrolls out.
- Show the nearest loaded frame until the exact one arrives, and update the angle readout.
- Pause all work when the figure is off-screen. Free the bitmaps on `astro:before-swap`.

STEP 7 — Motion (`src/lib/landing.ts`, loaded after first paint)

GSAP, ScrollTrigger and Lenis are already in the project. Animate only `transform`, `opacity` and `clip-path`.

- **Lava thread:** an ember fill layer over the dim thread, scaled on Y with the page's scroll progress (`transform-origin: top`). Each section's node gains the glow class when its section reaches 40% of the viewport.
- **Section entrances:** reuse `src/lib/reveal.ts` (`data-reveal`, `data-reveal="lines"`) rather than writing new reveal code.
- **Work panels:**
  - On pointer devices, a slight tilt (max 3°) and an ember glow that follows the cursor. Set it via CSS custom properties `--mx`/`--my` from one delegated `pointermove`, throttled to rAF.
  - No tilt on touch devices or with reduced motion.
- **The Core:** the glow's opacity rises with scroll as the section enters.
- **Reduced motion:** no pin, no scrub, no tilt. The thread shows fully lit, and reveals show their final state.

STEP 8 — Eruption copy

In `src/lib/site.ts`, change Eruption's third `included` line to: `Optional 3D, tuned to run smoothly on everyday phones, with a lighter fallback built in`.

On `/services`, under the Eruption card, add the same "See the potential" note used on the home page. On `/services` it carries one more sentence: `The Molten Core scene is a showcase at the very top end of browser performance, so it needs a powerful device.`

STEP 9 — Docs, tests, audits and assets

- **CLAUDE.md:** rewrite job 1 under "What this project is" to describe 2D by default, with the 3D story as an opt-in showcase at `/potential`. Add the experience mode to the non-negotiables, including that no WebGL runs without the visitor's choice. Add `npm run orbit` to the working notes.
- **docs/ART_DIRECTION.md:** add a "2D landing (strata)" section covering the strata edges, the lava thread, the orbit hero and the rule that the stone image always comes from the real scene.
- **docs/PHASES.md:** add Phase 6.
- **Tests and audits:**
  - Update `test:flows`, `audit:a11y` and `audit:manual` for the new home and `/potential`.
  - Add flows that check the gate: forced pass via `?tier=high`, and forced fail via `?tier=poster`.
  - Add a flow that checks the home route requests no scene chunk, atlas or worker.
- **Assets:** run `npm run og`, `npm run posters` (unchanged) and `npm run capture`. The capture recording now starts on `/potential`; add home-page screenshots at 1440 and 390.
- **Builds:** run `npm run build` and the strict build (`STRICT_CONTENT=1`).

---

ACCEPTANCE CRITERIA FOR PHASE 6

[ ] First visit to `/`, `/work`, `/services`, `/about`, `/lab`, `/contact`: the network log shows no scene chunk, no fissure atlas and no WebGL worker
[ ] `/` matches Step 5 section by section, with the copy verbatim, and only the Tigers panel hidden while its entry is a draft
[ ] The orbit hero scrubs smoothly in Chromium on desktop (pinned, 180°) and on phone width (unpinned, 90°); frame 0 alone shows with reduced motion or save-data
[ ] Orbit asset budgets are met (desktop ≤ 2.8 MB, phone ≤ 1.0 MB), and frames load only after `load`
[ ] Lighthouse mobile for `/`: Performance ≥ 95, LCP < 2.5 s, CLS < 0.02, TBT < 150 ms; Accessibility, Best Practices and SEO all 100
[ ] Home initial JS (excluding the lazily loaded landing and orbit scripts) stays under the 100 KB gz budget; the size is recorded
[ ] `/potential` shows the gate. `?tier=high` passes and "Enter the stone" starts the unchanged story. `?tier=poster` fails with a clear reason and a working link back
[ ] After entering 3D, navigating to `/work` shows the live page view; "Back to 2D" stops the scene without a reload; and the choice survives a reload
[ ] Nav pill works on desktop, in the mobile menu, at 320 px reflow and by keyboard; its label changes in 3D mode
[ ] Eruption copy is updated on `/` and `/services` and includes the "See the potential" note
[ ] All text passes WCAG 2.2 AA contrast on both basalt tones; the strata edges and thread are `aria-hidden`
[ ] Reduced motion: no pin, no scrub, no tilt; all content visible
[ ] No-JS: the home page is complete and readable; `/potential` shows the explanation, the story content and a link back
[ ] `npm run audit:a11y`: 0 violations; `npm run test:flows` (Chromium): all pass, 0 CSP violations, 0 console errors
[ ] No hardcoded hex values in any new or modified component (tokens only; shader colours stay in `palette.ts`)
[ ] No new dependencies
[ ] `npm run build` and `STRICT_CONTENT=1 npm run build` complete without errors

---

WORKING NOTES

- **Do not change the 3D scene itself:** no changes to shaders, tiers' settings, the story camera path or chapter states. The only scene-side additions are the capture-only orbit path and the gate's benchmark hook. If something there seems to need changing, stop and explain why in the completion file instead.
- **The persisted stage must survive navigation** between `/` (stage hidden), content pages (poster) and `/potential` (live). Test the round trip home → potential → enter → work → home → potential.
- **CSP:** the orbit and landing scripts are modules from `/_astro/`, so no policy change should be needed. `createImageBitmap` on same-origin images needs nothing new. If the policy refuses anything, fix the code, not the policy.
- **The placeholder gate** flags square brackets in built HTML. The new home uses no bracketed placeholders: missing assets (founder photo, Tigers screenshots) mean the element is left out, not shown as a box.
- **Honesty rules** still apply. Use no invented metrics, quotes or awards. "Award-level" may describe the craft but must never imply an award has been won.
- **Lighthouse here measures software rendering.** That's fine for this phase: the home page has no WebGL. Measure the orbit scrub's frame pacing with the existing `?fps` overlay and record it.
- **Sora** is self-hosted at 200/300/500 only. Where the mockup suggested 400, use 300 for body and 500 for emphasis.

When Phase 6 is complete, write PHASE_6_COMPLETE.md at the project root covering:
- what was built
- deviations from this spec and why
- every earlier-phase behaviour that changed
- the before and after Lighthouse numbers for `/`
- the orbit asset sizes
- what the owner still has to supply: the founder photo, Tigers screenshots plus flipping its draft flag, and the ABN
- what Phase 7 needs to know (the planned "style studies" Lab entry is next)
