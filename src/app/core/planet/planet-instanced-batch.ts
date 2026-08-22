import * as THREE from 'three';
import { VegetationVisual } from '../world/vegetation-model-loader';

const Y_AXIS = new THREE.Vector3(0, 1, 0);

// Minimum, které dávka o instanci potřebuje - tráva i stromy ho splňují, takže obojí jde
// stejnou cestou.
export interface PlanetInstancePlacement {
  readonly position: THREE.Vector3;
  // Radiální normála v místě instance.
  readonly up: THREE.Vector3;
  // Pootočení okolo `up`.
  readonly rotation: number;
  readonly scale: number;
  readonly tint: number;
}

// Instancovaná dávka pro jeden chunk.
//
// Dávka je posunutá A otočená do lokálního rámce chunku (lokální +Y = normála středu chunku).
// Posun je ze stejného důvodu jako u plochého světa - lokální bounding sphere pak pokrývá jen
// chunk, což dělá frustum culling smysluplným. Rotace je navíc proto, aby lokální souřadnice
// zůstaly malá čísla a ne stovky metrů.
//
// Každá instance se ale zarovnává vlastní normálou, ne normálou chunku: chunk je ~47 m
// napříč, takže na jeho okraji je odchylka normály ~9° a stébla/stromy by viditelně ležely.
// Zarovnání per instanci je čistě build-time náklad (jeden quaternion navíc), za běhu nic.
export function buildPlanetInstancedBatch(
  visual: VegetationVisual,
  placements: readonly PlanetInstancePlacement[],
  originPosition: THREE.Vector3,
  originUp: THREE.Vector3,
  // Rozšíření bounding sphere - potřebné jen tam, kde shader hýbe vrcholy na GPU (vítr).
  boundingSpherePadding = 0
): THREE.InstancedMesh[] {
  const capacity = placements.length;
  const groupQuaternion = new THREE.Quaternion().setFromUnitVectors(Y_AXIS, originUp);
  const inverseGroupQuaternion = groupQuaternion.clone().invert();

  const meshes = visual.parts.map((part) => {
    const mesh = new THREE.InstancedMesh(part.geometry, part.material, capacity);
    mesh.count = capacity;
    mesh.position.copy(originPosition);
    mesh.quaternion.copy(groupQuaternion);
    // Obsah dávky se po vystavění už nemění.
    mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    return mesh;
  });

  const matrix = new THREE.Matrix4();
  const localPosition = new THREE.Vector3();
  const alignQuaternion = new THREE.Quaternion();
  const spinQuaternion = new THREE.Quaternion();
  const instanceQuaternion = new THREE.Quaternion();
  const scaleVector = new THREE.Vector3();
  const tint = new THREE.Color();

  placements.forEach((placement, index) => {
    localPosition
      .copy(placement.position)
      .sub(originPosition)
      .applyQuaternion(inverseGroupQuaternion);

    // Model roste v +Y (loader mu srovná pivot na patu), takže zarovnání = otočit +Y na
    // radiálu, pak pootočení okolo té radiály. Nakonec do lokálního rámce dávky.
    alignQuaternion.setFromUnitVectors(Y_AXIS, placement.up);
    spinQuaternion.setFromAxisAngle(placement.up, placement.rotation);
    instanceQuaternion
      .copy(inverseGroupQuaternion)
      .multiply(spinQuaternion)
      .multiply(alignQuaternion);

    scaleVector.setScalar(placement.scale);
    tint.setScalar(placement.tint);

    matrix.compose(localPosition, instanceQuaternion, scaleVector);
    for (const mesh of meshes) {
      mesh.setMatrixAt(index, matrix);
      mesh.setColorAt(index, tint);
    }
  });

  for (const mesh of meshes) {
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    if (boundingSpherePadding > 0) mesh.boundingSphere!.radius += boundingSpherePadding;
  }

  return meshes;
}
