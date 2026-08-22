import * as THREE from 'three';
import type { VehicleProfile } from '../world/vehicle-controller';
import { PlanetTerrain } from './planet-terrain';
import { PLANET_CENTER } from './planet-config';

const Y_AXIS = new THREE.Vector3(0, 1, 0);
const ORIGIN = new THREE.Vector3(0, 0, 0);

function moveTowards(current: number, target: number, maxDelta: number): number {
  if (maxDelta <= 0) return current;
  const diff = target - current;
  if (Math.abs(diff) <= maxDelta) return target;
  return current + Math.sign(diff) * maxDelta;
}

// Kinematický „bicycle model" na kouli.
//
// Skalární dynamika je vzatá 1:1 z VehicleController plochého světa a je záměrně nedotčená -
// řízení, plyn, brzda, dojezd, zpomalení do kopce, volnoběžné zrychlení z kopce, yaw-rate
// z rozvoru i klopení jsou čistě skalární výpočty, kterým je tvar světa lhostejný. Stejně tak
// se přebírá celý VehicleProfile, takže jízdní vlastnosti jsou identické s plochým světem.
//
// Topologicky vázané byly jen čtyři řádky: skalární `heading` integrovaný jako yaw okolo
// *pevné* world-Y osy a z něj odvozený `forward`. Na kouli je „nahoru" funkcí pozice, takže
// heading tu nahradil tangenciální vektor `forward` s paralelním transportem - stejná technika
// jako v planet-player-controller.ts, viz komentář tam, proč yaw/pitch vůči pevné ose selže.
export class PlanetVehicleController {
  readonly position = new THREE.Vector3();
  speed = 0; // signed, m/s - záporné = couvání
  steerAngle = 0; // rad
  leanAngle = 0; // rad

  private readonly forward = new THREE.Vector3();
  private readonly up = new THREE.Vector3();
  private readonly quaternion = new THREE.Quaternion();
  private readonly yawQuaternion = new THREE.Quaternion();
  private readonly lookMatrix = new THREE.Matrix4();
  private readonly tangentScratch = new THREE.Vector3();

  constructor(
    private readonly profile: VehicleProfile,
    private readonly terrain: PlanetTerrain,
    position: THREE.Vector3,
    initialForward: THREE.Vector3
  ) {
    this.position.copy(position);
    this.up.copy(position).sub(PLANET_CENTER).normalize();
    this.forward.copy(initialForward);
    this.projectOntoTangentPlane(this.forward);
    this.snapToSurface();
    this.updateQuaternion();
  }

  // `slope` si controller dopočítá sám z terénu ve směru aktuální jízdy - na rozdíl od ploché
  // verze, kde ho musel dodat volající (tam terén znala jen scéna).
  update(delta: number, input: { throttle: number; steer: number }): void {
    const p = this.profile;

    const targetSteerAngle = THREE.MathUtils.clamp(input.steer, -1, 1) * p.maxSteerAngle;
    this.steerAngle = moveTowards(this.steerAngle, targetSteerAngle, p.steerResponseRate * delta);

    // Sklon ve směru pohybu (při couvání tedy opačným směrem), ne ve směru pohledu.
    const travelSign = Math.sign(this.speed) || 1;
    this.tangentScratch.copy(this.forward).multiplyScalar(travelSign);
    const slope = this.terrain.getSlopeAlongDirection(this.up, this.tangentScratch);

    const uphillSlope = Math.max(0, slope);
    const downhillSlope = Math.max(0, -slope);
    const uphillMultiplier = Math.max(
      p.minUphillSpeedMultiplier,
      1 - p.uphillSlopePenalty * uphillSlope
    );

    const throttle = THREE.MathUtils.clamp(input.throttle, -1, 1);
    let targetSpeed: number;
    let rate: number;
    if (throttle > 0) {
      targetSpeed = p.maxForwardSpeed * throttle * uphillMultiplier;
      rate = this.speed < 0 ? p.brakeDeceleration : p.acceleration;
    } else if (throttle < 0) {
      targetSpeed = -p.maxReverseSpeed * -throttle * uphillMultiplier;
      rate = this.speed > 0 ? p.brakeDeceleration : p.acceleration;
    } else {
      targetSpeed = 0;
      rate = p.rollingResistance;
    }
    this.speed = moveTowards(this.speed, targetSpeed, rate * delta);

    if (downhillSlope > 0) {
      // Zrychlení ve směru aktuálního pohybu (i při couvání z kopce) - proto přes magnitudu
      // se znaménkem, ne přímé přičtení.
      const sign = Math.sign(this.speed) || 1;
      const boosted = Math.min(
        Math.abs(this.speed) + downhillSlope * p.downhillAcceleration * delta,
        p.maxDownhillSpeed
      );
      this.speed = sign * boosted;
    }

    // Nulová rychlost => nulový yaw-rate; na místě se zatáčet nedá ani s plně vytočeným řízením.
    const yawRate = (this.speed / p.wheelBase) * Math.tan(this.steerAngle);

    // Zatáčení je rotace tangenciálního `forward` okolo lokální radiály, ne přírůstek skaláru.
    this.yawQuaternion.setFromAxisAngle(this.up, yawRate * delta);
    this.forward.applyQuaternion(this.yawQuaternion);
    this.projectOntoTangentPlane(this.forward);

    this.position.addScaledVector(this.forward, this.speed * delta);
    this.snapToSurface();
    // Po posunu se změnila radiála, takže `forward` se musí vrátit do nové tečné rovinky -
    // diskrétní paralelní transport (stejně jako u hráče).
    this.projectOntoTangentPlane(this.forward);
    this.updateQuaternion();

    const leanTarget = THREE.MathUtils.clamp(
      -this.steerAngle * (this.speed / p.maxForwardSpeed) * p.leanGain,
      -p.maxLeanAngle,
      p.maxLeanAngle
    );
    this.leanAngle = moveTowards(this.leanAngle, leanTarget, p.leanResponseRate * delta);
  }

  getTransform(): {
    position: THREE.Vector3;
    quaternion: THREE.Quaternion;
    leanAngle: number;
    up: THREE.Vector3;
  } {
    return {
      position: this.position,
      quaternion: this.quaternion,
      leanAngle: this.leanAngle,
      up: this.up
    };
  }

  getForward(): THREE.Vector3 {
    return this.forward;
  }

  // Přisadí kolo na povrch a přepočítá radiálu. Kolo terén neprobíjí ani nelétá - pozice je
  // vždy přímo na povrchu (group.position je u BicycleEntity bod na zemi).
  private snapToSurface(): void {
    this.up.copy(this.position).sub(PLANET_CENTER);
    if (this.up.lengthSq() < 1e-8) this.up.copy(Y_AXIS);
    else this.up.normalize();
    this.position
      .copy(PLANET_CENTER)
      .addScaledVector(this.up, this.terrain.getSurfaceRadius(this.up));
  }

  // Model má po normalizaci „dopředu" v lokálním -Z (viz normalizeBicycleModel), což je přesně
  // konvence Matrix4.lookAt - ta postaví bázi, kde -Z míří na cíl a +Y je zadaný up.
  private updateQuaternion(): void {
    this.lookMatrix.lookAt(ORIGIN, this.forward, this.up);
    this.quaternion.setFromRotationMatrix(this.lookMatrix);
  }

  private projectOntoTangentPlane(vector: THREE.Vector3): void {
    this.tangentScratch.copy(this.up).multiplyScalar(vector.dot(this.up));
    vector.sub(this.tangentScratch);
    if (vector.lengthSq() < 1e-8) {
      vector.copy(Math.abs(this.up.y) > 0.99 ? new THREE.Vector3(1, 0, 0) : Y_AXIS);
      this.tangentScratch.copy(this.up).multiplyScalar(vector.dot(this.up));
      vector.sub(this.tangentScratch);
    }
    vector.normalize();
  }
}
