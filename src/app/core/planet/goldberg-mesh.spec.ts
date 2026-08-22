import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createIcosphere } from './icosphere';
import { buildGoldbergTiles } from './goldberg-mesh';

// Goldberg síť má exaktně ověřitelné invarianty, takže se nemusí spoléhat na pohled do hry:
// když by se rozpadla topologie (rozbitá edge cache, prasklý prstenec v duálu), spadne rovnou
// jeden z těchhle testů.
describe('createIcosphere', () => {
  for (const level of [0, 1, 2, 3]) {
    it(`level ${level} má 10*4^N+2 vrcholů a 20*4^N trojúhelníků`, () => {
      const sphere = createIcosphere(level);
      expect(sphere.vertices.length).toBe(10 * 4 ** level + 2);
      expect(sphere.indices.length / 3).toBe(20 * 4 ** level);
      expect(sphere.baseVertexCount).toBe(12);
    });
  }

  it('všechny vrcholy leží na jednotkové kouli', () => {
    for (const v of createIcosphere(2).vertices) {
      expect(v.length()).toBeCloseTo(1, 10);
    }
  });

  it('každá hrana je sdílená právě dvěma trojúhelníky (uzavřený povrch)', () => {
    // Kdyby edge-midpoint cache nefungovala, sousední trojúhelníky by dostaly vlastní kopie
    // vrcholů a hrany by se přestaly potkávat.
    const { indices } = createIcosphere(2);
    const edgeCount = new Map<string, number>();
    for (let f = 0; f < indices.length / 3; f++) {
      const tri = [indices[f * 3], indices[f * 3 + 1], indices[f * 3 + 2]];
      for (let i = 0; i < 3; i++) {
        const a = tri[i];
        const b = tri[(i + 1) % 3];
        const key = a < b ? `${a}-${b}` : `${b}-${a}`;
        edgeCount.set(key, (edgeCount.get(key) ?? 0) + 1);
      }
    }
    for (const count of edgeCount.values()) expect(count).toBe(2);
  });
});

describe('buildGoldbergTiles', () => {
  it('vyrobí dlaždici pro každý vrchol icosphere', () => {
    const sphere = createIcosphere(3);
    const tiles = buildGoldbergTiles(sphere);
    expect(tiles.length).toBe(sphere.vertices.length);
  });

  it('má vždy přesně 12 pětiúhelníků, zbytek šestiúhelníky', () => {
    // Tohle je ten důsledek Eulerovy formule, kvůli kterému čistě hexagonální planeta
    // nejde - platí pro každou jemnost dělení.
    for (const level of [1, 2, 3]) {
      const tiles = buildGoldbergTiles(createIcosphere(level));
      const pentagons = tiles.filter((t) => t.isPentagon);
      expect(pentagons.length).toBe(12);
      for (const tile of tiles) {
        expect(tile.cornerDirs.length).toBe(tile.isPentagon ? 5 : 6);
      }
    }
  });

  it('pětiúhelníky sedí na prvních 12 vrcholech (vrcholy původního ikosaedru)', () => {
    const tiles = buildGoldbergTiles(createIcosphere(2));
    for (let i = 0; i < 12; i++) expect(tiles[i].isPentagon).toBe(true);
    for (let i = 12; i < tiles.length; i++) expect(tiles[i].isPentagon).toBe(false);
  });

  it('rohy dlaždice tvoří uzavřený prstenec okolo jejího středu', () => {
    const tiles = buildGoldbergTiles(createIcosphere(2));
    for (const tile of tiles) {
      // Všechny rohy stejně daleko od středu dlaždice (± tolerance danou tím, že centroidy
      // pěti- a šestiúhelníků nejsou dokonale pravidelné) a všechny na jednotkové kouli.
      for (const corner of tile.cornerDirs) {
        expect(corner.length()).toBeCloseTo(1, 10);
        expect(corner.dot(tile.centerDir)).toBeGreaterThan(0.9);
      }
      // Součet rohů míří stejným směrem jako střed - jinak by prstenec nebyl okolo něj.
      // Dlaždice nejsou dokonale pravidelné (centroidy trojúhelníků icosphere se blíž
      // k pětiúhelníkům deformují), takže tolerance není nulová.
      const sum = tile.cornerDirs
        .reduce((acc, c) => acc.add(c), new THREE.Vector3())
        .normalize();
      expect(sum.dot(tile.centerDir)).toBeGreaterThan(0.999);
    }
  });
});
