// Terrain rendering: one world-space quad covering a window of loaded chunks. A shader samples the
// 1 m material grid with noise-perturbed coordinates and blends neighbouring materials, so ground
// transitions look natural rather than tiled (design plan §80).

import { BufferImageSource, Geometry, Mesh, Shader, Texture, type Container } from 'pixi.js';
import { CHUNK_SIZE, TERRAIN_CELLS_PER_CHUNK, terrainIndex } from '@tuff/shared';
import type { ClientWorld } from '../game/world';
import { ATLAS_COLS, ATLAS_ROWS, buildNoiseTexture, buildTerrainAtlas, TILE_METERS } from './textures';

/** Chunks per side of the terrain window around the camera (the game streams 5 × 5 around you). */
const DEFAULT_WINDOW_CHUNKS = 7;

const VERTEX = /* glsl */ `#version 300 es
in vec2 aPosition;
out vec2 vWorld;
uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;
uniform vec2 uOrigin;
void main() {
  mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
  vWorld = aPosition + uOrigin;
}`;

const FRAGMENT = /* glsl */ `#version 300 es
precision highp float;
in vec2 vWorld;
out vec4 finalColor;
uniform sampler2D uMaterials;
uniform sampler2D uAtlas;
uniform sampler2D uNoise;
uniform vec2 uOrigin;
uniform float uCells;
uniform vec2 uAtlasGrid;
uniform float uTileMeters;

float materialAt(vec2 cell) {
  vec2 uv = (cell + 0.5) / uCells;
  return floor(texture(uMaterials, uv).r * 255.0 + 0.5);
}

vec3 materialColor(float idx, vec2 world, vec2 dUv) {
  float col = mod(idx, uAtlasGrid.x);
  float row = floor(idx / uAtlasGrid.x);
  vec2 local = fract(world / uTileMeters) * (254.0 / 256.0) + (1.0 / 256.0);
  vec2 uv = (vec2(col, row) + local) / uAtlasGrid;
  return textureGrad(uAtlas, uv, dUv, dUv).rgb;
}

void main() {
  vec2 n1 = texture(uNoise, vWorld * 0.045).rg - 0.5;
  vec2 n2 = texture(uNoise, vWorld * 0.19 + 0.37).rg - 0.5;
  vec2 p = (vWorld - uOrigin) + n1 * 1.5 + n2 * 0.5;
  vec2 base = floor(p - 0.5);
  vec2 f = p - 0.5 - base;
  vec2 w = smoothstep(0.2, 0.8, f);
  float m00 = materialAt(base);
  float m10 = materialAt(base + vec2(1.0, 0.0));
  float m01 = materialAt(base + vec2(0.0, 1.0));
  float m11 = materialAt(base + vec2(1.0, 1.0));
  vec2 dUv = fwidth(vWorld / uTileMeters) / uAtlasGrid;
  vec3 c00 = materialColor(m00, vWorld, dUv);
  vec3 c;
  if (m00 == m10 && m00 == m01 && m00 == m11) {
    c = c00;
  } else {
    vec3 c10 = materialColor(m10, vWorld, dUv);
    vec3 c01 = materialColor(m01, vWorld, dUv);
    vec3 c11 = materialColor(m11, vWorld, dUv);
    c = mix(mix(c00, c10, w.x), mix(c01, c11, w.x), w.y);
  }
  // Broad, slow variation so large fields are not uniform.
  float v = texture(uNoise, vWorld * 0.011).b;
  c *= 0.86 + 0.26 * v;
  finalColor = vec4(c, 1.0);
}`;

export class TerrainRenderer {
  readonly mesh: Mesh<Geometry, Shader>;
  private readonly data: Uint8Array;
  private readonly source: BufferImageSource;
  private readonly windowChunks: number;
  private readonly windowCells: number;
  private originCx = Number.NaN;
  private originCy = Number.NaN;
  private dirty = true;
  private readonly uniforms: { uniforms: { uOrigin: Float32Array } } & { update(): void };

  constructor(
    parent: Container,
    private readonly world: ClientWorld,
    windowChunks = DEFAULT_WINDOW_CHUNKS,
  ) {
    this.windowChunks = windowChunks;
    this.windowCells = windowChunks * TERRAIN_CELLS_PER_CHUNK;
    const WINDOW_CELLS = this.windowCells;
    this.data = new Uint8Array(WINDOW_CELLS * WINDOW_CELLS * 4);
    const atlas = Texture.from(buildTerrainAtlas());
    atlas.source.scaleMode = 'linear';
    const noise = Texture.from(buildNoiseTexture());
    noise.source.addressMode = 'repeat';
    noise.source.scaleMode = 'linear';
    this.source = new BufferImageSource({
      resource: this.data,
      width: WINDOW_CELLS,
      height: WINDOW_CELLS,
      scaleMode: 'nearest',
      addressMode: 'clamp-to-edge',
    });
    const size = WINDOW_CELLS;
    const geometry = new Geometry({
      attributes: { aPosition: [0, 0, size, 0, size, size, 0, size] },
      indexBuffer: [0, 1, 2, 0, 2, 3],
    });
    const shader = Shader.from({
      gl: { vertex: VERTEX, fragment: FRAGMENT, name: 'terrain' },
      resources: {
        terrainUniforms: {
          uOrigin: { value: new Float32Array([0, 0]), type: 'vec2<f32>' },
          uCells: { value: WINDOW_CELLS, type: 'f32' },
          uAtlasGrid: { value: new Float32Array([ATLAS_COLS, ATLAS_ROWS]), type: 'vec2<f32>' },
          uTileMeters: { value: TILE_METERS, type: 'f32' },
        },
        uMaterials: this.source,
        uAtlas: atlas.source,
        uNoise: noise.source,
      },
    });
    this.uniforms = shader.resources.terrainUniforms;
    this.mesh = new Mesh({ geometry, shader });
    parent.addChild(this.mesh);
  }

  invalidate(): void {
    this.dirty = true;
  }

  update(centerX: number, centerY: number): void {
    const WINDOW_CHUNKS = this.windowChunks;
    const WINDOW_CELLS = this.windowCells;
    const cx = Math.floor(centerX / CHUNK_SIZE) - Math.floor(WINDOW_CHUNKS / 2);
    const cy = Math.floor(centerY / CHUNK_SIZE) - Math.floor(WINDOW_CHUNKS / 2);
    if (cx !== this.originCx || cy !== this.originCy) {
      this.originCx = cx;
      this.originCy = cy;
      this.dirty = true;
    }
    if (!this.dirty) return;
    this.dirty = false;
    const fill = terrainIndex('grass');
    const data = this.data;
    const C = TERRAIN_CELLS_PER_CHUNK;
    for (let j = 0; j < WINDOW_CHUNKS; j++) {
      for (let i = 0; i < WINDOW_CHUNKS; i++) {
        const chunk = this.world.chunks.get(`${cx + i},${cy + j}`);
        for (let y = 0; y < C; y++) {
          let o = ((j * C + y) * WINDOW_CELLS + i * C) * 4;
          for (let x = 0; x < C; x++) {
            data[o] = chunk ? chunk.terrain[y * C + x] : fill;
            o += 4;
          }
        }
      }
    }
    this.source.update();
    const originX = cx * CHUNK_SIZE;
    const originY = cy * CHUNK_SIZE;
    this.uniforms.uniforms.uOrigin[0] = originX;
    this.uniforms.uniforms.uOrigin[1] = originY;
    this.uniforms.update();
    this.mesh.position.set(originX, originY);
  }
}
