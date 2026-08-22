import * as THREE from 'three';
import { PlanetPhysicsService, PlayerBodyHandle } from './planet-physics.service';
import { PlanetTerrain } from './planet-terrain';
import {
  EYE_OFFSET,
  FEET_OFFSET,
  GRAVITY,
  JUMP_SPEED,
  MOVE_SPEED,
  PLANET_CENTER
} from './planet-config';

const Y_AXIS = new THREE.Vector3(0, 1, 0);
const ORIGIN = new THREE.Vector3(0, 0, 0);
const MAX_PITCH = (89 * Math.PI) / 180;
// Delta se stropuje, aby jeden extrémně dlouhý frame (tab bez fokusu) neposlal hráče
// skokem přes půl planety.
//
// Pozn.: pohyb hráče běží per-frame s touhle klampnutou deltou, zatímco fyzika krokuje
// pevných 1/60 (viz PlanetPhysicsService.step). Je to tedy frame-rate závislé, ale pohyb je
// takhle odladěný a přepis na fixed-step by ho rozladil bez zisku - vědomé zjednodušení.
const MAX_DELTA = 1 / 30;
const LOOK_RADIANS_PER_PIXEL = 0.002;

// Pohyb hráče po kouli.
//
// Proč nejde použít PointerLockControls: dělá `_euler.setFromQuaternion(camera.quaternion,
// 'YXZ')` a zpátky - tedy rozklad na yaw/pitch vůči *pevné* world-Y ose. Na kouli je "nahoru"
// funkcí pozice, takže by se rozhlížení lámalo všude, kde se lokální up od world-Y liší.
//
// Řešení: místo yaw/pitch vůči pevné ose si držíme tangenciální vektor `forward` a každý frame
// ho jen znovu srovnáme do tečné rovinky aktuálního `up`. To je diskrétní paralelní transport -
// nikdy neodkazuje na žádnou globální osu, jen na předchozí frame, takže funguje identicky
// na pólech, u pětiúhelníků i na antipodu.
export class PlanetPlayerController {
  private readonly position = new THREE.Vector3();
  private readonly forward = new THREE.Vector3();
  private pitch = 0;
  private radialVelocity = 0;
  private groundedFlag = false;

  // Nasbírané pohyby myši za frame - konzumují se v tick(), aby se yaw otáčel okolo `up`
  // platného pro tenhle frame, ne okolo toho z doby doručení eventu.
  private pendingYaw = 0;
  private pendingPitch = 0;

  private readonly up = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly lookDir = new THREE.Vector3();
  private readonly desired = new THREE.Vector3();
  private readonly rotation = new THREE.Quaternion();
  private readonly yawQuat = new THREE.Quaternion();
  private readonly lookMatrix = new THREE.Matrix4();
  private readonly tangentScratch = new THREE.Vector3();

  constructor(
    private readonly physics: PlanetPhysicsService,
    private readonly terrain: PlanetTerrain,
    private readonly handle: PlayerBodyHandle,
    spawnPosition: THREE.Vector3,
    // Záchytka pro hlavní riziko prototypu: kdyby se Rapier character controller na
    // zakřiveném trimeshi s měnícím se `up` chovalo divně, tímhle se přepne na přímé
    // analytické přisazení k povrchu a je hned vidět, jestli je problém v controlleru,
    // nebo v transportu rámce výš.
    private useRapierController = true
  ) {
    this.position.copy(spawnPosition);
    this.up.copy(spawnPosition).sub(PLANET_CENTER).normalize();
    // Startovní `forward` = libovolný vektor tečný k povrchu. Vezmeme world-Y a odečteme
    // radiální složku; kdyby byl spawn přesně na "Y pólu" (a tedy up ~ Y), vezmeme X.
    this.forward.copy(Y_AXIS);
    if (Math.abs(this.forward.dot(this.up)) > 0.99) this.forward.set(1, 0, 0);
    this.projectOntoTangentPlane(this.forward);
  }

  get grounded(): boolean {
    return this.groundedFlag;
  }

  setUseRapierController(value: boolean): void {
    this.useRapierController = value;
  }

  isUsingRapierController(): boolean {
    return this.useRapierController;
  }

  // `deltaX/deltaY` už jsou přenásobené citlivostí (viz PlanetInputService.consumeLookDelta).
  addLookDelta(deltaX: number, deltaY: number): void {
    // Stejná konvence jako PointerLockControls: 0.002 rad na pixel.
    this.pendingYaw -= deltaX * LOOK_RADIANS_PER_PIXEL;
    this.pendingPitch -= deltaY * LOOK_RADIANS_PER_PIXEL;
  }

  jump(): void {
    if (this.groundedFlag) {
      this.radialVelocity = JUMP_SPEED;
      this.groundedFlag = false;
    }
  }

  teleportTo(position: THREE.Vector3): void {
    this.position.copy(position);
    this.radialVelocity = 0;
    this.groundedFlag = false;
    this.physics.teleportPlayer(this.handle, this.position);
  }

  // Rozhlížení a tečná báze - společné pro chůzi i jízdu.
  private updateOrientationFrame(): void {
    // 1. Lokální "nahoru" = radiála z středu planety.
    this.up.copy(this.position).sub(PLANET_CENTER);
    if (this.up.lengthSq() < 1e-6) this.up.copy(Y_AXIS);
    else this.up.normalize();

    // 2. Srovnat `forward` do tečné roviny nového `up` (hráč se od minulého framu pohnul,
    // takže starý forward už v ní přesně neleží).
    this.projectOntoTangentPlane(this.forward);

    // 3. Konzumovat myš: yaw je rotace forward okolo up, pitch je jen skalár.
    if (this.pendingYaw !== 0) {
      this.yawQuat.setFromAxisAngle(this.up, this.pendingYaw);
      this.forward.applyQuaternion(this.yawQuat);
      this.projectOntoTangentPlane(this.forward);
      this.pendingYaw = 0;
    }
    if (this.pendingPitch !== 0) {
      this.pitch = THREE.MathUtils.clamp(this.pitch + this.pendingPitch, -MAX_PITCH, MAX_PITCH);
      this.pendingPitch = 0;
    }

    // 4. Tečná báze. `right` a `forward` jsou nezávislé na pitchi, takže pohled nahoru
    // nezpomaluje chůzi (stejná vlastnost jako moveForwardVector v plochém světě).
    this.right.crossVectors(this.forward, this.up).normalize();
    this.lookDir
      .copy(this.forward)
      .multiplyScalar(Math.cos(this.pitch))
      .addScaledVector(this.up, Math.sin(this.pitch));
  }

  private applyCameraOrientation(camera: THREE.Camera): void {
    camera.up.copy(this.up);
    this.lookMatrix.lookAt(ORIGIN, this.lookDir, this.up);
    camera.quaternion.setFromRotationMatrix(this.lookMatrix);
  }

  // Za jízdy hráč neřídí svou pozici ani gravitaci - tu má vozidlo. Zůstává jen rozhlížení,
  // takže se A/D nepřetahuje mezi kamerou a řízením kola (stejná konvence jako v plochém
  // světě, viz RideConfig).
  tickWhileRiding(anchorPosition: THREE.Vector3, camera: THREE.Camera): void {
    this.position.copy(anchorPosition);
    this.radialVelocity = 0;
    this.groundedFlag = true;
    this.updateOrientationFrame();
    this.applyCameraOrientation(camera);
  }

  // Kam se hráč vodorovně kouká - kolo z toho bere počáteční směr jízdy při nasednutí.
  getForward(): THREE.Vector3 {
    return this.forward;
  }

  tick(delta: number, pressedKeys: ReadonlySet<string>, camera: THREE.Camera): void {
    const dt = Math.min(delta, MAX_DELTA);

    this.updateOrientationFrame();

    // 5. WASD v tečné rovině.
    let forwardAmount = 0;
    let rightAmount = 0;
    if (pressedKeys.has('KeyW')) forwardAmount += 1;
    if (pressedKeys.has('KeyS')) forwardAmount -= 1;
    if (pressedKeys.has('KeyD')) rightAmount += 1;
    if (pressedKeys.has('KeyA')) rightAmount -= 1;

    this.desired.set(0, 0, 0);
    if (forwardAmount !== 0 || rightAmount !== 0) {
      this.desired
        .addScaledVector(this.forward, forwardAmount)
        .addScaledVector(this.right, rightAmount)
        // Normalizace, aby diagonála nebyla rychlejší.
        .normalize()
        .multiplyScalar(MOVE_SPEED * dt);
    }

    // 6. Radiální gravitace. Rapier ji hráči neaplikuje sám - character controller dělá jen
    // collide-and-slide, takže si ji integrujeme do požadovaného posunu.
    this.radialVelocity -= GRAVITY * dt;
    this.desired.addScaledVector(this.up, this.radialVelocity * dt);

    if (this.useRapierController) {
      this.moveWithRapier();
    } else {
      this.moveAnalytically();
    }

    // 7. Kapsli srovnat s radiálou: Rapier capsule(halfHeight, radius) je podél lokální Y,
    // takže bez tohohle by hráč po přemístění na jinou část planety ležel na boku.
    this.rotation.setFromUnitVectors(Y_AXIS, this.up);
    this.physics.setPlayerTransform(this.handle, this.position, this.rotation);

    // 8. Kamera: oči nad středem kapsle podél radiály, orientace z tečné báze.
    camera.position.copy(this.position).addScaledVector(this.up, EYE_OFFSET);
    this.applyCameraOrientation(camera);
  }

  private moveWithRapier(): void {
    const result = this.physics.moveCharacter(this.handle, this.desired, this.up);
    this.position.add(result.movement);
    this.groundedFlag = result.grounded;
    if (result.grounded && this.radialVelocity < 0) this.radialVelocity = 0;
  }

  // Analytická varianta: povrch je daný funkcí směru, takže "kde je zem" se dá spočítat
  // přímo, bez collideru. Žádné horizontální kolize (v prototypu nejsou žádné překážky).
  private moveAnalytically(): void {
    this.position.add(this.desired);
    this.up.copy(this.position).sub(PLANET_CENTER).normalize();
    const groundDistance = this.terrain.getSurfaceRadius(this.up) + FEET_OFFSET;
    const distance = this.position.distanceTo(PLANET_CENTER);
    if (distance <= groundDistance) {
      this.position.copy(PLANET_CENTER).addScaledVector(this.up, groundDistance);
      this.radialVelocity = 0;
      this.groundedFlag = true;
    } else {
      this.groundedFlag = false;
    }
  }

  // Odečte radiální složku, takže vektor zůstane tečný k povrchu.
  private projectOntoTangentPlane(vector: THREE.Vector3): void {
    this.tangentScratch.copy(this.up).multiplyScalar(vector.dot(this.up));
    vector.sub(this.tangentScratch);
    // Degenerace (vektor se stal rovnoběžným s up) je jinak neopravitelná - vybereme
    // náhradní tečný směr, ať kontrolér nikdy neskončí s nulovým forwardem.
    if (vector.lengthSq() < 1e-8) {
      vector.copy(Math.abs(this.up.y) > 0.99 ? new THREE.Vector3(1, 0, 0) : Y_AXIS);
      this.tangentScratch.copy(this.up).multiplyScalar(vector.dot(this.up));
      vector.sub(this.tangentScratch);
    }
    vector.normalize();
  }
}
