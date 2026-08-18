import { VegetationVariant } from '../../shared/models/vegetation.model';
import { BIOMES } from './biome.config';
import { ExclusionZone, isExcluded } from './placement-exclusion';
import { SpatialGrid, SpatialPoint } from './spatial-grid';
import { getBiomeAt, getBiomeZRanges } from './terrain-generator';
import { pickWeightedVariant } from './weighted-random';
import { WorldBounds } from './world-config';

export interface VegetationSpawnPoint {
  readonly x: number;
  readonly z: number;
  readonly variant: VegetationVariant;
}

// Ground cover nemá min-spacing, jen musí trefit správný biom/mimo vyloučené zóny - pár
// pokusů na bod stačí. Accenty (dál od sebe, kvůli SpatialGrid dotazu) potřebují víc pokusů,
// stejně jako rareTrees v tree-placement.ts.
const GROUND_COVER_ATTEMPTS = 4;
const MAX_ACCENT_ATTEMPTS = 30;

function isFarEnough(x: number, z: number, grid: SpatialGrid<SpatialPoint>, minSpacing: number): boolean {
  return grid.queryRadius(x, z, minSpacing).every((point) => {
    const dx = point.x - x;
    const dz = point.z - z;
    return dx * dx + dz * dz >= minSpacing * minSpacing;
  });
}

export function generateVegetationPlacements(
  bounds: WorldBounds,
  exclusionZones: readonly ExclusionZone[] = []
): VegetationSpawnPoint[] {
  const placements: VegetationSpawnPoint[] = [];

  for (const zRange of getBiomeZRanges(bounds)) {
    const vegetation = BIOMES[zRange.biome].vegetation;
    if (!vegetation) continue;

    // Ground cover: čistý scatter bez min-spacing kontroly - hustý koberec smí trsy mírně
    // překrývat, to je žádoucí vzhled louky, ne bug (na rozdíl od accentů níž).
    for (let i = 0; i < vegetation.groundCoverDensity; i++) {
      for (let attempt = 0; attempt < GROUND_COVER_ATTEMPTS; attempt++) {
        const x = bounds.minX + Math.random() * (bounds.maxX - bounds.minX);
        const z = zRange.minZ + Math.random() * (zRange.maxZ - zRange.minZ);
        if (getBiomeAt(x, z) === zRange.biome && !isExcluded(x, z, exclusionZones)) {
          placements.push({ x, z, variant: pickWeightedVariant(vegetation.groundCoverWeights) });
          break;
        }
      }
    }

    // Accenty (květiny/trsy/keře/houby): rejection sampling + min-spacing (stejný princip
    // jako rareTrees v tree-placement.ts), aby se nekupily na jedno místo.
    const accentGrid = new SpatialGrid<SpatialPoint>(vegetation.accentMinSpacing);
    let nextAccentId = 0;
    for (let i = 0; i < vegetation.accentDensity; i++) {
      for (let attempt = 0; attempt < MAX_ACCENT_ATTEMPTS; attempt++) {
        const x = bounds.minX + Math.random() * (bounds.maxX - bounds.minX);
        const z = zRange.minZ + Math.random() * (zRange.maxZ - zRange.minZ);
        if (
          getBiomeAt(x, z) === zRange.biome &&
          !isExcluded(x, z, exclusionZones) &&
          isFarEnough(x, z, accentGrid, vegetation.accentMinSpacing)
        ) {
          accentGrid.insert(String(nextAccentId++), { x, z });
          placements.push({ x, z, variant: pickWeightedVariant(vegetation.accentWeights) });
          break;
        }
      }
    }
  }

  return placements;
}
