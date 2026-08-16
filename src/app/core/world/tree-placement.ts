import { TreeVariant } from '../../shared/models/tree.model';
import { BIOMES } from './biome.config';
import { ExclusionZone, isExcluded } from './placement-exclusion';
import { SpatialGrid } from './spatial-grid';
import {
  BIOME_BOUNDARY_TILT,
  BIOME_BOUNDARY_Z,
  BIOME_WARP_AMPLITUDE,
  MOUNTAIN_BOUNDARY_Z,
  getBiomeAt
} from './terrain-generator';
import { WorldBounds } from './world-config';

export interface TreePlacement {
  readonly x: number;
  readonly z: number;
  readonly variant: TreeVariant;
}

const MIN_TREE_SPACING = 3;
const MAX_PLACEMENT_ATTEMPTS = 40;

function pickWeightedVariant(weights: Record<TreeVariant, number>): TreeVariant {
  const entries = Object.entries(weights) as Array<[TreeVariant, number]>;
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = Math.random() * total;
  for (const [variant, weight] of entries) {
    roll -= weight;
    if (roll <= 0) return variant;
  }
  return entries[entries.length - 1][0];
}

function isFarEnough(
  x: number,
  z: number,
  placedGrid: SpatialGrid<TreePlacement>,
  minSpacing: number = MIN_TREE_SPACING
): boolean {
  // Mřížka vrátí jen stromy z okolních buněk (v dosahu minSpacing), ne všechny
  // dosud umístěné stromy - O(n) místo O(n²) při rostoucím počtu stromů na mapě.
  return placedGrid.queryRadius(x, z, minSpacing).every((tree) => {
    const dx = tree.x - x;
    const dz = tree.z - z;
    return dx * dx + dz * dz >= minSpacing * minSpacing;
  });
}

export function generateTreePositions(
  bounds: WorldBounds,
  exclusionZones: readonly ExclusionZone[] = []
): TreePlacement[] {
  // Hranice biomu je nakloněná (tilt) a zvlněná (warp noise), ne konstantní z - tyto
  // rozsahy proto slouží jen jako padding pro efektivitu vzorkování (kam vůbec
  // náhodné body v daném biomu cílit), skutečné rozhodnutí dělá getBiomeAt(x, z) níž.
  const boundaryMaxShift = (Math.abs(BIOME_BOUNDARY_TILT) * (bounds.maxX - bounds.minX)) / 2 + BIOME_WARP_AMPLITUDE;
  const regions = [
    { biome: BIOMES['meadow'], minZ: bounds.minZ, maxZ: BIOME_BOUNDARY_Z + boundaryMaxShift },
    {
      biome: BIOMES['highlands'],
      minZ: BIOME_BOUNDARY_Z - boundaryMaxShift,
      maxZ: MOUNTAIN_BOUNDARY_Z + boundaryMaxShift
    },
    { biome: BIOMES['mountains'], minZ: MOUNTAIN_BOUNDARY_Z - boundaryMaxShift, maxZ: bounds.maxZ }
  ];

  const placements: TreePlacement[] = [];
  const placedGrid = new SpatialGrid<TreePlacement>(MIN_TREE_SPACING);
  let nextPlacementId = 0;

  for (const region of regions) {
    for (let i = 0; i < region.biome.treeDensity; i++) {
      for (let attempt = 0; attempt < MAX_PLACEMENT_ATTEMPTS; attempt++) {
        const x = bounds.minX + Math.random() * (bounds.maxX - bounds.minX);
        const z = region.minZ + Math.random() * (region.maxZ - region.minZ);
        if (
          getBiomeAt(x, z) === region.biome.id &&
          isFarEnough(x, z, placedGrid) &&
          !isExcluded(x, z, exclusionZones)
        ) {
          const placement = { x, z, variant: pickWeightedVariant(region.biome.treeWeights) };
          placements.push(placement);
          placedGrid.insert(String(nextPlacementId++), placement);
          break;
        }
      }
    }

    // Vzácné stromy (např. velký frostFir v horách) mají garantovaný počet, nezávislý
    // na treeWeights/treeDensity - jinak by při nízké hustotě biomu nízká váha mohla
    // v konkrétní generaci mapy nevylosovat ani jeden kus.
    for (const rare of region.biome.rareTrees ?? []) {
      for (let i = 0; i < rare.count; i++) {
        for (let attempt = 0; attempt < MAX_PLACEMENT_ATTEMPTS; attempt++) {
          const x = bounds.minX + Math.random() * (bounds.maxX - bounds.minX);
          const z = region.minZ + Math.random() * (region.maxZ - region.minZ);
          if (
            getBiomeAt(x, z) === region.biome.id &&
            isFarEnough(x, z, placedGrid, rare.minSpacing) &&
            !isExcluded(x, z, exclusionZones)
          ) {
            const placement = { x, z, variant: rare.variant };
            placements.push(placement);
            placedGrid.insert(String(nextPlacementId++), placement);
            break;
          }
        }
      }
    }
  }

  return placements;
}
