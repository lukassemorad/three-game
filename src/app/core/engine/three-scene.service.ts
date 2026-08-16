import { Injectable, NgZone, effect, signal } from '@angular/core';
import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { BiomeId } from '../../shared/models/biome.model';
import { QuatLike, Vec3Like } from '../../shared/models/save-game.model';
import { SettingsService } from '../state/settings.service';
import { RoadNetwork } from '../world/road-network';
import { HeightGrid, TerrainGenerator } from '../world/terrain-generator';
import { TERRAIN_WIDTH, TERRAIN_DEPTH, TERRAIN_SEGMENTS_X, TERRAIN_SEGMENTS_Z } from '../world/world-config';
import { CollisionService } from './collision.service';
import { PhysicsService } from './physics.service';

export interface InteractableMeta {
  readonly id: string;
  readonly label?: string;
  readonly interactPrompt?: string;
  // instanceId je nastavený jen když zásah trefil THREE.InstancedMesh (dávka nedotčených
  // stromů, viz InstancedTreeBatch) - říká, KTERÁ konkrétní instance byla zasažena.
  readonly onInteract?: (hitPoint: THREE.Vector3, instanceId?: number) => void;
  readonly onGrabStart?: (hitPoint: THREE.Vector3, camera: THREE.Camera) => void;
  readonly onGrabTick?: (camera: THREE.Camera, delta: number) => void;
  readonly onGrabEnd?: (throwVelocity: THREE.Vector3) => void;
}

export interface LookTarget {
  readonly id: string;
  readonly label?: string;
  readonly interactPrompt?: string;
  readonly distance: number;
}

const MOVE_SPEED = 6;
const EYE_HEIGHT = 1.6;
const PLAYER_RADIUS = 0.35;
export const GRAVITY = 20;
const JUMP_SPEED = 7;
const INTERACTION_DISTANCE = 4;
// Rezerva navíc k INTERACTION_DISTANCE pro hrubý distance pre-filter níže - kryje i
// objekty, jejichž samotná geometrie (ne jen group.position) zasahuje blíž ke kameře,
// než kolik je vzdálenost od jejich počátku (typicky koruna stromu/roh budovy).
const INTERACTABLE_PREFILTER_MARGIN = 6;
const GRABBED_PROMPT = 'Pusť pro zahození';
const THROW_SPEED = 8;

const SLOPE_SAMPLE_STEP = 0.4;
const UPHILL_SLOPE_PENALTY = 1.4;
const MIN_UPHILL_SPEED_MULTIPLIER = 0.3;
const JUMP_SLOPE_PENALTY = 0.6;
const MIN_JUMP_SLOPE_MULTIPLIER = 0.5;

@Injectable({ providedIn: 'root' })
export class ThreeSceneService {
  private readonly lockedSignal = signal(false);
  readonly locked = this.lockedSignal.asReadonly();

  private readonly lookTargetSignal = signal<LookTarget | null>(null);
  readonly lookTarget = this.lookTargetSignal.asReadonly();

  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private renderer!: THREE.WebGLRenderer;
  private controls!: PointerLockControls;
  private clock!: THREE.Clock;
  private frameId: number | null = null;

  private readonly pressedKeys = new Set<string>();
  private velocityY = 0;
  private grounded = true;
  private terrain = new TerrainGenerator();

  private readonly raycaster = new THREE.Raycaster();
  private readonly interactables = new Map<THREE.Object3D, InteractableMeta>();
  private interactableList: THREE.Object3D[] = [];
  private lastTargetId: string | null = null;
  private currentDistance: number | null = null;
  private lastResolvedMeta: InteractableMeta | null = null;
  private lastSignaledMeta: InteractableMeta | null = null;
  private lastHitPoint: THREE.Vector3 | null = null;
  private lastHitInstanceId: number | null = null;
  private heldMeta: InteractableMeta | null = null;

  private readonly tickables = new Set<(delta: number) => void>();
  private readonly moveRightVector = new THREE.Vector3();
  private readonly moveForwardVector = new THREE.Vector3();
  private readonly cameraForward = new THREE.Vector3();

  private readonly onKeyDown = (event: KeyboardEvent) => {
    this.pressedKeys.add(event.code);
    if (event.code === 'Space' && !event.repeat && this.grounded) {
      const { gradX, gradZ } = this.getSlopeGradient(this.camera.position.x, this.camera.position.z);
      const slope = Math.sqrt(gradX * gradX + gradZ * gradZ);
      const jumpMultiplier = Math.max(MIN_JUMP_SLOPE_MULTIPLIER, 1 - JUMP_SLOPE_PENALTY * slope);
      this.velocityY = JUMP_SPEED * jumpMultiplier;
      this.grounded = false;
    }
  };
  private readonly onKeyUp = (event: KeyboardEvent) => this.pressedKeys.delete(event.code);

  private readonly onMouseDown = (event: MouseEvent) => {
    if (!this.controls.isLocked || event.button !== 0 || this.heldMeta) return;
    if (this.lastResolvedMeta?.onGrabStart && this.lastHitPoint) {
      const hitPoint = this.lastHitPoint;
      this.heldMeta = this.lastResolvedMeta;
      this.lastTargetId = this.heldMeta.id;
      this.lastSignaledMeta = this.heldMeta;
      const target: LookTarget = {
        id: this.heldMeta.id,
        label: this.heldMeta.label,
        interactPrompt: GRABBED_PROMPT,
        distance: 0
      };
      this.zone.run(() => this.lookTargetSignal.set(target));
      this.heldMeta.onGrabStart?.(hitPoint, this.camera);
      return;
    }
    if (this.lastResolvedMeta && this.lastHitPoint) {
      this.lastResolvedMeta.onInteract?.(this.lastHitPoint, this.lastHitInstanceId ?? undefined);
    }
  };

  private readonly onMouseUp = (event: MouseEvent) => {
    if (event.button !== 0 || !this.heldMeta) return;
    this.camera.getWorldDirection(this.cameraForward);
    const throwVelocity = this.cameraForward.clone().multiplyScalar(THROW_SPEED);
    const heldMeta = this.heldMeta;
    this.heldMeta = null;
    heldMeta.onGrabEnd?.(throwVelocity);
  };

  constructor(
    private readonly zone: NgZone,
    private readonly collision: CollisionService,
    private readonly physics: PhysicsService,
    private readonly settings: SettingsService
  ) {
    effect(() => {
      const sensitivity = this.settings.lookSensitivity();
      if (this.controls) this.controls.pointerSpeed = sensitivity;
    });
  }

  async init(canvas: HTMLCanvasElement, roads?: RoadNetwork): Promise<void> {
    this.terrain = new TerrainGenerator(roads);
    this.interactables.clear();
    this.interactableList = [];
    this.lastTargetId = null;
    this.currentDistance = null;
    this.lastResolvedMeta = null;
    this.lastSignaledMeta = null;
    this.lastHitPoint = null;
    this.lastHitInstanceId = null;
    this.heldMeta = null;
    this.tickables.clear();
    this.lookTargetSignal.set(null);
    this.collision.clear();
    const heightGrid = this.terrain.computeHeightGrid(
      TERRAIN_WIDTH,
      TERRAIN_DEPTH,
      TERRAIN_SEGMENTS_X,
      TERRAIN_SEGMENTS_Z
    );
    await this.physics.init(heightGrid, GRAVITY);

    this.raycaster.far = INTERACTION_DISTANCE;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x87ceeb);

    this.camera = new THREE.PerspectiveCamera(
      75,
      canvas.clientWidth / canvas.clientHeight,
      0.1,
      600
    );
    this.camera.position.set(0, this.getGroundHeight(0, -40) + EYE_HEIGHT, -40);

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setSize(canvas.clientWidth, canvas.clientHeight);

    this.buildScene(heightGrid);

    this.controls = new PointerLockControls(this.camera, canvas);
    this.controls.pointerSpeed = this.settings.lookSensitivity();
    this.controls.addEventListener('lock', () => {
      this.zone.run(() => this.lockedSignal.set(true));
      // Prohlížeč po (re)zamčení kurzoru občas dodá první mousemove s nafouknutým
      // movementX/Y (naakumulovaným, než se lock skutečně chytil) - bez tlumení by
      // to způsobilo prudké, dezorientující otočení kamery. Jeden frame s nulovou
      // citlivostí ho spolehlivě pohltí.
      this.controls.pointerSpeed = 0;
      requestAnimationFrame(() => (this.controls.pointerSpeed = this.settings.lookSensitivity()));
    });
    this.controls.addEventListener('unlock', () => this.zone.run(() => this.lockedSignal.set(false)));

    this.clock = new THREE.Clock();

    this.zone.runOutsideAngular(() => {
      document.addEventListener('keydown', this.onKeyDown);
      document.addEventListener('keyup', this.onKeyUp);
      document.addEventListener('mousedown', this.onMouseDown);
      document.addEventListener('mouseup', this.onMouseUp);
      this.animate();
    });
  }

  lock(): void {
    this.controls.lock();
  }

  getPlayerTransform(): { position: Vec3Like; quaternion: QuatLike } {
    return {
      position: { x: this.camera.position.x, y: this.camera.position.y, z: this.camera.position.z },
      quaternion: {
        x: this.camera.quaternion.x,
        y: this.camera.quaternion.y,
        z: this.camera.quaternion.z,
        w: this.camera.quaternion.w
      }
    };
  }

  setPlayerTransform(position: Vec3Like, quaternion: QuatLike): void {
    this.camera.position.set(position.x, position.y, position.z);
    this.camera.quaternion.set(quaternion.x, quaternion.y, quaternion.z, quaternion.w);
  }

  addToScene(object: THREE.Object3D): void {
    this.scene.add(object);
  }

  removeFromScene(object: THREE.Object3D): void {
    this.scene.remove(object);
  }

  registerInteractable(object: THREE.Object3D, meta: InteractableMeta): void {
    this.interactables.set(object, meta);
    this.interactableList = Array.from(this.interactables.keys());
  }

  unregisterInteractable(object: THREE.Object3D): void {
    this.interactables.delete(object);
    this.interactableList = Array.from(this.interactables.keys());
  }

  registerTickable(fn: (delta: number) => void): void {
    this.tickables.add(fn);
  }

  unregisterTickable(fn: (delta: number) => void): void {
    this.tickables.delete(fn);
  }

  getCurrentLookDistance(): number | null {
    return this.currentDistance;
  }

  getGroundHeight(x: number, z: number): number {
    return this.terrain.getHeight(x, z);
  }

  getBiomeAt(x: number, z: number): BiomeId {
    return this.terrain.getBiomeAt(x, z);
  }

  resize(width: number, height: number): void {
    if (!this.renderer || !this.camera) return;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  dispose(): void {
    if (this.frameId !== null) {
      cancelAnimationFrame(this.frameId);
      this.frameId = null;
    }
    document.removeEventListener('keydown', this.onKeyDown);
    document.removeEventListener('keyup', this.onKeyUp);
    document.removeEventListener('mousedown', this.onMouseDown);
    document.removeEventListener('mouseup', this.onMouseUp);
    if (this.controls?.isLocked) {
      this.controls.unlock();
    }
    this.controls?.dispose();
    this.renderer?.dispose();

    this.interactables.clear();
    this.interactableList = [];
    this.lastTargetId = null;
    this.currentDistance = null;
    this.lastResolvedMeta = null;
    this.lastSignaledMeta = null;
    this.lastHitPoint = null;
    this.lastHitInstanceId = null;
    this.heldMeta = null;
    this.tickables.clear();
    this.lookTargetSignal.set(null);
    this.collision.clear();
  }

  private buildScene(heightGrid: HeightGrid): void {
    const groundGeometry = new THREE.PlaneGeometry(
      TERRAIN_WIDTH,
      TERRAIN_DEPTH,
      TERRAIN_SEGMENTS_X,
      TERRAIN_SEGMENTS_Z
    );
    const position = groundGeometry.attributes['position'] as THREE.BufferAttribute;
    const colors = new Float32Array(position.count * 3);
    const cols = TERRAIN_SEGMENTS_X + 1;
    // PlaneGeometry staví vrcholy po řádcích: index i = row * cols + col, row ~ krok po lokální
    // Y (= -world Z, viz rotation.x = -PI/2 níže), col ~ krok po lokální X (= world X) -
    // stejné pořadí, se kterým počítá TerrainGenerator.computeHeightGrid, takže se dá číst
    // přímo bez přepočtu world souřadnic a bez druhého volání getHeight/getColor za běhu.
    for (let i = 0; i < position.count; i++) {
      const row = Math.floor(i / cols);
      const col = i % cols;
      const height = heightGrid.getHeightAt(col, row);
      position.setZ(i, height);

      const color = heightGrid.getColorAt(col, row);
      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
    }
    position.needsUpdate = true;
    groundGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    groundGeometry.computeVertexNormals();

    const ground = new THREE.Mesh(
      groundGeometry,
      new THREE.MeshStandardMaterial({ vertexColors: true })
    );
    ground.rotation.x = -Math.PI / 2;
    this.scene.add(ground);

    const light = new THREE.DirectionalLight(0xffffff, 2);
    light.position.set(5, 10, 5);
    this.scene.add(light);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.4));
  }

  private animate(): void {
    this.frameId = requestAnimationFrame(() => this.animate());
    const delta = this.clock.getDelta();

    for (const tick of this.tickables) tick(delta);

    if (this.controls.isLocked) {
      this.moveRightVector.setFromMatrixColumn(this.camera.matrix, 0);
      this.moveForwardVector.crossVectors(this.camera.up, this.moveRightVector);

      let dirX = 0;
      let dirZ = 0;
      if (this.pressedKeys.has('KeyW')) {
        dirX += this.moveForwardVector.x;
        dirZ += this.moveForwardVector.z;
      }
      if (this.pressedKeys.has('KeyS')) {
        dirX -= this.moveForwardVector.x;
        dirZ -= this.moveForwardVector.z;
      }
      if (this.pressedKeys.has('KeyD')) {
        dirX += this.moveRightVector.x;
        dirZ += this.moveRightVector.z;
      }
      if (this.pressedKeys.has('KeyA')) {
        dirX -= this.moveRightVector.x;
        dirZ -= this.moveRightVector.z;
      }

      const speedMultiplier = this.getUphillSpeedMultiplier(dirX, dirZ);
      const distance = MOVE_SPEED * speedMultiplier * delta;

      let forwardAmount = 0;
      let rightAmount = 0;
      if (this.pressedKeys.has('KeyW')) forwardAmount += distance;
      if (this.pressedKeys.has('KeyS')) forwardAmount -= distance;
      if (this.pressedKeys.has('KeyD')) rightAmount += distance;
      if (this.pressedKeys.has('KeyA')) rightAmount -= distance;

      const desiredX =
        this.camera.position.x +
        this.moveForwardVector.x * forwardAmount +
        this.moveRightVector.x * rightAmount;
      const desiredZ =
        this.camera.position.z +
        this.moveForwardVector.z * forwardAmount +
        this.moveRightVector.z * rightAmount;
      const resolved = this.collision.resolve(desiredX, desiredZ, PLAYER_RADIUS);
      this.camera.position.x = resolved.x;
      this.camera.position.z = resolved.z;

      this.velocityY -= GRAVITY * delta;
      this.camera.position.y += this.velocityY * delta;
      const groundY = this.getGroundHeight(this.camera.position.x, this.camera.position.z) + EYE_HEIGHT;
      if (this.camera.position.y <= groundY) {
        this.camera.position.y = groundY;
        this.velocityY = 0;
        this.grounded = true;
      }

      if (this.heldMeta) {
        this.heldMeta.onGrabTick?.(this.camera, delta);
      } else {
        this.updateLookTarget();
      }
    } else {
      this.clearLookTarget();
    }

    this.renderer.render(this.scene, this.camera);
  }

  private updateLookTarget(): void {
    if (this.interactableList.length === 0) {
      this.clearLookTarget();
      return;
    }

    // matrixWorld se jinak přepočítá až uvnitř render() - o frame pozadu za pohybem hráče výše.
    this.camera.updateMatrixWorld();
    this.raycaster.setFromCamera(new THREE.Vector2(0, 0), this.camera);

    const nearby = this.filterNearbyInteractables();
    const hits = this.raycaster.intersectObjects(nearby, true);
    const resolved = hits.length > 0 ? this.resolveInteractable(hits[0].object) : null;

    if (!resolved) {
      this.clearLookTarget();
      return;
    }

    this.currentDistance = hits[0].distance;
    this.lastResolvedMeta = resolved.meta;
    this.lastHitPoint = hits[0].point.clone();
    this.lastHitInstanceId = hits[0].instanceId ?? null;
    this.lastTargetId = resolved.meta.id;

    // Porovnání referencí, ne jen id - meta se re-registruje s novým objektem
    // při každé změně (např. ubývající počet ran), i když id stromu zůstává stejné.
    if (resolved.meta !== this.lastSignaledMeta) {
      this.lastSignaledMeta = resolved.meta;
      const target: LookTarget = {
        id: resolved.meta.id,
        label: resolved.meta.label,
        interactPrompt: resolved.meta.interactPrompt,
        distance: hits[0].distance
      };
      this.zone.run(() => this.lookTargetSignal.set(target));
    }
  }

  // Předfiltruje interactableList na kandidáty, které raycast má vůbec šanci trefit -
  // dřív se `raycaster.intersectObjects` volal proti celému seznamu bez ohledu na
  // vzdálenost, i když INTERACTION_DISTANCE je jen 4 jednotky. InstancedMesh (dávka
  // nedotčených stromů) se nefiltruje vůbec - je jich konstantně málo (pár na variantu)
  // bez ohledu na to, kolik stromů celkem existuje, takže se to nevyplatí.
  private filterNearbyInteractables(): THREE.Object3D[] {
    const maxDistSq = (INTERACTION_DISTANCE + INTERACTABLE_PREFILTER_MARGIN) ** 2;
    const cameraPos = this.camera.position;
    return this.interactableList.filter((object) => {
      if (object instanceof THREE.InstancedMesh) return true;
      const dx = object.position.x - cameraPos.x;
      const dy = object.position.y - cameraPos.y;
      const dz = object.position.z - cameraPos.z;
      return dx * dx + dy * dy + dz * dz <= maxDistSq;
    });
  }

  private clearLookTarget(): void {
    this.currentDistance = null;
    this.lastResolvedMeta = null;
    this.lastSignaledMeta = null;
    this.lastHitPoint = null;
    this.lastHitInstanceId = null;
    if (this.lastTargetId !== null) {
      this.lastTargetId = null;
      this.zone.run(() => this.lookTargetSignal.set(null));
    }
  }

  private getUphillSpeedMultiplier(dirX: number, dirZ: number): number {
    const dirMagSq = dirX * dirX + dirZ * dirZ;
    if (dirMagSq === 0) return 1;

    const dirMag = Math.sqrt(dirMagSq);
    const { gradX, gradZ } = this.getSlopeGradient(this.camera.position.x, this.camera.position.z);
    const uphillSlope = Math.max(0, (gradX * dirX + gradZ * dirZ) / dirMag);
    return Math.max(MIN_UPHILL_SPEED_MULTIPLIER, 1 - UPHILL_SLOPE_PENALTY * uphillSlope);
  }

  private getSlopeGradient(x: number, z: number): { gradX: number; gradZ: number } {
    const step = SLOPE_SAMPLE_STEP;
    const gradX =
      (this.getGroundHeight(x + step, z) - this.getGroundHeight(x - step, z)) / (2 * step);
    const gradZ =
      (this.getGroundHeight(x, z + step) - this.getGroundHeight(x, z - step)) / (2 * step);
    return { gradX, gradZ };
  }

  private resolveInteractable(
    hitObject: THREE.Object3D
  ): { root: THREE.Object3D; meta: InteractableMeta } | null {
    let current: THREE.Object3D | null = hitObject;
    while (current) {
      const meta = this.interactables.get(current);
      if (meta) return { root: current, meta };
      current = current.parent;
    }
    return null;
  }
}
