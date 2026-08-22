import { describe, expect, it } from 'vitest';
import { createIcosphere } from './icosphere';
import { buildGoldbergTiles } from './goldberg-mesh';
import { PlanetTerrain } from './planet-terrain';
import { buildTileData, getBiomeDefinition } from './planet-biome';
import { PlanetTileIndex } from './planet-tile-index';
import { generatePlanetVegetation } from './planet-vegetation-placement';
import { PLANET_RADIUS } from './planet-config';

// Level 3 místo produkčního 5 - dlaždice jsou větší, ale všechny invarianty jsou na jemnosti
// nezávislé a test běží rychle.
const tiles = buildGoldbergTiles(createIcosphere(3));
const terrain = new PlanetTerrain();
const tileData = buildTileData(tiles, terrain);
const placements = generatePlanetVegetation(tiles, tileData, terrain);

describe('generatePlanetVegetation', () => {
  it('vygeneruje nenulový počet instancí', () => {
    expect(placements.length).toBeGreaterThan(0);
  });

  it('je deterministický - druhý průchod dá identický výsledek', () => {
    // Bez toho by se planeta po každém reloadu přerovnala. Proto placement nepoužívá
    // Math.random() ani pickWeightedVariant z world/, ale hash z (dlaždice, vzorek).
    const again = generatePlanetVegetation(tiles, tileData, terrain);
    expect(again.length).toBe(placements.length);
    for (let i = 0; i < placements.length; i += 97) {
      expect(again[i].position.toArray()).toEqual(placements[i].position.toArray());
      expect(again[i].variant).toBe(placements[i].variant);
      expect(again[i].rotation).toBe(placements[i].rotation);
      expect(again[i].scale).toBe(placements[i].scale);
    }
  });

  it('instance sedí na povrchu a `up` je jednotková radiála', () => {
    for (let i = 0; i < placements.length; i += 37) {
      const p = placements[i];
      expect(p.up.length()).toBeCloseTo(1, 10);
      // Pozice musí ležet přesně na povrchu daném terénem, jinak by tráva plavala nebo
      // se zanořila.
      const expectedRadius = terrain.getSurfaceRadius(p.up);
      expect(p.position.length()).toBeCloseTo(expectedRadius, 6);
      // A `up` musí být opravdu směr té pozice, ne něco jiného.
      expect(p.up.dot(p.position.clone().normalize())).toBeCloseTo(1, 10);
    }
  });

  it('tráva roste jen v biomech, které mají vegetační konfiguraci', () => {
    // Dnes má `vegetation` jen meadow (viz biome.config.ts), takže vysočina a hory zůstávají
    // holé. Je to vlastnost konfigurace, ne opomenutí - tohle to hlídá.
    for (const placement of placements) {
      const biome = tileData[placement.tile].biome;
      expect(
        getBiomeDefinition(biome).vegetation,
        `biom ${biome} nemá vegetaci, ale vyrostla tam tráva`
      ).toBeDefined();
    }
  });

  it('body leží ve své dlaždici až na úzký pás u hranic', () => {
    // Nejde o 100 %, a to je v pořádku: rohy dlaždice jsou centroidy okolních trojúhelníků,
    // zatímco findTile hledá nejbližší střed. Centroidový duál a Voronoiho buňka se u hranic
    // liší tím víc, čím je trojúhelníková síť zkreslenější (nejvíc u 12 pětiúhelníků), takže
    // několik procent bodů z okrajového pásu spadne o hranu vedle. Funkčně to nevadí -
    // chunky jsou o řád větší než dlaždice a biom se bere z `placement.tile`, ne z lookupu.
    // Tolerance je tu proto, aby test odhalil skutečnou chybu ve vzorkování, kde by podíl
    // spadl řádově.
    const index = new PlanetTileIndex(tiles);
    let matching = 0;
    let total = 0;
    for (let i = 0; i < placements.length; i += 29) {
      if (index.findTile(placements[i].up) === placements[i].tile) matching++;
      total++;
    }
    expect(matching / total).toBeGreaterThan(0.95);
  });

  it('hustota odpovídá ploše planety, ne počtu dlaždic', () => {
    // Kontrola řádu: instancí na m² travnatého povrchu musí odpovídat konfigurované hustotě.
    const grassTiles = tileData.filter((d) => getBiomeDefinition(d.biome).vegetation).length;
    const tileArea = (4 * Math.PI * PLANET_RADIUS * PLANET_RADIUS) / tiles.length;
    const perTile = placements.length / grassTiles;
    expect(perTile).toBeGreaterThan(tileArea * 0.5);
    expect(perTile).toBeLessThan(tileArea * 2);
  });
});
