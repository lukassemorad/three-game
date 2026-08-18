import { Injectable, NgZone, signal } from '@angular/core';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { PhysicsService } from '../engine/physics.service';
import { RideConfig, RideInputAxes, ThreeSceneService } from '../engine/three-scene.service';
import { BicycleEntity, BicycleTemplate } from './bicycle.entity';
import { EntityServiceBase } from './entity-service.base';
import { PlayerHandService } from './player-hand.service';
import { springTowardPosition, springTowardRotation } from './spring-damper';
import { VehicleController, VehicleProfile } from './vehicle-controller';

const BICYCLE_MODEL_URL = encodeURI('assets/models/Bicycle.glb');

// Sdílený loader + cache - stejný vzor jako stag.service.ts (jediný fetch/parse GLTF,
// i kdyby v budoucnu byla kol víc).
const gltfLoader = new GLTFLoader();
let cachedTemplate: Promise<BicycleTemplate> | null = null;

function loadBicycleTemplate(): Promise<BicycleTemplate> {
  if (!cachedTemplate) {
    cachedTemplate = new Promise((resolve, reject) => {
      gltfLoader.load(BICYCLE_MODEL_URL, (gltf) => resolve({ scene: gltf.scene }), undefined, reject);
    });
  }
  return cachedTemplate;
}

// Grab/carry - stejné konstanty a spring-damper model jako tree.service.ts, jen bez "sag"
// efektu (kolo je tuhé těleso, ne kmen s prověšujícím se koncem).
const CARRY_DISTANCE = 1.6;
const POSITION_SPRING_STIFFNESS = 120;
const POSITION_SPRING_DAMPING_RATIO = 0.8;
const ROTATION_SPRING_STIFFNESS = 90;
const ROTATION_SPRING_DAMPING_RATIO = 0.8;

const MOUNT_PROMPT = 'Stiskni E pro nasednutí';
const DISMOUNT_PROMPT = 'E / mezerník - sesednout';

// Herní tuning, čistě odhad pro první test - viz plán (vozidlová mechanika). W/S = plyn/brzda,
// A/D = řízení; poloměr zatáčení závisí na rychlosti (nulová rychlost => nulový yaw-rate).
const BICYCLE_PROFILE: VehicleProfile = {
  maxForwardSpeed: 8,
  maxReverseSpeed: 2.5,
  acceleration: 4,
  brakeDeceleration: 9,
  rollingResistance: 3,
  maxSteerAngle: THREE.MathUtils.degToRad(35),
  steerResponseRate: THREE.MathUtils.degToRad(180),
  wheelBase: 1.05,
  leanGain: 0.9,
  maxLeanAngle: THREE.MathUtils.degToRad(25),
  leanResponseRate: THREE.MathUtils.degToRad(300),
  // Do kopce mirroruje tuning chůze (ThreeSceneService: UPHILL_SLOPE_PENALTY=1.4,
  // MIN_UPHILL_SPEED_MULTIPLIER=0.3), aby zpomalení působilo konzistentně - viz uživatelský
  // požadavek. Z kopce naopak kolo volnoběhem zrychluje nad rámec šlapání, až po
  // maxDownhillSpeed.
  uphillSlopePenalty: 1.4,
  minUphillSpeedMultiplier: 0.3,
  downhillAcceleration: 6,
  maxDownhillSpeed: 14
};

// Výška kamery nad kolem za jízdy - stejný princip jako EYE_HEIGHT při chůzi, jen lokální
// konstanta (vozidlo řídí kameru samo, viz tickRide).
const SEAT_HEIGHT = 1.5;

@Injectable({ providedIn: 'root' })
export class BicycleService extends EntityServiceBase<BicycleEntity> {
  private template: BicycleTemplate | null = null;
  private tickableRegistered = false;
  private heldBicycle: BicycleEntity | null = null;
  private riddenBicycle: BicycleEntity | null = null;

  // Stav aktuální grab session - stejný princip jako TreeService (viz komentáře tam).
  private grabOffsetLocal: THREE.Vector3 | null = null;
  private grabRotationOffset: THREE.Quaternion | null = null;
  private readonly grabPivotPosition = new THREE.Vector3();
  private readonly grabRotation = new THREE.Quaternion();
  private readonly grabAngularVelocity = new THREE.Vector3();
  private readonly grabLinearVelocity = new THREE.Vector3();

  // Vlastní stav jízdy - vytvořen při nasednutí (tryMount), zahozen při sesednutí (dismount).
  private vehicle: VehicleController | null = null;
  // Scratch objekt pro tickRide - vyhýbá se alokaci nového Vector3 každý frame jízdy.
  private readonly seatWorldPosition = new THREE.Vector3();

  // Rychlost jízdy pro HUD (km/h, null = hráč nejede) - stejný nullable-signal princip jako
  // ThreeSceneService.lookTarget. tickRide/tryMount/dismount běží mimo Angular zone (viz
  // animate()'s runOutsideAngular v ThreeSceneService), proto zone.run při každém zápisu.
  private readonly rideSpeedKmhSignal = signal<number | null>(null);
  readonly rideSpeedKmh = this.rideSpeedKmhSignal.asReadonly();

  constructor(
    scene: ThreeSceneService,
    private readonly physics: PhysicsService,
    private readonly playerHandService: PlayerHandService,
    private readonly zone: NgZone
  ) {
    super(scene);
  }

  async spawnBicycle(position: THREE.Vector3): Promise<void> {
    if (!this.tickableRegistered) {
      this.tickableRegistered = true;
      // Nekroká physics.step() - to už dělá TreeService's tickable (vždy registrovaný,
      // viz plán); dvojí krokování stejného Rapier světa za frame by ho zrychlilo.
      this.scene.registerTickable((delta) => this.trySyncResting(delta));
    }

    this.template = await loadBicycleTemplate();
    const bicycle = new BicycleEntity(this.template, position);
    this.register(bicycle);
    bicycle.physicsHandle = this.physics.createDynamicBoxBody(
      position,
      new THREE.Quaternion(),
      bicycle.colliderHalfExtents,
      bicycle.colliderOriginOffsetY
    );
    this.registerBicycle(bicycle);
  }

  override dispose(): void {
    for (const bicycle of this.entities.values()) {
      if (bicycle.physicsHandle) this.physics.removeBody(bicycle.physicsHandle);
    }
    this.heldBicycle = null;
    this.riddenBicycle = null;
    this.vehicle = null;
    this.rideSpeedKmhSignal.set(null);
    this.grabOffsetLocal = null;
    this.grabRotationOffset = null;
    this.tickableRegistered = false;
    super.dispose();
  }

  private registerBicycle(bicycle: BicycleEntity): void {
    this.scene.registerInteractable(bicycle.group, {
      id: bicycle.id,
      label: 'Kolo',
      interactPrompt: MOUNT_PROMPT,
      onUse: () => this.tryMount(bicycle),
      onGrabStart: (hitPoint, camera) => this.startGrab(bicycle, hitPoint, camera),
      onGrabTick: (camera, delta) => this.tickGrab(bicycle, camera, delta),
      onGrabEnd: (throwVelocity) => this.endGrab(bicycle, throwVelocity)
    });
  }

  private startGrab(bicycle: BicycleEntity, hitPoint: THREE.Vector3, camera: THREE.Camera): void {
    if (!bicycle.physicsHandle) return;
    this.heldBicycle = bicycle;
    this.physics.setKinematic(bicycle.physicsHandle);

    this.grabOffsetLocal = bicycle.group.worldToLocal(hitPoint.clone());
    this.grabRotationOffset = camera.quaternion.clone().invert().multiply(bicycle.group.quaternion.clone());
    this.grabPivotPosition.copy(hitPoint);
    this.grabRotation.copy(bicycle.group.quaternion);
    this.grabAngularVelocity.set(0, 0, 0);
    this.grabLinearVelocity.set(0, 0, 0);
  }

  private tickGrab(bicycle: BicycleEntity, camera: THREE.Camera, delta: number): void {
    if (!bicycle.physicsHandle || !this.grabOffsetLocal || !this.grabRotationOffset) return;

    const desiredRotation = camera.quaternion.clone().multiply(this.grabRotationOffset);
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

    const origin = this.grabPivotPosition.clone().sub(this.grabOffsetLocal.clone().applyQuaternion(this.grabRotation));

    this.physics.setKinematicTarget(bicycle.physicsHandle, origin, this.grabRotation);
    bicycle.applyPhysicsTransform(origin, this.grabRotation);
  }

  private endGrab(bicycle: BicycleEntity, throwVelocity: THREE.Vector3): void {
    this.heldBicycle = null;
    this.grabOffsetLocal = null;
    this.grabRotationOffset = null;
    if (!bicycle.physicsHandle) return;
    const finalLinvel = throwVelocity.clone().add(this.grabLinearVelocity);
    this.physics.setDynamic(bicycle.physicsHandle, finalLinvel, this.grabAngularVelocity);
  }

  // Kolo leží ve fyzikálním světě dál (může se kutálet/posouvat), dokud ho hráč nedrží ani
  // na něm nejede - stejný princip jako TreeService.syncFallenTreesToCollision.
  private trySyncResting(delta: number): void {
    for (const bicycle of this.entities.values()) {
      if (bicycle === this.heldBicycle || bicycle === this.riddenBicycle || !bicycle.physicsHandle) continue;
      const { translation, rotation } = this.physics.readTransform(bicycle.physicsHandle);
      bicycle.applyPhysicsTransform(translation, rotation);
    }
  }

  private tryMount(bicycle: BicycleEntity): void {
    const config: RideConfig = {
      label: 'Kolo',
      dismountPrompt: DISMOUNT_PROMPT,
      onTick: (camera, input, delta) => this.tickRide(bicycle, camera, input, delta),
      onDismount: () => this.dismount(bicycle)
    };
    if (!this.scene.beginRide(config)) return;

    this.riddenBicycle = bicycle;
    this.zone.run(() => this.rideSpeedKmhSignal.set(0));
    // Směr jízdy navazuje na to, kam se hráč díval při nasednutí - jen počáteční hodnota,
    // dál si ho řídí výhradně A/D (viz VehicleController).
    this.vehicle = new VehicleController(BICYCLE_PROFILE, bicycle.group.position, this.scene.getCameraYaw());
    // Kolo teď stojí přímo pod hráčem - bez odregistrování by na něj mohl mířit vlastní
    // look-at raycast hráče (matoucí "nasedni"/grab prompt na objekt, na kterém už jede).
    this.scene.unregisterInteractable(bicycle.group);
    if (bicycle.physicsHandle) this.physics.setKinematic(bicycle.physicsHandle);
    this.playerHandService.setVisible(false);
  }

  // Vozidlo (viz VehicleController) si samo řídí svou pozici/natočení podle plynu a řízení
  // (W/S/A/D, nezávislé na kameře). Kamera jen "sedí" nad kolem na SEAT_HEIGHT a nechává si
  // vlastní rotaci (myš) - proto se tu camera.quaternion vůbec nedotýká, na rozdíl od
  // předchozí verze, kde kolo kopírovalo yaw kamery.
  private tickRide(bicycle: BicycleEntity, camera: THREE.Camera, input: RideInputAxes, delta: number): void {
    if (!bicycle.physicsHandle || !this.vehicle) return;

    // Sklon terénu ve směru aktuálního pohybu kola (couvání tedy počítá sklon opačným
    // směrem), ne ve směru pohledu kamery - VehicleController si z něj sám odvodí zpomalení
    // do kopce (stejné jako chůze) i zrychlení z kopce (volnoběh).
    const travelSign = Math.sign(this.vehicle.speed) || 1;
    const forward = this.vehicle.getForward();
    const slope = this.scene.getSlopeAlongDirection(
      this.vehicle.position.x,
      this.vehicle.position.z,
      forward.x * travelSign,
      forward.z * travelSign
    );

    this.vehicle.update(delta, input, slope);

    const kmh = Math.round(Math.abs(this.vehicle.speed) * 3.6 * 10) / 10;
    if (kmh !== this.rideSpeedKmhSignal()) {
      this.zone.run(() => this.rideSpeedKmhSignal.set(kmh));
    }

    const { position, quaternion, leanAngle } = this.vehicle.getTransform();
    position.y = this.scene.getGroundHeight(position.x, position.z);

    this.physics.setKinematicTarget(bicycle.physicsHandle, position, quaternion);
    bicycle.applyPhysicsTransform(position, quaternion);
    bicycle.setLean(leanAngle);

    this.seatWorldPosition.set(position.x, position.y + SEAT_HEIGHT, position.z);
    camera.position.copy(this.seatWorldPosition);
  }

  // Sesednutí kolo nijak nepřemísťuje - zůstává přesně tam, kde ho tickRide naposledy
  // nechal, jen přestává být řízené jízdou a znovu se dá uchopit/nasednout.
  private dismount(bicycle: BicycleEntity): void {
    this.riddenBicycle = null;
    this.vehicle = null;
    this.zone.run(() => this.rideSpeedKmhSignal.set(null));
    bicycle.setLean(0);
    this.playerHandService.setVisible(true);
    if (bicycle.physicsHandle) {
      this.physics.setDynamic(bicycle.physicsHandle, new THREE.Vector3(), new THREE.Vector3());
    }
    this.registerBicycle(bicycle);
  }
}
