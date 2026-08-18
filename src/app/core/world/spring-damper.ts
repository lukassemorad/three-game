import * as THREE from 'three';

// Rozdíl mezi dvěma rotacemi vyjádřený jako axis*angle (small-angle vektor) - stejná
// reprezentace jako úhlová rychlost, takže se s ní dá rovnou počítat ve spring-damper modelu
// níže. Vrací rotaci "from -> to", normalizovanou na nejkratší cestu (w >= 0).
export function quaternionErrorVector(from: THREE.Quaternion, to: THREE.Quaternion): THREE.Vector3 {
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
export function springTowardPosition(
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

export function springTowardRotation(
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
