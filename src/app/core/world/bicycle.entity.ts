import * as THREE from 'three';
import { FallenLogHandle } from '../engine/physics.service';
import { WorldEntity } from './entity-service.base';

export interface BicycleTemplate {
  readonly scene: THREE.Object3D;
}

// Nejdelší rozměr bounding boxu po škálování - stejná konvence jako ItemDef.targetSize
// v item-model-loader.ts. Bicycle.glb je needitovaný asset bez známé orientace/proporcí,
// takže tahle hodnota (a rotace níže) je první odhad - čekej vizuální doladění po prvním
// spuštění (viz plán).
const BICYCLE_TARGET_SIZE = 1.7;
const BICYCLE_ROTATION_X = 0;
const BICYCLE_ROTATION_Y = Math.PI /2;
const BICYCLE_ROTATION_Z = 0;
// Kolik lokálního originu modelu leží nad "zemní" kontaktní rovinou po scale - viz
// vizuální doladění výše. group.position je bod na zemi (spodek kola).
const BICYCLE_GROUND_PIVOT_OFFSET = 0;

// Sdílené i s view-modelem na kameře (viz BicycleService.buildRideViewModel) - obě strany
// potřebují stejnou orientaci/škálu, jinak by kolo v ruce/pod hráčem a kolo ve světě vypadaly
// nekonzistentně naškálovaná.
export function normalizeBicycleModel(clone: THREE.Object3D): void {
  clone.rotation.set(BICYCLE_ROTATION_X, BICYCLE_ROTATION_Y, BICYCLE_ROTATION_Z);
  const rawSize = new THREE.Box3().setFromObject(clone).getSize(new THREE.Vector3());
  const scale = BICYCLE_TARGET_SIZE / Math.max(rawSize.x, rawSize.y, rawSize.z, 0.0001);
  clone.scale.setScalar(scale);
  clone.position.y += BICYCLE_GROUND_PIVOT_OFFSET;
}

let nextBicycleId = 0;

export class BicycleEntity implements WorldEntity {
  readonly id: string;
  readonly group: THREE.Group;
  // Vnitřní grupa pro čistě vizuální náklon (lean) do zatáček - odděleně od `group`, které
  // nese pozici/yaw z fyziky. Kolider zůstává neroloval (jednodušší/stabilnější fyzika), náklon
  // je jen kosmetický, viz setLean.
  private readonly visualGroup: THREE.Group;
  readonly colliderHalfExtents: THREE.Vector3;
  readonly colliderOriginOffsetY: number;
  physicsHandle: FallenLogHandle | null = null;

  constructor(template: BicycleTemplate, position: THREE.Vector3) {
    this.id = `bicycle-${nextBicycleId++}`;

    const clone = template.scene.clone(true);
    normalizeBicycleModel(clone);

    const scaledBox = new THREE.Box3().setFromObject(clone);
    this.colliderHalfExtents = scaledBox.getSize(new THREE.Vector3()).multiplyScalar(0.5);
    this.colliderOriginOffsetY = this.colliderHalfExtents.y;

    this.visualGroup = new THREE.Group();
    this.visualGroup.add(clone);

    this.group = new THREE.Group();
    this.group.add(this.visualGroup);
    this.group.position.copy(position);
  }

  applyPhysicsTransform(translation: THREE.Vector3Like, rotation: THREE.QuaternionLike): void {
    this.group.position.set(translation.x, translation.y, translation.z);
    this.group.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
  }

  // Náklon kolem lokální osy směru jízdy (roll) - viz normalizeBicycleModel pro to, jak je
  // "dopředu" modelu zarovnané. Needitovaný asset bez známé orientace, takže osa je první
  // odhad - čekej vizuální doladění po prvním spuštění (stejně jako u BICYCLE_ROTATION_Y).
  setLean(angle: number): void {
    this.visualGroup.rotation.z = angle;
  }
}
