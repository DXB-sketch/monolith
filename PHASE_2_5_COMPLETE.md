# Phase 2.5 complete: Scalable scene and progressive loading

The live scene now runs on most devices instead of only strong GPUs. A new **Lite** tier gives integrated-GPU laptops and most phones a live scene at a fraction of the cost. The expensive per-pixel work is baked. Resolution adapts before any feature is removed. The scene builds up in layers behind a short branded intro, and the poster is a rare fallback.

The art direction, camera path, chapter states, copy and page structure are unchanged. High looks the same as before: a High render matches the existing Chapter 00 poster at 47.2 dB PSNR, so the posters were not re-rendered.

All measurements were taken in this container, which has **no GPU** (WebGL runs on SwiftShader). The costs below are relative only.

## What was built

### Step 1: per-layer GPU cost (`src/scene/gpu-timer.ts`)

- `EXT_disjoint_timer_query_webgl2` times every layer's draw calls. A query opens in each mesh's `onBeforeRender` and closes in `onAfterRender`, so queries never nest.
- The frame is timed in slices between the layers' draws. Those slices count as **post** (post-processing plus clears).
- **`?fps` overlay:** shows GPU ms per layer (sky, peaks, monolith, glow, terrain, lava, embers, post, frame total), always visible, so one screenshot has everything.
- **Dev route:** `/dev/scene` exposes `window.__gpu()` for scripted measurements.
- **Fallback:** where the extension is missing, the overlay says so. Per-layer cost can still be measured from frame-time differences with `/dev/scene?hide=…&nopost`.
- **SwiftShader exposes the extension,** so the tables below are GPU time, not frame-time differences.

### Step 2: tier model (`src/scene/quality.ts`)

| Tier | Who | Scene |
|---|---|---|
| High | Discrete GPUs, Apple silicon Macs | The full procedural scene, unchanged |
| Medium | Strong integrated GPUs (Iris Xe, Radeon 680M/780M…), recent flagship phone GPUs (Adreno 7xx+, Mali-G7x+, Immortalis, Xclipse) | Baked fissure field, lighter post-processing (5 bloom levels at 0.35 resolution, no MSAA) |
| Lite | Every other hardware-accelerated WebGL2 device | Everything baked, no post chain, DPR cap 1.25, 30 fps |
| Poster | Reduced motion, save-data, no WebGL2, software renderers, a failed WebGL context, or Lite unable to hold ~24 fps at half resolution | Static poster |

Final rules, details and the session cache are below.

### Step 3: baked work

**Fissure atlas** (`scripts/bake-fissures.ts`, `npm run bake`):

- **Same maths as High.** The field functions moved into `src/scene/shaders/fissure-field.glsl`. The High shader and the bake run exactly the same GLSL.
- **How it bakes:** headlessly in Chromium, at the exact displaced surface point of every texel. `src/scene/monolith-geometry.ts` holds the displacement, and every vertex carries its atlas address in `aAtlas`. The baked veins sit exactly where High's are (compare the screenshots).
- **Layout:** 1024 × 2048. Front and left faces in the top row, back and right in the bottom row, the crown in a narrow column. Faces get 128 texels per metre across the veins and 64 per metre along them. Each region has a gutter of extrapolated field, so mipmaps never bleed between faces.
- **Channels:**

  | Channel | Contents |
  |---|---|
  | r | Main-vein edge distance (distance minus width), sqrt-encoded. Pushed 6 cm out where the vein breaks, so the bright line breaks but its glow carries on, as bloom gives it on High. |
  | g | Branch edge distance, gated where branches can't grow |
  | b | Vein strength (the region mask) |
  | a | Pulse phase |

  Wherever no vein can show, the channels are flattened to a constant, which compresses to almost nothing.
- **Shipped as AVIF planes** (`public/textures/fissures-planes.avif`, **133 KB**). The four channels are laid out as grayscale planes in one 2048 × 4096 lossy AV1 image (crf 6). The mean error is about half an 8-bit code, and 99.99% of texels are within 3 codes. The browser decodes it off the main thread, and it is repacked once on the GPU into an RGBA texture with mipmaps and 4× anisotropy (`src/scene/atlas.ts`).
- **PNG fallback:** a lossless RGBA PNG (1.14 MB), only for browsers that can't decode the AVIF.
- **Runtime on Medium and Lite:**
  - Only cheap work runs per frame: the three-sine pulse, face heat and pointer heat (they widen the veins through a heat-dependent threshold on the stored distances, and brighten them), the core vein (analytic; `uCoreOpen` and `uCorePoint` as before), the emissive ramp, and a glossy reflection of the analytic sky.
  - Medium lights the stone per pixel; Lite per vertex.
  - The six lava point lights are summed once per vertex at build time (`aLavaLight`).

**Other layers:**

- **Lava:** the crust plates come from a seamless Voronoi tile (`src/scene/textures.ts`, 512², 16 × 16 cells: border distance and a per-plate value). It scrolls along the channel UVs, and a seamless noise tile supplies the warp, melt and pulse.
- **Terrain:** the detail noise (three scales) and the hot cracks in the banks come from the same tiles. Lite computes fog per vertex.
- **Sky (Lite):** the gradient is computed per vertex on a dome whose rings crowd toward the horizon, plus one textured smoke layer.
- **Sky (all tiers):** now drawn **after** the opaque scene, so the depth test skips every pixel the ground or stone covers. The image is unchanged.

### Step 4: Lite rendering pipeline

- **Straight to the canvas:** no composer and no MSAA. The renderer's ACES tone mapping runs in each material (tone mapping now stays on the renderer for every tier; three skips it when drawing into the post chain's targets).
- **Bloom stand-in:**
  - The fissure shader adds a tight hot glow and a broad warm one. The broad one reads the atlas at a coarser mip, so it spreads smoothly.
  - Additive glow sprites (`src/scene/glow.ts`) sit at the core vein and along the lava where it wraps the base. The core sprite skips the depth test and fades as the front face turns away.
- **Grain and vignette:** a CSS overlay on the stage (a 128 px noise tile in overlay blend, plus a radial gradient). It is only shown, and only downloaded, on Lite.
- **Chapter 04 wash:** the existing CSS wash layer, with the same colours and sequencing as the post chain's `WashEffect`. The HUD still steps aside during the wash.
- **Embers:** 200 on Lite, 600 on Medium.
- **Terrain grid:** 112 on Lite (High 288, Medium 160). It stays denser near the stone.
- **Frame pacing:** Lite is capped at 30 fps. Frames are rendered only on whole vsyncs and evenly (every other refresh at 60 Hz, every fourth at 120 Hz). High and Medium are paced to 60 the same way.

### Step 5: dynamic resolution (`src/scene/index.ts`)

- The canvas renders at **scale × the tier's DPR cap** (scale 0.5–1.0), and CSS stretches it to fill the viewport.
- A controller reads the interval between rendered frames:
  - Over the tier's budget by 15%: one step down.
  - Steady for 2 s: one step back up.
  - At most one decision every 0.5 s.
- **Order of degradation:**
  1. Resolution (steps of 0.1 down, 0.05 up).
  2. The extras (crazing, full horizon smoke, the last 40% of the embers).
  3. One tier down, rebuilt in place, every layer at once. The old tier keeps drawing until the new one is compiled.
  4. The poster, only when Lite at scale 0.5 can't hold about 24 fps.
- **Ignored when measuring:** shader compilation, layer fades, 30 frames after any layer or tier appears, and 8 frames after a resolution change.
- **Overlay:** shows the scale, frame time, target, extras state and the last five decisions with their reasons.

### Step 6: progressive layers

| Layer | Contents | Chunk |
|---|---|---|
| L1 | Sky, distant peaks, monolith (and Lite's glow sprites) | core (`scene`) |
| L2 | Terrain and fog | `layers` |
| L3 | Lava and its light on the ground and stone (`uLavaGlow`) | `layers` |
| L4 | Embers (60% of the tier's count) | `layers` |
| L5 | Post-processing (High, Medium) | `layers` |
| L6 | Pointer heat, crazing, full smoke, every ember (if the budget allows) | — |

- **Compile and fade:** every layer is compiled with `compileAsync` (KHR_parallel_shader_compile where available) before it is added, then faded in over 450 ms. The ground rises out of the haze; the lava, its light and the fissure glow brighten from dark.
- **L5 first** compiles the scene's programs for the chain's render target. The CSS wash then hands over to the `WashEffect`, and bloom, vignette and grain ramp up from zero.
- **Atlas fetch:** `scene-boot` starts it alongside the core-chunk import. If the atlas is late, the stone starts with the flat-glow fallback (the core vein and a faint inner warmth) and the veins ignite when it arrives. If it fails, the fallback stays.
- **Scroll works from the moment the story mounts.** A scroll made before the scene existed is honoured when it arrives. Tested: page progress 0.124 at mount; once L6 was in, the camera was at 0.131, equal to the page.

### Step 7: the intro (`src/components/Intro.astro`)

- **Design:**
  - The basalt screen, with the "MONOLITH" wordmark (Sora 500, 0.42em).
  - A lava fissure is drawn top to bottom through the wordmark.
  - The screen then splits along the fissure, each half carrying half the wordmark.
  - No counter, no progress bar.
- **HTML and CSS, over the page:** `aria-hidden`, `inert`, no focusable content. The content and hero headline render underneath, unchanged.
- **Timing lives in CSS.** The split runs by itself at 800 ms as a compositor animation, so it opens on time even while the main thread starts the scene. JavaScript only opens it earlier:
  - when L1's first frame is on screen, or the tier turns out to be the poster (never before 400 ms)
  - immediately on any click, key, wheel or touch
- **When it shows:** once per browser session (`sessionStorage`, which is per tab), on a direct visit to `/` only. It never shows for deep links (`/#face-ii`), back/forward, ClientRouter navigations, other pages, reduced motion, or without JS.

## Deviations from the spec, and why

- **KTX2 replaced by AVIF planes plus a PNG fallback.**
  - three's Basis transcoder alone is **245 KB gzipped** (`basis_transcoder.wasm` + `.js`), more than the whole atlas budget. KTX2/UASTC of a 4-channel 1024 × 2048 field would also be far over 300 KB.
  - Grayscale AV1 planes give 133 KB, decode natively off the main thread, and need no wasm.
  - The cost is GPU memory: an uncompressed 8 MB RGBA texture (plus mips) instead of a compressed one. That is acceptable for one texture.
- **The tiling textures are generated at runtime, not baked to files.** They are tiny: 256² noise, and a 512² Voronoi tile in the layers chunk. Generating them costs a few milliseconds and saves two requests and two decodes.
- **The terrain tile is a noise tile, not a normal and roughness map.** It perturbs the normal and the albedo exactly as High's procedural noise does, so the look matches.
- **The breaks along each vein are folded into the main-vein distance (r), not the strength (b).** Without bloom, a strength channel with holes left dark ellipses inside the glow. High never shows them because bloom fills them.
- **Vein strength no longer carries the breaks,** so the heat response is approximated: heat multiplies strength (×1.5 at full heat) instead of shifting the region threshold. Veins still visibly widen and brighten.
- **Lite's DPR cap is 1.25,** with the dynamic scale on top. Phones at DPR 3 render at 1.25 and lower.
- **2G and ≤2 GB memory no longer mean the poster.** The spec limits the poster to the listed cases; such devices start on Lite and step down if they must.
- **The WebGL tier probe runs in a worker** (OffscreenCanvas), and on the main thread only where the worker can't create a context. With the stricter tier rules ("no WebGPU adapter" no longer means weak), the main-thread probe ran on Lighthouse's software renderer and cost 1.4–1.9 s of blocking time. In the worker it costs nothing.
- **Upgrades:**
  - With GPU timer queries: allowed when this tier's GPU time is under 35% of the next tier's frame budget.
  - Without them: only Lite can show headroom (every vsync on time while capped at 30 fps), so Lite → Medium works everywhere and Medium → High needs the extension.
  - Each upgrade happens at most once per tier per session. A tier that failed is never upgraded back into.
- **Pointer heat is part of L6 but is never dropped under load.** It costs one distance and one exponential, and every live tier must keep it. The droppable extras are crazing (High), the full horizon smoke (High, Medium) and 40% of the embers.
- **Lite's glow sprites are part of L1** (one draw each), so the core vein glows from the first frame.
- **Medium keeps High's per-pixel sky.** Its smoke drops to one octave when the extras are off.
- **The sky is drawn after the opaque scene on every tier,** including High. This is a performance change only; the High image is unchanged (47.2 dB against the poster).
- **The scroll story's modes map onto the new tiers:**

  | Tier | Story mode |
  |---|---|
  | Any live tier | full |
  | Poster | lite |
  | Reduced motion | static |

  The legacy `?tier=low` and `?tier=off` both mean the poster.

## Final tier rules

1. **Fast rules, before first paint:**
   - Reduced motion → poster.
   - `?tier=` (high, medium, lite, poster) forces a tier and is never changed by the controller.
   - Save-Data → poster.
2. **Session cache** (sessionStorage, key `monolith:tier`). If present, it is used and the GPU is not probed again (see below).
3. **WebGPU adapter** (1.5 s timeout). Only decisive answers are used:
   - a fallback adapter → poster
   - NVIDIA → High
   - Apple without touch → High
   - anything else, or no answer → the WebGL renderer string decides
4. **WebGL2 probe** (worker; main thread as fallback). Applied in this order:

   | Result | Tier |
   |---|---|
   | No WebGL2 | Poster |
   | Software renderer (SwiftShader, llvmpipe, softpipe, Microsoft Basic Render) | Poster |
   | High pattern: NVIDIA, GeForce, Quadro, RTX/GTX, Radeon RX/Pro/VII/R9, Intel Arc A-series, Apple M | High |
   | "Apple" on a device without touch (Safari on a Mac says only "Apple GPU") | High |
   | Medium pattern: Iris Xe, Intel Arc integrated, Radeon nnnM, Adreno 7xx/8xx, Mali-G7x/G7xx/G9xx, Immortalis, Xclipse | Medium |
   | **Anything else** (UHD/HD Graphics, older Adreno and Mali, PowerVR, iPhones and iPads, unknown strings) | **Lite** |

5. **The whole detection has a 4 s timeout.** If it times out, the tier is Lite, not the poster.
6. **The scene then adjusts:** resolution, then extras, then one tier down; the poster only from Lite at minimum resolution. Upgrades as described above.

**Classification tested** (Playwright, stubbed renderer strings):

| Device (emulated) | Renderer string | Tier |
|---|---|---|
| Desktop | RTX 3060 (with and without ANGLE prefix) | High |
| Desktop | Radeon RX 6700 XT | High |
| Desktop | Apple M1 Pro | High |
| Desktop | Apple GPU | High |
| Desktop | Iris Xe | Medium |
| Pixel 7 | Adreno 730 | Medium |
| Pixel 7 | Mali-G78 | Medium |
| Desktop | UHD Graphics 620 | Lite |
| Desktop | Radeon(TM) Graphics | Lite |
| iPhone 13 | Apple GPU | Lite |
| Pixel 5 | Adreno 618 | Lite |
| Galaxy S9+ | Mali-G52 | Lite |
| Galaxy S9+ | PowerVR GE8320 | Lite |
| Desktop | "Some Future GPU 9000" | Lite |
| Desktop | SwiftShader | Poster |
| Desktop | No WebGL2 | Poster |

A hung `requestAdapter` resolved through WebGL after 2.3 s.

**Session cache fields** (`monolith:tier`, version 2):

| Field | Meaning |
|---|---|
| `tier` | The settled tier |
| `reason` | Why (shown in the overlay) |
| `ceiling` | The highest tier this session may still try (lowered whenever a tier fails) |
| `upgraded` | Tiers already reached by an upgrade |
| `scale` | The last resolution scale (the next visit starts there) |
| `gpu` | The renderer string the decision was based on |

**When the cache is written:**
- after the GPU probe
- whenever the scene settles
- whenever the scene changes tier
- when it fails for good: context not restored, no first frame, setup failure, or Lite unable to hold 24 fps

**When it is invalidated:**
- when the tab closes (sessionStorage)
- when `CACHE_VERSION` changes
- it is ignored when `?tier=` forces a tier
- reduced motion and Save-Data override it at every visit

The intro uses its own key (`monolith:intro`).

## Cost tables (SwiftShader GPU ms per frame; relative only)

Chapter 00, Lite at scale 1.0 unless noted, measured with the timer queries.

**Baseline before Phase 2.5** (step 1):

| Tier | Size | Sky | Terrain + peaks | Lava | Monolith | Embers | Post | Frame |
|---|---|---|---|---|---|---|---|---|
| High | 1280×720 | 179.7 | 378.5 | 23.4 | 289.9 | 6.2 | 279.4 | **1157** |
| Medium | 1280×720 | 113.0 | 148.8 | 11.6 | 98.3 | 2.2 | 168.6 | **542** |
| High | 390×844 | 66.8 | 187.5 | 19.6 | 200.2 | 8.9 | 93.9 | **577** |
| Medium | 390×844 | 42.9 | 66.0 | 7.3 | 55.1 | 0.9 | 58.7 | **231** |

**What the baseline showed:**
- The expectation was half right. The monolith (25%) and post-processing (24%) are large.
- But at 1280×720 the **terrain and its fog were the largest** (33%), and the **sky was 16%**: it was shaded behind everything, every pixel.
- The savings came from all four: the baked fissures, baked terrain detail, per-vertex fog and sky, and no post chain on Lite. The sky also got cheaper on every tier by drawing it last.

**After Phase 2.5:**

| Tier | Size | Sky | Peaks | Terrain | Lava | Monolith | Glow | Embers | Post | Frame |
|---|---|---|---|---|---|---|---|---|---|---|
| High | 1280×720 | 162.6 | 72.4 | 311.8 | 72.1 | 412.5 | — | 37.7 | 49.0 | **933–1016** |
| Medium | 1280×720 | 116.1 | 41.2 | 118.6 | 20.1 | 35.5 | — | 13.4 | 124.2 | **433** |
| Lite | 1280×720 | 41.6 | 25.4 | 89.5 | 8.8 | 24.9 | 5.5 | 1.0 | — | **158–196** |
| Lite, scale 0.5 | 1280×720 | 10.9 | 11.2 | 28.0 | 4.2 | 6.7 | 1.3 | 0.3 | — | **63** |
| High | 390×844 | 59.3 | 41.7 | 178.6 | 46.3 | 287.0 | — | 27.9 | 68.5 | **639** |
| Medium | 390×844 | 37.3 | 16.9 | 49.9 | 6.0 | 14.1 | — | 1.1 | 56.6 | **181** |
| Lite | 390×844 | 14.4 | 10.6 | 38.7 | 6.0 | 9.9 | 2.6 | 0.4 | — | **83** |
| Lite, scale 0.5 | 390×844 | 5.6 | 7.7 | 17.1 | 4.2 | 5.5 | 0.8 | 0.4 | — | **41** |

**Ratios** (three runs at 1280×720: High 933, 1016 and 998 ms; Lite 196, 163 and 158 ms):

| Size | Lite vs High | Medium vs High |
|---|---|---|
| 1280×720 | **5.7× cheaper** at the same resolution; about 15× with the scale at its 0.5 floor | 2.3× |
| 390×844 | **7.7× cheaper** | 3.5× |

**Notes on the numbers:**
- The per-layer split inside one frame is noisy on SwiftShader (it interleaves work); the frame totals are the reliable figure.
- The monolith costs more on High than in the baseline because the baseline's monolith time was partly hidden in the post slice. The frame totals agree within noise.

## Screenshots

Same camera positions, Chapters 00–04 and the dive (top to bottom); High, Medium, Lite (left to right):

- `docs/phase-2-5/tiers-1440.webp` (1440×900)
- `docs/phase-2-5/tiers-390.webp` (390×844)

All three read as the same stone, with the same veins in the same places. **Medium** is very close to High; the main loss is the hairline crazing. **Lite** differs in four ways:
- the vein glow is redder and more saturated, because there is no bloom to whiten it
- some small branch loops render as filled pockets rather than outlines
- the stone's reflections are softer (lit per vertex)
- there are fewer embers

The dive washes to molten light on every tier.

## Chunk and asset sizes (gzip -9)

| Asset | Size | Loaded |
|---|---|---|
| Initial JS: ClientRouter 4.8 + layout/boot 3.2 + shared quality and diagnostics 3.4 | **≈ 11.4 KB** (budget 100 KB) | every page |
| Scene core chunk (three, renderer, sky, peaks, monolith, glow, atlas loader, camera, controller) | **155.3 KB** | live tiers |
| Layers chunk (terrain, lava, embers, postprocessing, wash) | **20.4 KB** | live tiers, after L1 |
| Story chunk (GSAP, ScrollTrigger, story) | 46.1 KB | home |
| Fissure atlas, AVIF planes | **133 KB** (budget 300 KB) | Medium, Lite |
| Fissure atlas, PNG fallback | 1.14 MB | only if the AVIF fails |
| Grain tile | 16 KB | Lite only |
| `?fps` overlay | 1.6 KB | only with `?fps` |

**Total scene download:**

| Tier | Size | Spec budget |
|---|---|---|
| High | 176 KB | 1.5 MB |
| Medium | 309 KB | 600 KB |
| Lite | 325 KB | — |

## Lighthouse mobile (local production build; software GPU, so the device gets the poster)

| Run | Intro | Performance | Accessibility | Best Practices | SEO | FCP | LCP | TBT | CLS |
|---|---|---|---|---|---|---|---|---|---|
| 1 | yes (`/`) | 97 | 100 | 100 | 100 | 1.5 s | 2.2 s | 140 ms | 0 |
| 2 | yes | 99 | 100 | 100 | 100 | 1.4 s | 1.7 s | 40 ms | 0 |
| 3 | yes | 99 | 100 | 100 | 100 | 1.4 s | 1.7 s | 100 ms | 0 |
| 1 | no (`/#main`) | 98 | 100 | 100 | 100 | 1.5 s | 2.2 s | 50 ms | 0 |
| 2 | no | 99 | 100 | 100 | 100 | 1.4 s | 1.7 s | 100 ms | 0 |
| 3 | no | 99 | 100 | 100 | 100 | 1.4 s | 1.7 s | 70 ms | 0 |

LCP is under 2.5 s with the intro active, and the intro makes no measurable difference. Phase 2 measured 99–100 with LCP 1.7–2.1 s.

**Two regressions were found and fixed along the way:**
1. **The main-thread WebGL probe (TBT 1.4–1.9 s):** moved into a worker.
2. **Early requests competing with the LCP fonts (LCP up to 2.9 s):** the grain tile is now Lite-only, and the scene-chunk prefetch now waits until the GPU check is still unanswered a second after `load`.

## Testing done

- **Builds and checks:** `npm run build` (0 errors, 0 warnings), `npm run lint`, `npm run format:check` and `npm run check:camera` all pass.
- **Hex colours:** none added outside `tokens.css` and `palette.ts`; the bake and the shaders take colours from uniforms.
- **Downgrade ladder** (a "desktop GPU" that is really SwiftShader):
  - The resolution stepped 1.0 → 0.5, then the extras went off.
  - Then High → Medium → Lite, each rebuilt in place.
  - Then the poster ("lite can't hold 24 fps at half resolution").
  - The story switched to lite mode, the reasons appear in the overlay, and a reload in the same tab started from the session cache with no probe.
- **Progressive layers:** marks arrive in the order L1 compiled, first frame, L2, L3, L4, L6. Scrolling before the scene existed was honoured on arrival.
- **Atlas fallbacks:**
  - AVIF blocked → the PNG is used.
  - Both blocked → the flat glow (core vein and inner warmth), never a blank stone.
- **Context loss and restore** on Lite: the poster on loss; on restore, rebuilt and live.
- **Intro:**
  - **Timing:** measured from the animations' own start times, the split begins at most about 700 ms after first paint, even when the main thread is blocked. A key press opens it at once; on the poster tier it opens at 400–480 ms.
  - **Skipped where it should be:** reload in the same tab, back/forward, deep link, `/about`, reduced motion and no JS (not displayed).
- **Lifecycle, re-run unchanged:**
  - **Deep link `#face-ii`:** lands on the chapter without replay.
  - **HUD:** Enter scrolls to the chapter and focuses its heading.
  - **Two `/about` round trips:** 0 ScrollTriggers on `/about`, 14 on each return, the same position, chapter and temperature.
  - **Back/forward:** restores scrollY 3000.
  - **Reduced motion, no JS and keyboard tab order:** all unchanged.
  - The intro was active on these fresh visits; the first Tab press still lands on the skip link.

## Known issues

- **No real GPU here.** Every frame rate is SwiftShader, which is 10–100× slower than real hardware. Thresholds (15% over budget, 5 s for upgrades, 35% headroom) are reasoned, not tuned on devices.
- **Upgrades without timer queries:** only Lite → Medium can be proven (every vsync on time while capped at 30). Medium → High needs `EXT_disjoint_timer_query_webgl2`, which many browsers hide. A Medium device that could run High stays on Medium unless its GPU string says High.
- **iPhones and iPads start on Lite.** Safari reports only "Apple GPU", so model generations can't be told apart. They step up to Medium once they hold 30 fps with every vsync on time for 5 s.
- **Convergence is slow on very slow devices.** The controller needs 8 rendered frames per decision, so a device at 5 fps takes several seconds per step. On real hardware a step takes about 0.5 s.
- **KHR_parallel_shader_compile is missing in SwiftShader,** so adding a layer stalls here, and "no visible freeze when each layer is added" can't be shown in this container. On browsers with the extension, compilation is asynchronous and the poster covers L1's compile.
- **Lite's branch loops:** a few small loops render as filled pockets, because the atlas can't resolve loops smaller than a few texels. It reads as magma pockets.
- **Lite's left-face edge:** at a grazing angle the atlas's anisotropic sampling shows a few blocky texels near the edge.
- **Intro wordmark:** set in Sora 500, which isn't preloaded (preloading it delayed the LCP fonts). On a very slow first load the wordmark can swap from the fallback face mid-intro.
- **Session scope:** `sessionStorage` is per tab, so a new tab is a new session: the probe runs again and the intro shows again.

## What the owner should check on real devices with `?fps`

Open `/?fps` in a **fresh private tab** on each device. The overlay shows four groups of information:
- `setup` (tier, post or no post, layers present, atlas AVIF or PNG)
- `scale × dpr` (the resolution actually rendered)
- `target · frame · extras`, and the last decisions with reasons
- `gpu ms` per layer, if the browser exposes timer queries

Screenshot the overlay after about 20 seconds.

1. **Desktop with an RTX 3060.** Expect `high, post` and scale 1.00 with no decisions after the first seconds. If it scales down, the `gpu ms` lines show which layer costs most.
2. **The laptop that was Low.** Expect `lite` or `medium`. If it is Lite and holds 30 fps at full scale for 5 s, it may upgrade itself ("tier lite → medium (headroom…)"). Check that the stone reads as the same artwork.
3. **Phones.** Expect `lite` (iPhone) or `medium` (recent Android flagships). Check that the scale settles (decisions stop) and that scrolling feels smooth.
4. **Intro and layers.** Visit `/` once in a fresh tab and watch the intro. Then open **Load**: it lists boot start, tier final, scene chunk loaded, fissure atlas ready, L1 compiled, first frame, L2…L6.
5. **Whenever the poster shows,** open **Diagnostics**: the fallback line says why.
6. **To compare tiers on one device,** use `?tier=high&fps`, `?tier=medium&fps` or `?tier=lite&fps` (forced tiers never change tier, but still scale). Add `&scale=1` to hold full resolution.

## What Phase 3 needs to know

- **Scene API additions:** `handle.tier`, `handle.stats()`, `handle.gpuTimings()`.
- **New `createScene` options:**
  - `startScale`, `ceiling`, `upgraded` (session state)
  - `atlas` (a fetch already in flight)
  - `onSettle`, `onDecision`
  - `fixedScale`, `gpuTiming`
- **Tier changes:** the scene changes tier by itself, in place. `onTierChange` reports it, and `scene-boot`'s `setTier(…, fromScene)` handles it. Only `poster` tears the scene down.
- **Tiers:** `quality.ts` exports `TIER_SETTINGS` for `high`, `medium` and `lite`. `isSceneTier()` replaces the old High/Medium checks, and `html[data-tier]` is now `high`, `medium`, `lite` or `poster`.
- **Rebake after changing the fissure maths.** `fissure-field.glsl` is shared with the bake: after changing it, or the monolith's displacement (`monolith-geometry.ts`), run `npm run bake` (needs ffmpeg with libaom; set `CHROMIUM_PATH` if Playwright's default browser isn't installed). The High posters only need `npm run posters` if High's look changes.
- **Page transitions (Phase 4):** content pages still leave the canvas dormant. Lite's CSS look (grain, vignette) and CSS wash live in `SceneStage.astro`.
- **The intro** is `Intro.astro` plus a head script in `BaseLayout.astro` (decides `intro-on`). It uses `--z-intro` (60) in `tokens.css` and listens for the `monolith:scene-ready` and `monolith:poster` events that `scene-boot` dispatches.
