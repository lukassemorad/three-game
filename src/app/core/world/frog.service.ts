import { Injectable } from '@angular/core';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { ThreeSceneService } from '../engine/three-scene.service';
import { FrogEntity, FrogTemplate } from './frog.entity';

const FROG_MODEL_URL = encodeURI('assets/models/Frog by Quaternius - 9Z2V8fpazF.glb');

// Sdílený loader + cache stejná technika jako item-model-loader.ts - 3 žáby čekají na
// jeden jediný fetch/parse GLTF, ne 3 samostatné.
const gltfLoader = new GLTFLoader();
let cachedTemplate: Promise<FrogTemplate> | null = null;

function loadFrogTemplate(): Promise<FrogTemplate> {
  if (!cachedTemplate) {
    cachedTemplate = new Promise((resolve, reject) => {
      gltfLoader.load(
        FROG_MODEL_URL,
        (gltf) => resolve({ scene: gltf.scene, animations: gltf.animations }),
        undefined,
        reject
      );
    });
  }
  return cachedTemplate;
}

@Injectable({ providedIn: 'root' })
export class FrogService {
  private readonly frogs = new Map<string, FrogEntity>();
  private tickableRegistered = false;

  constructor(private readonly scene: ThreeSceneService) {}

  async spawnFrogs(positions: THREE.Vector3[]): Promise<void> {
    if (!this.tickableRegistered) {
      this.tickableRegistered = true;
      this.scene.registerTickable((delta) => {
        for (const frog of this.frogs.values()) frog.update(delta);
      });
    }

    const template = await loadFrogTemplate();
    for (const position of positions) {
      const frog = new FrogEntity(position, template, (x, z) => this.scene.getGroundHeight(x, z));
      this.frogs.set(frog.id, frog);
      this.scene.addToScene(frog.group);
    }
  }

  dispose(): void {
    for (const frog of this.frogs.values()) {
      this.scene.removeFromScene(frog.group);
      frog.dispose();
    }
    this.frogs.clear();
    this.tickableRegistered = false;
  }
}
