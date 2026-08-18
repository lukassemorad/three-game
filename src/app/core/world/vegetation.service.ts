import { Injectable } from '@angular/core';
import * as THREE from 'three';
import { VegetationVariant } from '../../shared/models/vegetation.model';
import { ThreeSceneService } from '../engine/three-scene.service';
import { ChunkVisibilitySweep } from './chunk-visibility-sweep';
import { getChunkCenter, getChunkKey, VEGETATION_CHUNK_SIZE } from './chunk-grid';
import { buildVegetationBatch } from './instanced-vegetation-batch';
import { loadVegetationVisuals } from './vegetation-model-loader';
import { updateVegetationWindTime } from './vegetation-wind';
import { VEGETATION_DEFS } from './vegetation.config';

export interface VegetationSpawnEntry {
  readonly position: THREE.Vector3;
  readonly variant: VegetationVariant;
}

const CHUNK_VISIBILITY_INTERVAL = 0.2;
// Tráva/keře/květiny jsou drobné a řádově početnější než stromy (160/130 m) - mizí mnohem
// blíž, klidně nepozorovaně, protože na tu vzdálenost stejně nejsou skoro vidět.
const CHUNK_HIDE_DISTANCE = 70;
const CHUNK_SHOW_DISTANCE = 55;

// Vegetace je čistě dekorativní scatter - na rozdíl od TreeService žádná kolize, žádné
// interaktivní sekání, žádný save/restore (pozice se generují znovu při každém loadu, viz
// vegetation-placement.ts). Instance se po vystavění za běhu nikdy nemění.
@Injectable({ providedIn: 'root' })
export class VegetationService {
  private readonly meshes: THREE.Object3D[] = [];
  private readonly chunkVisibility = new ChunkVisibilitySweep(
    CHUNK_VISIBILITY_INTERVAL,
    CHUNK_HIDE_DISTANCE,
    CHUNK_SHOW_DISTANCE
  );
  private tickableRegistered = false;
  private windElapsed = 0;
  private readonly tick = (delta: number): void => {
    this.windElapsed += delta;
    updateVegetationWindTime(this.windElapsed);
    this.chunkVisibility.update(delta, this.scene.getCameraPosition());
  };

  constructor(private readonly scene: ThreeSceneService) {}

  async spawnVegetation(entries: readonly VegetationSpawnEntry[]): Promise<void> {
    if (entries.length === 0) return;
    if (!this.tickableRegistered) {
      this.tickableRegistered = true;
      this.scene.registerTickable(this.tick);
    }

    const visuals = await loadVegetationVisuals(entries.map((entry) => entry.variant));

    const byGroup = new Map<string, { variant: VegetationVariant; chunkKey: string; entries: VegetationSpawnEntry[] }>();
    for (const entry of entries) {
      const chunkKey = getChunkKey(entry.position.x, entry.position.z, VEGETATION_CHUNK_SIZE);
      const groupKey = `${entry.variant}:${chunkKey}`;
      const group = byGroup.get(groupKey);
      if (group) group.entries.push(entry);
      else byGroup.set(groupKey, { variant: entry.variant, chunkKey, entries: [entry] });
    }

    for (const { variant, chunkKey, entries: groupEntries } of byGroup.values()) {
      const visual = visuals.get(variant);
      if (!visual) continue;

      const center = getChunkCenter(chunkKey, VEGETATION_CHUNK_SIZE);
      const origin = new THREE.Vector3(center.x, 0, center.z);
      const placements = groupEntries.map((entry) => ({ x: entry.position.x, y: entry.position.y, z: entry.position.z }));
      const meshes = buildVegetationBatch(visual, placements, VEGETATION_DEFS[variant].variation, origin);

      for (const mesh of meshes) this.scene.addToScene(mesh);
      this.meshes.push(...meshes);
      this.chunkVisibility.register(chunkKey, center, meshes);
    }
  }

  dispose(): void {
    for (const mesh of this.meshes) this.scene.removeFromScene(mesh);
    this.meshes.length = 0;
    this.chunkVisibility.clear();
    if (this.tickableRegistered) {
      this.scene.unregisterTickable(this.tick);
      this.tickableRegistered = false;
    }
  }
}
