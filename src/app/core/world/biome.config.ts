import { BiomeDefinition, BiomeId } from '../../shared/models/biome.model';

// Ladit-elné konstanty: poměr variant stromů a jejich hustota (počet na biom).
export const BIOMES: Record<BiomeId, BiomeDefinition> = {
  meadow: {
    id: 'meadow',
    treeWeights: { oak: 0.85, pine: 0.15, frostFir: 0 },
    treeDensity: 90
  },
  highlands: {
    id: 'highlands',
    treeWeights: { oak: 0.2, pine: 0.8, frostFir: 0 },
    treeDensity: 65
  },
  mountains: {
    id: 'mountains',
    // frostFir se neztvárňuje váženým losováním (váha 0) - vzniká výhradně přes
    // rareTrees níže, aby byl garantovaný počet, ne náhoda podle treeDensity.
    treeWeights: { oak: 0.05, pine: 0.95, frostFir: 0 },
    treeDensity: 25,
    rareTrees: [{ variant: 'frostFir', count: 3, minSpacing: 8 }]
  }
};
