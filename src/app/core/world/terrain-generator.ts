import * as THREE from 'three';
import { ImprovedNoise } from 'three/addons/math/ImprovedNoise.js';
import { BiomeId } from '../../shared/models/biome.model';
import { RoadNetwork } from './road-network';
import { WorldBounds } from './world-config';

const TERRAIN_FREQ_1 = 0.05;
const TERRAIN_AMPLITUDE_1 = 1.6;
const TERRAIN_FREQ_2 = 0.1;
const TERRAIN_AMPLITUDE_2 = 0.8;

const ROAD_EDGE_SOFTNESS = 2;

export const BIOME_BOUNDARY_Z = 0;
const BIOME_TRANSITION_WIDTH = 30;
const HIGHLANDS_ELEVATION = 12;

// Lokální "podlaha" pod budovou - v okruhu `radius` je terén dorovnaný na jednu výšku (tu,
// kterou by měl přirozeně přesně ve středu zóny, případně navýšenou o `raise`), takže
// podlaha budovy nemůže terénem prosvítat ani nad ním viset. Mezi `radius` a
// `radius + feather` se dorovnaná výška hladce vrací k přirozenému terénu - stejný
// smoothstep-blend vzor jako u getRoadBlend. `raise` (výchozí 0) navíc terén v zóně
// nadzvedne nad okolí - malý "podstavec", který s rezervou překryje mikro-reliéfní jitter
// vizuálního meshe (viz MICRO_RELIEF_AMPLITUDE v three-scene.service.ts) a dá budově
// přirozený náběh/schůdek u vchodu místo toho, aby ležela přesně v úrovni okolní trávy.
export interface FlatZone {
  readonly x: number;
  readonly z: number;
  readonly radius: number;
  readonly feather: number;
  readonly raise?: number;
}

export const MOUNTAIN_BOUNDARY_Z = 75;
const MOUNTAIN_TRANSITION_WIDTH = 60;
const MOUNTAIN_ELEVATION = 26;

// Bez tilt/warp by hranice biomů byly rovné čáry napříč celou šířkou mapy (jen
// funkce z). Tilt naklání hranici diagonálně podle x, warp ji navíc nechá pozvolna
// meandrovat - dohromady dělají přechod mezi biomy organický místo pravoúhlého.
export const BIOME_BOUNDARY_TILT = 0.35;
const BIOME_WARP_FREQ = 0.015;
export const BIOME_WARP_AMPLITUDE = 30;
const biomeWarpNoise = new ImprovedNoise();

// Posune z tak, jako by hranice biomu byla nakloněná a zvlněná - getBiomeAt/
// getBiomeBlend/getMountainBlend pak porovnávají tento posunutý z se stále
// rovnými konstantami BIOME_BOUNDARY_Z/MOUNTAIN_BOUNDARY_Z.
function getBiomeShiftedZ(x: number, z: number): number {
  // Offset (500, 500) je jen jiný bod ve stejném noise poli - odlišný od výškového
  // noise (které vzorkuje kolem (0,0)/(0,10)/...), aby vlnění hranice biomu
  // nekorelovalo s tvarem terénu.
  const warp = biomeWarpNoise.noise(x * BIOME_WARP_FREQ, 500, 500);
  return z - BIOME_BOUNDARY_TILT * x + warp * BIOME_WARP_AMPLITUDE;
}

export function getBiomeAt(x: number, z: number): BiomeId {
  const shiftedZ = getBiomeShiftedZ(x, z);
  if (shiftedZ < BIOME_BOUNDARY_Z) return 'meadow';
  return shiftedZ < MOUNTAIN_BOUNDARY_Z ? 'highlands' : 'mountains';
}

export interface BiomeZRange {
  readonly biome: BiomeId;
  readonly minZ: number;
  readonly maxZ: number;
}

// Hranice biomu je nakloněná (tilt) a zvlněná (warp noise), ne konstantní z - tyhle rozsahy
// proto slouží jen jako padding pro efektivní vzorkování (kam vůbec náhodné body v daném
// biomu cílit, viz tree-placement.ts/vegetation-placement.ts), skutečné rozhodnutí vždy dělá
// getBiomeAt(x, z).
export function getBiomeZRanges(bounds: WorldBounds): readonly BiomeZRange[] {
  const boundaryMaxShift = (Math.abs(BIOME_BOUNDARY_TILT) * (bounds.maxX - bounds.minX)) / 2 + BIOME_WARP_AMPLITUDE;
  return [
    { biome: 'meadow', minZ: bounds.minZ, maxZ: BIOME_BOUNDARY_Z + boundaryMaxShift },
    { biome: 'highlands', minZ: BIOME_BOUNDARY_Z - boundaryMaxShift, maxZ: MOUNTAIN_BOUNDARY_Z + boundaryMaxShift },
    { biome: 'mountains', minZ: MOUNTAIN_BOUNDARY_Z - boundaryMaxShift, maxZ: bounds.maxZ }
  ];
}

function getBiomeBlendAt(x: number, z: number): number {
  const shiftedZ = getBiomeShiftedZ(x, z);
  return smoothstep(
    BIOME_BOUNDARY_Z - BIOME_TRANSITION_WIDTH / 2,
    BIOME_BOUNDARY_Z + BIOME_TRANSITION_WIDTH / 2,
    shiftedZ
  );
}

function getMountainBlendAt(x: number, z: number): number {
  const shiftedZ = getBiomeShiftedZ(x, z);
  return smoothstep(
    MOUNTAIN_BOUNDARY_Z - MOUNTAIN_TRANSITION_WIDTH / 2,
    MOUNTAIN_BOUNDARY_Z + MOUNTAIN_TRANSITION_WIDTH / 2,
    shiftedZ
  );
}
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

// Samostatný noise (jiné pole než výškový this.noise) a vyšší frekvence než tvar terénu -
// jinak by skvrny 1:1 kopírovaly reliéf/výškové pásy a působily jako "duch" tvaru terénu
// místo nezávislé nerovnoměrnosti barvy uvnitř pásu.
const GROUND_MOTTLE_FREQ = 0.4;
const GROUND_MOTTLE_LIGHTNESS = 0.06;
const groundMottleNoise = new ImprovedNoise();

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

// Výšky (+ volitelně barvy) předpočítané jednou pro celou mřížku (segmentsX+1) x
// (segmentsZ+1) bodů - `getHeightAt`/`getColorAt` berou col/row indexy do mřížky
// (col ~ krok po X, row ~ krok po Z), ne světové souřadnice, takže se `getHeight`/
// `getColor` (noise + road blend) nemusí přepočítávat vícekrát pro stejný bod
// (viz ThreeSceneService.buildScene() a PhysicsService.buildTerrainHeightfield(),
// které dřív každý počítaly tu samou mřížku znovu od nuly).
export interface HeightGrid {
  readonly width: number;
  readonly depth: number;
  readonly segmentsX: number;
  readonly segmentsZ: number;
  getHeightAt(col: number, row: number): number;
  getColorAt(col: number, row: number): THREE.Color;
}

export class TerrainGenerator {
  private readonly noise = new ImprovedNoise();
  // Přirozená (nedorovnaná) výška ve středu každé flatZone, spočtená jednou v konstruktoru -
  // je to cíl, ke kterému se dorovnává celý okruh, takže budova sedí přesně na výšce, kterou
  // by měla ve svém středu i bez dorovnání (žádný umělý skok).
  private readonly flatZoneTargets: readonly number[];

  constructor(private readonly roads?: RoadNetwork, private readonly flatZones: readonly FlatZone[] = []) {
    this.flatZoneTargets = this.flatZones.map((zone) => this.getNaturalHeight(zone.x, zone.z) + (zone.raise ?? 0));
  }

  getBiomeBlend(x: number, z: number): number {
    return getBiomeBlendAt(x, z);
  }

  getMountainBlend(x: number, z: number): number {
    return getMountainBlendAt(x, z);
  }

  getBiomeAt(x: number, z: number): BiomeId {
    return getBiomeAt(x, z);
  }

  getHeight(x: number, z: number): number {
    const natural = this.getNaturalHeight(x, z);
    return this.applyFlatZones(x, z, natural);
  }

  private applyFlatZones(x: number, z: number, natural: number): number {
    let height = natural;
    for (let i = 0; i < this.flatZones.length; i++) {
      const zone = this.flatZones[i];
      const blend = this.getZoneBlend(zone, x, z);
      if (blend <= 0) continue;
      height += (this.flatZoneTargets[i] - height) * blend;
    }
    return height;
  }

  // Kolik (0..1) je bod uvnitř nějaké flatZone - použito i mimo výškovou funkci, k potlačení
  // vizuálního mikro-reliéfního jitteru (ThreeSceneService.buildScene) v dorovnané ploše.
  getFlatZoneBlend(x: number, z: number): number {
    let maxBlend = 0;
    for (const zone of this.flatZones) {
      const blend = this.getZoneBlend(zone, x, z);
      if (blend > maxBlend) maxBlend = blend;
    }
    return maxBlend;
  }

  private getZoneBlend(zone: FlatZone, x: number, z: number): number {
    const distance = Math.hypot(x - zone.x, z - zone.z);
    if (distance >= zone.radius + zone.feather) return 0;
    return 1 - smoothstep(zone.radius, zone.radius + zone.feather, distance);
  }

  private getNaturalHeight(x: number, z: number): number {
    const base = this.noise.noise(x * TERRAIN_FREQ_1, z * TERRAIN_FREQ_1, 0);
    const detail = this.noise.noise(x * TERRAIN_FREQ_2, z * TERRAIN_FREQ_2, 10);
    const mountainBlend = this.getMountainBlend(x, z);
    const elevation = this.getBiomeBlend(x, z) * HIGHLANDS_ELEVATION + mountainBlend * MOUNTAIN_ELEVATION;

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

  computeHeightGrid(width: number, depth: number, segmentsX: number, segmentsZ: number): HeightGrid {
    const cols = segmentsX + 1;
    const rows = segmentsZ + 1;
    const heights = new Float32Array(cols * rows);
    for (let row = 0; row < rows; row++) {
      const z = -depth / 2 + (row / segmentsZ) * depth;
      for (let col = 0; col < cols; col++) {
        const x = -width / 2 + (col / segmentsX) * width;
        heights[row * cols + col] = this.getHeight(x, z);
      }
    }

    return {
      width,
      depth,
      segmentsX,
      segmentsZ,
      getHeightAt: (col, row) => heights[row * cols + col],
      getColorAt: (col, row) => {
        const x = -width / 2 + (col / segmentsX) * width;
        const z = -depth / 2 + (row / segmentsZ) * depth;
        return this.getColor(heights[row * cols + col], x, z);
      }
    };
  }

  getColor(height: number, x?: number, z?: number): THREE.Color {
    const groundColor = this.getGroundColor(height, x, z);

    if (x === undefined || z === undefined) return groundColor;
    const roadBlend = this.getRoadBlend(x, z);
    if (roadBlend === 0) return groundColor;
    return groundColor.lerp(this.roads!.surfaceColor, roadBlend);
  }

  private getGroundColor(height: number, x?: number, z?: number): THREE.Color {
    let color: THREE.Color;
    if (height <= GROUND_MID_HEIGHT) {
      color = new THREE.Color().lerpColors(
        GROUND_LOW_COLOR,
        GROUND_MID_COLOR,
        smoothstep(0, GROUND_MID_HEIGHT, height)
      );
    } else if (height <= GROUND_HIGH_HEIGHT) {
      color = new THREE.Color().lerpColors(
        GROUND_MID_COLOR,
        GROUND_HIGH_COLOR,
        smoothstep(GROUND_MID_HEIGHT, GROUND_HIGH_HEIGHT, height)
      );
    } else {
      color = new THREE.Color().lerpColors(
        GROUND_HIGH_COLOR,
        GROUND_SNOW_COLOR,
        smoothstep(GROUND_HIGH_HEIGHT, GROUND_SNOW_HEIGHT, height)
      );
    }

    if (x === undefined || z === undefined) return color;
    const mottle = groundMottleNoise.noise(x * GROUND_MOTTLE_FREQ, z * GROUND_MOTTLE_FREQ, 200);
    return color.offsetHSL(0, 0, mottle * GROUND_MOTTLE_LIGHTNESS);
  }

  private getRoadBlend(x: number, z: number): number {
    if (!this.roads) return 0;
    const distance = this.roads.distanceToNearest(x, z);
    const halfWidth = this.roads.width / 2;
    return 1 - smoothstep(halfWidth, halfWidth + ROAD_EDGE_SOFTNESS, distance);
  }
}
