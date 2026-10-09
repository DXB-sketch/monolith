/**
 * Scene palette — mirrors the colour tokens in src/styles/tokens.css.
 * Shaders never hardcode colours; they receive these as uniforms, so the
 * accent can be changed here (and in tokens.css) in one place.
 */
import { Color } from 'three';

export const PALETTE_HEX = {
  basalt: '#0B0909',
  obsidian: '#141010',
  obsidianEdge: '#2A1E1B',
  magma: '#3A170F',
  lava: '#FF5A1F',
  lavaHot: '#FFB070',
  ember: '#8E3214',
  ash: '#B5AAA0',
  ashSoft: '#CFC4B8',
  bone: '#EFE8E0',
  /** UI only (the 2D landing page's strata); kept here so the two lists match. */
  basalt2: '#13110F',
  ruleEmber: '#3A2A20',
} as const;

export type PaletteKey = keyof typeof PALETTE_HEX;

/**
 * Linear-space Colors for shader uniforms. Three's ColorManagement converts the
 * sRGB hex values to the linear working space, which is what lighting maths needs.
 */
export function createPalette(): Record<PaletteKey, Color> {
  const out = {} as Record<PaletteKey, Color>;
  for (const key of Object.keys(PALETTE_HEX) as PaletteKey[]) {
    out[key] = new Color(PALETTE_HEX[key]);
  }
  return out;
}
