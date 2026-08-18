import * as THREE from 'three';
import { getVisualVariation, VisualVariationRange } from './position-hash';
import { WIND_CONFIG } from './vegetation-wind';
import { VegetationVisual } from './vegetation-model-loader';

const UP = new THREE.Vector3(0, 1, 0);

export interface VegetationPlacement {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

// Zjednodušená obdoba InstancedTreeBatch - na rozdíl od stromů se instance vegetace za běhu
// nikdy neodebírají (tráva/keře/květiny se nedají "posekat"), takže stačí naplnit všechny
// meshe najednou při stavbě, bez id-mapy a swap-with-last-and-shrink logiky pro odebírání.
// origin posouvá dávku na střed jejího chunku ze stejného důvodu jako u stromů - lokální
// bounding sphere pak pokrývá jen chunk, což dělá per-chunk frustum culling smysluplným.
export function buildVegetationBatch(
  visual: VegetationVisual,
  placements: readonly VegetationPlacement[],
  variation: VisualVariationRange,
  origin: THREE.Vector3
): THREE.InstancedMesh[] {
  const capacity = placements.length;
  const meshes = visual.parts.map((part) => {
    const mesh = new THREE.InstancedMesh(part.geometry, part.material, capacity);
    mesh.count = capacity;
    mesh.position.copy(origin);
    // Vegetace se po vystavění už nikdy nemění - StaticDrawUsage (na rozdíl od
    // InstancedTreeBatch, kde DynamicDrawUsage počítá s pozdějším odebíráním instancí).
    mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    return mesh;
  });

  const matrix = new THREE.Matrix4();
  placements.forEach((placement, index) => {
    const localX = placement.x - origin.x;
    const localZ = placement.z - origin.z;
    const visualVariation = getVisualVariation(placement.x, placement.z, variation);
    const rotation = new THREE.Quaternion().setFromAxisAngle(UP, visualVariation.rotationY);
    const scale = new THREE.Vector3(visualVariation.scale, visualVariation.scale, visualVariation.scale);
    const tint = new THREE.Color(visualVariation.tint, visualVariation.tint, visualVariation.tint);

    matrix.compose(new THREE.Vector3(localX, placement.y, localZ), rotation, scale);
    for (const mesh of meshes) {
      mesh.setMatrixAt(index, matrix);
      mesh.setColorAt(index, tint);
    }
  });

  for (const mesh of meshes) {
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    // Wind shader posouvá vrcholy na GPU, což se do CPU-side bounding sphere nepromítne -
    // bez paddingu by tráva na okraji záběru kamery při vlnění blikala/mizela.
    mesh.boundingSphere!.radius += WIND_CONFIG.amplitude;
  }

  return meshes;
}
