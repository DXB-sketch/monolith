---
title: Light through stone
date: 2026-10-07
summary: The fissure shader behind this site, on its own. Cellular noise masked into a few branching veins, so magma reads as light leaking through rock rather than an even crackle.
demo: light-through-stone
tags: [GLSL, WebGL2, Noise]
---

## The problem with cracks

Cellular noise draws cracks easily. Take the distance to the nearest border between Voronoi cells, and anything close to zero is a crack. The trouble is that it cracks _everywhere_, evenly, like a dry riverbed or a broken phone screen. Stone that's holding something molten back doesn't look like that. It has a few deep veins, some branches off them, and long stretches of unbroken surface.

## Few veins, not many

The monolith's fissures start from the exact border distance of a 3D Voronoi field, then lose most of it:

- **Warp first.** The coordinates are stretched vertically and pushed around by low-frequency noise, so the cells become long and leaning. Veins run mostly up and down the slab instead of forming tidy polygons.
- **Mask by region.** A very slow noise decides where veins may exist at all. Most of the surface fails that test, so only a handful of veins survive.
- **Break along the vein.** A second noise interrupts each vein for a stretch and changes its brightness, which is what makes it read as a crack in rock rather than a drawn line.
- **Branch only near the veins.** Smaller cracks come from a finer cell field, but they're only allowed close to a main vein, so they grow off it.

## Making it glow

Each vein has a thin core, sharpened with `fwidth` so it stays crisp at any distance, and a soft halo that falls off exponentially. The pulse is three sine waves at frequencies that never line up, with a phase that changes slowly across the stone. Neighbouring veins beat out of step, and there's never an obvious rhythm.

Heat (from the chapter you're in, or your pointer) widens the veins, extends their fading ends and brightens them.

## Try it

The demo above is the fissure function alone, on a single full-screen triangle in raw WebGL2: no Three.js, no lighting, no post-processing. Turn up the heat and the veins open. Change the pulse speed and the light breathes faster or slower.

## On the live site

The High tier runs this per pixel, every frame. Lighter devices read the same veins from a texture baked at build time from the very same shader code, so every visitor sees the same stone.
