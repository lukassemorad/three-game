import { BiomeId } from '../../shared/models/biome.model';
import { VisualVariationRange } from '../world/position-hash';

// Stromy na planetě jsou GLB modely z nature-kitu, ne procedurální geometrie jako v plochém
// světě (tree.entity.ts staví kmen z válcových klínů a korunu z kuželů). Důvod: procedurální
// stromy jsou navázané na kácení - klíny existují proto, aby se z nich dal vykrojit zásek -
// a to je zatím mimo scope. Modely projdou stejnou pipeline jako tráva.
//
// Kit obsahuje i hash-suffixované duplicity (např. "Pine-699sFuLCN2.glb") - jde o redundantní
// kopie ze zdroje balíčku, ne o samostatné varianty, proto se sem nezahrnují (stejná úvaha
// jako ve vegetation.config.ts).
export type PlanetTreeVariant = 'broadleaf' | 'pine' | 'twisted' | 'deadTree';

export interface PlanetTreeDef {
  readonly modelUrl: string;
  // Cílová výška po naškálování (metry) - normalizuje se na ni nejdelší rozměr modelu.
  readonly targetSize: number;
  readonly variation: VisualVariationRange;
  // Rapier collider: svislý válec podél lokální osy stromu. Radius je poloměr kmene, ne
  // korony - do větví se dá vejít, do kmene ne.
  readonly colliderRadius: number;
  // Podíl targetSize, do jaké výšky collider sahá. Nemá smysl dělat ho do celé výšky koruny.
  readonly colliderHeightFactor: number;
}

function natureKitUrl(fileName: string): string {
  return encodeURI(`assets/nature-kit/${fileName}`);
}

export const PLANET_TREE_DEFS: Record<PlanetTreeVariant, PlanetTreeDef> = {
  broadleaf: {
    modelUrl: natureKitUrl('Tree.glb'),
    targetSize: 7,
    variation: { scaleMin: 0.8, scaleRange: 0.5, tintMin: 0.8, tintRange: 0.35 },
    colliderRadius: 0.45,
    colliderHeightFactor: 0.55
  },
  pine: {
    modelUrl: natureKitUrl('Pine.glb'),
    targetSize: 9,
    variation: { scaleMin: 0.8, scaleRange: 0.55, tintMin: 0.8, tintRange: 0.3 },
    colliderRadius: 0.4,
    colliderHeightFactor: 0.7
  },
  twisted: {
    modelUrl: natureKitUrl('Twisted Tree.glb'),
    targetSize: 6.5,
    variation: { scaleMin: 0.8, scaleRange: 0.5, tintMin: 0.75, tintRange: 0.35 },
    colliderRadius: 0.45,
    colliderHeightFactor: 0.5
  },
  deadTree: {
    modelUrl: natureKitUrl('Dead Tree.glb'),
    targetSize: 6,
    variation: { scaleMin: 0.75, scaleRange: 0.5, tintMin: 0.85, tintRange: 0.25 },
    colliderRadius: 0.35,
    colliderHeightFactor: 0.6
  }
};

export interface BiomeTreeConfig {
  // Stromů na m² povrchu. biome.config.ts má treeDensity jako absolutní počty na biom
  // (90/65/25), což na kouli nejde použít - plocha biomu je jiná. Poměry mezi biomy jsou
  // ale vzaté odtud, jen s vysočinou jako nejzalesněnější (jehličnaté lesy nad loukami).
  readonly perSquareMeter: number;
  readonly weights: Partial<Record<PlanetTreeVariant, number>>;
}

export const BIOME_TREES: Record<BiomeId, BiomeTreeConfig> = {
  meadow: {
    perSquareMeter: 0.003,
    weights: { broadleaf: 0.8, pine: 0.15, twisted: 0.05 }
  },
  highlands: {
    perSquareMeter: 0.006,
    weights: { pine: 0.75, broadleaf: 0.15, twisted: 0.1 }
  },
  mountains: {
    // Nad hranicí lesa řídne a přibývá suchých stromů.
    perSquareMeter: 0.0015,
    weights: { pine: 0.55, twisted: 0.2, deadTree: 0.25 }
  }
};

// Minimální rozestup mezi stromy (metry). Plochý svět má MIN_TREE_SPACING 3 - stejná hodnota,
// protože měřítko světa se nemění, jen jeho tvar.
export const MIN_TREE_SPACING = 3;

// Dohled stromů s hysterezí - stejné hodnoty jako v plochém světě (tree.service.ts).
// Výrazně dál než tráva, protože stromy jsou velké a jejich zmizení je nápadné.
export const TREE_HIDE_DISTANCE = 160;
export const TREE_SHOW_DISTANCE = 130;
