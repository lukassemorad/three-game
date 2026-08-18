import * as THREE from 'three';

// Ladicí parametry jednoho typu vozidla (kolo, později auto apod.) - viz VehicleController
// níže pro to, jak se používají.
export interface VehicleProfile {
  readonly maxForwardSpeed: number; // m/s
  readonly maxReverseSpeed: number; // m/s (kladné číslo, couvání je speed < 0)
  readonly acceleration: number; // m/s^2 při plynu vpřed/vzad
  readonly brakeDeceleration: number; // m/s^2 při brždění (opačný throttle než aktuální pohyb)
  readonly rollingResistance: number; // m/s^2 dojezd bez sešlápnutého plynu
  readonly maxSteerAngle: number; // rad, max úhel natočení řízení
  readonly steerResponseRate: number; // rad/s, jak rychle řízení dohání cílový úhel
  readonly wheelBase: number; // m, rozvor pro yaw-rate výpočet (kinematický bicycle model)
  readonly leanGain: number; // násobí cílový náklon odvozený ze zatáčení a rychlosti
  readonly maxLeanAngle: number; // rad
  readonly leanResponseRate: number; // rad/s, tlumení náklonu
  readonly uphillSlopePenalty: number; // jak moc sklon do kopce snižuje dosažitelnou rychlost
  readonly minUphillSpeedMultiplier: number; // dolní mez multiplikátoru rychlosti do kopce
  readonly downhillAcceleration: number; // m/s^2 zrychlení navíc na jednotku sklonu z kopce (volnoběh)
  readonly maxDownhillSpeed: number; // m/s, tvrdý strop rychlosti z kopce - smí překročit maxForwardSpeed
}

const UP = new THREE.Vector3(0, 1, 0);
const LOCAL_FORWARD = new THREE.Vector3(0, 0, -1);

function moveTowards(current: number, target: number, maxDelta: number): number {
  if (maxDelta <= 0) return current;
  const diff = target - current;
  if (Math.abs(diff) <= maxDelta) return target;
  return current + Math.sign(diff) * maxDelta;
}

// Kinematický "bicycle model" - stejný přístup se běžně používá i pro auta (rozvor je
// vzdálenost mezi přední a zadní nápravou), takže tahle třída je záměrně obecná a
// znovupoužitelná pro budoucí vozidla, ne jen pro kolo. Vlastník (např. BicycleService) si
// jen zavolá update() každý frame se syrovými vstupy (throttle/steer, oba -1..1) a přečte
// getTransform() pro výsledné umístění.
export class VehicleController {
  readonly position: THREE.Vector3;
  heading: number; // yaw v radiánech
  speed = 0; // signed, m/s - záporné = couvání
  steerAngle = 0; // rad
  leanAngle = 0; // rad

  private readonly quaternion = new THREE.Quaternion();
  private readonly forward = new THREE.Vector3();

  constructor(
    private readonly profile: VehicleProfile,
    position: THREE.Vector3,
    heading: number
  ) {
    this.position = position.clone();
    this.heading = heading;
  }

  // slope je signed sklon terénu ve směru aktuální jízdy (kladné = do kopce, záporné = z
  // kopce) - volající ho sám dopočítá z terénu pro aktuální směr (viz getForward() a
  // ThreeSceneService.getSlopeAlongDirection), tahle třída terén nezná. Do kopce se
  // zesláblá dosažitelná rychlost chová stejně jako chůze; z kopce naopak i bez plynu
  // zrychluje gravitace (volnoběh), až po maxDownhillSpeed.
  update(delta: number, input: { throttle: number; steer: number }, slope = 0): void {
    const p = this.profile;

    const targetSteerAngle = THREE.MathUtils.clamp(input.steer, -1, 1) * p.maxSteerAngle;
    this.steerAngle = moveTowards(this.steerAngle, targetSteerAngle, p.steerResponseRate * delta);

    const uphillSlope = Math.max(0, slope);
    const downhillSlope = Math.max(0, -slope);
    const uphillMultiplier = Math.max(p.minUphillSpeedMultiplier, 1 - p.uphillSlopePenalty * uphillSlope);

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
      // Zrychlení se přičítá ve směru aktuálního pohybu (i při couvání z kopce), ne jen
      // dopředu - proto přes magnitudu se znaménkem, ne přímé přičtení k this.speed.
      const travelSign = Math.sign(this.speed) || 1;
      const boostedMagnitude = Math.min(
        Math.abs(this.speed) + downhillSlope * p.downhillAcceleration * delta,
        p.maxDownhillSpeed
      );
      this.speed = travelSign * boostedMagnitude;
    }

    // Nulová rychlost => nulový yaw-rate, i při plně vytočeném řízení nelze zatáčet na místě.
    const yawRate = (this.speed / p.wheelBase) * Math.tan(this.steerAngle);
    this.heading += yawRate * delta;

    this.quaternion.setFromAxisAngle(UP, this.heading);
    this.forward.copy(LOCAL_FORWARD).applyQuaternion(this.quaternion);
    this.position.addScaledVector(this.forward, this.speed * delta);

    const leanTarget = THREE.MathUtils.clamp(
      -this.steerAngle * (this.speed / p.maxForwardSpeed) * p.leanGain,
      -p.maxLeanAngle,
      p.maxLeanAngle
    );
    this.leanAngle = moveTowards(this.leanAngle, leanTarget, p.leanResponseRate * delta);
  }

  getTransform(): { position: THREE.Vector3; quaternion: THREE.Quaternion; leanAngle: number } {
    return { position: this.position, quaternion: this.quaternion, leanAngle: this.leanAngle };
  }

  // Aktuální směr jízdy (world-space, y=0) - použij k dopočtu sklonu terénu v tomhle směru
  // (viz slope parametr update() a ThreeSceneService.getSlopeAlongDirection).
  getForward(): THREE.Vector3 {
    return this.forward.clone();
  }
}
