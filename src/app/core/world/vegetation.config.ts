import { VegetationVariant } from '../../shared/models/vegetation.model';
import { VisualVariationRange } from './position-hash';

export interface VegetationDef {
  readonly modelUrl: string;
  // Cílový nejdelší rozměr modelu po naškálování (metry) - geometrie se na něj normalizuje
  // jednou při loadu (viz vegetation-model-loader.ts), instance pak už jen mírně variují
  // kolem 1.0 (viz variation) - stejný princip jako item.targetSize v item-model-loader.ts.
  readonly targetSize: number;
  readonly variation: VisualVariationRange;
}

function natureKitUrl(fileName: string): string {
  return encodeURI(`assets/nature-kit/${fileName}`);
}

function polyPizzaGrassUrl(fileName: string): string {
  return encodeURI(`assets/poly-pizza-grass/${fileName}`);
}

// Kit obsahuje i hash-suffixované duplicity (např. "Grass Wispy-Msr9zx66VU.glb",
// "Clover-u5SOgBFiut.glb") - jde o redundantní stažené kopie ze zdroje balíčku, ne o
// samostatné varianty, proto se sem záměrně nezahrnují.
export const VEGETATION_DEFS: Record<VegetationVariant, VegetationDef> = {
  // Trs z poly.pizza ("Grass Patch 01", CC BY 3.0, autor Jarlan Perez) - jednodušší/hranatý
  // low-poly styl, který lépe sedí ke zbytku světa než dřívější jemné poly.pizza trávy
  // (grass-green/mix/yellowing.glb - soubory zůstaly v assets pro případné pozdější použití,
  // jen se na ně nikdo neodkazuje). Surový model má stranu ~0.15 m, targetSize ho úmyslně
  // zvětšuje hodně nad reálné měřítko, ať je trs v hustotě groundCoverDensity dobře vidět.
  grassPatch: {
    modelUrl: polyPizzaGrassUrl('grass-patch-lowpoly.glb'),
    targetSize: 1,
    // tint jde jen 0.55-1.05 (dřív 0.85-1.75) - žádný trs už nesvítí nad "přirozenou" barvu
    // materiálu a zároveň je citelný rozptyl tmavší/světlejší, ať pole nepůsobí jednobarevně.
    variation: { scaleMin: 0.85, scaleRange: 0.3, tintMin: 0.55, tintRange: 0.5 }
  },
  // Stejná autorská rodina (Jarlan Perez, CC BY 3.0) jako grassPatch výš - drží se stejný
  // hranatý low-poly styl. targetSize je zatím jen orientační odhad (viz komentář u
  // grassPatch) - klidně doladit podle oka, stejně jako u ostatních variant výš.
  tuftOfGrass: {
    modelUrl: polyPizzaGrassUrl('tuft-of-grass.glb'),
    targetSize: 0.9,
    variation: { scaleMin: 0.85, scaleRange: 0.3, tintMin: 0.55, tintRange: 0.45 }
  },
  dandelions: {
    modelUrl: polyPizzaGrassUrl('dandelions.glb'),
    targetSize: 0.7,
    variation: { scaleMin: 0.85, scaleRange: 0.3, tintMin: 0.9, tintRange: 0.2 }
  },
  tulip: {
    modelUrl: polyPizzaGrassUrl('tulip.glb'),
    targetSize: 0.7,
    variation: { scaleMin: 0.85, scaleRange: 0.3, tintMin: 0.9, tintRange: 0.2 }
  },
  bush: {
    modelUrl: natureKitUrl('Bush.glb'),
    targetSize: 1.2,
    variation: { scaleMin: 0.8, scaleRange: 0.4, tintMin: 0.85, tintRange: 0.3 }
  },
  bushFlowers: {
    modelUrl: natureKitUrl('Bush with Flowers.glb'),
    targetSize: 1.2,
    variation: { scaleMin: 0.8, scaleRange: 0.4, tintMin: 0.85, tintRange: 0.3 }
  },
  mushroom: {
    modelUrl: natureKitUrl('Mushroom.glb'),
    targetSize: 0.6,
    variation: { scaleMin: 0.8, scaleRange: 0.5, tintMin: 0.9, tintRange: 0.2 }
  }
};
