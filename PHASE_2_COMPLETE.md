# Phase 2 complete: The scroll story

## What was built

**Step 1 — housekeeping and the fps overlay**
- `engines.node` is pinned to `22.x`.
- `?fps` on any page loads `src/lib/fps-overlay.ts` with a dynamic import. It shows:
  - the tier, and whether the scene is live, resting or showing the poster
  - average fps and 95th-percentile frame time over the last 120 frames
  - the effective DPR (device DPR capped by the tier)
- It survives ClientRouter navigations. Without the parameter the chunk is never requested; the only cost is a one-line `URLSearchParams` check in the layout script.

**Step 2 — scroll infrastructure** (`src/lib/scroll.ts`)
- One Lenis instance, `autoRaf: false`, driven from `gsap.ticker` (`lenis.raf(time * 1000)`), with `gsap.ticker.lagSmoothing(0)` and `lenis.on('scroll', ScrollTrigger.update)`.
- `syncTouch: false`: wheel and trackpad are smoothed, touch scrolling stays native.
- `ScrollTrigger.config({ ignoreMobileResize: true })`. Chapter heights use `lvh`, so the mobile address bar never changes them.
- No Lenis with reduced motion, tier Off or tier Low; ScrollTrigger reads native scroll there.
- **Lifecycle:** `scene-boot.ts` mounts the story on `astro:page-load` when the page has `[data-story]` (home only) and the tier is known. On `astro:before-swap` it unmounts the story, which:
  - reverts the GSAP context and kills the SplitText tweens
  - kills every ScrollTrigger
  - destroys Lenis and removes its ticker callback
  - removes the click and focus listeners
  - removes `motion-ready`

**Step 3 — story layout** (`src/pages/index.astro`)
- Chapters 00–04 sit in one `.story[data-story][data-scene-anchor]` container. The scene renders while any of it is on screen and pauses (and dims) at the plain section and beyond.
- **Heights (only with JS and no reduced-motion preference):**
  - Chapters 01–03 are `min-height: 150lvh`.
  - The Core is 25lvh of padding, then the services block, a 120lvh dive stretch, and the CTA block with 30lvh below it (about 220lvh plus content).
- Without JS, or with reduced motion, the story is compact, so nobody scrolls through empty space past a static image.
- **Placement:** content is normal flowing HTML, on the side opposite the face in view:
  - Face I, The Lab: left
  - Face II, The Core: right
- **Portrait:** content flows full width and its anchor puts the content top at mid-screen. The portrait framings place the stone in the upper half.
- **Panels:** chapter copy is on obsidian panels. Chapter eyebrow labels have an 82% basalt backing, so lava behind them never washes them out.

**Step 4 — camera path** (`src/scene/camera-path.ts`)
- **Orbit (00–04):** in cylindrical coordinates around the monolith: angle (one direction, front-left → left → back → right → front), radius and height. Target height, lateral offset, depth and FOV are blended separately. Landscape and portrait framings are blended by aspect ratio.
- **Dive:** only the Chapter 04 dive uses a spline (centripetal Catmull-Rom from the Core framing into the core vein).
- **Clearance:**
  - Orbit: at least 6 m from the stone's bounding box (radius pushed outward if needed).
  - Dive: at least 0.3 m.
  - Ground: at least 1 m above `terrainHeight()`.
  - The near plane follows clearance: `0.4 × clearance`, clamped to 0.03–0.5 m.
- **Story map** (`src/scene/story-map.ts`): chapter anchors in progress space come from the real layout, measured in `story.ts` on every ScrollTrigger refresh (never in the render loop). `setProgress(p)` maps through them, with a hold at each chapter (18% of each gap) and smootherstep travel between.
- **Damping:** exponential smoothing on the camera's progress, rate 7/s: weight without fighting Lenis. Idle drift is kept and fades out during the dive.
- **Check:** `npm run check:camera` (`scripts/check-camera-path.ts`) samples 4,000 points across the story at four aspect ratios and fails on clipping, ground contact or jumps.

**Step 5 — per-chapter scene state** (`src/scene/chapters.ts`)
- Blended continuously by the story position.
- The HUD's CORE TEMP rises from 1,160°C to 1,250°C. It updates only when the rounded value (5°C steps) changes, and is not a live region.

**Step 6 — the dive and cool-down**
- **Core vein:** `uCorePoint` (object space `(0.35, 8.4, depth/2)`, on the front face) guarantees a wide, jagged, mostly vertical core vein. `uCoreOpen` (0..1, the camera's progress along the dive spline) widens it up to about 10× and lengthens it as the camera arrives.
- **Wash:** `WashEffect` (`src/scene/wash.ts`) is a new effect in the existing single pass, after bloom and tone mapping, so a full wash is exactly the palette colour. The dive phase runs 0..1:

  | Dive phase | Wash amount | Wash colour |
  |---|---|---|
  | 0 → 0.5 (peak) | rises from 0 to 1 (from 0.22) | lava-hot |
  | 0.5 → 0.75 | 1 | lava-hot → lava → magma |
  | 0.75 → 1 | 1 | magma → basalt |

  During the dive, bloom rises from 1.25 to 2.85 and fissure gain from 1.6 to 2.8. Grain fades out with the wash.
- **Sequencing** (all measured from the layout):
  - The dive starts when the services block's bottom passes 20% of the viewport.
  - The magma point is when the CTA block's top reaches the bottom of the viewport.
  - The peak sits 60% of the way between start and magma.
  - Progress 1 (pure basalt) is exactly where the plain section begins.
  - The plain section's background is basalt, so there's no seam.
- **HUD during the wash:** the HUD steps aside (`data-washed`) between dive phase 0.12 and 0.74, so its small labels never sit over the bright wash.

**Step 7 — content reveals** (`src/lib/story.ts`)
- **Never hide content prematurely:** hidden states are set by JS only, after `html.motion-ready`, and only for `[data-reveal]` elements still below 90% of the viewport at mount. Content already in view (on load, after a deep link or back navigation) is never hidden.
- **Headings:** SplitText `type: 'lines'`, `mask: 'lines'`, `aria: 'auto'` (full text as the heading's `aria-label`, split pieces `aria-hidden`), and `autoSplit: true` (re-splits on resize and font load). Lines rise from the mask with a 6px blur clearing, `expo.out`, staggered. Only headings are split: `aria-label` isn't valid on `<p>`.
- **Supporting text and cards:** fade and rise (28px, `expo.out`). The Low tier gets simple fades. Each reveal plays once.
- **Keyboard safety:**
  - Reveals animate opacity only. `visibility: hidden` would drop unrevealed links out of the tab order.
  - Focus landing inside an unrevealed block completes its reveal immediately.

**Step 8 — HUD tracking and deep links**
- **Tracking:** one ScrollTrigger per chapter (`top center` → `bottom center`) sets `aria-current="true"` and `data-active` in `onToggle` (not per frame). Works in every mode, including static.
- **Links:**
  - Chapter links (HUD and "Skip to the work") are handled in the capture phase, ahead of ClientRouter's own same-page hash handling.
  - Full mode scrolls with `lenis.scrollTo` to the chapter's anchor position. Static and lite modes jump natively.
  - Focus then moves to the chapter heading (`[data-chapter-heading]`, `tabindex="-1"`), and the URL hash is updated with `replaceState`.
- **Deep links:** `/#face-ii` lands on the chapter's framing (not the top of its section), and the camera, scene state, HUD and temperature are set immediately (`setProgress(p, true)`), with no replay.
- **Back/forward:** ClientRouter restores the scroll position and the story applies the matching camera state immediately.

**Step 9 — modes**

| Mode | When | Scroll | Camera, wash | Reveals | HUD, links |
|---|---|---|---|---|---|
| full | High, Medium | Lenis (wheel/trackpad) | yes | SplitText lines + fades | yes |
| lite | Low | native | none (poster with CSS drift) | simple fades | yes |
| static | reduced motion, Off | native | none (poster) | none, everything visible | yes |
| no JS | — | native | none (poster) | none, compact layout | native anchors |

## Final chapter state table

| Chapter | faceHeat (front, right, back, left) | emberDensity | lavaIntensity | uFissureGain | uGlow | Core temp |
|---|---|---|---|---|---|---|
| 00 Arrival | (0.2, 0, 0, 0.2) | 0.55 | 1.0 | 1.0 | 1.0 | 1,160°C |
| 01 Face I | (0, 0, 0, 1.0) | 0.55 | 1.0 | 1.1 | 1.0 | 1,180°C |
| 02 Face II | (0, 0, 1.0, 0) | 0.6 | 1.35 | 1.1 | 1.1 | 1,200°C |
| 03 The Lab | (0, 1.0, 0, 0) | 0.9 | 1.1 | 1.15 | 1.0 | 1,225°C |
| 04 The Core | (1.0, 0.3, 0, 0.3) | 0.7 | 1.2 | 1.6 → 2.8 by the dive peak | 1.25 | 1,250°C |

The face heat values are as specified. What changed is how heat drives the shader (see Deviations).

## Final camera framings

Orbit frames are `orbit(θ, radius, height, targetHeight, lateral, fov)`:
- θ is the angle around the monolith's axis (0 = +z, decreasing through the story).
- Positive `lateral` puts the stone left of centre.
- Face angles include the monolith's 0.06 rad turn: left = −1.511, back = −3.082, right = −4.652, front again = −6.223.

| Chapter | Landscape | Portrait |
|---|---|---|
| 00 Arrival | Phase 1 framing, unchanged: position (−6.5, 2.1, 42), target (5.6, 7.2, 0), FOV 34 | Phase 1 framing, unchanged: position (−5, 2.3, 50), target (−0.2, 0.6, 0), FOV 46 |
| 01 Face I (left face) | θ −1.271, r 21, h 4.4, target y 8.8, lateral −3.6, FOV 36 | r 30, h 3.2, target y 3.6, lateral 0, FOV 50 |
| 02 Face II (back face) | θ −2.922, r 26, h 2.8, target y 7.6, lateral +4.4, FOV 36 | r 36, h 2.6, target y 2.8, lateral 0, FOV 50 |
| 03 The Lab (right face, tilted up) | θ −4.472, r 22, h 1.3, target y 12.5, lateral −3.8, FOV 42 | r 32, h 1.4, target y 8.5, lateral 0, FOV 54 |
| 04 The Core (front face) | θ −6.223, r 30, h 4, target y 8.2, lateral +4.6, FOV 34 | r 40, h 3.2, target y 3.4, lateral 0, FOV 46 |
| Dive | Spline from the Core framing: 11 m out from the core point, then 3 m, then 0.42 m. The target swings to just behind the core point; FOV narrows to 72% | Same |

`npm run check:camera` results:

| Aspect | Min orbit clearance | Min dive clearance | Min height above ground | Max step per 1/4000 of story |
|---|---|---|---|---|
| Desktop 16:9 | 18.4 m | 0.42 m | 1.24 m | 0.23 m |
| Laptop 16:10 | 18.4 m | 0.42 m | 1.24 m | 0.23 m |
| Tablet 4:3 | 18.9 m | 0.42 m | 1.26 m | 0.24 m |
| Phone 390×844 | 27.3 m | 0.42 m | 1.15 m | 0.35 m |

## Deviations from the spec, and why

- **Face heat drives the shader more gently than in Phase 1.** At faceHeat 1, Phase 1's response widened the vein mask so much that a whole face became an even bright crackle, the look the brief rules out. Heat now mostly brightens and widens existing veins: mask expansion 0.3 → 0.1, branch reach 0.7 → 0.3, intensity factor 1.4 → 0.9. The faces still visibly come alive (screenshots checked per chapter).
- **The Chapter 00 look changed slightly,** from the specified (0.2, 0, 0, 0.2) face heat and the always-present core vein on the front face. I re-ran `npm run posters`.
- **The wash sits after tone mapping,** not directly after bloom. It's still after bloom in the same merged pass. Placing it after ACES means a full wash is exactly the palette colour, so the final basalt matches the plain section's background with no seam.
- **No Lenis on the Low tier.** The spec only ruled it out for reduced motion and tier Off. Low tier devices are the weakest, so they keep native scrolling.
- **Markup changes for headings:**
  - The visually hidden "Selected work: …" h2s on Face I/II are gone. The project card's title is now the chapter's h2, its focus target, and its `aria-labelledby` label.
  - The closing CTA line is now an h3, because SplitText's `aria-label` needs a heading.
- **Native `scroll-behavior: smooth` now applies only without JS.** With JS it broke two things: a smooth jump to a `#fragment` on load was interrupted by ScrollTrigger's first measurement, and ClientRouter's scroll restoration was made smooth and interruptible.
- **A tier forced with `?tier=` is never downgraded** by the 3-second frame-time check (`fixedTier`). That makes `?tier=high&fps` meaningful on real devices, and made testing on SwiftShader possible.
- **Dev hooks:** `?debug` on the home page exposes `window.__story.triggers()` (the live ScrollTrigger count) for checking lifecycle cleanup. The `/dev/scene` route takes `&progress=` with `capture` (using the default story map).
- **Monolith dimensions and ground height moved into shader-free modules** (`dimensions.ts`, `ground.ts`) so the camera maths can run headlessly. `monolith.ts` and `terrain.ts` re-export what they used to export.

## Bugs found and fixed during testing

- **Missing monolith:** a GLSL variable was redeclared in the new core-vein code, so the monolith's shader failed to compile.
- **Deep links landed at the top of the page:** a smooth fragment scroll was cancelled by ScrollTrigger's refresh.
- **Back navigation lost the scroll position:**
  - ClientRouter briefly removes the `js` class during the swap, so its scroll restore became a smooth animation that got interrupted. Root state is now stamped onto the incoming document in `astro:before-swap`.
  - ScrollTrigger's refresh restored a stale cached position. Scroll memory is now cleared before every refresh, and the real position is kept.
- **Chapter links didn't move focus:** ClientRouter handled same-page hash clicks first and called `preventDefault`. Story links are now handled in the capture phase.
- **Orphan ScrollTriggers after navigation:** SplitText's `onSplit` tweens live outside the GSAP context. They're now tracked and killed, and unmount kills every ScrollTrigger.
- **Unrevealed links were skipped by Tab:** the reveal used `autoAlpha`. It now animates opacity only and completes on focus.
- **Contrast trap:** the HUD's small labels and the chapter eyebrows sat over the bright wash and over lava lines. The HUD now steps aside during the wash, and the eyebrows have a basalt backing.

## Performance

All measurements were taken in this container, which has **no GPU** (WebGL runs on SwiftShader). Lighthouse ran against the production build, served locally with gzip.

**Lighthouse mobile** (Moto G Power emulation, 4× CPU, slow 4G), three runs. The emulated device gets the Low tier, so these runs cover the poster plus the lite story chunk:

| Run | Performance | Accessibility | Best Practices | SEO | FCP | LCP | TBT | CLS |
|---|---|---|---|---|---|---|---|---|
| 1 | 99 | 100 | 100 | 100 | 1.4 s | 1.7 s | 80 ms | 0 |
| 2 | 99 | 100 | 100 | 100 | 1.5 s | 2.1 s | 20 ms | 0 |
| 3 | 100 | 100 | 100 | 100 | 1.4 s | 1.7 s | 60 ms | 0 |

**Vercel deploy preview** (`dpl_9ATKwa832naHysvkdn4Ut8nihEER`, commit `438b262`): the build succeeded. Lighthouse mobile ran three times from this container through a temporary share link (one auth redirect, and the container's network proxy):

| Run | Performance | Accessibility | Best Practices | SEO | FCP | LCP | TBT | CLS |
|---|---|---|---|---|---|---|---|---|
| 1 | 94 | 100 | 100 | 63* | 2.2 s | 2.5 s | 30 ms | 0 |
| 2 | 96 | 100 | 100 | 63* | 2.0 s | 2.4 s | 20 ms | 0 |
| 3 | 92 | 100 | 100 | 63* | 2.3 s | 2.7 s | 30 ms | 0 |

\* SEO's only failing audit is `is-crawlable`: Vercel adds `X-Robots-Tag: noindex` to every preview. Production doesn't get it, and the local build scores SEO 100.

**LCP is at or over the 2.5 s budget in two of the three preview runs** (Phase 1's preview measured 2.1–2.4 s the same way). The local runs, with no redirect or proxy, are 1.7–2.1 s. Initial JS is essentially unchanged (+0.4 KB), and the story chunk loads after first paint, so the difference is most likely network variance through the share redirect and proxy. It still needs re-measuring on the production domain, where neither applies.

**Bundle sizes** (gzip -9):

| Chunk | Size | Loaded |
|---|---|---|
| ClientRouter | 4.8 KB | initial |
| Boot (layout script) | 2.3 KB | initial |
| quality.ts | 1.2 KB | initial |
| **Initial JS total** | **≈ 8.3 KB** (Phase 1: 7.9 KB; budget 100 KB) | |
| Story (GSAP core + ScrollTrigger + story code) | 45.7 KB | lazy, home only, all modes |
| chapters.ts | 0.7 KB | shared by story and scene |
| Lenis | 5.4 KB | full mode only |
| SplitText | 3.3 KB | full mode only |
| Scene | 162.8 KB (Phase 1: 160.8 KB; budget 300 KB) | lazy, High and Medium only |
| fps overlay | 0.9 KB | only with `?fps` |

GSAP and Lenis stay in lazy, home-only chunks, as the working notes recommended.

**SwiftShader frame rates** (CPU-only; relative cost only, not real-device numbers):

| Tier and size | Phase 2 | Phase 1 |
|---|---|---|
| High, 1280×720 | 1.43 fps | 1.36 fps |
| Medium, 1280×720 | 3.27 fps | 3.62 fps |
| Medium, 390×844 | 7.15 fps | 7.92 fps |

The core vein adds about 5–10% fragment cost. Medium remains about 2.3× cheaper than High.

**Contrast at reveal points.** Measured against the rendered background band just outside each text box, at the 99th-percentile background:
- **Desktop chapters 01–04:**

  | Text | Contrast |
  |---|---|
  | Eyebrow labels (bone) | 7.3–17.3:1 |
  | Card and lead body text (ash-soft) | 11.2:1 |

- **Closing CTA heading (bone):**

  | Moment | Desktop | Portrait |
  |---|---|---|
  | Entering the viewport | 13.7:1 | 13.6:1 |
  | Mid-screen | 16.2:1 | 16.0:1 |
  | End of the story (basalt) | 16.4:1 | 16.4:1 |

- **Background behind the CTA:** the 13.7:1 reading puts it at a luminance of about 0.014 as the CTA enters, slightly darker than magma (0.016). So the CTA only appears once the wash has cooled to magma or darker.
- **The CTA's lava phrase:** about 5.3:1 against that background and 6.4:1 on basalt. It's large text, so 3:1 is required.
- **Portrait eyebrows:** the band method samples outside their basalt backing, so it doesn't apply. The worst case was computed instead: 82% basalt over pure white bloom composites to about rgb(55, 39, 28), and bone on that is about 12:1.

## Testing done

- `npm run build` (0 errors, 0 warnings, 0 hints), `npm run lint`, `npm run format:check` and `npm run check:camera` all pass. No hex values were introduced outside `tokens.css` and `palette.ts`.
- **Full scroll at 1440×900 (High) and 390×844 (Medium):** every chapter screenshot checked. The HUD and core temperature track each chapter; the dive and wash run to basalt.
- **Deep link `/#face-ii`:** lands on Face II's framing, with the HUD on Face II and 1,200°C, and nothing replayed.
- **Back navigation:**
  - Two round trips to `/about` and back. Each time the page restores to the same position with the same chapter, temperature and camera framing.
  - ScrollTriggers: 0 on `/about`, and the same count on every return (no accumulation). `motion-ready` is removed on `/about`.
- **Keyboard:**
  - HUD links via Enter scroll to the chapter and focus its heading, in both full and static modes.
  - Tab order runs through every story link in reading order, in both full and lite modes. Each link is fully visible when focused.
- **Reduced motion:** compact layout, `motion-ready` never set, nothing hidden, HUD tracking and links work. No JS: compact layout with all content present.
- **`?fps`:** the overlay renders and persists across navigation. Without the parameter, the chunk is never fetched.

## Known issues

- **Real-device testing is still outstanding:** fps per tier (use `?fps`, or `?tier=high&fps` to pin a tier), and the *feel* of the Lenis and camera damping, which can't be judged at SwiftShader's 1–7 fps.
- **Address-bar resizing is untested on a real phone.** `lvh` heights and `ignoreMobileResize` are in place, but iOS and Android still need a check.
- **Deploy preview LCP is at or over 2.5 s in two of three runs** (see Performance), very likely the share-link redirect plus the proxy. Re-measure on the production domain after merge. Previews are behind Vercel deployment protection.
- **Tall blocks:** the Lab and Core content blocks are taller than a 900px viewport. Their anchors align the block's top at 20% of the viewport, so the heading is in view when the camera arrives, and the rest scrolls past normally.
- **HUD overlap:** the fixed HUD can briefly overlap content panels as they scroll past on desktop. It has no backing, by design (instrument readout).
- **Safari:** browsers without WebGPU (Safari before 26, Firefox on most platforms) still decide the tier with the WebGL probe after first paint.

## What Phase 3 needs to know

- **Content pages and the scene:**
  - Pages without `[data-scene-anchor]` leave the persistent canvas paused and dimmed (`is-dormant`, 32% opacity). The scene resumes on returning home.
  - Content pages don't need to do anything with the scene in Phase 3. Phase 4's page transitions can call `setChapter(i)` (it targets that chapter's anchor in the current story map) or add per-page framings to `CHAPTER_FRAMES`.
- **Scrolling on content pages is native:** Lenis exists only while the home story is mounted.
- **ScrollTrigger is reserved for the home story right now.** The story's unmount kills *every* ScrollTrigger (`ScrollTrigger.getAll()`). If a content page needs ScrollTrigger, change that line in `story.ts` to kill only the story's own triggers (the GSAP context already covers them; the line exists as a safety net), and give the page its own mount/unmount on `astro:page-load` / `astro:before-swap`.
- **Reveals:** `[data-reveal]` / `[data-reveal="lines"]` only work inside `[data-story]` today. To reuse the reveal motion on content pages, lift the reveal block out of `story.ts` into a shared helper, and keep the rules: hidden states only after `motion-ready`, never hide what's in view, opacity only, and complete on focus.
- **Smooth scrolling:** `html:not(.js)` gets native smooth scrolling. With JS, in-page links on content pages jump instantly unless a page handles them itself.
- **Root state:** `scene-boot.ts` re-stamps `html.js` and `data-tier` onto every incoming document before the swap. Don't rely on `astro:after-swap` for anything that has to be in place during ClientRouter's scroll restoration.
- **Reusable styles:** `.chapter__panel`, the eyebrow label style and `PageIntro`/`Section` give content pages the same panel language.
- **Scene API** (`src/scene/index.ts`): `setProgress(p, immediate?)`, `setStoryMap(map)`, `setChapter(i)`, `setPointer(x, y)`, `pause()`, `resume()`, `dispose()`. Pages go through `scene-boot.ts`'s bridge and never hold the handle themselves.

## Post-Phase 2 fixes: first load

Targeted fixes after the first real-device test (`DEBUG_FIRST_LOAD_PROMPT.md`). The look of the scene, the camera path, the chapter states and the copy are unchanged. The shader change below is a no-op for the post-processed path: a render compared against the poster scored 39.9 dB PSNR, so the posters were not re-rendered.

### Issue 1: the scroll story was missing on first visit

**Confirmed cause: neither (a) nor (b). It was a third cause that looked the same.**

- **Not (a).** The story did not mount in the wrong mode. It awaited the final tier before mounting, so it always mounted as `full` on a capable device.
- **Not (b).** Progress was not lost when the scene arrived late. The bridge queued the progress and forwarded it: with the scene delayed, the camera went from 0.028 to 0.165 to match the page.
- **The actual cause was the frame-time check.** It counted the first frames after setup, which include shader compilation and GPU uploads. Measured first frames: 39, 2767, 33, 117, 333, 33, 1100, 733 ms…, an average of 92.8 ms against a 38.5 ms limit for Medium.
- **What happened next.** The check dropped Medium to Low on every cold load, and Low tears the scene down to the poster. The poster is the Chapter 00 hero shot, so the page looked as if the scroll story had never started. On a warm load, compilation is cached and the check passed, which is why it only happened on the first visit.

**Tier caching:** none. Every visit decides the tier from scratch, and nothing about the tier is stored in `localStorage`, cookies or `sessionStorage`.

### Issue 3: the scene never appeared on mobile

There are no device logs yet, so this is the **likely** cause, from the code and from emulation:

1. **The same warm-up downgrade as Issue 1.** Phones compile shaders more slowly, so the first frames always failed the check: Medium dropped to Low, then the poster.
2. **Tier rules that put recent iPhones on Low:**
   - Safari reports `hardwareConcurrency` as at most 4 (sometimes 2), and does not report `deviceMemory` at all.
   - The old rule treated cores ≤ 2 as Low, and missing memory as low memory.
3. **Async steps with no timeout.** A `requestAdapter()` that never resolves, or a scene setup that never finishes, left the page on the poster with nothing recorded.
4. **Configurations the scene could not handle.** No half-float render targets, an incomplete post-processing framebuffer or a lost context threw, and the only fallback was the poster.
5. **No record of why.** None of this was visible on the device.

Now every async step has a timeout, every fallback records its reason, and the scene degrades one step at a time before it gives up.

### Final tier rules (`src/scene/quality.ts`)

1. **Fast rules, decided at once:**
   - `?tier=` or reduced motion → Off.
   - Save-Data, 2G, or a *known* `deviceMemory` ≤ 2 → Low.
2. **GPU probe:**
   - WebGPU `requestAdapter` with a 1.5 s timeout, then the WebGL2 probe.
   - The whole detection has a 4 s timeout; if it times out, the tier is Low.
3. **No WebGL** → Off.
4. **Software renderer** or a weak GPU (Mali-T/G31/G51/G52, Adreno ≤ 5xx, PowerVR, Utgard/Midgard, Intel GMA) → Low.
5. **Medium**, if any of these:
   - a mobile or integrated GPU (Adreno 6xx+, Mali-G7x+, Apple GPU on touch, Xclipse, Intel HD)
   - a coarse pointer
   - a screen whose short side is under 768 px
   - *known* memory ≤ 4 GB
   - *known* cores ≤ 4
6. **Otherwise High.**

Unknown memory or cores never lower the tier. In emulation:

| Device | Tier |
|---|---|
| iPhone 13 / 15 Pro (no memory reported) | Medium |
| Pixel 7 (Adreno 730) | Medium |
| Mali Utgard | Low |

**Frame-time check:**
- It starts after the first frame plus 30 warm-up frames, then samples 2 s of real frame time (each frame capped at 250 ms).
- High drops to Medium in place above 22.2 ms (45 fps).
- Medium drops to Low (the poster and the lite story) above 38.5 ms (26 fps).

### Changes by issue

**Issue 1: reactive story (`src/lib/story.ts`, `src/lib/scene-boot.ts`, `src/lib/scroll.ts`)**

- **The story is now a controller** with modes `pending`, `full`, `lite` and `static`:
  - It mounts as soon as possible in the current mode, without waiting for the tier.
  - `setMode()` switches in place.
  - Reveals and the SplitText splits are built once. Lenis is created only in `full` mode and destroyed on leaving it, so there is never more than one.
  - The scroll position is never touched. Measured across lite → full → lite → full → static: 23 triggers throughout, Lenis 0 or 1, and `scrollY` unchanged at 1125.
- **`setTier()` in `scene-boot.ts` is now the single place the tier changes:**
  - It starts or tears down the scene, or records the poster.
  - It then calls `story.setMode()`.
  - The reduced-motion change and the scene's own downgrades all go through it.
- **The bridge always forwards to the current scene handle.** When a scene arrives, it applies the queued story map, then `setProgress(p, true)`. With the scene delayed by 5 s, the camera matched the page (0.349) on arrival.
- **`ScrollTrigger.refresh()` is debounced (150 ms)** and runs after the first scene frame, on `document.fonts.ready`, and after each mode change.
- **The warm-up fix for the frame-time check** (Issue 2) is what removes the actual cause.

**Issue 2: slow first load**

- **Instrumentation (`src/lib/diagnostics.ts`):**
  - `performance.mark('monolith:…')` at each boot step.
  - The marks are shown in the `?fps` overlay under a collapsible **Load** section.
  - Without `?fps` or `?debug`, no marks are written and the overlay chunk is never fetched. Verified: 0 marks, no overlay request.
- **Scene chunk fetch:**
  - The scene chunk is prefetched (`rel=prefetch`, low priority) after `load` while the tier is still pending, so the download overlaps the GPU probe.
  - The build plugin in `astro.config.mjs` writes the hashed chunk URL into the boot script.
  - Low and Off never import the chunk, so Three.js never executes on them.
  - Save-Data and 2G are decided as Low before any prefetch.
- **LCP:**
  - A first attempt used `modulepreload` and moved the story import to boot time. That competed with the fonts that the LCP text needs, and Lighthouse LCP rose to 2.2–2.9 s.
  - Fix: the prefetch now waits for `load`, and the story import waits for first paint. LCP is back to 1.7 s (see Lighthouse below).
- **Shader compilation:**
  - `renderer.compileAsync()` (KHR_parallel_shader_compile) compiles the scene materials and then the post-processing materials, with a 15 s timeout that is not fatal.
  - A hidden warm-up render follows.
  - The poster stays up until all of that is done and the first real frame has drawn, then cross-fades over 1.2 s.
- **Frame-time check:** now starts after the warm-up described above. No quality was reduced.

**Issue 3: scene never appears on mobile (`src/scene/index.ts`, `src/scene/quality.ts`, `src/lib/scene-boot.ts`)**

- **Timeouts on every async step:**

  | Step | Timeout |
  |---|---|
  | WebGPU adapter | 1.5 s |
  | Tier detection | 4 s |
  | Story chunk | 20 s |
  | Scene chunk | 30 s |
  | Scene setup | 45 s |
  | First frame | 8 s |
  | Context restore | 10 s |

  A setup that arrives after its timeout is disposed.
- **Degrade ladder.** Each attempt runs `compileAsync`, then checks the shader logs (`renderer.debug.onShaderError`), the framebuffer status and `GL_OUT_OF_MEMORY` after a warm-up render:
  - No half-float colour buffer → 8-bit render targets with dithering.
  - Post-processing fails → the same tier without post-processing (ACES tone mapping in the renderer, through the shader chunks added to the five fragment shaders).
  - High → High without post → Medium → Medium without post. Only if Medium also fails does the page fall back to the poster.
- **WebGL context lost:** the poster is shown at once.
- **Context restored:** the scene is rebuilt and goes live again. If the context is not restored within 10 s, the poster stays and the reason is recorded.
- **Diagnostics:**
  - Every fallback reason, error (shader log, framebuffer status code, timeout) and tier signal is recorded.
  - Signals recorded: GPU string and source, memory or "unknown", cores, DPR, screen and touch.
  - The `?fps` overlay shows them under **Diagnostics**, and `?debug` logs them to the console.
  - `?debug` also exposes `window.__monolith.state()` and `window.__story`, for tests.
- **Tier rules:** as listed above.

### Tests (Playwright, Chromium with SwiftShader; no GPU in this container)

- **Cold first visit** (fresh profile, cache disabled, Fast 4G at 60 ms / 9 Mbps, 4× CPU, desktop GPU stub, tier pinned with `?keeptier`):
  - The story mounted in `pending` mode at about 0.6 s and the tier was final at about 0.95 s.
  - The scene was live at about 6 s.
  - After a wheel scroll the camera progress (0.304) matched the page.
- **Same cold visit without the pin:** SwiftShader really is slow (220 ms frames). After warm-up the check correctly dropped to Low: the story switched to `lite`, Lenis went to 0, the poster was shown, and the reason was recorded.
- **Hung `requestAdapter` stub:** the WebGL probe decided the tier 1.8 s after detection started, and the scene went live.
- **No half-float stub:** the scene ran as "medium, post, 8-bit" and rendered correctly.
- **Incomplete framebuffer stub:** recorded `0x8cd6`, then ran as "medium, no post" and rendered correctly.
- **Context loss and restore** (`WEBGL_lose_context`): the poster showed on loss; on restore the scene was rebuilt and went live.
- **Mobile Chrome emulation:** iPhone 13, iPhone 15 Pro and Pixel 7 got Medium; the Utgard stub got Low.
- **Lifecycle re-tested on the new code:**
  - Deep link `#face-ii` restores without replay.
  - HUD Enter scrolls to the chapter and focuses its heading.
  - Two round trips to `/about` and back: 0 triggers on `/about`, the same count on each return, and the same position, chapter and temperature.
  - Back navigation restores `scrollY` 3000.
  - Reduced motion and no-JS are unchanged.
  - Keyboard tab order is unchanged in High and Low.
- **WebKit was not tested.** Only Chromium is installed in this container, and browsers must not be downloaded here. iOS Safari needs a real-device check (below).

### Load timings (local production build)

Both runs use Fast 4G and 4× CPU, with a desktop GPU stub, SwiftShader and `?fps&keeptier`. Times are milliseconds from navigation start, from the `?fps` Load marks:

| Step | Cold | Warm |
|---|---|---|
| First contentful paint | 2132 | 1384 |
| Boot start | 1884 | 1212 |
| Tier final | 2254 | 1504 |
| Scene chunk loaded | 2488 | 1668 |
| Story mounted | 4017 | 3241 |
| Shaders compiled | 7288 | 6452 |
| First frame | 7394 | 6535 |
| Poster cross-fade done | 8595 | 7735 |

**What the timings show:**
- Compilation dominates: about 4.8 s on SwiftShader with 4× CPU throttling, cold or warm. A real GPU with KHR_parallel_shader_compile should be far faster; this needs a device check.
- On the warm visit, the scene chunk comes from cache 160 ms after it is requested.
- On every run, the tier is decided within about 0.4 s of boot.

**Bundle sizes (gzip):**

| Bundle | Phase 2 | Now |
|---|---|---|
| Initial JS (ClientRouter + BaseLayout + `quality`) | ≈ 8.3 KB | ≈ 10.2 KB |
| Scene chunk | 162.8 KB | 165.0 KB |
| Story chunk | 45.7 KB | 46.2 KB |
| `?fps` overlay | — | 1.3 KB, never loaded without `?fps` |

### Lighthouse mobile (local production build, three runs, same setup as above)

| Run | Performance | Accessibility | Best Practices | SEO | FCP | LCP | TBT | CLS |
|---|---|---|---|---|---|---|---|---|
| 1 | 100 | 100 | 100 | 100 | 1.4 s | 1.7 s | 40 ms | 0 |
| 2 | 99 | 100 | 100 | 100 | 1.4 s | 1.7 s | 50 ms | 0 |
| 3 | 100 | 100 | 100 | 100 | 1.4 s | 1.7 s | 60 ms | 0 |

This is no worse than Phase 2 (99–100, LCP 1.7–2.1 s).

`npm run build`, `lint`, `format:check` and `check:camera` all pass with no warnings.

### What the owner should check on devices

Open `/?fps` on each device in a **fresh private tab**. That is the cold, first-visit case.

1. **The live line** shows the tier and whether the scene is live, resting or on the poster. Expected:

   | Device | Tier |
   |---|---|
   | Recent iPhone or Android flagship | `medium · live` |
   | Desktop with a dedicated GPU | `high · live` |

2. **If it shows `poster`,** open **Diagnostics**. The fallback line says why, for example:
   - a frame-time downgrade (with the measured average)
   - a timeout (and which step)
   - a shader or framebuffer error
   - context loss

   The **tier signals** show what the device reported (GPU string, memory, cores, DPR, screen). Screenshot both and send them.
3. **Open Load** to see how long each step took on the device: tier final, scene chunk loaded, shaders compiled, first frame. Expect shader compilation to be the longest step.
4. **Scroll the story.** The HUD and the camera should move together from the first scroll, including while the poster is still up.
5. **Add `?debug`** (`/?fps&debug`) to get the same entries in the console (Safari Web Inspector or Chrome remote debugging).
6. **To check a single tier,** use `?tier=high&fps` or `?tier=medium&fps`. The frame-time check still applies; add `&debug&keeptier` to disable it while judging the feel.
