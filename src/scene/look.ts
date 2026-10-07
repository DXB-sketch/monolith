/**
 * Post-processing levels shared by the core chunk (which animates them) and
 * the layers chunk (which builds the chain). Kept here so the core chunk never
 * imports the layers chunk statically.
 */
/** Base bloom; it rises through the Chapter 04 dive. */
export const BLOOM_INTENSITY = 1.25;
/** Extra bloom at the dive's peak. */
export const BLOOM_DIVE = 1.6;
export const VIGNETTE_DARKNESS = 0.62;
/** Film grain; it fades out with the wash. */
export const GRAIN_OPACITY = 0.1;
