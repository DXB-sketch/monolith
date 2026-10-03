# ART DIRECTION — Molten Monolith

## The concept in one paragraph

At dusk, on a dark volcanic plain at the foot of distant peaks, stands a single obsidian monolith. Magma glows through the cracks in its surface. Rivers of lava run across the basalt toward its base, embers drift upward, and heat haze shimmers behind it. As the visitor scrolls, the camera slowly circles the stone. Each face of the monolith reveals a piece of work. At the end of the journey the camera descends to the glowing core, where the visitor is invited to start a project.

The feel is **sleek, modern and cinematic**, not fantasy or gaming. Think premium product launch meets land art. Restraint everywhere except the light.

## Palette (tokens)

Define these in `src/styles/tokens.css` and mirror them in `src/scene/palette.ts`.

| Token | Hex | Use |
|---|---|---|
| `--basalt` | #0B0909 | page background |
| `--obsidian` | #141010 | panels, monolith base colour |
| `--obsidian-edge` | #2A1E1B | borders, hairlines |
| `--magma` | #3A170F | deep glow, sky low band |
| `--lava` | #FF5A1F | primary accent, CTAs, fissure emission |
| `--lava-hot` | #FFB070 | hottest cores of fissures (scene only) |
| `--ember` | #8E3214 | horizon glow |
| `--ash` | #B5AAA0 | secondary text, labels |
| `--ash-soft` | #CFC4B8 | body text on dark |
| `--bone` | #EFE8E0 | primary text |

Text on `--basalt` must meet WCAG AA. `--lava` is for accents, buttons (with `--basalt` text), and large display words only, never small body text.

## Typography

- **Sora**: 200 for large display headlines, 300 for subheads and body, 500 for emphasis and buttons.
- **JetBrains Mono**: 400 and 500 for labels, the HUD, numbers, metadata. Uppercase, letter-spacing 0.12–0.16em.
- Headline style: very large, thin weight, tight negative tracking (around -0.035em). The final phrase of key headlines switches to weight 500 in `--lava` (e.g. "Forged in fire. **Built to stand.**").
- Wordmark: "MONOLITH" in Sora 500, letter-spacing 0.42em.

## Interface language

- **Navigation**: a frosted pill (translucent `--obsidian` with backdrop blur and a hairline border) centred at the top, wordmark on the left, a solid `--lava` "Start a project" pill button on the right.
- **HUD**: small instrument-style readouts in the corners, in JetBrains Mono, over the scene:
  - Top left: coordinates `26.90°S · 152.82°E`, `CORE TEMP 1,160°C`, a pulsing `● LIVE` dot
  - Right edge: the chapter index (00 Arrival, 01 Face I, 02 Face II, 03 The Lab, 04 The Core), with the active chapter highlighted as you scroll. Each item is a real link.
- **Panels**: obsidian gradients with hairline `--obsidian-edge` borders and a thin `--lava` top rule. Corners square or very slightly rounded (max 2px). Buttons are full pills.
- **Glow** is reserved for the scene and for one or two hero moments. The UI itself stays crisp and flat.

## Motion language

- Everything moves as if it has weight and heat: slow eases in (`power3.out`, `expo.out`), never bouncy.
- Headline reveals: lines rise from a mask with a slight blur that clears, staggered.
- Hover on interactive elements: a subtle warm glow under the cursor, borders brighten toward `--lava`.
- Page transitions: a heat-shimmer distortion or a "cooling" fade to `--basalt` and back, while the WebGL canvas persists and the camera moves to the page's position.
- Cursor: optional custom cursor (a small ring) on desktop only, never replacing the native cursor on form fields.
- `prefers-reduced-motion`: no camera movement, no shimmer, no parallax. Instant cuts and simple fades only. Show the static poster.

## The scroll story (Home page)

| Chapter | Camera | Scene | Content (HTML over the scene) |
|---|---|---|---|
| 00 — Arrival | Wide, low, front of the monolith | Fissures pulse slowly, embers rise, lava glows | Headline "Forged in fire. Built to stand.", intro line, Start a project + Skip to the work buttons |
| 01 — Face I | Orbits about 90° to the first face, moves closer | That face's fissures brighten | SEQDVGC: title, summary, link to the case study |
| 02 — Face II | Orbits to the second face | Lava rivers intensify around the base | Allen Gillon: title, summary, link |
| 03 — The Lab | Orbits to the third face, tilts upward | Ember density increases, a heat haze column rises | Lab teaser and links to experiments; concept project card |
| 04 — The Core | Descends and pushes into the brightest fissure, which fills the screen with molten light | Bloom and colour wash toward `--lava-hot` | Services summary (Ember / Flow / Eruption) and the final CTA "Let's make something that stands." |

Below the scroll story: a normal, fast, plain section with services, a short about line, and the footer. This is the safety net for visitors who skip the experience.

## The cursor and the stone

On desktop, moving the cursor near the monolith subtly heats the surface: fissures near the pointer brighten and the obsidian takes on a faint warm reflection. On touch devices, a gentle device-tilt parallax is acceptable only if it doesn't need permissions; otherwise skip it.

## What to avoid

- Fantasy lava (cartoon orange, bubbling, gaming tropes)
- Neon or synthwave colours
- Multiple competing accent colours
- Glow effects on UI text or panels outside hero moments
- Stock 3D assets that look generic
- Any text placed only in WebGL
