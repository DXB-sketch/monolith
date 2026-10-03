# Phase 1 complete: Foundation and the hero scene

## What was built

**Project setup**
- Astro 7 (strict TypeScript), static output, `@astrojs/vercel` adapter. One on-demand route is reserved for Phase 3: `src/pages/api/contact.ts` (`prerender = false`, returns 501 for now). Every page is prerendered.
- Dependencies: `three` 0.186, `postprocessing` 6.39, `gsap` 3.15, `lenis` 1.3 (GSAP and Lenis are installed but unused until Phase 2).
- ESLint (flat config, typescript-eslint, eslint-plugin-astro) and Prettier (with prettier-plugin-astro). `npm run build` runs `astro check` and then `astro build`.
- Scripts: `dev`, `build`, `preview`, `check`, `lint`, `format`, `format:check`, `posters`.

**Design foundation**
- `src/styles/tokens.css` holds every palette token from ART_DIRECTION.md, plus RGB triplets for translucent mixes, semantic aliases, a fluid type scale (clamp, 360 to 1440px), space, radii, surfaces, easing (power3.out and expo.out equivalents), durations and z-layers.
- `src/scene/palette.ts` mirrors the colour tokens. Every shader colour reaches the GPU as a uniform from this file (`src/scene/uniforms.ts`).
- Fonts are self-hosted from `public/fonts` (Latin subset, woff2, `font-display: swap`): Sora 200/300/500 and JetBrains Mono 400/500. Sora 200 (hero display) and Sora 300 (body) are preloaded.
- `global.css` sets the basalt background and bone text, lava `:focus-visible` rings, the skip link, pill buttons and reduced-motion overrides.

**Layout and pages**
- `BaseLayout.astro` provides head metadata (canonical, Open Graph from the poster), `ClientRouter`, the skip link and the persistent decorative stage (poster plus canvas, `aria-hidden`, `pointer-events: none`, `transition:persist`). It also holds the nav, `<main id="main">` and the footer.
- Nav is a frosted pill with the wordmark, Work, Lab, Services, About and a lava "Start a project" button. Below 52rem it collapses into a disclosure menu: `aria-expanded`/`aria-controls`, Escape closes and returns focus, and it closes on outside click or when focus leaves. Opening it from the keyboard moves focus into the links. Without JS, the links stay visible inside the pill.
- Footer has the email placeholder, "Wamuran, Queensland" with coordinates, social placeholder, site links and the ABN placeholder.
- Stub pages exist for every route in BRIEF.md: `/work`, `/work/[slug]` (seqdvgc, allen-gillon, concept), `/services`, `/about`, `/lab`, `/lab/[slug]` (light-through-stone), `/contact` and a 404 ("You've wandered off the edge of the map").
- The home page is all semantic HTML:
  - Hero (h1 "Forged in fire. *Built to stand.*", intro, two buttons)
  - Face I (SEQDVGC) and Face II (Allen Gillon)
  - The Lab (teaser, experiment link, concept card clearly labelled "Concept")
  - The Core (Ember / Flow / Eruption with `from [$ PRICE]`, final CTA "Let's make something that stands.")
  - The plain safety-net section, then the footer
- HUD (≥64rem): coordinates, core temp and a pulsing live dot top left; the chapter index top right, as real links. It hides when the plain section is reached.

**Quality tiers and posters**
- `src/scene/quality.ts` runs `detectTierFast()` synchronously from cheap signals (forced `?tier=`, reduced motion, save-data, 2G, memory, cores).
- `detectTier()` adds the GPU check after first paint, and only on pages with a scene. It asks WebGPU's async adapter first: no adapter or a fallback adapter means Low. Otherwise it falls back to a WebGL2 probe with renderer-string classification (software → Low; weak mobile GPUs → Low; mobile/integrated GPUs, touch, small screens or ≤4 GB/≤4 cores → Medium; otherwise High).
- `src/lib/scene-boot.ts` is in the initial bundle and never imports Three.js. For High and Medium it dynamic-imports the scene chunk after first paint (rAF + idle callback) and cross-fades from the poster when the first frame is on screen. Off and Low never load Three.js; Low gets a CSS-only scroll-linked poster drift.
- Posters are rendered from the live scene, not a temporary image: `npm run posters` (`scripts/render-posters.mjs`) drives the dev-only `/dev/scene` route and encodes WebP and AVIF. Sizes: landscape 1920 and 1280, portrait 1080×2160 and 720×1440 (the portrait framing puts the stone above the copy). `<picture>` chooses by orientation and format.

**The Chapter 00 scene** (`src/scene/`)
- Every module returns `{ object, update(state), dispose() }` so procedural geometry can later be swapped for a GLB.
- `monolith.ts` and `shaders/monolith.frag`:
  - **Geometry.** A 5 × 16 × 2.5 m slab (1 : 3.2 : 0.5), tapered, leaning about 1.5°, with bulging faces and chipped vertical and crown edges. Offsets are position-only, so box seams never split.
  - **Obsidian surface.** Near-black glass with conchoidal ripples (a screen-space bump from banded noise), Fresnel reflections of the analytic dusk sky and lava-lit ground, and GGX afterglow highlights. Ash dust dulls the base, and a warm rim light catches the silhouette.
  - **Fissures.** Main veins use exact 3D Voronoi border distance on domain-warped, vertically stretched coordinates. A low-frequency region mask means only a few veins survive, with breaks and brightness changes along their length. Branch cracks grow only near main veins, and hairline crazing sits beside the hottest veins on High. Cores are thin, anti-aliased with `fwidth`, and run from lava-hot down to lava. The halo has an exponential falloff.
  - **Pulse.** Three incommensurate sine frequencies with a spatially varying phase, plus slow upward-flowing brightness.
  - **Heat.** Per-face `uFaceHeat` and pointer heat both brighten and widen the fissures, open more branches and warm the glass.
  - **Lava light.** Six lava point lights from the channel light the lower stone.
- `terrain.ts` creates basalt ground on a grid that is denser near the stone, flat around the monolith and the camera sightline and rising into ridges. The lava channel is carved into it, there's per-vertex distance-to-lava for the glow, and the banks have hot cracks. It also builds seven volcanic plugs after the Glasshouse Mountains (Beerwah-like dome, Coonowrin-like crooked neck, Tibrogargan-like knuckle).
- `channel.ts` defines one channel path from the distant peaks around the front of the base and out to the left foreground (a leading line). A grid accelerates distance queries.
- `lava.ts` builds a ribbon along the channel. The shader shows dark crust plates drifting on a molten flow: seams open toward the centre, some plates are half melted, banks are solid crust and it settles to an average glow in the distance. Cartoon lava is avoided.
- `sky.ts` is a dusk gradient dome (basalt overhead, warm charcoal, magma, a thin ember band) with an afterglow behind the stone, low-contrast drifting horizon smoke and a few faint stars.
- `shaders/atmosphere.glsl` holds the shared sky colour and exponential height fog. Fog fades to the sky colour in the same view direction, so distance melts into the glow.
- `embers.ts` is a GPU point system: life, rise, sway, wind and flicker are computed entirely in the vertex shader. Embers come off the lava near the stone and the monolith's base and cool from lava-hot to ember as they rise. Density is a uniform.
- Post-processing: mipmap bloom (luminance threshold on HDR, so only emissive surfaces bloom), vignette, ACES Filmic tone mapping and film grain, merged into one effect pass. Half-float buffers, with 4× MSAA on High.
- `camera-path.ts` has Chapter 00 keyframes with landscape and portrait compositions blended by aspect ratio, plus a very slow idle drift.

**Pointer heat and lifecycle**
- A pointer ray is tested against the monolith's local bounding box. A near miss heats the closest part of the stone with falloff. The heat point follows smoothly; the stone warms over about 0.4 s and cools over about 1 s. Mouse only (`hover: hover` and `pointer: fine`).
- Rendering pauses when the hero leaves the viewport (IntersectionObserver on `[data-scene-anchor]`) and when the tab is hidden. The stage dims when dormant.
- On navigation the canvas persists (`transition:persist` on the stage element). It pauses and dims on pages without a scene anchor and resumes on returning home.
- ResizeObserver resizes the renderer, composer and point scale, with the DPR capped per tier.
- After 3 s the average frame time is checked once: High drops to Medium in place (DPR, MSAA, ember count); Medium drops to Low (canvas fades back to the poster, then everything is disposed).
- WebGL context loss falls back to the poster. Switching reduced motion on at runtime tears the scene down.
- `dispose()` releases geometries, materials, composer targets and the renderer, and forces context loss.

## Deviations from the spec, and why

- **Docs moved into `docs/`.** They were at the repo root; CLAUDE.md and the phase prompt reference `docs/…`.
- **`ClientRouter` is active now.** Page transition effects remain Phase 4, but the persistent canvas needs the router, and building the lifecycle around it now avoids rework. Scripts re-bind on `astro:page-load`.
- **Hero composition.** I read "monolith centred, slightly left of the hero text block's visual weight" literally. On desktop the stone stands just left of centre and the copy block sits to its right. On portrait screens the stone rises above the copy, which sits at the bottom. The camera views from front-left, so the left face catches the afterglow.
- **Medium tier keeps vignette and grain.** They're merged into the same single pass as bloom, so they cost almost nothing. Heat haze isn't built on any tier yet; SCENE_SPEC puts it in Phase 4.
- **No `detect-gpu` dependency.** A small heuristic plus the WebGPU adapter covers the cases without a network lookup or extra bytes.
- **Tier detection was made asynchronous** (see Performance). The spec's "detect once at start-up" still holds: one decision, made after first paint instead of before it.
- **Every shader output is capped (`safeHdr`) and terrain varyings are clamped.** With MSAA, varyings are evaluated at pixel centres that can fall outside thin far-away triangles. An extrapolated value overflowed the half-float target to Inf, and bloom smeared it into a white disc. The terrain grid also keeps a minimum spacing, because degenerate triangles produced zero normals.
- **The HUD chapter index highlights 00 statically.** Live tracking is Phase 2 scope.
- **Copy I wrote** where BRIEF.md has none: the hero intro, the Lab teaser, the Core heading ("Three ways to work together. Every one is hand-built by me."), the plain section's about and start lines, the footer line, and the stub-page intros. All of it is first person and makes no claims about clients, metrics or awards. The one Lab entry, "Light through stone", is this site's fissure shader; its write-up is a placeholder.
- **`favicon.svg`** in `public/` contains literal hex colours (an SVG asset can't read CSS variables). There are none in components or styles.

## Libraries chosen and why

- **`postprocessing` (pmndrs) rather than three's example passes.** It merges bloom, vignette, tone mapping and grain into one fullscreen pass instead of four or more, which matters on Medium and mobile. Its mipmap bloom is higher quality and cheaper than `UnrealBloomPass`, and a luminance threshold on half-float buffers gives effectively selective bloom (only emissive surfaces exceed it). It also handles MSAA on its targets. It supports three `< 0.187`.
- **Vanilla Three.js** with custom `ShaderMaterial`s throughout: full control of the look and smaller than extending `MeshPhysicalMaterial`.
- **`playwright-core` (dev only)** drives poster rendering.

## Performance

**Vercel deploy preview** (`dpl_EyZUxDwUm2KddXBFLutE87RQASMe`, commit `a315f21`, iad1): the build succeeded. I ran Lighthouse mobile three times from this container through a temporary share link, which adds one auth redirect:

| Run | Performance | Accessibility | Best Practices | SEO | FCP | LCP | TBT | CLS |
|---|---|---|---|---|---|---|---|---|
| 1 | 95 | 100 | 100 | 63* | 2.2 s | 2.4 s | 0 ms | 0 |
| 2 | 97 | 100 | 100 | 63* | 1.9 s | 2.1 s | 0 ms | 0 |
| 3 | 97 | 100 | 100 | 63* | 1.9 s | 2.1 s | 0 ms | 0 |

\* SEO's only failing audit is `is-crawlable`: Vercel adds `X-Robots-Tag: noindex` to every preview deployment on purpose. Production deployments don't get this header, and the local build scores SEO 100.

Measured in this cloud container, which has **no GPU**: WebGL runs on SwiftShader (software). Lighthouse ran locally against the production build served with gzip (`serve`).

**Lighthouse mobile** (default Moto G Power emulation, 4× CPU, slow 4G), three runs after the final fix:

| Run | Performance | Accessibility | Best Practices | SEO | FCP | LCP | TBT | CLS |
|---|---|---|---|---|---|---|---|---|
| 1 | 99 | 100 | 100 | 100 | 1.4 s | 1.7 s | 0 ms | 0 |
| 2 | 100 | 100 | 100 | 100 | 1.4 s | 1.7 s | 10 ms | 0 |
| 3 | 100 | 100 | 100 | 100 | 1.4 s | 1.7 s | 0 ms | 0 |

Before the tier-detection change, Performance was 72–87 with 0.5–1.9 s TBT. The cause was the synchronous WebGL probe: SwiftShader context creation took about 2 s under throttling.

Lighthouse's emulated device lands on the Low tier (no hardware adapter), so these scores cover the poster path, which is what most constrained phones get.

**Bundle sizes** (gzip -9):

| Asset | Size |
|---|---|
| Initial JS: ClientRouter 4.8 KB + boot 1.9 KB + quality 1.2 KB | **≈ 7.9 KB** (budget 100 KB) |
| Scene chunk (Three.js, postprocessing, shaders) | **161 KB** (budget 300 KB); no textures or models |
| CSS (three files) | ≈ 6.1 KB |
| Home HTML | 5.5 KB |
| Posters AVIF (all four) | 60 KB total; the 1920 landscape is 16 KB, 1280 is 10 KB |
| Fonts (five woff2) | 96 KB total, two preloaded (30 KB) |

**Frame rate.** Not measured on real hardware; this container has no GPU. SwiftShader figures, useful only as relative cost:

| Tier and size | SwiftShader fps |
|---|---|
| High, 1280×720 | 1.4 |
| Medium, 1280×720 | 3.6 (Medium is ~2.7× cheaper than High) |
| Medium, 390×844 | 7.9 |

The acceptance targets (High at 60 fps on a recent laptop, Medium at 30 fps or better on a mid-range phone) **still need checking on real devices**.

## Testing done

- `npm run build`: 0 errors, 0 warnings, 0 hints. `npm run lint` and `npm run format:check` are clean.
- No hex values in any component or style outside `tokens.css` and `palette.ts` (grep).
- **Reduced motion:** tier Off, poster shown, no scene chunk requested, all content usable.
- **WebGL disabled:** tier Off, poster shown.
- **JavaScript disabled:** poster shown, mobile nav links visible in the pill, all content and links work.
- **Software GPU:** tier Low, poster with the CSS drift.
- **Lifecycle** (scripted with Playwright, counting draw calls): renders while the hero is visible, pauses and dims when scrolled away, resumes on return. The canvas element survives navigation to /about (dormant there) and is live again back home. The HUD hides at the plain section.
- **Keyboard:**
  - The first Tab shows the skip link on screen; Enter moves focus to `main`.
  - Tab order runs through the hero buttons and the cards in reading order.
  - The mobile menu opens with Enter and focus moves to the first link; Escape closes it and returns focus to the toggle.
- **Contrast over the live scene.** I sampled rendered backgrounds behind the hero text, excluding glyph pixels, and measured contrast at the 99th-percentile background:

  | Text | Desktop | Mobile |
  |---|---|---|
  | Intro (ash-soft) | 5.9:1 | 5.3:1 |
  | Eyebrow (bone) | 7.9:1 | 9.1:1 |

  All token pairs on flat backgrounds pass AA: ash on basalt is 8.7:1, lava on basalt 6.4:1, basalt on lava 6.4:1.
- **Narrow mobile (390×844):** layout, menu, poster and live scene (Medium) all checked.

## Known issues

- **Deploy preview.** I created the Vercel project `monolith` (team "DXB-sketch's projects") linked to this repo; every push to this branch creates a preview. Previews sit behind the team's default deployment protection, so viewing one needs a Vercel login or a share link.
- **Vercel labels this branch's deployment target as "production".** `main` is still the production branch and holds only the docs; check this before merging.
- **Node version.** Vercel warns that `engines.node: ">=22.12.0"` will float to new Node majors. Pin it (e.g. `22.x`) if that's unwanted.
- **Real-device testing is outstanding:** fps per tier, iOS Safari and Firefox (the WebGL probe path), and tier classification on actual phones.
- The `site` URL in `astro.config.mjs` is a placeholder (`https://monolith.example`) until [DOMAIN] is supplied. It affects canonical and Open Graph URLs only.
- The dev-only scene route's script (445 bytes) is emitted to `_astro/` in production builds, but no page references it.
- `?tier=high|medium|low|off` overrides detection on any page. It's useful for testing and harmless, but it's public.
- The first frame on High compiles all shaders. `compileAsync` is used, but where `KHR_parallel_shader_compile` is missing, compilation still blocks once, after first paint.
- The lava ribbon is lifted slightly in the far distance so it never sinks into the coarser terrain grid there.

## What Phase 2 needs to know

**Public API** (`src/scene/index.ts`), unchanged from SCENE_SPEC:
- `createScene(canvas, { tier, onFirstFrame?, onTierChange?, capture?, debugHide?, debugNoPost? })` returns a handle. Note that it is `async`.
- Handle methods: `setProgress(p)`, `setChapter(i)`, `setPointer(x, y)`, `pause()`, `resume()`, `dispose()`.
- `setProgress` is a stub: it stores the clamped value and does nothing else.
- `setChapter` selects a `CHAPTER_FRAMES` entry. Only Chapter 00 exists; out-of-range indices clamp to it.
- `scene-boot.ts` owns the handle. Phase 2's scroll system should get the handle from there; don't create a second scene.

**Per-frame state** (`SceneState` in `types.ts`), read by every module's `update()`:
- `faceHeat: Vector4` maps to `uFaceHeat` as **(front +z, right +x, back −z, left −x)** in monolith object space. The Chapter 00 camera sees the front and the left face.
- `emberDensity` maps to `uDensity` (Chapter 00 uses 0.55). It's the fraction of the particle pool alive; per-particle `aSeed.w` is compared against it, so changes are smooth.
- `lavaIntensity` maps to `uLavaIntensity` (1.0).
- `pointerPoint` and `pointerHeat` are computed internally from `setPointer`.

**Other uniforms** worth driving per chapter:
- Monolith: `uFissureGain` (1.0), `uPointerRadius` (3.2 m).
- Shared, in `uniforms.ts`: `uGlow` (horizon glow strength), `uFogDensity` (0.0019), `uSunDir`, `uTime`.
- For Chapter 04's wash toward lava-hot, add an effect after bloom, or raise bloom intensity and `uFissureGain`.

**Camera.** `CHAPTER_FRAMES` holds `{ landscape, portrait }` framings of `{ position, target, fov }`, and `framingFor(chapter, aspect)` blends them by aspect ratio. Add chapters 01–04 there and interpolate (CatmullRom for position, eased target) from `setProgress`. Idle drift is added on top in `render()`; keep it.

**Geometry and coordinates.** The monolith sits at the origin (base y ≈ −0.35, height 16 m), rotated `(0.014, 0.06, −0.022, 'YXZ')`. `MONOLITH` exports its dimensions. The lava channel's control points are in `channel.ts`; `channel.lightsNear()` supplies the lava lights.

**Posters.** Re-run `npm run posters` (with the dev server running) after any visual change; it renders at a fixed `capture` time of 12 s. Phase 5 can add per-chapter posters by passing a chapter to the dev route.

**Debugging.** `/dev/scene?hide=lava,embers&nopost` isolates objects and skips post-processing.
