import { describe, expect, it } from 'vitest';
import { createIcosphere } from './icosphere';
import { buildGoldbergTiles } from './goldberg-mesh';
import { PlanetTerrain } from './planet-terrain';
import { buildTileData } from './planet-biome';
import { generatePlanetTrees } from './planet-tree-placement';
import { BIOME_TREES, MIN_TREE_SPACING, PLANET_TREE_DEFS } from './planet-tree.config';
import { PLANET_SUBDIVISION_LEVEL } from './planet-config';

// Produkční úroveň dělení: hustoty stromů jsou pod 1 na dlaždici, takže na hrubší síti by
// vyšel jiný počet a test na hustotu by neměl smysl.
const tiles = buildGoldbergTiles(createIcosphere(PLANET_SUBDIVISION_LEVEL));
const terrain = new PlanetTerrain();
const tileData = buildTileData(tiles, terrain);
const placements = generatePlanetTrees(tiles, tileData, terrain);

describe('generatePlanetTrees', () => {
  it('vygeneruje stromy ve všech biomech', () => {
    expect(placements.length).toBeGreaterThan(0);
    const biomes = new Set(placements.map((p) => tileData[p.tile].biome));
    expect(biomes).toContain('meadow');
    expect(biomes).toContain('highlands');
    expect(biomes).toContain('mountains');
  });

  it('je deterministický', () => {
    const again = generatePlanetTrees(tiles, tileData, terrain);
    expect(again.length).toBe(placements.length);
    for (let i = 0; i < placements.length; i += 13) {
      expect(again[i].position.toArray()).toEqual(placements[i].position.toArray());
      expect(again[i].variant).toBe(placements[i].variant);
    }
  });

  it('drží minimální rozestup', () => {
    // Rozestup se kontroluje jen proti vlastní dlaždici a jejím sousedům (bez prostorového
    // indexu). Tenhle test to ověřuje hrubou silou proti VŠEM stromům - kdyby okolí sousedů
    // nestačilo, vyjde tu porušení.
    const minSq = MIN_TREE_SPACING * MIN_TREE_SPACING;
    let violations = 0;
    for (let i = 0; i < placements.length; i++) {
      for (let j = i + 1; j < placements.length; j++) {
        if (placements[i].position.distanceToSquared(placements[j].position) < minSq) {
          violations++;
        }
      }
    }
    expect(violations).toBe(0);
  });

  it('stromy sedí na povrchu a `up` je jejich radiála', () => {
    for (let i = 0; i < placements.length; i += 7) {
      const p = placements[i];
      expect(p.up.length()).toBeCloseTo(1, 10);
      expect(p.position.length()).toBeCloseTo(terrain.getSurfaceRadius(p.up), 6);
      expect(p.up.dot(p.position.clone().normalize())).toBeCloseTo(1, 10);
    }
  });

  it('varianty odpovídají vahám svého biomu', () => {
    // Např. na loukách nesmí vyrůst suchý strom - deadTree má váhu jen v horách.
    for (const placement of placements) {
      const biome = tileData[placement.tile].biome;
      const weights = BIOME_TREES[biome].weights;
      expect(
        weights[placement.variant],
        `${placement.variant} nemá v biomu ${biome} váhu`
      ).toBeGreaterThan(0);
    }
  });

  it('každá použitá varianta má definici modelu a colideru', () => {
    for (const variant of new Set(placements.map((p) => p.variant))) {
      const def = PLANET_TREE_DEFS[variant];
      expect(def, `chybí definice pro ${variant}`).toBeDefined();
      expect(def.colliderRadius).toBeGreaterThan(0);
      expect(def.colliderHeightFactor).toBeGreaterThan(0);
      expect(def.colliderHeightFactor).toBeLessThanOrEqual(1);
    }
  });

  it('hustota je v řádu konfigurace', () => {
    // Kontrola, že se stromy nevygenerovaly řádově jinak (např. že zlomková
    // pravděpodobnost u hustot pod 1 na dlaždici nevypadla úplně).
    const counts = new Map<string, number>();
    for (const p of placements) {
      const biome = tileData[p.tile].biome;
      counts.set(biome, (counts.get(biome) ?? 0) + 1);
    }
    const tileArea = (4 * Math.PI * 150 * 150) / tiles.length;
    for (const [biome, count] of counts) {
      const tilesInBiome = tileData.filter((d) => d.biome === biome).length;
      const expected = tilesInBiome * tileArea * BIOME_TREES[biome as 'meadow'].perSquareMeter;
      expect(count, `počet stromů v ${biome}`).toBeGreaterThan(expected * 0.5);
      expect(count, `počet stromů v ${biome}`).toBeLessThan(expected * 1.5);
    }
  });
});
