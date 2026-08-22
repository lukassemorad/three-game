import { Injectable } from '@angular/core';
import * as THREE from 'three';
import { loadVegetationVisuals } from '../world/vegetation-model-loader';
import { PlanetTile } from './goldberg-mesh';
import { TileData } from './planet-biome';
import { PlanetTerrain } from './planet-terrain';
import { PlanetTileIndex } from './planet-tile-index';
import { PlanetChunkVisibility } from './planet-chunk-visibility';
import { buildPlanetInstancedBatch } from './planet-instanced-batch';
import {
  generatePlanetVegetation,
  PlanetVegetationPlacement
} from './planet-vegetation-placement';
import {
  applyPlanetWindShader,
  PLANET_WIND_CONFIG,
  updatePlanetWindTime
} from './planet-vegetation-wind';
import { VEGETATION_HIDE_DISTANCE, VEGETATION_SHOW_DISTANCE } from './planet-config';

// Vegetace planety. Čistě dekorativní scatter - žádné kolize, žádná fyzika, žádný save state,
// žádná interakce. Právě proto je to první obsah, který na planetu jde: celý cyklus
// placement -> orientace -> instancing -> culling -> vítr se odladí izolovaně.
@Injectable({ providedIn: 'root' })
export class PlanetVegetationService {
  private readonly visibility = new PlanetChunkVisibility(
    VEGETATION_HIDE_DISTANCE,
    VEGETATION_SHOW_DISTANCE
  );
  private readonly meshes: THREE.InstancedMesh[] = [];
  private elapsed = 0;
  private instanceCount = 0;

  async spawn(
    scene: THREE.Scene,
    tiles: readonly PlanetTile[],
    tileData: readonly TileData[],
    tileIndex: PlanetTileIndex,
    terrain: PlanetTerrain
  ): Promise<void> {
    const placements = generatePlanetVegetation(tiles, tileData, terrain);
    if (placements.length === 0) return;
    this.instanceCount = placements.length;

    const variants = Array.from(new Set(placements.map((p) => p.variant)));
    // Vlastní wind shader a vlastní cache klíč - plochý svět má vítr počítaný jinak a nesmí
    // se materiály přebírat (viz vegetation-model-loader.ts).
    const visuals = await loadVegetationVisuals(variants, {
      applyWind: applyPlanetWindShader,
      cacheKey: 'planet'
    });

    // Seskupit podle (chunk, varianta): chunk kvůli cullingu, varianta protože každá má
    // vlastní geometrii a materiál.
    const groups = new Map<string, PlanetVegetationPlacement[]>();
    const chunkOfGroup = new Map<string, number>();
    for (const placement of placements) {
      // Dlaždice přichází s placementem, takže se tu nehledá - viz komentář u
      // PlanetVegetationPlacement.tile.
      const chunk = tileIndex.getChunkOfTile(placement.tile);
      const key = `${chunk}|${placement.variant}`;
      let group = groups.get(key);
      if (!group) {
        group = [];
        groups.set(key, group);
        chunkOfGroup.set(key, chunk);
      }
      group.push(placement);
    }

    // Objekty jednoho chunku se skrývají společně, takže se sbírají dohromady napříč
    // variantami.
    const objectsByChunk = new Map<number, THREE.Object3D[]>();

    for (const [key, group] of groups) {
      const chunk = chunkOfGroup.get(key)!;
      const originUp = tileIndex.getChunkCenterDir(chunk);
      const originPosition = originUp
        .clone()
        .multiplyScalar(terrain.getSurfaceRadius(originUp));

      const visual = visuals.get(group[0].variant);
      if (!visual) continue;

      const batch = buildPlanetInstancedBatch(
        visual,
        group,
        originPosition,
        originUp,
        // Wind shader hýbe vrcholy na GPU, což CPU-side bounding sphere nezachytí - bez
        // paddingu by tráva na okraji záběru při vlnění blikala.
        PLANET_WIND_CONFIG.amplitude
      );
      for (const mesh of batch) {
        scene.add(mesh);
        this.meshes.push(mesh);
      }
      const bucket = objectsByChunk.get(chunk) ?? [];
      bucket.push(...batch);
      objectsByChunk.set(chunk, bucket);
    }

    for (const [chunk, objects] of objectsByChunk) {
      const centerDir = tileIndex.getChunkCenterDir(chunk);
      const center = centerDir.clone().multiplyScalar(terrain.getSurfaceRadius(centerDir));
      this.visibility.register(center, objects);
    }
  }

  tick(delta: number, cameraPosition: THREE.Vector3): void {
    this.elapsed += delta;
    updatePlanetWindTime(this.elapsed);
    this.visibility.update(delta, cameraPosition);
  }

  getStats(): { instances: number; visibleChunks: number; meshes: number } {
    return {
      instances: this.instanceCount,
      visibleChunks: this.visibility.visibleChunkCount,
      meshes: this.meshes.length
    };
  }

  dispose(): void {
    for (const mesh of this.meshes) {
      mesh.removeFromParent();
      mesh.dispose();
    }
    this.meshes.length = 0;
    this.visibility.clear();
    this.elapsed = 0;
    this.instanceCount = 0;
    // Geometrie a materiály patří cache v loaderu (sdílené mezi dávkami), takže se tu
    // záměrně neuvolňují - dispose() na InstancedMesh ruší jen instancované atributy.
  }
}
