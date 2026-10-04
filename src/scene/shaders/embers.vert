attribute vec3 aSpawn;
attribute vec4 aSeed;

uniform float uTime;
uniform float uDensity;
uniform float uPointScale;
uniform vec2 uWind;

varying float vLife;
varying float vAlpha;

void main() {
  float rate = 0.045 + aSeed.x * 0.07;
  float life = fract(uTime * rate + aSeed.y);
  float rise = life * (5.0 + aSeed.z * 17.0);

  vec3 p = aSpawn;
  p.y += rise;
  float sway = life * life;
  p.x += sin(uTime * 0.35 + aSeed.w * 40.0 + life * 5.0) * 0.8 * sway + uWind.x * rise * 0.5;
  p.z += cos(uTime * 0.29 + aSeed.y * 40.0 + life * 4.0) * 0.8 * sway + uWind.y * rise * 0.5;

  vec4 mv = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;

  float alive = step(aSeed.w, uDensity);
  float flicker = 0.55 + 0.45 * sin(uTime * (7.0 + aSeed.x * 13.0) + aSeed.z * 50.0);
  vAlpha = alive * smoothstep(0.0, 0.05, life) * (1.0 - smoothstep(0.4, 1.0, life)) * flicker;
  vLife = life;

  float size = (0.035 + aSeed.z * 0.045) * uPointScale / max(-mv.z, 0.1);
  // Sub-pixel embers would shimmer: keep a minimum size and dim them instead.
  vAlpha *= clamp(size / 1.6, 0.2, 1.0);
  gl_PointSize = max(size, 1.6);
}
