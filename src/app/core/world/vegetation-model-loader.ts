import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { VegetationVariant } from '../../shared/models/vegetation.model';
import { applyWindShader, WIND_AFFECTED_VARIANTS } from './vegetation-wind';
import { VEGETATION_DEFS } from './vegetation.config';

export interface VegetationPart {
  readonly geometry: THREE.BufferGeometry;
  readonly material: THREE.Material;
}

export interface VegetationVisual {
  readonly parts: readonly VegetationPart[];
}

// Sdílený loader/cache podle varianty - stejná technika jako item-model-loader.ts/
// frog.service.ts, model se stáhne/naparsuje jen jednou bez ohledu na to, kolikrát se
// varianta v placementech vyskytne.
const gltfLoader = new GLTFLoader();
const visualCache = new Map<VegetationVariant, Promise<VegetationVisual>>();

// Zapeče lokální transform KAŽDÉHO mesh uzlu (pozici/rotaci/škálu vůči kořeni modelu) přímo
// do klonu jeho geometrie, spolu se sjednocující normalizační škálou (na targetSize, spočtenou
// z bounding boxu celé scény). Výsledné "parts" tak jde instancovat jednou společnou maticí na
// instanci (viz instanced-vegetation-batch.ts) bez ručních Y-offsetů mezi částmi, jako to kvůli
// procedurální geometrii musí dělat tree.entity.ts - u modelu z GLTF je relativní umístění částí
// (např. kytek na keři) přesně to, co bylo v autorském souboru.
//
// Modely trávníkových "trsů" (viz vegetation.config.ts) mívají desítky až stovky mesh uzlů
// (jedno stéblo = jeden uzel), ale jen pár sdílených materiálů - proto se geometrie seskupují
// a slučují (mergeGeometries) po materiálu, ne po uzlu. Bez toho by každý trs znamenal desítky
// InstancedMesh (jeden draw call na uzel) místo jednoho na materiál - přesně ta zátěž navíc,
// kterou má instancing řešit.
function extractParts(scene: THREE.Object3D, targetSize: number, variant: VegetationVariant): VegetationPart[] {
  scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(scene);
  const size = box.getSize(new THREE.Vector3());
  const scale = targetSize / Math.max(size.x, size.y, size.z, 0.0001);
  // Ne všechny stažené modely mají pivot u paty (na rozdíl od nature-kitu, kde na to lze
  // spoléhat - viz komentář výš) - "grass-patch-lowpoly.glb" má pivot skoro uprostřed výšky,
  // takže bez rebasu na box.min.y by trs z poloviny "tonul" pod terénem. Odsazení se aplikuje
  // před škálou, aby platilo přesně jednou bez ohledu na targetSize.
  const normalize = new THREE.Matrix4()
    .makeScale(scale, scale, scale)
    .multiply(new THREE.Matrix4().makeTranslation(0, -box.min.y, 0));
  const affectedByWind = WIND_AFFECTED_VARIANTS.has(variant);

  const geometriesByMaterial = new Map<THREE.Material, THREE.BufferGeometry[]>();
  scene.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const geometry = child.geometry.clone();
    geometry.applyMatrix4(child.matrixWorld);
    geometry.applyMatrix4(normalize);
    const material = Array.isArray(child.material) ? child.material[0] : child.material;
    const group = geometriesByMaterial.get(material);
    if (group) group.push(geometry);
    else geometriesByMaterial.set(material, [geometry]);
  });

  const parts: VegetationPart[] = [];
  for (const [material, geometries] of geometriesByMaterial) {
    const geometry = geometries.length === 1 ? geometries[0] : mergeGeometries(geometries);
    let finalMaterial = material;
    if (affectedByWind && material instanceof THREE.MeshStandardMaterial) {
      geometry.computeBoundingBox();
      const minY = geometry.boundingBox!.min.y;
      const maxY = geometry.boundingBox!.max.y;
      finalMaterial = applyWindShader(material, minY, maxY);
    }
    parts.push({ geometry, material: finalMaterial });
  }
  return parts;
}

function loadVegetationVisual(variant: VegetationVariant): Promise<VegetationVisual> {
  let cached = visualCache.get(variant);
  if (!cached) {
    const def = VEGETATION_DEFS[variant];
    cached = new Promise<VegetationVisual>((resolve, reject) => {
      gltfLoader.load(
        def.modelUrl,
        (gltf) => resolve({ parts: extractParts(gltf.scene, def.targetSize, variant) }),
        undefined,
        reject
      );
    });
    visualCache.set(variant, cached);
  }
  return cached;
}

export async function loadVegetationVisuals(
  variants: readonly VegetationVariant[]
): Promise<Map<VegetationVariant, VegetationVisual>> {
  const unique = Array.from(new Set(variants));
  const loaded = await Promise.all(
    unique.map(async (variant) => [variant, await loadVegetationVisual(variant)] as const)
  );
  return new Map(loaded);
}
