import { Injectable } from '@angular/core';
import * as THREE from 'three';
import type * as RapierNS from '@dimforge/rapier3d-compat';
import { PlanetSurface } from './planet-mesh-builder';
import {
  AUTOSTEP_MAX_HEIGHT,
  AUTOSTEP_MIN_WIDTH,
  CHARACTER_OFFSET,
  GRAVITY,
  MAX_SLOPE_CLIMB_ANGLE,
  MIN_SLOPE_SLIDE_ANGLE,
  PLANET_CENTER,
  PLAYER_CAPSULE_HALF_HEIGHT,
  PLAYER_CAPSULE_RADIUS,
  SNAP_TO_GROUND_DISTANCE
} from './planet-config';

const FIXED_TIMESTEP = 1 / 60;
const MAX_STEPS_PER_TICK = 5;
const Y_AXIS = new THREE.Vector3(0, 1, 0);

export interface PlayerBodyHandle {
  readonly rigidBody: RapierNS.RigidBody;
  readonly collider: RapierNS.Collider;
}

export interface CharacterMoveResult {
  readonly movement: THREE.Vector3;
  readonly grounded: boolean;
}

// Vlastní Rapier svět pro planetku, oddělený od PhysicsService plochého světa.
//
// Proč sibling a ne reuse: PhysicsService.init(heightGrid, gravity) je natvrdo svázaný
// s plochým světem - bere HeightGrid, hned z něj staví heightfield collider a nastavuje
// gravitaci jako {0,-g,0}. Tady potřebujeme nulovou world gravitaci (radiální se aplikuje
// per-body) a trimesh povrch. Duplikuje se tím bootstrap (dynamický import + akumulátor);
// až prototyp projde, dá se vytáhnout do společného základu.
@Injectable({ providedIn: 'root' })
export class PlanetPhysicsService {
  private RAPIER!: typeof RapierNS;
  private world!: RapierNS.World;
  private characterController!: RapierNS.KinematicCharacterController;
  private accumulator = 0;

  // Dynamická tělesa, kterým se každý krok přikládá radiální gravitace.
  private readonly gravityBodies: RapierNS.RigidBody[] = [];

  private readonly computedMovement = new THREE.Vector3();
  private readonly bodyUp = new THREE.Vector3();
  private readonly forceScratch = new THREE.Vector3();

  // Dynamický import - balíček nese WASM jako base64 (řádově MB), statický import by ho
  // natáhl do initial bundlu (stejný důvod jako v PhysicsService).
  async init(surface: PlanetSurface): Promise<void> {
    this.RAPIER = await import('@dimforge/rapier3d-compat');
    await this.RAPIER.init();

    // Nulová gravitace ve světě: na planetě není žádný globální "dolů". Každé tělo dostává
    // vlastní radiální sílu (viz applyRadialGravity), hráč si ji integruje sám.
    this.world = new this.RAPIER.World({ x: 0, y: 0, z: 0 });
    this.world.timestep = FIXED_TIMESTEP;
    this.accumulator = 0;
    this.gravityBodies.length = 0;

    this.buildSurfaceCollider(surface);

    this.characterController = this.world.createCharacterController(CHARACTER_OFFSET);
    this.characterController.setUp({ x: 0, y: 1, z: 0 });
    this.characterController.setSlideEnabled(true);
    this.characterController.setMaxSlopeClimbAngle(MAX_SLOPE_CLIMB_ANGLE);
    this.characterController.setMinSlopeSlideAngle(MIN_SLOPE_SLIDE_ANGLE);
    this.characterController.enableAutostep(AUTOSTEP_MAX_HEIGHT, AUTOSTEP_MIN_WIDTH, true);
    this.characterController.enableSnapToGround(SNAP_TO_GROUND_DISTANCE);
    this.characterController.setApplyImpulsesToDynamicBodies(true);
  }

  // Rapier heightfield je definovaný nad pravoúhlou mřížkou, takže na kouli nejde použít -
  // povrch planety musí být trimesh. Vstup je přímo pole z mesh builderu, aby se fyzika
  // a vizuál nemohly rozejít.
  private buildSurfaceCollider(surface: PlanetSurface): void {
    const body = this.world.createRigidBody(this.RAPIER.RigidBodyDesc.fixed());
    this.world.createCollider(
      this.RAPIER.ColliderDesc.trimesh(surface.positions, surface.indices),
      body
    );
  }

  createPlayer(position: THREE.Vector3): PlayerBodyHandle {
    const rigidBody = this.world.createRigidBody(
      this.RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
        position.x,
        position.y,
        position.z
      )
    );
    const collider = this.world.createCollider(
      this.RAPIER.ColliderDesc.capsule(PLAYER_CAPSULE_HALF_HEIGHT, PLAYER_CAPSULE_RADIUS),
      rigidBody
    );
    return { rigidBody, collider };
  }

  // `up` se předává každý frame, protože na kouli se "nahoru" mění s pozicí hráče - přesně
  // pro tohle má Rapier setUp() jako nastavitelný parametr (určuje, kde je podlaha a jaký
  // má sklon).
  moveCharacter(
    handle: PlayerBodyHandle,
    desiredTranslation: THREE.Vector3,
    up: THREE.Vector3
  ): CharacterMoveResult {
    this.characterController.setUp(up);
    this.characterController.computeColliderMovement(handle.collider, desiredTranslation);
    const movement = this.characterController.computedMovement();
    this.computedMovement.set(movement.x, movement.y, movement.z);
    return {
      movement: this.computedMovement,
      grounded: this.characterController.computedGrounded()
    };
  }

  setPlayerTransform(handle: PlayerBodyHandle, position: THREE.Vector3, rotation: THREE.Quaternion): void {
    handle.rigidBody.setNextKinematicTranslation(position);
    handle.rigidBody.setNextKinematicRotation(rotation);
  }

  // Teleport (respawn) - u kinematického těla musí jít přes setTranslation, ne
  // setNextKinematicTranslation, jinak by se mezi pozicemi interpoloval pohyb.
  teleportPlayer(handle: PlayerBodyHandle, position: THREE.Vector3): void {
    handle.rigidBody.setTranslation(position, true);
  }

  readPlayerPosition(handle: PlayerBodyHandle, target: THREE.Vector3): THREE.Vector3 {
    const t = handle.rigidBody.translation();
    return target.set(t.x, t.y, t.z);
  }

  // Statický válec pro kmen stromu. Na rozdíl od plochého světa, kde stačí translace
  // (PhysicsService.createStaticTreeCollider staví válec podél world Y), tady musí být tělo
  // otočené podle radiály - Rapier `cylinder` je vždy podél lokální Y, takže bez rotace by
  // kmeny na jiných částech planety ležely na boku.
  //
  // Collider je lokálně posunutý o height/2, aby origin těla byl u paty kmene (stejná
  // konvence jako v plochém světě).
  createStaticTreeCollider(
    position: THREE.Vector3,
    up: THREE.Vector3,
    radius: number,
    height: number
  ): RapierNS.RigidBody {
    const rotation = new THREE.Quaternion().setFromUnitVectors(Y_AXIS, up);
    const body = this.world.createRigidBody(
      this.RAPIER.RigidBodyDesc.fixed()
        .setTranslation(position.x, position.y, position.z)
        .setRotation(rotation)
    );
    this.world.createCollider(
      this.RAPIER.ColliderDesc.cylinder(height / 2, radius).setTranslation(0, height / 2, 0),
      body
    );
    return body;
  }

  removeBody(body: RapierNS.RigidBody): void {
    this.world.removeRigidBody(body);
  }

  // Testovací dynamická tělesa - ověřují, že radiální gravitace funguje i pro ne-hráčská
  // tělesa (to je vlastní důkaz rozšiřitelnosti pro budoucí stromy/objekty).
  createDynamicBox(position: THREE.Vector3, halfExtent: number): RapierNS.RigidBody {
    const rigidBody = this.world.createRigidBody(
      this.RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(position.x, position.y, position.z)
        .setLinearDamping(0.2)
        .setAngularDamping(0.4)
        .setCcdEnabled(true)
    );
    this.world.createCollider(
      this.RAPIER.ColliderDesc.cuboid(halfExtent, halfExtent, halfExtent),
      rigidBody
    );
    this.gravityBodies.push(rigidBody);
    return rigidBody;
  }

  // Obecný dynamický box - kolo a další budoucí uchopitelné/pojezdné objekty. Origin těla je
  // bod na zemi (spodek objektu), collider je lokálně posunutý o originOffsetY - stejná
  // konvence jako v plochém světě, aby se dala použít táž entita (BicycleEntity).
  createDynamicBoxBody(
    position: THREE.Vector3,
    rotation: THREE.Quaternion,
    halfExtents: THREE.Vector3,
    originOffsetY = 0
  ): PlayerBodyHandle {
    const rigidBody = this.world.createRigidBody(
      this.RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(position.x, position.y, position.z)
        .setRotation(rotation)
        .setLinearDamping(0.5)
        .setAngularDamping(0.5)
        .setCcdEnabled(true)
    );
    const collider = this.world.createCollider(
      this.RAPIER.ColliderDesc.cuboid(halfExtents.x, halfExtents.y, halfExtents.z).setTranslation(
        0,
        originOffsetY,
        0
      ),
      rigidBody
    );
    // Dokud tělo není kinematické (za jízdy), musí na něj působit radiální gravitace.
    this.gravityBodies.push(rigidBody);
    return { rigidBody, collider };
  }

  setKinematic(handle: PlayerBodyHandle): void {
    handle.rigidBody.setBodyType(this.RAPIER.RigidBodyType.KinematicPositionBased, true);
  }

  setDynamic(handle: PlayerBodyHandle, linvel: THREE.Vector3, angvel: THREE.Vector3): void {
    handle.rigidBody.setBodyType(this.RAPIER.RigidBodyType.Dynamic, true);
    handle.rigidBody.setLinvel(linvel, true);
    handle.rigidBody.setAngvel(angvel, true);
  }

  setKinematicTarget(
    handle: PlayerBodyHandle,
    translation: THREE.Vector3,
    rotation: THREE.Quaternion
  ): void {
    handle.rigidBody.setNextKinematicTranslation(translation);
    handle.rigidBody.setNextKinematicRotation(rotation);
  }

  readHandleTransform(handle: PlayerBodyHandle): {
    translation: THREE.Vector3Like;
    rotation: THREE.QuaternionLike;
  } {
    return { translation: handle.rigidBody.translation(), rotation: handle.rigidBody.rotation() };
  }

  readBodyTransform(body: RapierNS.RigidBody): {
    translation: THREE.Vector3Like;
    rotation: THREE.QuaternionLike;
  } {
    return { translation: body.translation(), rotation: body.rotation() };
  }

  step(delta: number): void {
    this.accumulator += delta;
    let steps = 0;
    while (this.accumulator >= FIXED_TIMESTEP && steps < MAX_STEPS_PER_TICK) {
      // Síly Rapier po každém kroku nuluje, takže se musí přiložit uvnitř smyčky, ne jednou
      // za frame - jinak by při více krocích na frame gravitace působila jen v prvním.
      this.applyRadialGravity();
      this.world.step();
      this.accumulator -= FIXED_TIMESTEP;
      steps++;
    }
  }

  private applyRadialGravity(): void {
    for (const body of this.gravityBodies) {
      const t = body.translation();
      this.bodyUp.set(t.x, t.y, t.z).sub(PLANET_CENTER);
      // Přesně ve středu planety není radiála definovaná - tam gravitaci prostě vynecháme.
      if (this.bodyUp.lengthSq() < 1e-6) continue;
      this.bodyUp.normalize();
      this.forceScratch.copy(this.bodyUp).multiplyScalar(-GRAVITY * body.mass());
      body.addForce(this.forceScratch, true);
    }
  }

  dispose(): void {
    this.gravityBodies.length = 0;
    this.world?.free();
  }
}
