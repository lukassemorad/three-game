import { Injectable, NgZone, effect, signal } from '@angular/core';
import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { ImprovedNoise } from 'three/addons/math/ImprovedNoise.js';
import { BiomeId } from '../../shared/models/biome.model';
import { QuatLike, Vec3Like } from '../../shared/models/save-game.model';
import { SettingsService } from '../state/settings.service';
import { TREE_CHUNK_SIZE } from '../world/chunk-grid';
import { RoadNetwork } from '../world/road-network';
import { FlatZone, HeightGrid, TerrainGenerator } from '../world/terrain-generator';
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
  // Samostatný callback pro klávesu E - oddělený od onInteract (levé tlačítko/kácení),
  // používá se pro akce typu "koupit", které nemají být na kliku.
  readonly onUse?: () => void;
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

const MICRO_RELIEF_FREQ = 0.6;
const MICRO_RELIEF_AMPLITUDE = 0.05;

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
const ATTACK_COOLDOWN_SECONDS = 0.5;

// Poloviční úhlopříčka chunku (viz chunk-grid.ts, sdíleno s TreeService) - viz
// filterNearbyInteractables níže, kde se používá k rozšíření prefiltru pro chunkované
// instancované dávky stromů.
const TREE_CHUNK_RADIUS = Math.SQRT2 * (TREE_CHUNK_SIZE / 2);

const SPAWN_X = 0;
const SPAWN_Z = -40;

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
  private readonly microReliefNoise = new ImprovedNoise();

  private readonly pressedKeys = new Set<string>();
  private velocityY = 0;
  private grounded = true;
  private terrain = new TerrainGenerator();

  private readonly raycaster = new THREE.Raycaster();
  private readonly interactableWorldPositionScratch = new THREE.Vector3();
  private readonly interactables = new Map<THREE.Object3D, InteractableMeta>();
  private interactableList: THREE.Object3D[] = [];
  private lastTargetId: string | null = null;
  private currentDistance: number | null = null;
  private lastResolvedMeta: InteractableMeta | null = null;
  private lastSignaledMeta: InteractableMeta | null = null;
  private lastHitPoint: THREE.Vector3 | null = null;
  private lastHitInstanceId: number | null = null;
  private heldMeta: InteractableMeta | null = null;
  private lastAttackTime = -Infinity;
  private isPrimaryHeld = false;
  private autoFireIntervalSeconds: number | null = null;

  private fpsAccumulator = 0;
  private fpsFrameCount = 0;
  private lastFps = 0;

  private readonly tickables = new Set<(delta: number) => void>();
  private readonly primaryActionListeners = new Set<() => void>();
  private readonly secondaryActionListeners = new Set<() => void>();
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
    if (event.code === 'KeyF' && !event.repeat && this.controls.isLocked) {
      for (const fn of this.secondaryActionListeners) fn();
    }
    if (event.code === 'KeyE' && !event.repeat && this.controls.isLocked) {
      this.lastResolvedMeta?.onUse?.();
    }
  };
  private readonly onKeyUp = (event: KeyboardEvent) => this.pressedKeys.delete(event.code);

  private readonly scrollListeners = new Set<(direction: 1 | -1) => void>();

  private readonly onWheel = (event: WheelEvent) => {
    if (!this.controls.isLocked) return;
    const direction = event.deltaY > 0 ? 1 : -1;
    for (const fn of this.scrollListeners) fn(direction);
  };

  private readonly onMouseDown = (event: MouseEvent) => {
    if (!this.controls.isLocked || event.button !== 0 || this.heldMeta) return;
    this.isPrimaryHeld = true;
    const now = this.clock.getElapsedTime();
    if (now - this.lastAttackTime < ATTACK_COOLDOWN_SECONDS) return;
    this.lastAttackTime = now;
    for (const fn of this.primaryActionListeners) fn();
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
    if (event.button !== 0) return;
    this.isPrimaryHeld = false;
    if (!this.heldMeta) return;
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

  async init(canvas: HTMLCanvasElement, roads?: RoadNetwork, flatZones?: readonly FlatZone[]): Promise<void> {
    this.terrain = new TerrainGenerator(roads, flatZones);
    this.lastAttackTime = -Infinity;
    this.interactables.clear();
    this.interactableList = [];
    this.lastTargetId = null;
    this.currentDistance = null;
    this.lastResolvedMeta = null;
    this.lastSignaledMeta = null;
    this.lastHitPoint = null;
    this.lastHitInstanceId = null;
    this.heldMeta = null;
    this.isPrimaryHeld = false;
    this.autoFireIntervalSeconds = null;
    this.tickables.clear();
    this.primaryActionListeners.clear();
    this.secondaryActionListeners.clear();
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
    this.camera.position.set(SPAWN_X, this.getGroundHeight(SPAWN_X, SPAWN_Z) + EYE_HEIGHT, SPAWN_Z);
    // Kamera musí být součástí scény, jinak renderer.render(scene, camera) níže neprojde
    // nic zavěšeného přes attachToCamera (view-model ruky) - traverzuje jen `scene`.
    this.scene.add(this.camera);

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
    this.controls.addEventListener('unlock', () => {
      this.zone.run(() => this.lockedSignal.set(false));
      this.isPrimaryHeld = false;
    });

    this.clock = new THREE.Clock();

    this.zone.runOutsideAngular(() => {
      document.addEventListener('keydown', this.onKeyDown);
      document.addEventListener('keyup', this.onKeyUp);
      document.addEventListener('mousedown', this.onMouseDown);
      document.addEventListener('mouseup', this.onMouseUp);
      document.addEventListener('wheel', this.onWheel, { passive: true });
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

  // Pro případ zaseknutí hráče (v terénu, mezi objekty apod.) - vrátí ho na startovní pozici,
  // včetně vertikální rychlosti a rotace, aby po teleportu nezůstal viset v pádu nebo pootočený.
  resetPlayerToSpawn(): void {
    this.camera.position.set(SPAWN_X, this.getGroundHeight(SPAWN_X, SPAWN_Z) + EYE_HEIGHT + 1, SPAWN_Z);
    this.camera.quaternion.identity();
    this.velocityY = 0;
    this.grounded = true;
  }

  addToScene(object: THREE.Object3D): void {
    this.scene.add(object);
  }

  removeFromScene(object: THREE.Object3D): void {
    this.scene.remove(object);
  }

  // Připojí objekt jako dítě kamery (view-model, např. ruka hráče) - hýbe se automaticky
  // s pohledem/pohybem, žádný extra sync není potřeba.
  attachToCamera(object: THREE.Object3D): void {
    this.camera.add(object);
  }

  detachFromCamera(object: THREE.Object3D): void {
    this.camera.remove(object);
  }

  // Zavoláno při každém platném levém kliknutí (locked, LMB, nic se právě nedrží) bez
  // ohledu na to, zda kliknutí trefilo interactable - pro vizuální feedback (švih ruky),
  // ne herní logiku.
  onPrimaryAction(fn: () => void): void {
    this.primaryActionListeners.add(fn);
  }

  offPrimaryAction(fn: () => void): void {
    this.primaryActionListeners.delete(fn);
  }

  // Zavoláno při stisku 'F' (locked, ne autorepeat) - vedlejší akce nezávislá na
  // interactable pod kurzorem (např. "prohlédnutí" ruky/nástroje).
  onSecondaryAction(fn: () => void): void {
    this.secondaryActionListeners.add(fn);
  }

  offSecondaryAction(fn: () => void): void {
    this.secondaryActionListeners.delete(fn);
  }

  // Zavoláno při otočení kolečkem myši (locked) - používá hotbar pro přepínání vybaveného
  // předmětu. 1 = dolů/dál, -1 = nahoru/zpátky (stejná konvence jako event.deltaY).
  onScroll(fn: (direction: 1 | -1) => void): void {
    this.scrollListeners.add(fn);
  }

  offScroll(fn: (direction: 1 | -1) => void): void {
    this.scrollListeners.delete(fn);
  }

  // Volá se při každé změně vybaveného nástroje (viz PlayerHandService) - null vypíná
  // automatické opakování akce při podrženém LMB, číslo udává kadenci v sekundách.
  setAutoFireInterval(seconds: number | null): void {
    this.autoFireIntervalSeconds = seconds;
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

  // Živá reference na pozici kamery - jen ke čtení, nikdy neuchovávat/mutovat mimo
  // synchronní použití (viz TreeService.updateChunkVisibility).
  getCameraPosition(): THREE.Vector3 {
    return this.camera.position;
  }

  getFps(): number {
    return this.lastFps;
  }

  getRendererInfo(): { calls: number; triangles: number } | null {
    if (!this.renderer) return null;
    return { calls: this.renderer.info.render.calls, triangles: this.renderer.info.render.triangles };
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
    document.removeEventListener('wheel', this.onWheel);
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
    this.isPrimaryHeld = false;
    this.autoFireIntervalSeconds = null;
    this.tickables.clear();
    this.primaryActionListeners.clear();
    this.secondaryActionListeners.clear();
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
      // Jitter jde jen do vizuálního bufferu, ne do heightGrid samotného - fyzikální
      // heightfield (PhysicsService.buildTerrainHeightfield) se staví z heightGrid dřív,
      // než sem tato smyčka dojde (viz init() níže), takže o jitteru neví a zůstává
      // nedotčený. Malá amplituda + 1 segment/unit = viditelně "rozbité" mikro-facety
      // (žádoucí spolu s flatShading), bez znatelného posunu proti nejitrované výšce.
      const x = -TERRAIN_WIDTH / 2 + (col / TERRAIN_SEGMENTS_X) * TERRAIN_WIDTH;
      const z = -TERRAIN_DEPTH / 2 + (row / TERRAIN_SEGMENTS_Z) * TERRAIN_DEPTH;
      const jitter = this.microReliefNoise.noise(x * MICRO_RELIEF_FREQ, z * MICRO_RELIEF_FREQ, 300);
      // V dorovnané zóně (FlatZone) potlačit jitter na 0 - jinak by i pár centimetrů
      // mikro-reliéfu mohlo prosvítat skrz dokonale plochou podlahu budovy.
      const flatBlend = this.terrain.getFlatZoneBlend(x, z);
      position.setZ(i, height + jitter * MICRO_RELIEF_AMPLITUDE * (1 - flatBlend));

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
      new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true })
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

    // Prosté klouzavé FPS pro dev perf overlay (viz getFps) - přepočet ~2x/s, ne každý
    // frame, aby číslo nebylo tak cukavé, že je nečitelné.
    this.fpsFrameCount++;
    this.fpsAccumulator += delta;
    if (this.fpsAccumulator >= 0.5) {
      this.lastFps = Math.round(this.fpsFrameCount / this.fpsAccumulator);
      this.fpsFrameCount = 0;
      this.fpsAccumulator = 0;
    }

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
        this.tickAutoFire();
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
  // nedotčených stromů, viz TreeService) je teď rozdělená po chunkách - může jich být
  // desítky - takže se filtruje stejným distančním testem jako běžné objekty, jen s
  // marginem navíc rozšířeným o poloměr chunku (world pozice u těchto meshů je
  // střed chunku, ne pozice jednotlivého stromu).
  // Používá getWorldPosition, ne holé object.position - to druhé je lokální souřadnice
  // vůči rodiči, což sedí jen pro objekty připojené přímo do scény (stromy). Zboží
  // v obchodě (viz ShopEntity) je zanořené pod shop.group, takže by lokální position
  // odpovídalo posunu na poličce, ne skutečné světové pozici.
  private filterNearbyInteractables(): THREE.Object3D[] {
    const maxDistSq = (INTERACTION_DISTANCE + INTERACTABLE_PREFILTER_MARGIN) ** 2;
    const maxDistSqInstanced = (INTERACTION_DISTANCE + INTERACTABLE_PREFILTER_MARGIN + TREE_CHUNK_RADIUS) ** 2;
    const cameraPos = this.camera.position;
    return this.interactableList.filter((object) => {
      object.getWorldPosition(this.interactableWorldPositionScratch);
      const dx = this.interactableWorldPositionScratch.x - cameraPos.x;
      const dy = this.interactableWorldPositionScratch.y - cameraPos.y;
      const dz = this.interactableWorldPositionScratch.z - cameraPos.z;
      const distSq = dx * dx + dy * dy + dz * dz;
      return distSq <= (object instanceof THREE.InstancedMesh ? maxDistSqInstanced : maxDistSq);
    });
  }

  // Opakuje interakční část onMouseDown (bez grab-start větve), dokud je LMB drženo a
  // vybavený nástroj má nastavený autoFireIntervalSeconds (viz setAutoFireInterval) -
  // sdílí lastAttackTime s manuálním klikem, takže po počátečním kliku navazuje v
  // kadenci auto-fire bez dvojího odpálení hned při stisku.
  private tickAutoFire(): void {
    if (!this.isPrimaryHeld || this.autoFireIntervalSeconds === null) return;
    const now = this.clock.getElapsedTime();
    if (now - this.lastAttackTime < this.autoFireIntervalSeconds) return;
    this.lastAttackTime = now;
    for (const fn of this.primaryActionListeners) fn();
    if (this.lastResolvedMeta && this.lastHitPoint) {
      this.lastResolvedMeta.onInteract?.(this.lastHitPoint, this.lastHitInstanceId ?? undefined);
    }
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
