import { Injectable } from '@angular/core';
import * as THREE from 'three';
import type * as RapierNS from '@dimforge/rapier3d-compat';
import { CollisionService } from '../engine/collision.service';
import { ThreeSceneService } from '../engine/three-scene.service';
import { PhysicsService } from '../engine/physics.service';
import { IntactTreeSaveState, TreeSaveState } from '../../shared/models/save-game.model';
import { PlayerStateService } from '../state/player-state.service';
import { InstancedTreeBatch } from './instanced-tree-batch';
import { getIntactTreeVisual, getTreeColliderInfo, TreeEntity, TreeVariant } from './tree.entity';

export interface TreeSpawnEntry {
  readonly position: THREE.Vector3;
  readonly variant?: TreeVariant;
}

const CARRY_DISTANCE = 2;
// Cena za jednotku dřeva vyplacená při odevzdání kmene do výkupny.
const WOOD_PRICE = 2;
// Kmen se po pádové animaci může místy ocitnout mírně zanořený v terénu (báze a špička
// leží na jinak vysokém místě, než kde je zbytek rovného kmene) - i malá počáteční
// prostupnost stačí na to, aby fyzika nevygenerovala kontakt a těleso rovnou propadlo
// skrz (tunneling). Tělo se proto vytvoří s rezervou nad nejvyšším bodem terénu pod
// kmenem a nechá se dopadnout samo - pád o pár centimetrů je nepostřehnutelný.
const LOG_SPAWN_CLEARANCE = 0.1;

// Uchopený kmen se nedrží rigidně - "prověšuje" se kolem uchopeného bodu (volný konec táhne
// gravitace dolů, viz sag v tickGrab) a k cílové pozici/rotaci se tlumeně dohání pružinovým
// modelem (spring-damper) místo okamžitého teleportu na cíl každý tick. Damping ratio mírně
// pod 1 (kritické tlumení) dává jemné dokmitnutí/ustálení, ne nekonečnou oscilaci ani strnulé
// beznávazné natočení.
const MAX_SAG_ANGLE = THREE.MathUtils.degToRad(25);
const SAG_FACTOR = 0.6;
const POSITION_SPRING_STIFFNESS = 120;
const POSITION_SPRING_DAMPING_RATIO = 0.8;
const ROTATION_SPRING_STIFFNESS = 90;
const ROTATION_SPRING_DAMPING_RATIO = 0.8;

// Rozdíl mezi dvěma rotacemi vyjádřený jako axis*angle (small-angle vektor) - stejná
// reprezentace jako úhlová rychlost, takže se s ní dá rovnou počítat ve spring-damper modelu
// níže. Vrací rotaci "from -> to", normalizovanou na nejkratší cestu (w >= 0).
function quaternionErrorVector(from: THREE.Quaternion, to: THREE.Quaternion): THREE.Vector3 {
  const delta = to.clone().multiply(from.clone().invert());
  if (delta.w < 0) delta.set(-delta.x, -delta.y, -delta.z, -delta.w);
  const angle = 2 * Math.acos(THREE.MathUtils.clamp(delta.w, -1, 1));
  if (angle < 1e-6) return new THREE.Vector3();
  const sinHalfAngle = Math.sqrt(1 - delta.w * delta.w);
  const axis =
    sinHalfAngle < 1e-6
      ? new THREE.Vector3(delta.x, delta.y, delta.z)
      : new THREE.Vector3(delta.x, delta.y, delta.z).multiplyScalar(1 / sinHalfAngle);
  return axis.multiplyScalar(angle);
}

// Kritické tlumení = 2*sqrt(tuhost) - damping ratio pod 1 z toho odvozuje o kolik "poddimenzovat"
// tlumení, aby vzniklo mírné, samo-utlumující se dokmitnutí místo přesného bezeskokového náběhu.
function springTowardPosition(
  current: THREE.Vector3,
  velocity: THREE.Vector3,
  target: THREE.Vector3,
  stiffness: number,
  dampingRatio: number,
  delta: number
): void {
  const damping = dampingRatio * 2 * Math.sqrt(stiffness);
  const displacement = target.clone().sub(current);
  const accel = displacement.multiplyScalar(stiffness).addScaledVector(velocity, -damping);
  velocity.addScaledVector(accel, delta);
  current.addScaledVector(velocity, delta);
}

function springTowardRotation(
  current: THREE.Quaternion,
  angularVelocity: THREE.Vector3,
  target: THREE.Quaternion,
  stiffness: number,
  dampingRatio: number,
  delta: number
): void {
  const damping = dampingRatio * 2 * Math.sqrt(stiffness);
  const error = quaternionErrorVector(current, target);
  const accel = error.multiplyScalar(stiffness).addScaledVector(angularVelocity, -damping);
  angularVelocity.addScaledVector(accel, delta);
  const stepAngle = angularVelocity.length() * delta;
  if (stepAngle > 1e-8) {
    const step = new THREE.Quaternion().setFromAxisAngle(angularVelocity.clone().normalize(), stepAngle);
    current.premultiply(step);
  }
}

interface IntactTreeInfo {
  readonly variant: TreeVariant;
  readonly position: THREE.Vector3;
}

@Injectable({ providedIn: 'root' })
export class TreeService {
  private readonly trees = new Map<string, TreeEntity>();
  private readonly fallingTrees = new Set<TreeEntity>();
  private readonly fallenTrees = new Set<TreeEntity>();
  // standingBodies je klíčovaný stejným id jako collision registrace - pro nedotčené
  // (instancované) stromy id ve tvaru "intact-N", pro povýšené/samostatné stromy tree.id.
  private readonly standingBodies = new Map<string, RapierNS.RigidBody>();
  // Nedotčené stromy vykreslované instancovaně (viz InstancedTreeBatch) - jedna dávka na
  // variantu. intactTrees drží pozici/variantu, dokud strom nedostane první zásah.
  private readonly instancedBatches = new Map<TreeVariant, InstancedTreeBatch>();
  private readonly intactTrees = new Map<string, IntactTreeInfo>();
  private nextIntactTreeId = 0;
  private heldTree: TreeEntity | null = null;
  private tickableRegistered = false;

  // Stav aktuální grab session (platný jen dokud je heldTree nastavený). grabOffsetLocal je
  // bod zásahu paprsku v lokální soustavě kmene v čase uchopení - díky němu zůstává skutečně
  // chycené místo (ne báze) ukotvené u ruky hráče. grabPivotPosition/grabRotation jsou tlumeně
  // dohnávané (spring-damper) hodnoty, ne okamžité cíle - viz tickGrab.
  private grabOffsetLocal: THREE.Vector3 | null = null;
  private grabRotationOffset: THREE.Quaternion | null = null;
  private readonly grabPivotPosition = new THREE.Vector3();
  private readonly grabRotation = new THREE.Quaternion();
  private readonly grabAngularVelocity = new THREE.Vector3();
  private readonly grabLinearVelocity = new THREE.Vector3();

  constructor(
    private readonly scene: ThreeSceneService,
    private readonly playerState: PlayerStateService,
    private readonly collision: CollisionService,
    private readonly physics: PhysicsService
  ) {}

  // Nedotčené stromy se nevykreslují jako individuální TreeEntity, ale jako pár
  // InstancedTreeBatch dávek (jedna na variantu) - viz chopIntact() pro "povýšení"
  // stromu na plnohodnotný TreeEntity při prvním zásahu.
  spawnTrees(entries: TreeSpawnEntry[]): void {
    if (!this.tickableRegistered) {
      this.tickableRegistered = true;
      this.scene.registerTickable((delta) => {
        this.physics.step(delta);
        this.tickFalling(delta);
        this.syncFallenTreesToCollision();
      });
    }

    const byVariant = new Map<TreeVariant, TreeSpawnEntry[]>();
    for (const entry of entries) {
      const variant = entry.variant ?? 'oak';
      const list = byVariant.get(variant);
      if (list) list.push(entry);
      else byVariant.set(variant, [entry]);
    }

    for (const [variant, variantEntries] of byVariant) {
      const visual = getIntactTreeVisual(variant);
      const colliderInfo = getTreeColliderInfo(variant);
      const batch = new InstancedTreeBatch(visual, variantEntries.length);
      this.instancedBatches.set(variant, batch);

      for (const mesh of batch.getMeshes()) {
        this.scene.addToScene(mesh);
        this.scene.registerInteractable(mesh, {
          id: `intact-batch-${variant}`,
          label: 'Strom',
          interactPrompt: `Klikni pro pokácení (${visual.sectorCount}/${visual.sectorCount} stran zbývá)`,
          onInteract: (hitPoint, instanceId) => this.chopIntact(variant, batch, hitPoint, instanceId)
        });
      }

      for (const entry of variantEntries) {
        const id = `intact-${this.nextIntactTreeId++}`;
        batch.addInstance(id, entry.position);
        this.intactTrees.set(id, { variant, position: entry.position.clone() });
        this.collision.register(id, {
          x: entry.position.x,
          z: entry.position.z,
          radius: colliderInfo.radius
        });
        this.standingBodies.set(
          id,
          this.physics.createStaticTreeCollider(
            entry.position.x,
            entry.position.y,
            entry.position.z,
            colliderInfo.radius,
            colliderInfo.height
          )
        );
      }
    }
  }

  // Strom dostal první zásah, dokud byl ještě jen instancí v dávce - "povýší" se na
  // plnohodnotný TreeEntity (stejná sdílená intact geometrie, žádný vizuální pop) a
  // hned na něj aplikuje tenhle první zásah přes existující chop() logiku.
  private chopIntact(
    variant: TreeVariant,
    batch: InstancedTreeBatch,
    hitPoint: THREE.Vector3,
    instanceId?: number
  ): void {
    if (instanceId === undefined) return;
    const treeId = batch.getTreeIdAt(instanceId);
    if (!treeId) return;
    const info = this.intactTrees.get(treeId);
    if (!info) return;

    batch.removeInstance(treeId);
    this.intactTrees.delete(treeId);
    this.collision.unregister(treeId);
    const standingBody = this.standingBodies.get(treeId);
    if (standingBody) {
      this.physics.removeRigidBody(standingBody);
      this.standingBodies.delete(treeId);
    }

    const tree = new TreeEntity({ position: info.position, variant });
    this.trees.set(tree.id, tree);
    this.scene.addToScene(tree.group);
    this.collision.register(tree.id, {
      x: info.position.x,
      z: info.position.z,
      radius: tree.colliderRadius
    });
    this.standingBodies.set(
      tree.id,
      this.physics.createStaticTreeCollider(
        info.position.x,
        info.position.y,
        info.position.z,
        tree.colliderRadius,
        tree.trunkHeight
      )
    );

    this.chop(tree, hitPoint);
  }

  // Nedotčené stromy (jen pozice+varianta, viz intactTrees) se dají obnovit rovnou
  // přes spawnTrees - detailed jsou stromy, které už dostaly aspoň jeden zásah a nesou
  // plný stav (posekané sektory/lifecycle/pád), viz restoreTrees.
  getSerializableState(): { intact: IntactTreeSaveState[]; detailed: TreeSaveState[] } {
    const intact: IntactTreeSaveState[] = [];
    for (const info of this.intactTrees.values()) {
      intact.push({
        position: { x: info.position.x, y: info.position.y, z: info.position.z },
        variant: info.variant
      });
    }

    const detailed: TreeSaveState[] = [];
    const detailedTrees: TreeEntity[] = [...this.trees.values(), ...this.fallingTrees, ...this.fallenTrees];
    for (const tree of detailedTrees) {
      const fallAxis = tree.state.lifecycle === 'falling' && tree.fallAxis;
      detailed.push({
        position: { x: tree.group.position.x, y: tree.group.position.y, z: tree.group.position.z },
        rotation: {
          x: tree.group.quaternion.x,
          y: tree.group.quaternion.y,
          z: tree.group.quaternion.z,
          w: tree.group.quaternion.w
        },
        variant: tree.variant,
        sectorCount: tree.state.sectorCount,
        woodYield: tree.state.resource.amount,
        choppedSectorHits: Array.from(tree.state.choppedSectors.entries()).map(([sector, hitY]) => ({
          sector,
          hitY
        })),
        lifecycle: tree.state.lifecycle,
        fallProgress: tree.state.fallProgress,
        fallAxis: fallAxis ? { x: fallAxis.x, y: fallAxis.y, z: fallAxis.z } : null
      });
    }

    return { intact, detailed };
  }

  // Nahrazuje spawnTrees(generateTreePositions(...)) na load-cestě. Nedotčené stromy se
  // spawnují normální cestou (spawnTrees), stromy s uloženým "detailed" stavem se obnoví
  // jako plnohodnotné TreeEntity ve stejném lifecycle, ve kterém byly uloženy.
  restoreTrees(state: { intact: readonly IntactTreeSaveState[]; detailed: readonly TreeSaveState[] }): void {
    this.spawnTrees(
      state.intact.map((entry) => ({
        position: new THREE.Vector3(entry.position.x, entry.position.y, entry.position.z),
        variant: entry.variant
      }))
    );

    for (const entry of state.detailed) {
      const position = new THREE.Vector3(entry.position.x, entry.position.y, entry.position.z);
      const rotation = new THREE.Quaternion(entry.rotation.x, entry.rotation.y, entry.rotation.z, entry.rotation.w);
      const tree = new TreeEntity({
        position,
        variant: entry.variant,
        sectorCount: entry.sectorCount,
        woodYield: entry.woodYield,
        restore: {
          choppedSectorHits: entry.choppedSectorHits,
          lifecycle: entry.lifecycle,
          fallProgress: entry.fallProgress,
          fallAxis: entry.fallAxis,
          rotation: entry.rotation
        }
      });

      switch (entry.lifecycle) {
        case 'standing':
          this.trees.set(tree.id, tree);
          this.scene.addToScene(tree.group);
          this.registerTree(tree);
          this.collision.register(tree.id, { x: position.x, z: position.z, radius: tree.colliderRadius });
          this.standingBodies.set(
            tree.id,
            this.physics.createStaticTreeCollider(
              position.x,
              position.y,
              position.z,
              tree.colliderRadius,
              tree.trunkHeight
            )
          );
          break;
        case 'falling':
          this.scene.addToScene(tree.group);
          this.fallingTrees.add(tree);
          break;
        case 'fallen':
          this.scene.addToScene(tree.group);
          tree.physicsHandle = this.physics.createFallenLogBody(
            position,
            rotation,
            tree.colliderRadius,
            tree.trunkHeight
          );
          this.fallenTrees.add(tree);
          this.registerFallenTree(tree);
          this.registerFallenCollisionSegments(tree);
          break;
      }
    }
  }

  dispose(): void {
    this.trees.clear();
    this.fallingTrees.clear();
    this.fallenTrees.clear();
    this.standingBodies.clear();
    this.instancedBatches.clear();
    this.intactTrees.clear();
    this.nextIntactTreeId = 0;
    this.heldTree = null;
    this.tickableRegistered = false;
    this.grabOffsetLocal = null;
    this.grabRotationOffset = null;
  }

  private tickFalling(delta: number): void {
    if (this.fallingTrees.size === 0) return;
    for (const tree of this.fallingTrees) {
      if (tree.updateFall(delta)) {
        this.fallingTrees.delete(tree);
        tree.physicsHandle = this.physics.createFallenLogBody(
          this.computeLogSpawnPosition(tree),
          tree.group.quaternion,
          tree.colliderRadius,
          tree.trunkHeight
        );
        this.fallenTrees.add(tree);
        this.registerFallenTree(tree);
      }
    }
  }

  // Vzorkuje terén pod bází, středem a špičkou ležícího kmene a tělo vytvoří s rezervou
  // nad nejvyšším z nich - viz LOG_SPAWN_CLEARANCE.
  private computeLogSpawnPosition(tree: TreeEntity): THREE.Vector3 {
    const spawnPosition = tree.group.position.clone();
    const segment = tree.getFallenLogSegment();
    if (!segment) return spawnPosition;

    const mid = segment.start.clone().lerp(segment.end, 0.5);
    const terrainHeight = Math.max(
      this.scene.getGroundHeight(segment.start.x, segment.start.y),
      this.scene.getGroundHeight(mid.x, mid.y),
      this.scene.getGroundHeight(segment.end.x, segment.end.y)
    );
    spawnPosition.y = Math.max(spawnPosition.y, terrainHeight) + LOG_SPAWN_CLEARANCE;
    return spawnPosition;
  }

  // Kmen leží ve fyzikálním světě dál (může se kutálet/posouvat po nárazu/svahu), dokud ho
  // hráč nedrží - proto se to musí přepočítávat každý tick, ne jen jednou při dopadu.
  private syncFallenTreesToCollision(): void {
    for (const tree of this.fallenTrees) {
      if (tree === this.heldTree || !tree.physicsHandle) continue;
      const { translation, rotation } = this.physics.readTransform(tree.physicsHandle);
      tree.applyPhysicsTransform(translation, rotation);
      this.registerFallenCollisionSegments(tree);
    }
  }

  // Ležící kmen aproximujeme řetězcem kruhových koliderů podél jeho osy (kapsle z kruhů) -
  // CollisionService umí jen kruhy, takže víc kruhů "na sebe navazujících" po celé délce kmene
  // dá dohromady kolizi pro celou jeho ležící délku, ne jen pro bod báze. Počet segmentů se
  // počítá z konstantních rozměrů stromu (ne z aktuální - případně náklonem zkrácené - délky),
  // aby byl vždy stejný a šlo je při uchopení spolehlivě odregistrovat podle stejného výpočtu.
  private logSegmentCount(tree: TreeEntity): number {
    return Math.max(2, Math.ceil(tree.trunkHeight / tree.colliderRadius));
  }

  private registerFallenCollisionSegments(tree: TreeEntity): void {
    const segment = tree.getFallenLogSegment();
    if (!segment) return;

    const { start, end, radius } = segment;
    const segmentCount = this.logSegmentCount(tree);
    for (let i = 0; i < segmentCount; i++) {
      const t = i / (segmentCount - 1);
      const point = start.clone().lerp(end, t);
      this.collision.register(`${tree.id}-log-${i}`, { x: point.x, z: point.y, radius });
    }
  }

  private unregisterFallenCollisionSegments(tree: TreeEntity): void {
    const segmentCount = this.logSegmentCount(tree);
    for (let i = 0; i < segmentCount; i++) {
      this.collision.unregister(`${tree.id}-log-${i}`);
    }
  }

  private registerTree(tree: TreeEntity, promptOverride?: string): void {
    this.scene.registerInteractable(tree.group, {
      id: tree.id,
      label: 'Strom',
      interactPrompt: promptOverride ?? this.defaultPrompt(tree),
      onInteract: (hitPoint) => this.chop(tree, hitPoint)
    });
  }

  // Padlý kmen se po dopadu re-registruje jako "grabbable" - podržení LMB ho telekineticky
  // uchopí místo sekání (viz InteractableMeta.onGrabStart v ThreeSceneService).
  private registerFallenTree(tree: TreeEntity): void {
    this.scene.registerInteractable(tree.group, {
      id: tree.id,
      label: 'Kmen',
      interactPrompt: 'Podrž pro uchopení',
      onGrabStart: (hitPoint, camera) => this.startGrab(tree, hitPoint, camera),
      onGrabTick: (camera, delta) => this.tickGrab(tree, camera, delta),
      onGrabEnd: (throwVelocity) => this.endGrab(tree, throwVelocity)
    });
  }

  private startGrab(tree: TreeEntity, hitPoint: THREE.Vector3, camera: THREE.Camera): void {
    if (!tree.physicsHandle) return;
    this.heldTree = tree;
    this.physics.setKinematic(tree.physicsHandle);
    this.unregisterFallenCollisionSegments(tree);

    // Bod zásahu v lokální soustavě kmene - offset od báze k místu, kde ho hráč skutečně
    // chytil (viz tickGrab, kde se z něj zpětně dopočítává poloha báze).
    this.grabOffsetLocal = tree.group.worldToLocal(hitPoint.clone());
    // Jak byl kmen natočený vůči pohledu v okamžiku chycení - výchozí "carry" orientace,
    // na kterou se pak navíc aplikuje prověšení (sag) v tickGrab.
    this.grabRotationOffset = camera.quaternion.clone().invert().multiply(tree.group.quaternion.clone());
    // Pružinový model startuje z aktuálního stavu, ne z cíle - žádný skok při chycení.
    this.grabPivotPosition.copy(hitPoint);
    this.grabRotation.copy(tree.group.quaternion);
    this.grabAngularVelocity.set(0, 0, 0);
    this.grabLinearVelocity.set(0, 0, 0);
  }

  // Kmen se vznáší na pevné vzdálenosti před kamerou a "prověšuje se" kolem uchopeného bodu -
  // volný konec táhne gravitace dolů (sag), a k cíli (pozici i rotaci) se dohání tlumeným
  // pružinovým modelem, ne okamžitým teleportem - viz springTowardPosition/springTowardRotation.
  private tickGrab(tree: TreeEntity, camera: THREE.Camera, delta: number): void {
    if (!tree.physicsHandle || !this.grabOffsetLocal || !this.grabRotationOffset) return;

    const baseRotation = camera.quaternion.clone().multiply(this.grabRotationOffset);
    // Dlouhá osa kmene (lokální +Y), stejná konvence jako TreeEntity.getFallenLogSegment.
    const axis = new THREE.Vector3(0, 1, 0).applyQuaternion(baseRotation);
    const down = new THREE.Vector3(0, -1, 0);
    const sagAxis = new THREE.Vector3().crossVectors(axis, down);
    let desiredRotation = baseRotation;
    if (sagAxis.lengthSq() > 1e-6) {
      const sagAngle = Math.min(MAX_SAG_ANGLE, axis.angleTo(down) * SAG_FACTOR);
      desiredRotation = new THREE.Quaternion()
        .setFromAxisAngle(sagAxis.normalize(), sagAngle)
        .multiply(baseRotation);
    }
    springTowardRotation(
      this.grabRotation,
      this.grabAngularVelocity,
      desiredRotation,
      ROTATION_SPRING_STIFFNESS,
      ROTATION_SPRING_DAMPING_RATIO,
      delta
    );

    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    const pivotTarget = camera.position.clone().addScaledVector(forward, CARRY_DISTANCE);
    springTowardPosition(
      this.grabPivotPosition,
      this.grabLinearVelocity,
      pivotTarget,
      POSITION_SPRING_STIFFNESS,
      POSITION_SPRING_DAMPING_RATIO,
      delta
    );

    // Báze kmene se dopočítává zpětně z uchopeného bodu, aby zůstal přesně ukotvený u pivotu.
    const trunkOrigin = this.grabPivotPosition
      .clone()
      .sub(this.grabOffsetLocal.clone().applyQuaternion(this.grabRotation));

    this.physics.setKinematicTarget(tree.physicsHandle, trunkOrigin, this.grabRotation);
    tree.applyPhysicsTransform(trunkOrigin, this.grabRotation);
  }

  private endGrab(tree: TreeEntity, throwVelocity: THREE.Vector3): void {
    this.heldTree = null;
    this.grabOffsetLocal = null;
    this.grabRotationOffset = null;
    if (!tree.physicsHandle) return;
    // Aim-based "kop" od hráče + skutečná rychlost/rotace, jakou kmen měl z pružinového
    // modelu těsně před puštěním - hození tak navazuje na to, jak s kmenem hráč pohyboval,
    // místo aby najednou strhlo na fixní rychlost bez ohledu na předchozí pohyb.
    const finalLinvel = throwVelocity.clone().add(this.grabLinearVelocity);
    this.physics.setDynamic(tree.physicsHandle, finalLinvel, this.grabAngularVelocity);
  }

  private defaultPrompt(tree: TreeEntity): string {
    const remaining = tree.state.sectorCount - tree.state.choppedSectors.size;
    return `Klikni pro pokácení (${remaining}/${tree.state.sectorCount} stran zbývá)`;
  }

  private chop(tree: TreeEntity, hitPoint: THREE.Vector3): void {
    const result = tree.registerHit(hitPoint);

    if (result.outcome === 'alreadyFallen') {
      return;
    }

    if (result.outcome === 'felled') {
      this.scene.unregisterInteractable(tree.group);
      this.collision.unregister(tree.id);
      const standingBody = this.standingBodies.get(tree.id);
      if (standingBody) {
        this.physics.removeRigidBody(standingBody);
        this.standingBodies.delete(tree.id);
      }
      this.trees.delete(tree.id);
      this.fallingTrees.add(tree);
      this.playerState.incrementTreesChopped();
      return;
    }

    const promptOverride =
      result.outcome === 'repeatedSector'
        ? `Tahle strana je už odštípnutá — zkus jinou (${result.sectorsRemaining}/${tree.state.sectorCount} stran zbývá)`
        : undefined;
    this.registerTree(tree, promptOverride);
  }

  // Volá BuildingService každý tick pro zónu výkupny - kmen ležící v dosahu zóny se zničí
  // (odstraní ze scény/fyziky/kolizí) a hráči se za prodané dřevo připíšou peníze.
  collectLogsInZone(zone: { x: number; z: number; radius: number }): void {
    for (const tree of [...this.fallenTrees]) {
      if (tree === this.heldTree) continue;
      const dx = tree.group.position.x - zone.x;
      const dz = tree.group.position.z - zone.z;
      if (dx * dx + dz * dz > zone.radius * zone.radius) continue;
      this.removeFallenTree(tree);
      this.playerState.addMoney(tree.state.resource.amount * WOOD_PRICE);
    }
  }

  private removeFallenTree(tree: TreeEntity): void {
    this.scene.unregisterInteractable(tree.group);
    this.scene.removeFromScene(tree.group);
    this.unregisterFallenCollisionSegments(tree);
    if (tree.physicsHandle) {
      this.physics.removeBody(tree.physicsHandle);
      tree.physicsHandle = null;
    }
    this.fallenTrees.delete(tree);
  }
}
