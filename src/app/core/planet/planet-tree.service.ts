import { Injectable } from '@angular/core';
import * as THREE from 'three';
import type * as RapierNS from '@dimforge/rapier3d-compat';
import { loadModelVisual } from '../world/vegetation-model-loader';
import { PlanetTile } from './goldberg-mesh';
import { TileData } from './planet-biome';
import { PlanetTerrain } from './planet-terrain';
import { PlanetTileIndex } from './planet-tile-index';
import { PlanetPhysicsService } from './planet-physics.service';
import { PlanetChunkVisibility } from './planet-chunk-visibility';
import { buildPlanetInstancedBatch } from './planet-instanced-batch';
import { generatePlanetTrees, PlanetTreePlacement } from './planet-tree-placement';
import {
  PLANET_TREE_DEFS,
  PlanetTreeVariant,
  TREE_HIDE_DISTANCE,
  TREE_SHOW_DISTANCE
} from './planet-tree.config';

// Stromy jako kulisa s kolizí - vykreslují se instancovaně a mají Rapier collider na kmen,
// takže se do nich nedá vejít. Kácení (záseky, pád, ležící kmeny) zatím nemají; procedurální
// stromy plochého světa existují právě kvůli němu, tady jsou to GLB modely.
//
// Collidery se na rozdíl od meshů necullují: statických válců je řádově stovky, což je pro
// Rapier nic, a kdyby se vypínaly s viditelností, dal by se skrz vzdálený strom projít.
@Injectable({ providedIn: 'root' })
export class PlanetTreeService {
  private readonly visibility = new PlanetChunkVisibility(
    TREE_HIDE_DISTANCE,
    TREE_SHOW_DISTANCE
  );
  private readonly meshes: THREE.InstancedMesh[] = [];
  private readonly bodies: RapierNS.RigidBody[] = [];
  private treeCount = 0;

  constructor(private readonly physics: PlanetPhysicsService) {}

  async spawn(
    scene: THREE.Scene,
    tiles: readonly PlanetTile[],
    tileData: readonly TileData[],
    tileIndex: PlanetTileIndex,
    terrain: PlanetTerrain
  ): Promise<void> {
    const placements = generatePlanetTrees(tiles, tileData, terrain);
    if (placements.length === 0) return;
    this.treeCount = placements.length;

    const variants = Array.from(new Set(placements.map((p) => p.variant)));
    // Stromy nemají vítr (vlnění celé koruny plošným shaderem by vypadalo nepatřičně -
    // stejná úvaha jako WIND_AFFECTED_VARIANTS v plochém světě) ani stmavení.
    const visuals = new Map(
      await Promise.all(
        variants.map(async (variant) => {
          const def = PLANET_TREE_DEFS[variant];
          return [
            variant,
            await loadModelVisual(def.modelUrl, def.targetSize, { cacheKey: 'planet-tree' })
          ] as const;
        })
      )
    );

    // Seskupit podle (chunk, varianta): chunk kvůli cullingu, varianta kvůli geometrii.
    const groups = new Map<string, PlanetTreePlacement[]>();
    const chunkOfGroup = new Map<string, number>();
    const variantOfGroup = new Map<string, PlanetTreeVariant>();
    for (const placement of placements) {
      const chunk = tileIndex.getChunkOfTile(placement.tile);
      const key = `${chunk}|${placement.variant}`;
      let group = groups.get(key);
      if (!group) {
        group = [];
        groups.set(key, group);
        chunkOfGroup.set(key, chunk);
        variantOfGroup.set(key, placement.variant);
      }
      group.push(placement);
    }

    const objectsByChunk = new Map<number, THREE.Object3D[]>();

    for (const [key, group] of groups) {
      const chunk = chunkOfGroup.get(key)!;
      const visual = visuals.get(variantOfGroup.get(key)!);
      if (!visual) continue;

      const originUp = tileIndex.getChunkCenterDir(chunk);
      const originPosition = originUp
        .clone()
        .multiplyScalar(terrain.getSurfaceRadius(originUp));

      const batch = buildPlanetInstancedBatch(visual, group, originPosition, originUp);
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

    for (const placement of placements) {
      const def = PLANET_TREE_DEFS[placement.variant];
      this.bodies.push(
        this.physics.createStaticTreeCollider(
          placement.position,
          placement.up,
          def.colliderRadius * placement.scale,
          def.targetSize * def.colliderHeightFactor * placement.scale
        )
      );
    }
  }

  tick(delta: number, cameraPosition: THREE.Vector3): void {
    this.visibility.update(delta, cameraPosition);
  }

  getStats(): { trees: number; visibleChunks: number; colliders: number } {
    return {
      trees: this.treeCount,
      visibleChunks: this.visibility.visibleChunkCount,
      colliders: this.bodies.length
    };
  }

  dispose(): void {
    for (const mesh of this.meshes) {
      mesh.removeFromParent();
      mesh.dispose();
    }
    this.meshes.length = 0;
    // Těla se ruší jen pokud Rapier world ještě žije - při dispose celé scény se uvolní
    // s ním (PlanetPhysicsService.dispose volá world.free()).
    this.bodies.length = 0;
    this.visibility.clear();
    this.treeCount = 0;
  }
}
