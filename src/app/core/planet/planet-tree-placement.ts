import * as THREE from 'three';
import { positionHash } from '../world/position-hash';
import { PlanetTile } from './goldberg-mesh';
import { TileData } from './planet-biome';
import { PlanetTerrain } from './planet-terrain';
import { PLANET_RADIUS } from './planet-config';
import {
  BIOME_TREES,
  MIN_TREE_SPACING,
  PLANET_TREE_DEFS,
  PlanetTreeVariant
} from './planet-tree.config';

// Rozmístění stromů po povrchu planety.
//
// Proti plochému světu tu nefiguruje žádný SpatialGrid: minimální rozestup se kontroluje jen
// proti stromům v téže dlaždici a v jejích sousedech (PlanetTile.neighbors). Dlaždice je
// ~6,5 m napříč a rozestup 3 m, takže dál než k sousedovi kolize nedosáhne - graf sousednosti
// tak zastane práci prostorového indexu zdarma.

export interface PlanetTreePlacement {
  readonly position: THREE.Vector3;
  readonly up: THREE.Vector3;
  readonly tile: number;
  readonly variant: PlanetTreeVariant;
  readonly rotation: number;
  readonly scale: number;
  readonly tint: number;
}

function stream(tileIndex: number, sampleIndex: number, salt: number): number {
  return positionHash(tileIndex + salt * 53.71, sampleIndex - salt * 29.17);
}

function pickWeighted(
  weights: Partial<Record<PlanetTreeVariant, number>>,
  roll: number
): PlanetTreeVariant {
  const entries = Object.entries(weights) as Array<[PlanetTreeVariant, number]>;
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  let remaining = roll * total;
  for (const [variant, weight] of entries) {
    remaining -= weight;
    if (remaining <= 0) return variant;
  }
  return entries[entries.length - 1][0];
}

export function generatePlanetTrees(
  tiles: readonly PlanetTile[],
  tileData: readonly TileData[],
  terrain: PlanetTerrain
): PlanetTreePlacement[] {
  const tileArea = (4 * Math.PI * PLANET_RADIUS * PLANET_RADIUS) / tiles.length;

  const placements: PlanetTreePlacement[] = [];
  // Index podle dlaždice, aby šla kontrola rozestupu omezit na okolí.
  const byTile = new Map<number, PlanetTreePlacement[]>();
  const sampleDir = new THREE.Vector3();
  const candidate = new THREE.Vector3();

  const isTooClose = (tileIndex: number, point: THREE.Vector3): boolean => {
    const minSq = MIN_TREE_SPACING * MIN_TREE_SPACING;
    const own = byTile.get(tileIndex);
    if (own) {
      for (const other of own) if (other.position.distanceToSquared(point) < minSq) return true;
    }
    for (const neighbor of tiles[tileIndex].neighbors) {
      const list = byTile.get(neighbor);
      if (!list) continue;
      for (const other of list) if (other.position.distanceToSquared(point) < minSq) return true;
    }
    return false;
  };

  tiles.forEach((tile, tileIndex) => {
    const config = BIOME_TREES[tileData[tileIndex].biome];
    const expected = tileArea * config.perSquareMeter;

    // Hustoty stromů jsou pod 1 na dlaždici (louka ~0,08), takže celá část plus zlomek jako
    // pravděpodobnost - jinak by `Math.round` u hodnot pod 0,5 vyrobil nulu všude a na planetě
    // by nebyl ani jeden strom.
    let count = Math.floor(expected);
    if (stream(tileIndex, 0, 1) < expected - count) count++;
    if (count === 0) return;

    const cornerCount = tile.cornerDirs.length;

    for (let sample = 0; sample < count; sample++) {
      const triangle = Math.min(
        cornerCount - 1,
        Math.floor(stream(tileIndex, sample, 2) * cornerCount)
      );
      let u = stream(tileIndex, sample, 3);
      let v = stream(tileIndex, sample, 4);
      if (u + v > 1) {
        u = 1 - u;
        v = 1 - v;
      }

      const cornerA = tile.cornerDirs[triangle];
      const cornerB = tile.cornerDirs[(triangle + 1) % cornerCount];
      sampleDir
        .copy(tile.centerDir)
        .addScaledVector(cornerA.clone().sub(tile.centerDir), u)
        .addScaledVector(cornerB.clone().sub(tile.centerDir), v)
        .normalize();

      candidate.copy(sampleDir).multiplyScalar(terrain.getSurfaceRadius(sampleDir));
      if (isTooClose(tileIndex, candidate)) continue;

      const variant = pickWeighted(config.weights, stream(tileIndex, sample, 5));
      const range = PLANET_TREE_DEFS[variant].variation;

      const placement: PlanetTreePlacement = {
        position: candidate.clone(),
        up: sampleDir.clone(),
        tile: tileIndex,
        variant,
        rotation: stream(tileIndex, sample, 6) * Math.PI * 2,
        scale: range.scaleMin + stream(tileIndex, sample, 7) * range.scaleRange,
        tint: range.tintMin + stream(tileIndex, sample, 8) * range.tintRange
      };

      placements.push(placement);
      const list = byTile.get(tileIndex);
      if (list) list.push(placement);
      else byTile.set(tileIndex, [placement]);
    }
  });

  return placements;
}
