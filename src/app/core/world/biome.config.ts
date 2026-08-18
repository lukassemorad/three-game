import { BiomeDefinition, BiomeId } from '../../shared/models/biome.model';

// Ladit-elné konstanty: poměr variant stromů a jejich hustota (počet na biom).
export const BIOMES: Record<BiomeId, BiomeDefinition> = {
  meadow: {
    id: 'meadow',
    treeWeights: { oak: 0.85, pine: 0.15, frostFir: 0 },
    treeDensity: 90,
    // grassPatch je dominantní ground-cover, tuftOfGrass jen řídká příměs pro rozbití monotónnosti.
    // Accenty (květiny/keře/houby) mají vlastní, mnohem nižší hustotu a min-spacing, ať se
    // nekupí na jedno místo.
    // grassPatch (viz vegetation.config.ts) pokrývá plochu řádově víc než dřívější
    // jednostébelné Grass.glb, proto je groundCoverDensity oproti původním 700000 podstatně
    // nižší. Odhad podle poměru ploch trsu/stébla, ne přesné měření - klidně doladit podle oka.
    vegetation: {
      groundCoverDensity: 70000,
      groundCoverWeights: { grassPatch: 0.94, tuftOfGrass: 0.06 },
      accentDensity: 900,
      accentWeights: {
        tulip: 0.45,
        dandelions: 0.4,
        bush: 0.18,
        bushFlowers: 0.12,
        mushroom: 0.1
      },
      accentMinSpacing: 2.5
    },
    // Nahrazuje dřívější ručně vypsané souřadnice žab/jelenů (viz animal-placement.ts) -
    // stejný počet (6) rozdělený rovnoměrně mezi obě variace, s rozestupem ať se nekupí na
    // jedno místo. Klidně doladit podle oka, stejně jako accentDensity výš.
    animals: {
      density: 20,
      weights: { frog: 0.2, stag: 0.8 },
      minSpacing: 8
    }
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
