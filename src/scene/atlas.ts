/**
 * The fissure atlas (built by scripts/bake-fissures.ts): what the Medium and
 * Lite monolith shaders read instead of computing 3D Voronoi per pixel.
 *
 * Shipped as four grayscale planes in one lossy AVIF (about 175 KB). It is
 * decoded off the main thread (createImageBitmap) and repacked once on the GPU
 * into an RGBA texture with mipmaps. Browsers that can't decode it get the
 * lossless RGBA PNG.
 */
import {
  GLSL3,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  NearestFilter,
  NoColorSpace,
  OrthographicCamera,
  PlaneGeometry,
  RedFormat,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  Texture,
  UnsignedByteType,
  WebGLRenderTarget,
  type WebGLRenderer,
} from 'three';
import { ATLAS_HEIGHT, ATLAS_WIDTH } from './monolith-geometry';
import { FISSURE_ATLAS_URL } from './quality';

export const ATLAS_URLS = {
  planes: FISSURE_ATLAS_URL,
  png: '/textures/fissures.png',
} as const;

export interface FissureAtlas {
  texture: Texture;
  /** Which file it came from, for diagnostics. */
  source: 'avif' | 'png';
  dispose(): void;
}

const bitmapOptions: ImageBitmapOptions = {
  premultiplyAlpha: 'none',
  colorSpaceConversion: 'none',
};

async function decode(blob: Promise<Blob>) {
  return createImageBitmap(await blob, bitmapOptions);
}

async function fetchBlob(url: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.blob();
}

/** Image row 0 is atlas row 0 (v = 0): upload without flipping. */
function rawTexture(bitmap: ImageBitmap) {
  const texture = new Texture(bitmap);
  texture.flipY = false;
  texture.premultiplyAlpha = false;
  texture.colorSpace = NoColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function finish(texture: Texture, renderer: WebGLRenderer) {
  texture.minFilter = LinearMipmapLinearFilter;
  texture.magFilter = LinearFilter;
  // The faces are often seen at a glancing angle.
  texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
}

/** Draw the four planes into one RGBA target (texel for texel), then mipmap it. */
function repack(renderer: WebGLRenderer, planes: Texture) {
  const target = new WebGLRenderTarget(ATLAS_WIDTH, ATLAS_HEIGHT, {
    format: RGBAFormat,
    type: UnsignedByteType,
    depthBuffer: false,
    generateMipmaps: true,
    minFilter: LinearMipmapLinearFilter,
    magFilter: LinearFilter,
    colorSpace: NoColorSpace,
  });
  const material = new ShaderMaterial({
    glslVersion: GLSL3,
    uniforms: { uPlanes: { value: planes } },
    vertexShader: /* glsl */ `
      void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform sampler2D uPlanes;
      out vec4 outColor;
      void main() {
        ivec2 c = ivec2(gl_FragCoord.xy);
        ivec2 size = ivec2(${ATLAS_WIDTH}, ${ATLAS_HEIGHT});
        outColor = vec4(
          texelFetch(uPlanes, c, 0).r,
          texelFetch(uPlanes, c + ivec2(size.x, 0), 0).r,
          texelFetch(uPlanes, c + ivec2(0, size.y), 0).r,
          texelFetch(uPlanes, c + size, 0).r
        );
      }
    `,
    depthTest: false,
    depthWrite: false,
  });
  const geometry = new PlaneGeometry(2, 2);
  const scene = new Scene();
  const quad = new Mesh(geometry, material);
  quad.frustumCulled = false;
  scene.add(quad);
  const camera = new OrthographicCamera();

  const previousTarget = renderer.getRenderTarget();
  renderer.setRenderTarget(target);
  renderer.render(scene, camera);
  renderer.setRenderTarget(previousTarget);

  geometry.dispose();
  material.dispose();
  return target;
}

/**
 * Load the atlas. `planes` may be a fetch already in flight (scene-boot starts
 * it alongside the scene chunk). Rejects only if both files fail.
 */
export async function loadFissureAtlas(
  renderer: WebGLRenderer,
  planes: Promise<Blob> = fetchBlob(ATLAS_URLS.planes),
  onIssue?: (message: string) => void,
): Promise<FissureAtlas> {
  try {
    const bitmap = await decode(planes);
    if (bitmap.width !== ATLAS_WIDTH * 2 || bitmap.height !== ATLAS_HEIGHT * 2) {
      bitmap.close();
      throw new Error(`unexpected size ${bitmap.width}×${bitmap.height}`);
    }
    const source = rawTexture(bitmap);
    source.format = RedFormat;
    source.internalFormat = 'R8';
    source.minFilter = NearestFilter;
    source.magFilter = NearestFilter;
    source.generateMipmaps = false;
    const target = repack(renderer, source);
    source.dispose();
    bitmap.close();
    finish(target.texture, renderer);
    return { texture: target.texture, source: 'avif', dispose: () => target.dispose() };
  } catch (error) {
    onIssue?.(
      `fissure atlas (AVIF) unavailable, trying PNG: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const bitmap = await decode(fetchBlob(ATLAS_URLS.png));
  const texture = rawTexture(bitmap);
  texture.generateMipmaps = true;
  finish(texture, renderer);
  return {
    texture,
    source: 'png',
    dispose() {
      texture.dispose();
      bitmap.close();
    },
  };
}
