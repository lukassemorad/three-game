import * as THREE from 'three';
import { clone as cloneSkinnedModel } from 'three/addons/utils/SkeletonUtils.js';
import { WorldEntity } from './entity-service.base';
import { HopBehavior } from './hop-behavior';

export interface FrogTemplate {
  readonly scene: THREE.Object3D;
  readonly animations: THREE.AnimationClip[];
}

const FROG_HEIGHT = 70;
const IDLE_CLIP_NAME = 'FrogArmature|Frog_Idle';
const JUMP_CLIP_NAME = 'FrogArmature|Frog_Jump';

const MIN_WAIT_SECONDS = 3;
const MAX_WAIT_SECONDS = 8;
const MIN_HOP_DISTANCE = 2;
const MAX_HOP_DISTANCE = 7;
const CROSSFADE_SECONDS = 0.1;

let nextFrogId = 0;

export class FrogEntity implements WorldEntity {
  readonly id: string;
  readonly group: THREE.Group;

  private readonly mixer: THREE.AnimationMixer;
  private readonly idleAction: THREE.AnimationAction;
  private readonly jumpAction: THREE.AnimationAction;
  private readonly hopBehavior: HopBehavior;

  constructor(position: THREE.Vector3, template: FrogTemplate, getGroundHeight: (x: number, z: number) => number) {
    this.id = `frog-${nextFrogId++}`;

    // SkeletonUtils.clone (ne Object3D.clone) - jinak by klony sdílely skeleton a nešlo by
    // je animovat nezávisle na sobě.
    const model = cloneSkinnedModel(template.scene);
    const size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
    model.scale.setScalar(FROG_HEIGHT / Math.max(size.y, 0.0001));

    this.mixer = new THREE.AnimationMixer(model);
    // Názvy klipů ověřené přímo v GLB souboru (FrogArmature|Frog_Idle, FrogArmature|Frog_Jump).
    const idleClip = THREE.AnimationClip.findByName(template.animations, IDLE_CLIP_NAME)!;
    const jumpClip = THREE.AnimationClip.findByName(template.animations, JUMP_CLIP_NAME)!;
    this.idleAction = this.mixer.clipAction(idleClip);
    this.jumpAction = this.mixer.clipAction(jumpClip);
    this.jumpAction.setLoop(THREE.LoopOnce, 1);
    this.jumpAction.clampWhenFinished = true;
    this.idleAction.play();

    // Výchozí (neposovaná/bind-pose) geometrie má nohy jinak než reálná Idle póza - offset
    // spočtený z ní by neseděl se skutečně vykresleným modelem a chyba by rostla úměrně se
    // scale (tedy s FROG_HEIGHT). mixer.update(0) + updateMatrixWorld přepózuje kosti do
    // skutečné Idle pózy a precise Box3 pak měří skutečné (skinované) vrcholy místo syrové
    // T-pose geometrie, takže žába sedí přesně na getGroundHeight bez ohledu na velikost.
    this.mixer.update(0);
    model.updateMatrixWorld(true);
    const groundOffset = new THREE.Box3().setFromObject(model, true).min.y;
    model.position.y = -groundOffset;

    this.group = new THREE.Group();
    this.group.position.copy(position);
    this.group.rotation.y = Math.random() * Math.PI * 2;
    this.group.add(model);

    this.hopBehavior = new HopBehavior(this.group, {
      minWaitSeconds: MIN_WAIT_SECONDS,
      maxWaitSeconds: MAX_WAIT_SECONDS,
      minHopDistance: MIN_HOP_DISTANCE,
      maxHopDistance: MAX_HOP_DISTANCE,
      hopDuration: jumpClip.duration,
      getGroundHeight,
      onHopStart: () => this.idleAction.crossFadeTo(this.jumpAction.reset().play(), CROSSFADE_SECONDS, false),
      onHopEnd: () => this.jumpAction.crossFadeTo(this.idleAction.reset().play(), CROSSFADE_SECONDS, false)
    });
  }

  update(delta: number): void {
    this.mixer.update(delta);
    this.hopBehavior.update(delta);
  }

  dispose(): void {
    this.mixer.stopAllAction();
  }
}
