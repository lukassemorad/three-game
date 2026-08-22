import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createIcosphere } from './icosphere';
import { buildGoldbergTiles } from './goldberg-mesh';
import { PlanetTerrain } from './planet-terrain';
import { buildTileData } from './planet-biome';
import {
  MAX_ELEVATION,
  PLANET_RADIUS,
  RELIEF_DETAIL_AMPLITUDE
} from './planet-config';

// Terén a biomy se dají ověřit invarianty místo pohledem do hry: že se povrch nezařezává
// pod referenční poloměr, že biomy tvoří spojité oblasti a ne šum, a že planeta vyjde
// pokaždé stejná.

const tiles = buildGoldbergTiles(createIcosphere(4));
const terrain = new PlanetTerrain();
const tileData = buildTileData(tiles, terrain);

describe('PlanetTerrain', () => {
  it('povrch se nedostane hlouběji než o RELIEF_DETAIL_AMPLITUDE pod referenční poloměr', () => {
    // `rolling` je posunuté do 0..1, takže jediná složka, která může jít pod PLANET_RADIUS,
    // je jemný detail. Kdyby se to rozbilo, planeta by měla dolíky pod „dnem".
    for (const tile of tiles) {
      const radius = terrain.getSurfaceRadius(tile.centerDir);
      expect(radius).toBeGreaterThanOrEqual(PLANET_RADIUS - RELIEF_DETAIL_AMPLITUDE - 1e-6);
    }
  });

  it('elevation je znormalizovaná do 0..1 a MAX_ELEVATION je platná horní hranice', () => {
    for (const tile of tiles) {
      const sample = terrain.sample(tile.centerDir);
      expect(sample.elevation).toBeGreaterThanOrEqual(0);
      expect(sample.elevation).toBeLessThanOrEqual(1);
      expect(sample.surfaceRadius - PLANET_RADIUS).toBeLessThanOrEqual(MAX_ELEVATION + 1e-6);
    }
  });

  it('massif maska je v 0..1', () => {
    for (const tile of tiles) {
      const massif = terrain.getMassif(tile.centerDir);
      expect(massif).toBeGreaterThanOrEqual(0);
      expect(massif).toBeLessThanOrEqual(1);
    }
  });

  it('planeta je reprodukovatelná - dvě instance dají stejný terén', () => {
    // ImprovedNoise ze three.js má pevnou permutační tabulku, takže planeta je mezi
    // spuštěními identická. Kdyby se to změnilo (vlastní seed), rozejdou se uložené pozice
    // objektů s terénem - proto to hlídáme testem.
    const other = new PlanetTerrain();
    for (const tile of tiles.slice(0, 200)) {
      expect(other.getSurfaceRadius(tile.centerDir)).toBe(
        terrain.getSurfaceRadius(tile.centerDir)
      );
    }
  });

  it('sousední dlaždice nejsou svislé stěny - sklon zůstává schůdný', () => {
    // Character controller má MAX_SLOPE_CLIMB_ANGLE 55 stupňů. Tenhle test nekontroluje
    // každý trojúhelník, ale hlídá, že typický přechod mezi středy sousedních dlaždic není
    // schod, po kterém se nedá vyjít - tedy že relief není přeladěný do neprůchodna.
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    let steep = 0;
    let total = 0;

    tiles.forEach((tile, index) => {
      a.copy(tile.centerDir).multiplyScalar(tileData[index].surfaceRadius);
      for (const neighbor of tile.neighbors) {
        b.copy(tiles[neighbor].centerDir).multiplyScalar(tileData[neighbor].surfaceRadius);
        const rise = Math.abs(tileData[neighbor].surfaceRadius - tileData[index].surfaceRadius);
        const run = a.distanceTo(b);
        total++;
        if (Math.atan2(rise, run) > (55 * Math.PI) / 180) steep++;
      }
    });

    expect(steep / total).toBeLessThan(0.02);
  });
});

describe('biomy', () => {
  it('všechny tři biomy se na planetě vyskytují', () => {
    const present = new Set(tileData.map((d) => d.biome));
    expect(present).toContain('meadow');
    expect(present).toContain('highlands');
    expect(present).toContain('mountains');
  });

  it('žádný biom planetu nepohltí ani nezmizí do pár dlaždic', () => {
    const counts = new Map<string, number>();
    for (const data of tileData) counts.set(data.biome, (counts.get(data.biome) ?? 0) + 1);
    for (const [biome, count] of counts) {
      const share = count / tileData.length;
      expect(share, `podíl biomu ${biome}`).toBeGreaterThan(0.02);
      expect(share, `podíl biomu ${biome}`).toBeLessThan(0.9);
    }
  });

  it('biomy tvoří spojité oblasti, ne šum dlaždice po dlaždici', () => {
    // Tohle je vlastní důvod, proč se biom bere z nízkofrekvenční masivové masky a ne
    // z výšky dlaždice: u šumu by shoda se sousedy byla blízko 1/3, u spojitých oblastí
    // je většina dlaždic uvnitř oblasti a shoduje se.
    let same = 0;
    let total = 0;
    tiles.forEach((tile, index) => {
      for (const neighbor of tile.neighbors) {
        if (tileData[neighbor].biome === tileData[index].biome) same++;
        total++;
      }
    });
    expect(same / total).toBeGreaterThan(0.85);
  });
});
