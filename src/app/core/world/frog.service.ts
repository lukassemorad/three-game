import { Injectable } from '@angular/core';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { ThreeSceneService } from '../engine/three-scene.service';
import { EntityServiceBase } from './entity-service.base';
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
export class FrogService extends EntityServiceBase<FrogEntity> {
  constructor(scene: ThreeSceneService) {
    super(scene);
  }

  async spawnFrogs(positions: THREE.Vector3[]): Promise<void> {
    const template = await loadFrogTemplate();
    for (const position of positions) {
      const frog = new FrogEntity(position, template, (x, z) => this.scene.getGroundHeight(x, z));
      this.register(frog);
    }
  }
}
