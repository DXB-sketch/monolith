# Phase 4 complete: Polish and transitions

The stone now stays present across the whole site. Every content page has its own view of the monolith, and page changes glide the camera between views under a short "cooling" transition. Shared elements morph between pages, and High gains a heat haze. Desktop has a custom cursor and a considered hover and press language. Optional procedural ambient sound is available, off by default. A set of finishing touches completes it.

The home story's camera path, chapter states, copy and the first-visit intro are unchanged. Phase 2.5's intro stands in for the preloader, so no other preloader was built.

All measurements were taken in this container, which has **no GPU**. WebGL runs on SwiftShader, which is 10–100× slower than real hardware, so durations involving rendering are upper bounds, not device numbers (see Known issues).

## What was built

### Step 1: per-page camera views (`src/scene/views.ts`, `camera-path.ts`)

- **Views and scene state.**
  - Each content page declares its view (`<main data-scene-view="…">`, through BaseLayout's new `view` prop).
  - The scene frames it with its own landscape and portrait orbit frame (`VIEW_FRAMES`), blended by aspect ratio like the story chapters.
  - Each view has its own scene state (`VIEW_STATES`: face heat, embers, lava, fissure gain, horizon glow). Every view is darker and calmer than the home story.
- **The scene now runs on content pages too.**
  - On a first visit to a content page, the tier check and the scene load follow the same deferred path as on home: after first paint, with nothing competing with LCP.
  - The poster tier keeps the poster.
- **Cost control on content pages:**

  | Tier | Content pages |
  |---|---|
  | High, Medium | Render live under a per-page resolution cap (`VIEW_SCALE_CAP`: 0.7–0.8). The controller can only lower it further, and never upgrades a tier while capped. Rendering pauses when the tab is hidden, as before. |
  | Lite | Renders while the camera glides and layers fade in. It then **holds a still frame** (the render loop stops) until something needs motion: a page change, the contact flare or a resize. Verified: 0 draw calls in 3 s while holding; it wakes for the next page change and holds again. Home still renders continuously. |
  | Poster | The poster, with the same scrim. |

- **Looks.**
  - The old "dormant at 32%" look is gone from content pages. The stage sits at 72% (`--view-stage-opacity`), and a scrim darkens the text's side:
    - landscape: a left-to-right gradient
    - portrait: top to bottom, with more darkness lower down
  - During a page change the stage dips briefly to 38% (`--nav-stage-opacity`), so the change reads as intentional.
  - Home still dims at the plain section.

### Step 2: page transitions (`src/styles/transitions.css`, `src/lib/morph.ts`, `src/lib/page-focus.ts`)

**Sequence for a normal navigation:**
1. As the navigation starts, the stage dips, and scene rendering pauses while the page is fetched and swapped, so a heavy frame can never hold up the swap.
2. The view transition snapshots the outgoing page, which **cools** over 250 ms: it darkens toward basalt and fades, with a 6 px blur on fine-pointer screens only.
3. The swap happens as soon as the new HTML is in. In the same moment:
   - the scene gets a brief **WebGL heat shimmer**: an unmasked UV ripple in the post chain, 120 ms up and 380 ms down, on High and Medium
   - the camera starts its **glide** to the new view.
4. The incoming page warms in from 120 ms (300 ms long). Its blocks then reveal with the existing reveal system.

**The camera glide.** The camera glides from wherever it is, including mid-glide, to the new framing.
- **Interpolation:** cylindrical, as in the story, taking the short way round, eased with an in-out cubic.
- **Duration:** 550 ms, up to 850 ms for the longest moves (a big turn or a big change of distance).
- **Arc:** long moves rise on a higher, wider arc: up to +14 m of height and +11 m of radius at mid-glide.
- **Leaving from the dive:** the glide starts from the Core's orbit frame (the cut is hidden under the dip), so it can never pass close to the stone.

**Shared elements.**
- **Work row → case study hero:**
  - The title morphs into the hero title.
  - The cover morphs into the hero image. The source is the floating preview as the visitor sees it (desktop) or the inline thumbnail (touch and keyboard).
  - The case study hero now carries the cover (eager, high priority) instead of opening the Visuals section with it.
- **Next project → next case study:** the title morphs into the next hero's title.
- **Back to the work index:** the project's row takes the title back.
- **Naming:** names are given only to the elements involved in that navigation, so no other title is captured and flies across the screen.
- **Nav pill:** it never flickers (`view-transition-name: site-header`; the new one replaces the old in place). The **current-page indicator** is now a real element that slides between items.
- **HUD:** home only, so it doesn't cross pages.

**Rules:**
- **The new page never waits for the camera.** The camera catches up on its own time.
- **Back/forward:** scroll position and camera view (story chapter or page view) are restored **immediately**, with no glide and no shimmer.
- **Focus:** after every navigation it moves to the new page's `h1` (`tabindex="-1"`, `preventScroll`, no ring on a non-control). ClientRouter's route announcer reads the new title (verified on every navigation).
- **Reduced motion:** instant swaps (Astro disables every view-transition animation), no glide, no shimmer, and the morph names are removed.
- **Poster tier:** a plain 220 ms cross-fade, with no blur and no morphs.
- **Browsers without View Transitions:** ClientRouter now uses `fallback="animate"` (it was `none`, which meant a full page load). Those browsers get a plain cross-fade on the live page, and the canvas persists.

### Step 3: heat haze (`src/scene/heat.ts`)

`HeatEffect` sits first in the merged effect pass and bends the screen's UVs before anything is sampled.

- **High, full haze.**
  - **Mask:** the bloom texture, read 5% of the screen *below* each pixel (heat rises), and gated by depth to what lies **beyond the stone**.
  - **Result:** the air above the lava channel and behind the burning stone shimmers, while the stone, the foreground and the cool ground stay crisp.
  - **Drive:** two scrolling noise tiles, at 0.0045 UV amplitude.
  - A first version without the depth gate made the stone's own veins wobble like water; the gate fixed that.
- **Medium: no haze.** Phase 2.5 measured no headroom for it on Medium, and there are no real-device measurements that show otherwise. Medium compiles the effect without the haze, for the shimmer only.
- **Lite and Poster:** none.
- **Under load,** the haze is the first thing the controller drops, before any resolution step. It comes back last, after the extras, once there has been 4 s of headroom.
- **GPU cost:** see the Performance section.

### Step 4: custom cursor and hover language (`src/lib/cursor.ts`, `Cursor.astro`, `global.css`)

**Cursor:**
- **Who gets it:** loaded (1.1 KB) only on fine-pointer desktops without reduced motion. Touch and reduced motion never request it (verified). It stands down if either preference changes.
- **Shape:** a 28 px bone ring with inertia, and a 4 px dot that tracks exactly. The native cursor is never hidden (`body` cursor stays `auto`).
- **States:**

  | Over | Cursor |
  |---|---|
  | Links and buttons | Ring grows ×1.6 and warms to lava |
  | Project rows and cards | Lava disc reading "View" |
  | The Lab's range sliders | "Drag" |
  | Text fields, selects, iframes, the Cal.com embed | Hidden |

- Its label is decorative (`aria-hidden`).
- Transforms only, in `requestAnimationFrame`. The loop stops once the ring catches up and when the pointer leaves the window.

**Hover and press language:**
- **Buttons:**
  - a warm radial glow that follows the pointer (`--mx`/`--my`, set by the cursor module)
  - a press-down on `:active`
  - the primary "Start a project" buttons lean up to 6 px toward the pointer (`data-magnetic`)
- **Links in running text:** a faint resting underline, plus a lava line that draws in from the left on hover **or keyboard focus**.
- **Panels and cards** (`data-sheen`): the side borders warm toward lava on hover **or focus-within**, and a faint warm sheen follows the pointer.
- **Focus:** focus styles are unchanged and at least as visible as hover. Nothing keyboard-related depends on the pointer.

### Step 5: ambient sound (`src/lib/sound.ts`, nav toggle)

- **The toggle** is a real `<button aria-pressed>`. Its visible text reads "Sound off" or "Sound on". Its accessible name stays "Sound"; the state is in `aria-pressed` and the visible state word is `aria-hidden`.
  - Desktop: in the nav pill.
  - Mobile: in the menu.
  - Hidden without JS.
- **Generated in Web Audio,** with no files:
  - **Bed:** wind (band-passed noise with a slowly wandering centre and level) and a distant rumble (low-passed brown noise plus a faint 38 Hz tone).
  - **Accents:** a soft crackle when a chapter is reached (`monolith:chapter`), and a low swell as the dive begins (`monolith:dive`). The story dispatches these events, and only after it has settled on mount.
  - A compressor keeps the levels consistent.
- **Nothing audio-related loads until it's turned on** (verified: the 1.2 KB module is fetched on the first click). It never autoplays.
- **Session memory only.** After a reload with sound remembered on, the toggle shows "on", but audio starts only at the next click or key press, never on page load (verified).
- **Behaviour:** about 1 s fades, and it suspends while the tab is hidden. Sound carries nothing that isn't on screen.

### Step 6: micro-interactions and finishing touches

| Touch | How |
|---|---|
| Nav: current-page indicator | Slides between items on navigation (a shared element); on mobile it's a lava bar in the menu |
| HUD temperature | Ticks in 5 °C steps toward a new reading instead of jumping. The coordinates are static, so there is nothing to tick there. |
| Contact form | Each completed step leaves a thin lava line in a decorative step track. A successful send makes the core vein flare (it opens a little and burns brighter for about 2.7 s) on High, Medium and Lite. |
| Scroll progress | A 1 px lava hairline on case studies and lab entries: a CSS scroll-driven animation, with no JS |
| Selection | `--lava` background, `--basalt` text (already in place since Phase 1) |
| Scrollbar | Thin, obsidian edge on basalt (Firefox `scrollbar-color`, WebKit pseudo-elements) |
| 404 | Its view drifts slowly past the edge of the plain (live tiers; Lite holds it still) |

### Reduced motion and touch: every effect added

| Effect | Reduced motion | Touch | Low tiers |
|---|---|---|---|
| Page views | The view, no glide | Same as desktop | Lite: a still frame; Poster: the poster |
| Camera glide | None (instant) | Yes | Lite: yes, then holds; Poster: none |
| Cooling transition | None (instant swap) | No blur | Poster: plain cross-fade |
| WebGL shimmer | None | Yes | Lite and Poster: none |
| Shared-element morphs | Off | Yes (thumbnails) | Poster: off |
| Navigation dip | Instant | Yes | Same |
| Heat haze | n/a (reduced motion means the poster tier) | Yes on High | Medium, Lite, Poster: none |
| Cursor | Never loaded | Never loaded | n/a |
| Button glow and magnet | Off (needs the cursor module) | Off | n/a |
| Press-down | Instant (transitions are 0.01 ms) | Yes | n/a |
| Link underline draw | Instant | On focus | n/a |
| Panel sheen | Off; the border still warms | The border warms on focus | n/a |
| Sound bars animation | Static bars | Yes | n/a |
| HUD temperature tick | Jumps at once | Yes | Yes |
| Contact flare | None | Yes | Poster: none |
| Reading progress | Kept: it follows the reader's own scroll | Yes | Yes |
| 404 drift | None (poster) | Yes | Lite: still |

## Deviations from the spec, and why

1. **The case study hero now carries the cover image.** The spec's "cover preview → case study hero image" morph needs a hero image, and the template had none. The cover moved from the top of Visuals into the hero; Visuals now holds only the gallery. LCP is measured below.
2. **No haze on Medium.** The spec allowed it "only if Phase 2.5's measurements show headroom". They didn't (Medium 1280×720: 433 ms on SwiftShader against High's 933–1016 ms), and there are no real-device numbers yet. Medium keeps only the transition shimmer.
3. **The haze mask is the bloom texture plus depth**, not a separately rendered mask. Bloom already marks every hot region, so the mask costs one fetch, and depth keeps the stone itself crisp.
4. **ClientRouter's fallback changed from `none` to `animate`,** as the spec requires a cross-fade for browsers without View Transitions. With `none` they did full page loads.
5. **Lite gets no WebGL shimmer.** It has no post chain, and adding a pass to Lite would undo Phase 2.5's savings. It gets the DOM's cooling fade instead.
6. **Scene rendering pauses while a page change is fetched and swapped** (not in the spec). On SwiftShader a High frame took long enough to delay the view transition's snapshot, which violated "never wait for the camera". The pause sits under the navigation dip, so it isn't visible.
7. **The sound toggle's accessible name stays "Sound"** (state in `aria-pressed`), rather than switching between "Sound off" and "Sound on": a label that changes alongside `aria-pressed` would announce the state twice. The visible text still reads "Sound off" or "Sound on".
8. **Two pre-existing bugs fixed along the way:**
   - **Phase 2's poster-tier scroll drift had never run in production.** The CSS minifier folds `animation-timeline` into the `animation` shorthand, which browsers reject. It now uses longhands, with the timeline passed through a custom property; the reading-progress hairline does the same.
   - **The mobile menu's panel was 96% opaque,** which let the large headlines behind show through. It is now solid obsidian.

## Page camera views

Orbit frames are `orbit(θ, radius, height, targetHeight, lateral, fov)`, as in PHASE_2_COMPLETE.md. Positive `lateral` puts the stone left of centre.

| Page | Landscape | Portrait | Scale cap | Scene state |
|---|---|---|---|---|
| Work index | Left face + 0.42, r 78, h 6, target 10, lateral −22, FOV 34: wide, stone small and right | r 100, h 6, target −9, FOV 48: stone small and high | 0.75 | Face I warm (0.6), glow 0.7 |
| Case study | Front-right edge (θ rot + 1.3), r 10.5, h 1.1, target 9.5, lateral −5.6, FOV 40: low and close on the edge, one vein at the right | r 13, h 1, target 14, lateral −3.4, FOV 54 | 0.7 | Fissure gain 0.7, glow 0.55, few embers |
| Services | θ −0.44 (over the lava channel), r 45, h 2.4, target 5.5, lateral −9, FOV 36: looking up the flow to the stone | r 60, h 7, target 12, FOV 50 | 0.75 | Lava 1.2, glow 0.8 |
| About | θ 0.22, r 175, h 14 (ridge), target 9, lateral −34, FOV 30: the stone small on the plain, the peaks behind | r 200, h 16, target −16, FOV 44 | 0.75 | Glow 0.5 |
| Lab | Right face + 0.12, r 13, h 0.6, target 18, lateral −7.2, FOV 50: up the right face into the embers | r 15, h 0.6, target 21, FOV 60 | 0.8 | Right face 0.8, embers 0.9 |
| Contact | Front face (θ rot − 0.12), r 13, h 7.2, target 8.4 (the core), lateral +5.2, FOV 40: warm, behind the form (left) | r 32, h 6, target −2, FOV 50 | 0.75 | Front 0.8, gain 1.3, glow 1.0 (the brightest) |
| 404 | θ 0.1, r 300, h 26, target −2, lateral −44, FOV 32: beyond the plain's edge at z 220, the ground falling away below, slow drift (±0.035 rad, ±1.6 m) | r 320, h 30, target −24, FOV 44 | 0.7 | Glow 0.45 |

**`npm run check:camera`** now also places every view and samples every glide between every pair of framings (5 chapters, 7 views and the 404's drift extremes, both ways: 182 glides) at four aspect ratios:

| Aspect | Views (min clearance) | 182 glides (min clearance) | Ground | Worst step vs its neighbours | Longest glide |
|---|---|---|---|---|---|
| Desktop 16:9 | 7.74 m | 7.74 m | ≥ 1.00 m | 1.12× | 850 ms |
| Laptop 16:10 | 7.74 m | 7.74 m | ≥ 1.00 m | 1.12× | 850 ms |
| Tablet 4:3 | 7.88 m | 7.88 m | ≥ 1.00 m | 1.10× | 850 ms |
| Phone 390×844 | 10.23 m | 10.23 m | ≥ 1.00 m | 1.10× | 850 ms |

Minimums: 6 m from the stone, 0.9 m above ground, and no step more than 1.5× its neighbours (a jump). The story path's own check is unchanged.

CONTRAST_SECTION

## Transition timings

**As designed** (from the moment the new page's HTML arrives, which is fetch-bound):

| Part | Starts | Lasts | Ends |
|---|---|---|---|
| Stage dip | Click | Lifts 260 ms after the new page loads | — |
| Outgoing page cools (fade and darken, blur on fine pointers) | Swap | 250 ms | 250 ms |
| WebGL shimmer (High, Medium) | Swap | 120 ms up, 380 ms down | 500 ms |
| Incoming page warms in | Swap + 120 ms | 300 ms | 420 ms |
| Shared-element morphs | Swap | 560 ms | 560 ms |
| Nav indicator slide | Swap | 420 ms | 420 ms |
| Camera glide | New page loaded | 550–850 ms (by turn and distance) | ≤ 850 ms |
| Poster tier cross-fade | Swap | 220 ms | 220 ms |
| Reduced motion | — | Instant | — |

Content is never held back: the new page is laid out and readable from the swap. The DOM transition is complete by 560 ms after it, and the camera by 850 ms in the worst case (a long move). Add the fetch (a cached static page on the CDN, typically tens of milliseconds), and every navigation is **within the 1.1 s ceiling**.

**Measured in this container** (production build served locally). Each run is a scripted tour of 16 navigations:
- home → work → case study → next case study
- back, back, forward
- → contact → services → about → lab → lab entry → home
- back, forward
- home at Face II → about → back

"Shown" is click to swap (the new page is in the DOM); "done" is click to the end of the view transition.

| Config | Shown (median / max) | Transition done (max) | Errors | Notes |
|---|---|---|---|---|
| Poster, 1440×900 | 210 / 385 ms | 877 ms | 0 | |
| Poster, 390×844 | 98 / 180 ms | 505 ms | 0 | |
| Reduced motion, 1440×900 | 238 / 380 ms | 563 ms | 0 | No animation: "done" is the swap plus scripts |
| Reduced motion, 390×844 | 117 / 254 ms | 279 ms | 0 | |
| Lite, 1440×900 | 401 / 1046 ms | 1746 ms | 0 | SwiftShader: Lite renders at ~5 fps here |
| Lite, 390×844 | 135 / 306 ms | 1099 ms | 0 | |
| Lite, 1440×900, keyboard only | 490 / 730 ms | 1795 ms | 0 | Every navigation by Tab and Enter |
| High, 1440×900 | 1970 / 3196 ms | 7210 ms | 0 | SwiftShader: ~1 s per High frame |
| High, 390×844 | 775 / 1685 ms | 2424 ms | 0 | |

- **Where the time goes.** The poster tier shows the real cost of the page mechanics: 0.5–0.9 s from click to the end of the transition, including the fetch. On the rendering tiers here, every frame the compositor produces waits behind SwiftShader's software GPU. A High frame takes about a second (Phase 2.5 measured 933–1016 ms), so the view transition's own animation frames stretch accordingly.
- **The scene never delays the new page.**
  - Found and fixed during testing: High's "shown" was 3.1–4.7 s before scene rendering was paused during a page change, and 0.8–2.0 s (median) after.
  - What remains is SwiftShader finishing the one frame already in flight. On real hardware that is a single 8–16 ms frame.
- **Glides on SwiftShader also run long.** The scene clamps each frame step to 100 ms, so at 1–5 fps the glide's clock runs slower than wall time. On a real GPU the glides take their designed 550–850 ms.
- **In every configuration:**
  - focus landed on the new `h1` after every navigation
  - the route announcer read the new title
  - each page reached its view (or the story)
  - nothing errored
- **Back to the home story** restored the scroll position exactly (e.g. 2162 → 2162 at Face II) and the active chapter (`#face-ii`). On High, the camera returns to the page's own story position at once (see Lifecycle).

## GPU costs

Measured with the Phase 2.5 timer queries (`EXT_disjoint_timer_query_webgl2`) on the dev viewer at 1280×720. Each view is at its page's resolution cap, against home's Chapter 00 at scale 1.

These are SwiftShader GPU milliseconds per frame, so only the **ratios** mean anything. The per-layer split interleaves on SwiftShader; the frame totals are the reliable figure.

| View | High (frame ms) | vs home | Medium | vs home | Lite | vs home |
|---|---|---|---|---|---|---|
| Home, Chapter 00 (scale 1) | 650 | — | 257 | — | 99 | — |
| Work (0.75) | 472 | 73% | 152 | 59% | 58 | 59% |
| Case study (0.7) | 501 | 77% | 109 | 42% | — | — |
| Services (0.75) | 536 | 82% | 163 | 63% | 73 | 74% |
| About (0.75) | 526 | 81% | 152 | 59% | — | — |
| Lab (0.8) | 411 | 63% | 129 | 50% | — | — |
| Contact (0.75) | 602 | 93% | 161 | 63% | 70 | 71% |
| 404 (0.7) | 427 | 66% | 159 | 62% | — | — |

- **Content pages cost less than home on every tier.**
  - High and Medium render at 42–93% of a home frame.
  - Lite only renders while the camera glides and layers fade in. It then holds its still frame and costs **nothing** (0 draw calls over 3 s, measured on the production build).
- **Contact is the most expensive view on High,** because the close front face is mostly monolith pixels (342 ms of 602). Its scale cap could drop from 0.75 to 0.7 if real devices struggle there.

**Heat haze (High), at 1280×720 and scale 1, Chapter 00:**

| | Post slice (incl. heat) | Frame |
|---|---|---|
| Haze on | 53.4 ms | 650 ms |
| Haze off (`&nohaze`) | 52.5 ms | 678 ms |

The haze costs about **1 ms of SwiftShader GPU time (≈2% of the post slice)**. That is within the run-to-run noise of the frame total: the haze-off run happened to be slower overall.

Most of its work sits behind a mask branch: one bloom-texture fetch everywhere, and a depth fetch plus two noise fetches only where the mask is hot. Medium compiles without the haze; its shimmer branch is skipped whenever the shimmer is zero.

On a real High-tier GPU the haze is a fraction of a millisecond. If it ever pushes a frame over budget, the controller drops it before any resolution step.

## Lighthouse

LIGHTHOUSE_SECTION

## Lifecycle: 20 navigations

LEAK_SECTION

## Bundle sizes (gzip -9)

| Asset | Phase 3 | Phase 4 | Loaded |
|---|---|---|---|
| Initial JS, content pages | 11.3 KB | **13.2 KB** | Every page (budget 100 KB) |
| Initial JS, contact | 13.5 KB | 15.4 KB | Contact |
| Shared boot chunk (quality, views, diagnostics) | — | 3.0 KB | Every page (part of the above) |
| Nav script (menu and sound toggle) | — | 0.9 KB | Every page (part of the above) |
| Cursor | — | 1.1 KB | Fine pointer and motion allowed, after first paint |
| Sound | — | 1.2 KB | Only when sound is turned on |
| Scene core chunk | 155.3 KB | 154.6 KB | Live tiers |
| Layers chunk (now with `HeatEffect`) | 20.4 KB | 21.0 KB | Live tiers, after L1 |
| Story chunk | 46.1 KB | unchanged | Home |

## Known issues

KNOWN_ISSUES

## What Phase 5 needs to know before launch

PHASE5_NOTES
