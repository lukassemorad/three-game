import { TreeVariant } from '../../shared/models/tree.model';
import { BIOMES } from './biome.config';
import { ExclusionZone, isExcluded } from './placement-exclusion';
import { SpatialGrid } from './spatial-grid';
import { getBiomeAt, getBiomeZRanges } from './terrain-generator';
import { pickWeightedVariant } from './weighted-random';
import { WorldBounds } from './world-config';

export interface TreePlacement {
  readonly x: number;
  readonly z: number;
  readonly variant: TreeVariant;
}

const MIN_TREE_SPACING = 3;
const MAX_PLACEMENT_ATTEMPTS = 40;

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
  const placements: TreePlacement[] = [];
  const placedGrid = new SpatialGrid<TreePlacement>(MIN_TREE_SPACING);
  let nextPlacementId = 0;

  for (const zRange of getBiomeZRanges(bounds)) {
    const region = { biome: BIOMES[zRange.biome], minZ: zRange.minZ, maxZ: zRange.maxZ };
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
