import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createIcosphere } from './icosphere';
import { buildGoldbergTiles } from './goldberg-mesh';
import { PlanetTileIndex } from './planet-tile-index';

// Sousednost dlaždic a hill-climbing lookup jsou nosné pro všechen budoucí obsah (biomy,
// placement, culling), takže se testují na exaktních invariantech, ne pohledem do hry.

// Deterministický generátor směrů - Math.random() by dělal testy nereprodukovatelné.
function pseudoRandomDirections(count: number): THREE.Vector3[] {
  const dirs: THREE.Vector3[] = [];
  for (let i = 0; i < count; i++) {
    // Zlatý úhel: rovnoměrné pokrytí koule bez shluků, plně deterministické.
    const t = (i + 0.5) / count;
    const z = 1 - 2 * t;
    const azimuth = i * Math.PI * (3 - Math.sqrt(5));
    const planarRadius = Math.sqrt(Math.max(0, 1 - z * z));
    dirs.push(
      new THREE.Vector3(
        planarRadius * Math.cos(azimuth),
        planarRadius * Math.sin(azimuth),
        z
      ).normalize()
    );
  }
  return dirs;
}

describe('sousednost dlaždic', () => {
  const tiles = buildGoldbergTiles(createIcosphere(3));

  it('počet sousedů odpovídá počtu rohů', () => {
    for (const tile of tiles) {
      expect(tile.neighbors.length).toBe(tile.cornerDirs.length);
      expect(tile.neighbors.length).toBe(tile.isPentagon ? 5 : 6);
    }
  });

  it('sousednost je symetrická', () => {
    // Kdyby ring walk zapisoval sousedy nekonzistentně, hill climbing by mohl uváznout.
    tiles.forEach((tile, index) => {
      for (const neighbor of tile.neighbors) {
        expect(tiles[neighbor].neighbors).toContain(index);
      }
    });
  });

  it('dlaždice není svým vlastním sousedem a sousedi se neopakují', () => {
    tiles.forEach((tile, index) => {
      expect(tile.neighbors).not.toContain(index);
      expect(new Set(tile.neighbors).size).toBe(tile.neighbors.length);
    });
  });

  it('sousedi jsou geometricky blíž než průměrná dlaždice', () => {
    for (const tile of tiles) {
      for (const neighbor of tile.neighbors) {
        expect(tiles[neighbor].centerDir.dot(tile.centerDir)).toBeGreaterThan(0.8);
      }
    }
  });
});

describe('PlanetTileIndex', () => {
  const tiles = buildGoldbergTiles(createIcosphere(3));
  const index = new PlanetTileIndex(tiles);

  it('hill climbing dá stejný výsledek jako brute force', () => {
    // Tohle je vlastní ospravedlnění hill climbingu: na konvexním dláždění sféry je
    // dot(centerDir, dir) unimodální, takže lokální stoupání najde globální maximum.
    for (const dir of pseudoRandomDirections(400)) {
      expect(index.findTile(dir)).toBe(index.findTileByBruteForce(dir));
    }
  });

  it('najde správnou dlaždici i při skoku na antipod', () => {
    // Cache poslední dlaždice nesmí uvěznit hledání na opačné straně planety.
    const dirs = pseudoRandomDirections(50);
    for (const dir of dirs) {
      const antipode = dir.clone().negate();
      expect(index.findTile(dir)).toBe(index.findTileByBruteForce(dir));
      expect(index.findTile(antipode)).toBe(index.findTileByBruteForce(antipode));
    }
  });

  it('střed dlaždice najde sám sebe', () => {
    tiles.forEach((tile, expected) => {
      expect(index.findTile(tile.centerDir)).toBe(expected);
    });
  });

  it('každá dlaždice patří právě do jednoho chunku a chunky pokrývají všechny dlaždice', () => {
    let total = 0;
    for (let chunk = 0; chunk < index.chunkCount; chunk++) {
      const inChunk = index.getTilesInChunk(chunk);
      total += inChunk.length;
      for (const tile of inChunk) expect(index.getChunkOfTile(tile)).toBe(chunk);
    }
    expect(total).toBe(tiles.length);
  });
});
