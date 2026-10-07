/**
 * "Light through stone": the monolith's fissure function on its own, in raw
 * WebGL2 (no Three.js): one full-screen triangle and a fragment shader that
 * runs the same fissure-field.glsl as the site's High tier.
 *
 * Colours come from the CSS tokens (tokens.css), so nothing is hardcoded.
 * Renders only while on screen and while the tab is visible.
 */
import noiseGlsl from '../scene/shaders/noise.glsl?raw';
import fissureGlsl from '../scene/shaders/fissure-field.glsl?raw';

export interface Demo {
  setHeat(value: number): void;
  setSpeed(value: number): void;
  destroy(): void;
}

const VERTEX = `#version 300 es
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const FRAGMENT = `#version 300 es
precision highp float;
uniform vec2 uResolution;
uniform float uTime;
uniform float uHeat;
uniform vec3 uObsidian, uMagma, uEmber, uLava, uLavaHot;
out vec4 outColor;
${noiseGlsl}
${fissureGlsl}

void main() {
  // A 6 m wide patch of the stone's face (a well-veined one), drifting slowly upward.
  float scale = 6.0 / uResolution.x;
  vec3 p = vec3((gl_FragCoord.xy - uResolution * 0.5) * scale, 1.25);
  p.y += uTime * 0.05 + 3.0;
  p.x += 1.8;
  float heat = uHeat;

  vec3 q = fissureWarp(p);
  float dMain = fissureMainDistance(q);
  float veins = smoothstep(-0.12, 0.3, fissureRegion(p) + heat * 0.1) * fissureAlong(p);
  float width = fissureWidth(p) * (1.0 + heat * 0.35);
  float aa = fwidth(dMain);
  float core = (1.0 - smoothstep(width, width + aa * 1.5 + 0.003, dMain)) * veins;
  float halo = exp(-dMain / (0.05 + width * 2.5)) * veins;

  float dBr = fissureBranchDistance(q);
  float brMask = (1.0 - smoothstep(0.1, 0.9 + heat * 0.3, dMain)) * veins * fissureBranchGate(p);
  float brW = width * 0.45;
  core = max(core, (1.0 - smoothstep(brW, brW + fwidth(dBr) * 1.5 + 0.002, dBr)) * brMask * 0.45);
  halo += exp(-dBr / 0.035) * brMask * 0.3;

  float phase = fissurePhase(p);
  float t = uTime;
  float pulse = 0.74 + 0.15 * sin(t * 0.52 + phase) + 0.07 * sin(t * 1.37 + phase * 1.9)
              + 0.05 * sin(t * 0.21 + phase * 0.7);
  float intensity = pulse * (1.0 + heat * 0.9);

  vec3 glass = uObsidian * 0.5 + uMagma * 0.08;
  vec3 emission = mix(uLava, uLavaHot, 0.8) * core * 10.0 + mix(uEmber, uLava, 0.65) * halo * 1.6;
  vec3 color = glass * (1.0 - clamp(core, 0.0, 1.0)) + emission * intensity;

  // ACES-style tone curve, then sRGB.
  color *= 0.9;
  color = clamp((color * (2.51 * color + 0.03)) / (color * (2.43 * color + 0.59) + 0.14), 0.0, 1.0);
  outColor = vec4(pow(color, vec3(1.0 / 2.2)), 1.0);
}`;

/** A CSS colour token as linear RGB (the shader works in linear light). */
function token(name: string): [number, number, number] {
  const probe = document.createElement('span');
  probe.style.color = `var(${name})`;
  document.body.appendChild(probe);
  const rgb = getComputedStyle(probe)
    .color.match(/[\d.]+/g)!
    .slice(0, 3)
    .map(Number);
  probe.remove();
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return [lin(rgb[0]!), lin(rgb[1]!), lin(rgb[2]!)];
}

const SOFTWARE = /swiftshader|llvmpipe|softpipe|software|basic render/i;

/** Start the demo on `canvas`, or return null (no WebGL2, a software renderer, a compile error). */
export function startDemo(canvas: HTMLCanvasElement): Demo | null {
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false });
  if (!gl) return null;
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  const renderer = String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : '');
  if (SOFTWARE.test(renderer)) return null;

  const compile = (type: number, source: string) => {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    return shader;
  };
  const program = gl.createProgram()!;
  gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX));
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAGMENT));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
  gl.useProgram(program);
  gl.bindVertexArray(gl.createVertexArray());

  const u = (name: string) => gl.getUniformLocation(program, name);
  const uResolution = u('uResolution');
  const uTime = u('uTime');
  const uHeat = u('uHeat');
  for (const [name, css] of [
    ['uObsidian', '--obsidian'],
    ['uMagma', '--magma'],
    ['uEmber', '--ember'],
    ['uLava', '--lava'],
    ['uLavaHot', '--lava-hot'],
  ] as const) {
    gl.uniform3fv(u(name), token(css));
  }

  let heat = 0.3;
  let speed = 1;
  let time = 0;
  let last = 0;
  let raf = 0;
  let onScreen = false;

  const resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    gl.viewport(0, 0, w, h);
    gl.uniform2f(uResolution, w, h);
  };

  const frame = (now: number) => {
    raf = 0;
    const dt = last ? Math.min((now - last) / 1000, 0.1) : 0;
    last = now;
    time += dt * speed;
    gl.uniform1f(uTime, time);
    gl.uniform1f(uHeat, heat);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    schedule();
  };
  const schedule = () => {
    if (!raf && onScreen && !document.hidden) raf = requestAnimationFrame(frame);
  };
  const stop = () => {
    cancelAnimationFrame(raf);
    raf = 0;
    last = 0;
  };

  const observer = new IntersectionObserver(([entry]) => {
    onScreen = Boolean(entry?.isIntersecting);
    if (onScreen) schedule();
    else stop();
  });
  observer.observe(canvas);
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(canvas);
  const onVisibility = () => (document.hidden ? stop() : schedule());
  document.addEventListener('visibilitychange', onVisibility);
  resize();

  return {
    setHeat(value) {
      heat = value;
    },
    setSpeed(value) {
      speed = value;
    },
    destroy() {
      stop();
      observer.disconnect();
      resizeObserver.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    },
  };
}
