import { AnimalVariant } from '../../shared/models/animal.model';
import { BIOMES } from './biome.config';
import { ExclusionZone, isExcluded } from './placement-exclusion';
import { SpatialGrid, SpatialPoint } from './spatial-grid';
import { getBiomeAt, getBiomeZRanges } from './terrain-generator';
import { pickWeightedVariant } from './weighted-random';
import { WorldBounds } from './world-config';

export interface AnimalSpawnPoint {
  readonly x: number;
  readonly z: number;
  readonly variant: AnimalVariant;
}

// Rejection sampling + min-spacing, stejný princip jako accenty ve vegetation-placement.ts -
// zvířata nesmí spawnout příliš blízko sebe (bez ohledu na variantu, proto jedna sdílená grid).
const MAX_ANIMAL_ATTEMPTS = 30;

function isFarEnough(x: number, z: number, grid: SpatialGrid<SpatialPoint>, minSpacing: number): boolean {
  return grid.queryRadius(x, z, minSpacing).every((point) => {
    const dx = point.x - x;
    const dz = point.z - z;
    return dx * dx + dz * dz >= minSpacing * minSpacing;
  });
}

export function generateAnimalPlacements(
  bounds: WorldBounds,
  exclusionZones: readonly ExclusionZone[] = []
): AnimalSpawnPoint[] {
  const placements: AnimalSpawnPoint[] = [];

  for (const zRange of getBiomeZRanges(bounds)) {
    const animals = BIOMES[zRange.biome].animals;
    if (!animals) continue;

    const grid = new SpatialGrid<SpatialPoint>(animals.minSpacing);
    let nextId = 0;
    for (let i = 0; i < animals.density; i++) {
      for (let attempt = 0; attempt < MAX_ANIMAL_ATTEMPTS; attempt++) {
        const x = bounds.minX + Math.random() * (bounds.maxX - bounds.minX);
        const z = zRange.minZ + Math.random() * (zRange.maxZ - zRange.minZ);
        if (
          getBiomeAt(x, z) === zRange.biome &&
          !isExcluded(x, z, exclusionZones) &&
          isFarEnough(x, z, grid, animals.minSpacing)
        ) {
          grid.insert(String(nextId++), { x, z });
          placements.push({ x, z, variant: pickWeightedVariant(animals.weights) });
          break;
        }
      }
    }
  }

  return placements;
}
