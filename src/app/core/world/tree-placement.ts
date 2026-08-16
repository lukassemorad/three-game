import { TreeVariant } from '../../shared/models/tree.model';
import { BIOMES } from './biome.config';
import { ExclusionZone, isExcluded } from './placement-exclusion';
import { BIOME_BOUNDARY_Z, MOUNTAIN_BOUNDARY_Z } from './terrain-generator';

export interface WorldBounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

export interface TreePlacement {
  readonly x: number;
  readonly z: number;
  readonly variant: TreeVariant;
}

const MIN_TREE_SPACING = 3;
const MAX_PLACEMENT_ATTEMPTS = 30;

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

function isFarEnough(x: number, z: number, placed: TreePlacement[]): boolean {
  return placed.every((tree) => {
    const dx = tree.x - x;
    const dz = tree.z - z;
    return dx * dx + dz * dz >= MIN_TREE_SPACING * MIN_TREE_SPACING;
  });
}

export function generateTreePositions(
  bounds: WorldBounds,
  exclusionZones: readonly ExclusionZone[] = []
): TreePlacement[] {
  const regions = [
    { biome: BIOMES['meadow'], minZ: bounds.minZ, maxZ: BIOME_BOUNDARY_Z },
    { biome: BIOMES['highlands'], minZ: BIOME_BOUNDARY_Z, maxZ: MOUNTAIN_BOUNDARY_Z },
    { biome: BIOMES['mountains'], minZ: MOUNTAIN_BOUNDARY_Z, maxZ: bounds.maxZ }
  ];

  const placements: TreePlacement[] = [];

  for (const region of regions) {
    for (let i = 0; i < region.biome.treeDensity; i++) {
      for (let attempt = 0; attempt < MAX_PLACEMENT_ATTEMPTS; attempt++) {
        const x = bounds.minX + Math.random() * (bounds.maxX - bounds.minX);
        const z = region.minZ + Math.random() * (region.maxZ - region.minZ);
        if (isFarEnough(x, z, placements) && !isExcluded(x, z, exclusionZones)) {
          placements.push({ x, z, variant: pickWeightedVariant(region.biome.treeWeights) });
          break;
        }
      }
    }
  }

  return placements;
}
