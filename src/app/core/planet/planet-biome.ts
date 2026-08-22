import * as THREE from 'three';
import { ImprovedNoise } from 'three/addons/math/ImprovedNoise.js';
import { BiomeId } from '../../shared/models/biome.model';
import { BIOMES } from '../world/biome.config';
import { PlanetTile } from './goldberg-mesh';
import { PlanetTerrain, TerrainSample } from './planet-terrain';
import {
  BIOME_HIGHLANDS_MASSIF,
  BIOME_MOUNTAINS_ELEVATION,
  BIOME_MOUNTAINS_MASSIF,
  COLOR_HIGHLANDS,
  COLOR_MEADOW,
  COLOR_MEADOW_ALT,
  COLOR_PATCH_FREQ,
  COLOR_ROCK,
  COLOR_SNOW,
  SNOW_FULL_ELEVATION,
  SNOW_START_ELEVATION
} from './planet-config';

// Biom a barva dlaždice.
//
// Definice biomů (hustoty stromů, vegetace, zvířat) se berou přímo z ../world/biome.config -
// ten je topologicky neutrální (jen váhy a počty, žádná geometrie), takže se nekopíruje.
// Sférické je jen prostorové mapování, které v plochém světě dělá terrain-generator přes
// pásy podle Z (getBiomeShiftedZ / getBiomeZRanges) a na kouli nemá smysl.
//
// Biom se určuje z masivové masky, ne z absolutní výšky - jinak by biomy byly jen jiný zápis
// barevných pásů a rozpadaly by se na šum dlaždice po dlaždici.

export interface TileData {
  readonly biome: BiomeId;
  readonly surfaceRadius: number;
  readonly elevation: number;
}

export function getBiomeForSample(sample: TerrainSample): BiomeId {
  if (sample.massif >= BIOME_MOUNTAINS_MASSIF) return 'mountains';
  // Vysoký izolovaný hřeben je hora i mimo masivovou oblast.
  if (sample.elevation >= BIOME_MOUNTAINS_ELEVATION) return 'mountains';
  if (sample.massif >= BIOME_HIGHLANDS_MASSIF) return 'highlands';
  return 'meadow';
}

export function getBiomeDefinition(biome: BiomeId) {
  return BIOMES[biome];
}

// Sidecar pole paralelní k `tiles` - spočítané jednou při buildu, protože planetka je
// statická. Vyhne se tomu, aby si každý konzument (mesh, placement, budoucí culling)
// vzorkoval noise znovu.
export function buildTileData(
  tiles: readonly PlanetTile[],
  terrain: PlanetTerrain
): readonly TileData[] {
  return tiles.map((tile) => {
    const sample = terrain.sample(tile.centerDir);
    return {
      biome: getBiomeForSample(sample),
      surfaceRadius: sample.surfaceRadius,
      elevation: sample.elevation
    };
  });
}

const patchNoise = new ImprovedNoise();

const meadowColor = new THREE.Color(COLOR_MEADOW);
const meadowAltColor = new THREE.Color(COLOR_MEADOW_ALT);
const highlandsColor = new THREE.Color(COLOR_HIGHLANDS);
const rockColor = new THREE.Color(COLOR_ROCK);
const snowColor = new THREE.Color(COLOR_SNOW);

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

// Barva dlaždice z jejího biomu a výšky. `dir` je potřeba pro patch noise, který rozbíjí
// jednolitost trávy - bez něj by celý biom byl jeden plochý odstín.
export function getTileColor(
  dir: THREE.Vector3,
  data: TileData,
  target: THREE.Color
): THREE.Color {
  const patch = patchNoise.noise(
    dir.x * COLOR_PATCH_FREQ,
    dir.y * COLOR_PATCH_FREQ,
    dir.z * COLOR_PATCH_FREQ
  );

  switch (data.biome) {
    case 'meadow':
      target.copy(meadowColor).lerp(meadowAltColor, patch * 0.5 + 0.5);
      break;
    case 'highlands':
      target.copy(highlandsColor).lerp(rockColor, smoothstep(0.3, 0.7, data.elevation));
      break;
    case 'mountains':
      target.copy(rockColor);
      break;
  }

  // Sníh nasedá podle výšky napříč biomy, aby vrcholky navazovaly plynule.
  const snow = smoothstep(SNOW_START_ELEVATION, SNOW_FULL_ELEVATION, data.elevation);
  if (snow > 0) target.lerp(snowColor, snow);
  return target;
}
