import { BiomeDefinition, BiomeId } from '../../shared/models/biome.model';

// Ladit-elné konstanty: poměr variant stromů a jejich hustota (počet na biom).
export const BIOMES: Record<BiomeId, BiomeDefinition> = {
  meadow: {
    id: 'meadow',
    treeWeights: { oak: 0.85, pine: 0.15 },
    treeDensity: 14
  },
  highlands: {
    id: 'highlands',
    treeWeights: { oak: 0.2, pine: 0.8 },
    treeDensity: 10
  },
  mountains: {
    id: 'mountains',
    treeWeights: { oak: 0.05, pine: 0.95 },
    treeDensity: 4
  }
};
