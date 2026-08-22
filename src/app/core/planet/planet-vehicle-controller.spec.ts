import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { VehicleProfile } from '../world/vehicle-controller';
import { PlanetTerrain } from './planet-terrain';
import { PlanetVehicleController } from './planet-vehicle-controller';
import { PLANET_CENTER } from './planet-config';

// Stejný profil jako kolo ve hře - jízdní vlastnosti se přebírají z plochého světa, takže
// testy zároveň hlídají, že se ten přenos nerozbil.
const PROFILE: VehicleProfile = {
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

const DT = 1 / 60;
const terrain = new PlanetTerrain();

function createVehicle(): PlanetVehicleController {
  const dir = new THREE.Vector3(0.3, 0.8, 0.5).normalize();
  const position = dir.clone().multiplyScalar(terrain.getSurfaceRadius(dir)).add(PLANET_CENTER);
  // Startovní směr jen musí být tečný - controller si ho sám promítne do tečné roviny.
  const forward = new THREE.Vector3(1, 0, 0);
  return new PlanetVehicleController(PROFILE, terrain, position, forward);
}

function ride(
  vehicle: PlanetVehicleController,
  steps: number,
  input: { throttle: number; steer: number }
): void {
  for (let i = 0; i < steps; i++) vehicle.update(DT, input);
}

describe('PlanetVehicleController', () => {
  it('drží kolo na povrchu, ne nad ním ani v něm', () => {
    const vehicle = createVehicle();
    ride(vehicle, 600, { throttle: 1, steer: 0.3 });
    const up = vehicle.position.clone().sub(PLANET_CENTER).normalize();
    expect(vehicle.position.distanceTo(PLANET_CENTER)).toBeCloseTo(
      terrain.getSurfaceRadius(up),
      6
    );
  });

  it('`forward` zůstává tečný k povrchu', () => {
    const vehicle = createVehicle();
    for (let i = 0; i < 400; i++) {
      vehicle.update(DT, { throttle: 1, steer: i % 80 < 40 ? 0.8 : -0.8 });
      const up = vehicle.position.clone().sub(PLANET_CENTER).normalize();
      expect(Math.abs(vehicle.getForward().dot(up))).toBeLessThan(1e-6);
      expect(vehicle.getForward().length()).toBeCloseTo(1, 9);
    }
  });

  it('jízda bez zatáčení sleduje velkou kružnici', () => {
    // Tohle je vlastní důkaz, že paralelní transport funguje globálně: geodetika na kouli je
    // velká kružnice, a ta leží v rovině procházející středem. Normála té roviny
    // (position x forward) musí zůstat konstantní. Kdyby se `forward` srovnával vůči nějaké
    // pevné ose místo vůči předchozímu framu, normála by se stočila.
    const vehicle = createVehicle();
    ride(vehicle, 30, { throttle: 1, steer: 0 });
    const planeNormal = vehicle.position.clone().cross(vehicle.getForward()).normalize();

    ride(vehicle, 3000, { throttle: 1, steer: 0 });
    const laterNormal = vehicle.position.clone().cross(vehicle.getForward()).normalize();

    expect(laterNormal.dot(planeNormal)).toBeGreaterThan(0.999);
  });

  it('zatáčení mění směr, jízda přímo ne', () => {
    const straight = createVehicle();
    ride(straight, 20, { throttle: 1, steer: 0 });
    const straightStart = straight.getForward().clone();
    ride(straight, 300, { throttle: 1, steer: 0 });
    // Směr se v absolutních souřadnicích mění (kolo obíhá kouli), ale rovina zůstává -
    // proto se tu srovnává jen to, že zatáčení odchýlí víc než jízda přímo.
    const straightTurn = straightStart.angleTo(straight.getForward());

    const turning = createVehicle();
    ride(turning, 20, { throttle: 1, steer: 0 });
    const turningStart = turning.getForward().clone();
    ride(turning, 300, { throttle: 1, steer: 1 });
    const turningTurn = turningStart.angleTo(turning.getForward());

    expect(turningTurn).toBeGreaterThan(straightTurn * 2);
  });

  it('kladný steer zatáčí doleva a klopí kolo do zatáčky', () => {
    // Fixuje znaménkovou konvenci, kterou je snadné omylem obrátit (a jednou už obrácená
    // byla - projevilo se to prohozeným A/D a klopením do vnějšku zatáčky).
    //
    // "Doleva" = forward se stočí k -right, kde right = cross(forward, up) - stejná báze
    // jako v PlanetPlayerController.
    const vehicle = createVehicle();
    ride(vehicle, 200, { throttle: 1, steer: 0 });

    const up = vehicle.position.clone().sub(PLANET_CENTER).normalize();
    const forwardBefore = vehicle.getForward().clone();

    // Krátké okno záměrně: při plném vytočení je yaw-rate ~5 rad/s (rozvor 1,05 m,
    // tan(35°)), takže za sekundu se kolo stočí o víc než 360° a jakékoli měření směru by
    // se přetočilo. Znaménkový úhel okolo `up` je navíc robustnější než dot s `right`.
    ride(vehicle, 6, { throttle: 1, steer: 1 });

    const turnSign = forwardBefore.clone().cross(vehicle.getForward()).dot(up);
    expect(turnSign).toBeGreaterThan(0);
    // Klopení musí jít do zatáčky, tedy proti steerAngle (leanAngle = f(-steerAngle)).
    expect(vehicle.steerAngle).toBeGreaterThan(0);
    expect(vehicle.leanAngle).toBeLessThan(0);
  });

  it('zatáčení je vázané na rychlost, ne na vytočení řízení', () => {
    // Kinematický bicycle model: yaw-rate = (speed / wheelBase) * tan(steerAngle). Zatočení
    // za jeden frame tedy nemůže přesáhnout tuhle mez ani při plně vytočeném řízení - proto
    // se na místě zatáčet nedá.
    const vehicle = createVehicle();
    ride(vehicle, 200, { throttle: 1, steer: 0 });

    const before = vehicle.getForward().clone();
    const speedBefore = Math.abs(vehicle.speed);
    vehicle.update(DT, { throttle: 1, steer: 1 });
    const turned = before.angleTo(vehicle.getForward());

    const maxTurn = (speedBefore / PROFILE.wheelBase) * Math.tan(PROFILE.maxSteerAngle) * DT;
    expect(turned).toBeLessThanOrEqual(maxTurn + 1e-9);
  });

  it('bez plynu se kolo na svahu rozjede volnoběhem', () => {
    // Zděděné chování z plochého světa (downhillAcceleration): stojící kolo na kopci se
    // rozjede samo. Není to chyba, je to důvod, proč se rychlost z klidu nemusí rovnat nule -
    // a stojí to za zafixování testem, aby se to omylem "neopravilo".
    const vehicle = createVehicle();
    ride(vehicle, 300, { throttle: 0, steer: 0 });
    expect(Math.abs(vehicle.speed)).toBeGreaterThan(0);
    // Volnoběh nesmí přerůst strop.
    expect(Math.abs(vehicle.speed)).toBeLessThanOrEqual(PROFILE.maxDownhillSpeed + 1e-6);
  });

  it('má setrvačnost - po pustění plynu dojíždí, nezastaví skokem', () => {
    const vehicle = createVehicle();
    ride(vehicle, 180, { throttle: 1, steer: 0 });
    const cruising = vehicle.speed;
    expect(cruising).toBeGreaterThan(3);

    // Jeden frame bez plynu smí ubrat jen rollingResistance * dt, ne celou rychlost.
    vehicle.update(DT, { throttle: 0, steer: 0 });
    expect(vehicle.speed).toBeCloseTo(cruising - PROFILE.rollingResistance * DT, 4);

    // A po chvíli dojezdu je pořád v pohybu.
    ride(vehicle, 30, { throttle: 0, steer: 0 });
    expect(vehicle.speed).toBeGreaterThan(0);
  });

  it('brzdí rychleji než zrychluje', () => {
    const accelerating = createVehicle();
    accelerating.update(DT, { throttle: 1, steer: 0 });
    const gained = accelerating.speed;

    const braking = createVehicle();
    ride(braking, 180, { throttle: 1, steer: 0 });
    const beforeBrake = braking.speed;
    braking.update(DT, { throttle: -1, steer: 0 });
    const lost = beforeBrake - braking.speed;

    expect(lost).toBeGreaterThan(gained);
  });

  it('klopí se do zatáčky a v přímém směru se vyrovná', () => {
    const vehicle = createVehicle();
    ride(vehicle, 240, { throttle: 1, steer: 1 });
    expect(Math.abs(vehicle.leanAngle)).toBeGreaterThan(0.05);
    expect(Math.abs(vehicle.leanAngle)).toBeLessThanOrEqual(PROFILE.maxLeanAngle + 1e-9);

    ride(vehicle, 240, { throttle: 1, steer: 0 });
    expect(Math.abs(vehicle.leanAngle)).toBeLessThan(0.02);
  });

  it('nepřekročí maximální rychlost z kopce', () => {
    const vehicle = createVehicle();
    ride(vehicle, 4000, { throttle: 1, steer: 0 });
    expect(Math.abs(vehicle.speed)).toBeLessThanOrEqual(PROFILE.maxDownhillSpeed + 1e-6);
  });
});
