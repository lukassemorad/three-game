import * as THREE from 'three';
import { ImprovedNoise } from 'three/addons/math/ImprovedNoise.js';
import { BiomeId } from '../../shared/models/biome.model';
import { RoadNetwork } from './road-network';

const TERRAIN_FREQ_1 = 0.05;
const TERRAIN_AMPLITUDE_1 = 1.6;
const TERRAIN_FREQ_2 = 0.1;
const TERRAIN_AMPLITUDE_2 = 0.8;

const ROAD_EDGE_SOFTNESS = 2;

export const BIOME_BOUNDARY_Z = 0;
const BIOME_TRANSITION_WIDTH = 20;
const HIGHLANDS_ELEVATION = 12;

export const MOUNTAIN_BOUNDARY_Z = 50;
const MOUNTAIN_TRANSITION_WIDTH = 40;
const MOUNTAIN_ELEVATION = 26;
// Ridged noise (1 - |noise|, umocněno) dává ostré, lomené hřebeny místo hladkých kopců.
// Dvě frekvence smíchané dohromady rozbijí izolované extrémně ostré "jehly",
// které by vznikaly z jediné ridge oktávy.
const MOUNTAIN_RIDGE_FREQ_1 = 0.1;
const MOUNTAIN_RIDGE_FREQ_2 = 0.23;
const MOUNTAIN_RIDGE_EXPONENT = 1.6;
const MOUNTAIN_RIDGE_AMPLITUDE = 8;
const MOUNTAIN_JAGGED_FREQ = 0.35;
const MOUNTAIN_JAGGED_AMPLITUDE = 1.8;

const GROUND_LOW_COLOR = new THREE.Color(0x3a6e3a);
const GROUND_MID_COLOR = new THREE.Color(0x6b5c3a);
const GROUND_HIGH_COLOR = new THREE.Color(0x7d7d7d);
const GROUND_SNOW_COLOR = new THREE.Color(0xf5f5f5);
const GROUND_MID_HEIGHT = 6;
const GROUND_HIGH_HEIGHT = 12;
const GROUND_SNOW_HEIGHT = 24;

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export class TerrainGenerator {
  private readonly noise = new ImprovedNoise();

  constructor(private readonly roads?: RoadNetwork) {}

  getBiomeBlend(z: number): number {
    return smoothstep(
      BIOME_BOUNDARY_Z - BIOME_TRANSITION_WIDTH / 2,
      BIOME_BOUNDARY_Z + BIOME_TRANSITION_WIDTH / 2,
      z
    );
  }

  getMountainBlend(z: number): number {
    return smoothstep(
      MOUNTAIN_BOUNDARY_Z - MOUNTAIN_TRANSITION_WIDTH / 2,
      MOUNTAIN_BOUNDARY_Z + MOUNTAIN_TRANSITION_WIDTH / 2,
      z
    );
  }

  getBiomeAt(z: number): BiomeId {
    if (z < BIOME_BOUNDARY_Z) return 'meadow';
    return z < MOUNTAIN_BOUNDARY_Z ? 'highlands' : 'mountains';
  }

  getHeight(x: number, z: number): number {
    const base = this.noise.noise(x * TERRAIN_FREQ_1, z * TERRAIN_FREQ_1, 0);
    const detail = this.noise.noise(x * TERRAIN_FREQ_2, z * TERRAIN_FREQ_2, 10);
    const mountainBlend = this.getMountainBlend(z);
    const elevation = this.getBiomeBlend(z) * HIGHLANDS_ELEVATION + mountainBlend * MOUNTAIN_ELEVATION;

    const ridgeA = Math.pow(
      1 - Math.abs(this.noise.noise(x * MOUNTAIN_RIDGE_FREQ_1, z * MOUNTAIN_RIDGE_FREQ_1, 30)),
      MOUNTAIN_RIDGE_EXPONENT
    );
    const ridgeB = Math.pow(
      1 - Math.abs(this.noise.noise(x * MOUNTAIN_RIDGE_FREQ_2, z * MOUNTAIN_RIDGE_FREQ_2, 31)),
      MOUNTAIN_RIDGE_EXPONENT
    );
    const ridge = (ridgeA * 0.65 + ridgeB * 0.35) * MOUNTAIN_RIDGE_AMPLITUDE;
    const jaggedNoise = this.noise.noise(x * MOUNTAIN_JAGGED_FREQ, z * MOUNTAIN_JAGGED_FREQ, 40);
    const jagged = Math.abs(jaggedNoise) * MOUNTAIN_JAGGED_AMPLITUDE;

    // shapeHeight = velkoplošný tvar terénu (i s hřebeny hor), fineNoise = drobná
    // vysokofrekvenční kostrbatost navrch. Cesta smí smazat jen fineNoise, jinak
    // by (protože ridge/jagged jsou vždy kladné) ležela citelně pod okolním terénem.
    const shapeHeight = base * TERRAIN_AMPLITUDE_1 + elevation + ridge * mountainBlend;
    const fineNoise = detail * TERRAIN_AMPLITUDE_2 + jagged * mountainBlend;

    const roadBlend = this.getRoadBlend(x, z);
    return shapeHeight + fineNoise * (1 - roadBlend);
  }

  getColor(height: number, x?: number, z?: number): THREE.Color {
    const groundColor = this.getGroundColor(height);

    if (x === undefined || z === undefined) return groundColor;
    const roadBlend = this.getRoadBlend(x, z);
    if (roadBlend === 0) return groundColor;
    return groundColor.lerp(this.roads!.surfaceColor, roadBlend);
  }

  private getGroundColor(height: number): THREE.Color {
    if (height <= GROUND_MID_HEIGHT) {
      return new THREE.Color().lerpColors(
        GROUND_LOW_COLOR,
        GROUND_MID_COLOR,
        smoothstep(0, GROUND_MID_HEIGHT, height)
      );
    }
    if (height <= GROUND_HIGH_HEIGHT) {
      return new THREE.Color().lerpColors(
        GROUND_MID_COLOR,
        GROUND_HIGH_COLOR,
        smoothstep(GROUND_MID_HEIGHT, GROUND_HIGH_HEIGHT, height)
      );
    }
    return new THREE.Color().lerpColors(
      GROUND_HIGH_COLOR,
      GROUND_SNOW_COLOR,
      smoothstep(GROUND_HIGH_HEIGHT, GROUND_SNOW_HEIGHT, height)
    );
  }

  private getRoadBlend(x: number, z: number): number {
    if (!this.roads) return 0;
    const distance = this.roads.distanceToNearest(x, z);
    const halfWidth = this.roads.width / 2;
    return 1 - smoothstep(halfWidth, halfWidth + ROAD_EDGE_SOFTNESS, distance);
  }
}
