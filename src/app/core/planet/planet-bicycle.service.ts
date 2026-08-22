import { Injectable } from '@angular/core';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { BicycleEntity, BicycleTemplate } from '../world/bicycle.entity';
import type { VehicleProfile } from '../world/vehicle-controller';
import { PlanetPhysicsService, PlayerBodyHandle } from './planet-physics.service';
import { PlanetTerrain } from './planet-terrain';
import { PlanetVehicleController } from './planet-vehicle-controller';
import { FEET_OFFSET, PLANET_CENTER } from './planet-config';

const BICYCLE_MODEL_URL = encodeURI('assets/models/Bicycle.glb');

// Sdílený loader + cache - stejný vzor jako u ostatních modelů (jediný fetch/parse GLTF).
const gltfLoader = new GLTFLoader();
let cachedTemplate: Promise<BicycleTemplate> | null = null;

function loadBicycleTemplate(): Promise<BicycleTemplate> {
  if (!cachedTemplate) {
    cachedTemplate = new Promise((resolve, reject) => {
      gltfLoader.load(
        BICYCLE_MODEL_URL,
        (gltf) => resolve({ scene: gltf.scene }),
        undefined,
        reject
      );
    });
  }
  return cachedTemplate;
}

// Jízdní vlastnosti se přebírají doslova z plochého světa - jsou to samé skaláry (m/s, m/s²,
// rad/s, rozvor), kterým je tvar světa lhostejný, takže kolo jede na planetě stejně jako
// jelo na rovině. Ladit se tedy nemusí nic, jen se jinak skládá orientace (viz
// PlanetVehicleController).
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
  uphillSlopePenalty: 1.4,
  minUphillSpeedMultiplier: 0.3,
  downhillAcceleration: 6,
  maxDownhillSpeed: 14
};

export const MOUNT_PROMPT = 'Stiskni E pro nasednutí';
export const DISMOUNT_PROMPT = 'E - sesednout';

// Výška kamery nad kolem za jízdy - obdoba EYE_OFFSET při chůzi.
const SEAT_HEIGHT = 1.5;
// Kam se hráč postaví po sesednutí - vedle kola, ať do něj hned nenaráží.
const DISMOUNT_SIDE_OFFSET = 1;

@Injectable({ providedIn: 'root' })
export class PlanetBicycleService {
  private entity: BicycleEntity | null = null;
  private handle: PlayerBodyHandle | null = null;
  private vehicle: PlanetVehicleController | null = null;
  private terrain: PlanetTerrain | null = null;

  private readonly seatPosition = new THREE.Vector3();
  private readonly dismountPosition = new THREE.Vector3();
  private readonly sideScratch = new THREE.Vector3();

  constructor(private readonly physics: PlanetPhysicsService) {}

  async spawn(scene: THREE.Scene, terrain: PlanetTerrain, dir: THREE.Vector3): Promise<void> {
    this.terrain = terrain;
    const template = await loadBicycleTemplate();

    const up = dir.clone().normalize();
    const position = up.clone().multiplyScalar(terrain.getSurfaceRadius(up)).add(PLANET_CENTER);

    this.entity = new BicycleEntity(template, position);
    // Kolo musí od začátku stát kolmo k povrchu, jinak by na jiné části planety leželo.
    this.entity.applyPhysicsTransform(
      position,
      new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), up)
    );
    scene.add(this.entity.group);

    this.handle = this.physics.createDynamicBoxBody(
      position,
      this.entity.group.quaternion,
      this.entity.colliderHalfExtents,
      this.entity.colliderOriginOffsetY
    );
  }

  getGroup(): THREE.Object3D | null {
    return this.entity?.group ?? null;
  }

  isRiding(): boolean {
    return this.vehicle !== null;
  }

  getSpeedKmh(): number | null {
    if (!this.vehicle) return null;
    return Math.round(Math.abs(this.vehicle.speed) * 3.6 * 10) / 10;
  }

  // `forward` je směr, kam se hráč koukal při nasednutí - jen počáteční hodnota, dál si směr
  // řídí výhradně A/D.
  mount(forward: THREE.Vector3): boolean {
    if (!this.entity || !this.handle || !this.terrain || this.vehicle) return false;
    this.vehicle = new PlanetVehicleController(
      BICYCLE_PROFILE,
      this.terrain,
      this.entity.group.position,
      forward
    );
    // Za jízdy řídí pozici kola vozidlo, ne fyzika.
    this.physics.setKinematic(this.handle);
    return true;
  }

  // Vrací pozici sedla (kam patří kamera), nebo null když se nejede.
  tickRide(delta: number, input: { throttle: number; steer: number }): THREE.Vector3 | null {
    if (!this.vehicle || !this.entity || !this.handle) return null;

    this.vehicle.update(delta, input);
    const { position, quaternion, leanAngle, up } = this.vehicle.getTransform();

    this.physics.setKinematicTarget(this.handle, position, quaternion);
    this.entity.applyPhysicsTransform(position, quaternion);
    this.entity.setLean(leanAngle);

    return this.seatPosition.copy(position).addScaledVector(up, SEAT_HEIGHT);
  }

  // Vrací místo, kam postavit hráče (střed kapsle), nebo null když se nejelo.
  dismount(): THREE.Vector3 | null {
    if (!this.vehicle || !this.entity || !this.handle) return null;

    const { position, up } = this.vehicle.getTransform();
    // Krok do strany od kola - vlevo od směru jízdy.
    this.sideScratch.crossVectors(up, this.vehicle.getForward()).normalize();
    this.dismountPosition
      .copy(position)
      .addScaledVector(this.sideScratch, DISMOUNT_SIDE_OFFSET)
      .addScaledVector(up, FEET_OFFSET);

    this.vehicle = null;
    this.entity.setLean(0);
    // Kolo zůstává stát tam, kde ho jízda nechala, a vrací se do fyziky.
    this.physics.setDynamic(this.handle, new THREE.Vector3(), new THREE.Vector3());
    return this.dismountPosition;
  }

  // Když se nejede, kolo žije ve fyzikálním světě (může se převrátit, sjet ze svahu) -
  // radiální gravitaci na něj přikládá PlanetPhysicsService.
  tick(): void {
    if (this.vehicle || !this.entity || !this.handle) return;
    const { translation, rotation } = this.physics.readHandleTransform(this.handle);
    this.entity.applyPhysicsTransform(translation, rotation);
  }

  dispose(): void {
    this.entity?.group.removeFromParent();
    this.entity = null;
    this.handle = null;
    this.vehicle = null;
    this.terrain = null;
  }
}
