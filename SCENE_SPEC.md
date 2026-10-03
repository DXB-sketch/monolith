# SCENE SPEC — the 3D monolith scene

## Approach: procedural first, swappable assets later

Build the entire scene **procedurally in Three.js and GLSL**: geometry generated in code, materials made from shaders. This keeps everything in the repo, small to download, and tunable in code.

Design every scene module so a GLB model can replace its procedural geometry later (for example, a sculpted monolith or terrain made in Blender or Higgsfield and placed in `public/models/`). Each module should export a function that returns a `THREE.Object3D` plus an `update(time, state)` method and a `dispose()` method, so the source of the geometry doesn't matter to the rest of the scene.

## Public API (`src/scene/index.ts`)

```ts
createScene(canvas: HTMLCanvasElement, options: { tier: QualityTier }): {
  setProgress(p: number): void      // 0..1 scroll progress through the home story
  setChapter(index: number): void   // for non-home pages and direct links
  setPointer(x: number, y: number): void // normalised -1..1
  pause(): void
  resume(): void
  dispose(): void
}
```

Pages and the scroll system talk to the scene only through this API.

## Scene elements

### Monolith (`monolith.ts`)
- A tall rectangular slab, roughly 1 : 3.2 : 0.5 (width : height : depth), very slightly tapered and leaning (about 1–2°) so it feels natural, not CGI-perfect.
- Subdivided geometry with low-amplitude noise displacement on the faces and slightly chipped edges, so it reads as rough-hewn stone with clean overall lines.
- **Material**: a custom shader (or `MeshPhysicalMaterial` extended with `onBeforeCompile`):
  - Base: near-black obsidian with high glossiness and subtle conchoidal ripples (noise-driven normal perturbation), so it reflects the warm horizon.
  - **Fissures**: generated in the shader from a 3D Voronoi/cellular noise edge function, masked so cracks are concentrated in a few branching veins rather than an even crackle. Emission colour goes from `--lava` at the edges to `--lava-hot` at the centre, with a slow pulse (multiple sine frequencies, not a single obvious beat).
  - Each of the four faces has a `faceHeat` uniform (0..1) that brightens its fissures when its chapter is active.
  - `pointerHeat`: a world-space point and radius; fissures and surface warmth increase near the pointer.
- Rim light: a warm directional light from the horizon behind, giving an orange edge highlight on the silhouette.

### Terrain (`terrain.ts`)
- A large plane (or a few hundred metres of ground) with fractal noise displacement. Flat near the monolith, rising into low ridges toward the horizon.
- Distant peaks: a separate silhouette mesh (or layered billboard planes) shaped like volcanic plugs (the Glasshouse Mountains), dark against the glowing horizon.
- Material: matte basalt, very dark, with fine noise detail and a faint warm reflection from the lava.

### Lava rivers (`lava.ts`)
- Channels carved into the terrain (a mask texture or spline-based ribbons) that flow toward and around the monolith's base.
- Shader: flowing noise along the channel direction, with a crust pattern (dark cooled plates over bright lava) that drifts. Emissive, contributing to bloom.
- Light the nearby terrain and the base of the monolith with the lava's glow (an approximation is fine: a gradient term in the terrain shader based on distance to the channel mask).

### Sky (`sky.ts`)
- A gradient dome: `--basalt` overhead, through warm charcoal and `--magma`, to a band of `--ember` glow at the horizon.
- Very subtle drifting smoke or ash clouds near the horizon (layered noise), low contrast.
- Optional: one or two faint stars overhead. No moon.

### Embers and haze (`embers.ts`)
- A GPU particle system (points with a custom shader): embers rise from the lava and the monolith's base, flicker, drift with a gentle wind, and fade. Density is controlled by a uniform per chapter.
- Heat haze: a screen-space distortion (in post-processing) masked to the area above the lava and behind the monolith.

### Atmosphere and post-processing
- Exponential fog tinted toward the horizon colour, so distance fades into the glow.
- Post-processing chain (use `three/examples/jsm/postprocessing` or the `postprocessing` library): selective bloom on emissive surfaces, the heat-haze distortion, a very light film grain, and a subtle vignette. ACES Filmic tone mapping.

## Camera path (`camera-path.ts`)

- Define the camera position and look-at target for each chapter (see ART_DIRECTION.md) as keyframes.
- Interpolate along a smooth path (e.g. `CatmullRomCurve3` for position, separate curve or eased interpolation for the target) driven by `setProgress(p)`.
- Add a small amount of easing and inertia so the camera never feels locked to the scrollbar. Lenis provides the smooth scroll; ScrollTrigger maps scroll position in the home story section to `p`.
- Chapter 04 ends with the camera pushing into a fissure, and the screen washing to molten light, then cooling to `--basalt` as the plain section below begins.

## Quality tiers (`quality.ts`)

Detect once at start-up (GPU tier via a lightweight heuristic or `detect-gpu`, device memory, screen size, `prefers-reduced-motion`, save-data).

| Tier | Who | What changes |
|---|---|---|
| High | Recent desktops and laptops | Full geometry subdivisions, full post-processing, ~2,000 embers, device pixel ratio capped at 2 |
| Medium | Most phones, older laptops | Lower subdivisions, bloom only (no haze), ~600 embers, DPR capped at 1.5 |
| Low | Weak devices | Static poster with a light CSS parallax; no WebGL |
| Off | Reduced motion, WebGL unavailable, no JS | Static poster only |

Re-evaluate once after 3 seconds: if the average frame time is poor, drop one tier.

## Performance rules

- Load the scene chunk with a dynamic `import()` after first paint (or when the browser is idle).
- Show the poster image (`public/posters/hero.webp`, plus AVIF) immediately; cross-fade to the live canvas once the first frame renders.
- Pause rendering when the tab is hidden (`visibilitychange`) or the canvas is scrolled out of view (IntersectionObserver).
- Reuse geometries and materials; dispose of everything in `dispose()`.
- Keep total scene download (code + any textures/models) under 1.5 MB on the High tier and under 600 KB on Medium.

## Posters

Once the scene looks right, add a dev-only route or script that renders each chapter at fixed resolutions and saves them as WebP/AVIF to `public/posters/`, for the fallback and for Open Graph images.

## Later: swapping in Blender or Higgsfield assets

If sculpted models are produced later (e.g. in Blender, or Higgsfield's Blender workspace), export as GLB with Draco or meshopt compression and KTX2 textures, place them in `public/models/`, and swap the geometry source inside the relevant module. The shaders (fissures, lava, heat) stay the same.
