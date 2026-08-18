import { Injectable } from '@angular/core';
import * as THREE from 'three';
import type * as RapierNS from '@dimforge/rapier3d-compat';
import { HeightGrid } from '../world/terrain-generator';

const FIXED_TIMESTEP = 1 / 60;
// Zábrana proti "spirále smrti" - kdyby jeden frame trval extrémně dlouho (např. tab přišel
// o fokus), nedohánět fyziku desítkami kroků najednou, ale radši ji nechat na pár snímků zpomalit.
const MAX_STEPS_PER_TICK = 5;

export interface FallenLogHandle {
  readonly rigidBody: RapierNS.RigidBody;
  readonly collider: RapierNS.Collider;
}

@Injectable({ providedIn: 'root' })
export class PhysicsService {
  private RAPIER!: typeof RapierNS;
  private world!: RapierNS.World;
  private accumulator = 0;

  // Dynamický import - balíček nese WASM zabalené jako base64 (řádově MB), statický import
  // by ho natáhl do initial bundlu a rozbil produkční budget v angular.json.
  async init(heightGrid: HeightGrid, gravity: number): Promise<void> {
    this.RAPIER = await import('@dimforge/rapier3d-compat');
    await this.RAPIER.init();
    this.world = new this.RAPIER.World({ x: 0, y: -gravity, z: 0 });
    this.world.timestep = FIXED_TIMESTEP;
    this.accumulator = 0;
    this.buildTerrainHeightfield(heightGrid);
  }

  // Rapier interně krokuje s pevným timestepem bez ohledu na argument step() - akumulátor
  // zajistí, že fyzika běží konzistentně nezávisle na FPS (stejný princip jako ruční
  // "velocityY -= GRAVITY * delta" u hráče, jen realizovaný přes opakované pevné kroky).
  step(delta: number): void {
    this.accumulator += delta;
    let steps = 0;
    while (this.accumulator >= FIXED_TIMESTEP && steps < MAX_STEPS_PER_TICK) {
      this.world.step();
      this.accumulator -= FIXED_TIMESTEP;
      steps++;
    }
  }

  // Vrací rigid body, aby šlo strom po pokácení zase odstranit (viz removeRigidBody) -
  // dál by ve fyzikálním světě zůstával "fantomový" svislý válec v místě, kde už žádný
  // stojící kmen není.
  createStaticTreeCollider(x: number, y: number, z: number, radius: number, height: number): RapierNS.RigidBody {
    const body = this.world.createRigidBody(this.RAPIER.RigidBodyDesc.fixed().setTranslation(x, y, z));
    this.world.createCollider(
      this.RAPIER.ColliderDesc.cylinder(height / 2, radius).setTranslation(0, height / 2, 0),
      body
    );
    return body;
  }

  removeRigidBody(body: RapierNS.RigidBody): void {
    this.world.removeRigidBody(body);
  }

  createStaticBoxCollider(
    x: number,
    y: number,
    z: number,
    halfExtents: { x: number; y: number; z: number }
  ): RapierNS.RigidBody {
    const body = this.world.createRigidBody(this.RAPIER.RigidBodyDesc.fixed().setTranslation(x, y, z));
    this.world.createCollider(
      this.RAPIER.ColliderDesc.cuboid(halfExtents.x, halfExtents.y, halfExtents.z),
      body
    );
    return body;
  }

  // Origin těla = báze kmene (stejná konvence jako `TreeEntity.group.position`), collider je
  // lokálně posunutý o trunkHeight/2 - Rapier si z posunutého colideru sám spočítá setrvačnost.
  createFallenLogBody(
    position: THREE.Vector3,
    rotation: THREE.Quaternion,
    radius: number,
    trunkHeight: number
  ): FallenLogHandle {
    const bodyDesc = this.RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(position.x, position.y, position.z)
      .setRotation(rotation)
      .setLinearDamping(0.5)
      .setAngularDamping(0.5)
      .setCcdEnabled(true);
    const rigidBody = this.world.createRigidBody(bodyDesc);
    const colliderDesc = this.RAPIER.ColliderDesc.cylinder(trunkHeight / 2, radius).setTranslation(
      0,
      trunkHeight / 2,
      0
    );
    const collider = this.world.createCollider(colliderDesc, rigidBody);
    return { rigidBody, collider };
  }

  // Obecná verze createFallenLogBody pro box tvary (kolo a další budoucí "mount"/grab
  // objekty) - origin těla je bod na zemi (spodek objektu), collider je lokálně posunutý
  // o originOffsetY (typicky halfExtents.y), stejná konvence jako trunkHeight/2 u kmene.
  createDynamicBoxBody(
    position: THREE.Vector3,
    rotation: THREE.Quaternion,
    halfExtents: THREE.Vector3,
    originOffsetY = 0
  ): FallenLogHandle {
    const bodyDesc = this.RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(position.x, position.y, position.z)
      .setRotation(rotation)
      .setLinearDamping(0.5)
      .setAngularDamping(0.5)
      .setCcdEnabled(true);
    const rigidBody = this.world.createRigidBody(bodyDesc);
    const colliderDesc = this.RAPIER.ColliderDesc.cuboid(
      halfExtents.x,
      halfExtents.y,
      halfExtents.z
    ).setTranslation(0, originOffsetY, 0);
    const collider = this.world.createCollider(colliderDesc, rigidBody);
    return { rigidBody, collider };
  }

  setKinematic(handle: FallenLogHandle): void {
    handle.rigidBody.setBodyType(this.RAPIER.RigidBodyType.KinematicPositionBased, true);
  }

  setDynamic(handle: FallenLogHandle, linvel: THREE.Vector3, angvel?: THREE.Vector3): void {
    handle.rigidBody.setBodyType(this.RAPIER.RigidBodyType.Dynamic, true);
    handle.rigidBody.setLinvel(linvel, true);
    handle.rigidBody.setAngvel(angvel ?? { x: 0, y: 0, z: 0 }, true);
  }

  setKinematicTarget(handle: FallenLogHandle, translation: THREE.Vector3, rotation: THREE.Quaternion): void {
    handle.rigidBody.setNextKinematicTranslation(translation);
    handle.rigidBody.setNextKinematicRotation(rotation);
  }

  readTransform(handle: FallenLogHandle): { translation: THREE.Vector3Like; rotation: THREE.QuaternionLike } {
    return { translation: handle.rigidBody.translation(), rotation: handle.rigidBody.rotation() };
  }

  removeBody(handle: FallenLogHandle): void {
    this.world.removeRigidBody(handle.rigidBody);
  }

  private buildTerrainHeightfield(heightGrid: HeightGrid): void {
    // Pozor, obráceně než by se čekalo: empiricky ověřeno (viz debug session) - Rapier
    // heightfield(nrows, ncols, ...) má `nrows` podél lokální Z a `ncols` podél lokální X,
    // ne naopak. Se záměnou tvrdě sedí kolize jen na části mapy (zbytek se propadá).
    const nrows = heightGrid.segmentsZ;
    const ncols = heightGrid.segmentsX;
    const heights = new Float32Array((nrows + 1) * (ncols + 1));
    // Column-major: heights[col * (nrows+1) + row], col ~ lokální X, row ~ lokální Z.
    // Svět je vycentrovaný na (0,0), stejně jako vykreslovaný terén v ThreeSceneService.buildScene().
    // Hodnoty čteme z heightGrid předpočítaného jednou v ThreeSceneService.init() - žádný
    // další noise výpočet zde.
    for (let col = 0; col <= ncols; col++) {
      for (let row = 0; row <= nrows; row++) {
        heights[col * (nrows + 1) + row] = heightGrid.getHeightAt(col, row);
      }
    }

    const body = this.world.createRigidBody(this.RAPIER.RigidBodyDesc.fixed());
    this.world.createCollider(
      this.RAPIER.ColliderDesc.heightfield(nrows, ncols, heights, {
        x: heightGrid.width,
        y: 1,
        z: heightGrid.depth
      }),
      body
    );
  }
}
