import * as THREE from 'three';
import { clone as cloneSkinnedModel } from 'three/addons/utils/SkeletonUtils.js';

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

type FrogState = 'idle' | 'jumping';

let nextFrogId = 0;

// Žabí "AI" je čistě náhodný timer bez pathfindingu/kolizí - po většinu času idle animace,
// v náhodných intervalech otočka + krátký hop (jump animace + skutečný přesun) náhodným
// směrem. Y během hopu drží getGroundHeight (ne vlastní výškový oblouk) - vizuální nadskočení
// dělá animace kostry uvnitř group, ne posun group.position.y.
export class FrogEntity {
  readonly id: string;
  readonly group: THREE.Group;

  private readonly mixer: THREE.AnimationMixer;
  private readonly idleAction: THREE.AnimationAction;
  private readonly jumpAction: THREE.AnimationAction;
  private readonly hopDuration: number;
  private readonly getGroundHeight: (x: number, z: number) => number;

  private state: FrogState = 'idle';
  private waitTimer: number;
  private hopElapsed = 0;
  private readonly hopStart = new THREE.Vector3();
  private readonly hopTarget = new THREE.Vector3();

  constructor(position: THREE.Vector3, template: FrogTemplate, getGroundHeight: (x: number, z: number) => number) {
    this.id = `frog-${nextFrogId++}`;
    this.getGroundHeight = getGroundHeight;

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
    this.hopDuration = jumpClip.duration;
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

    this.waitTimer = THREE.MathUtils.randFloat(MIN_WAIT_SECONDS, MAX_WAIT_SECONDS);
  }

  update(delta: number): void {
    this.mixer.update(delta);

    if (this.state === 'idle') {
      this.waitTimer -= delta;
      if (this.waitTimer <= 0) this.startHop();
      return;
    }

    this.hopElapsed += delta;
    const t = Math.min(1, this.hopElapsed / this.hopDuration);
    this.group.position.lerpVectors(this.hopStart, this.hopTarget, t);
    this.group.position.y = this.getGroundHeight(this.group.position.x, this.group.position.z);

    if (t >= 1) this.finishHop();
  }

  private startHop(): void {
    this.state = 'jumping';
    this.hopElapsed = 0;

    const yaw = Math.random() * Math.PI * 2;
    this.group.rotation.y = yaw;
    const distance = THREE.MathUtils.randFloat(MIN_HOP_DISTANCE, MAX_HOP_DISTANCE);
    const direction = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    this.hopStart.copy(this.group.position);
    this.hopTarget.copy(this.hopStart).addScaledVector(direction, distance);
    this.hopTarget.y = this.getGroundHeight(this.hopTarget.x, this.hopTarget.z);

    this.idleAction.crossFadeTo(this.jumpAction.reset().play(), CROSSFADE_SECONDS, false);
  }

  private finishHop(): void {
    this.state = 'idle';
    this.waitTimer = THREE.MathUtils.randFloat(MIN_WAIT_SECONDS, MAX_WAIT_SECONDS);
    this.jumpAction.crossFadeTo(this.idleAction.reset().play(), CROSSFADE_SECONDS, false);
  }

  dispose(): void {
    this.mixer.stopAllAction();
  }
}
