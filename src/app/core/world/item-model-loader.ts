import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { ItemDef } from '../../shared/models/item.model';

// Sdílený loader/cache pro modely předmětů (obchodní polička i ruka hráče čerpají ze
// stejného zdroje - viz ITEM_DEFS) - model se stáhne/naparsuje jen jednou, další použití
// (např. přepnutí zpět na dřív vybavený nástroj) dostane klon z cache okamžitě.
const gltfLoader = new GLTFLoader();
const modelCache = new Map<string, Promise<THREE.Object3D>>();

// Vrátí naškálovaný a natočený klon modelu podle ItemDef (targetSize/rotation) - volající
// si model už jen umístí na požadovanou pozici (na podstavec, do ruky, ...). Klon sdílí
// geometrii/materiál s cachovaným originálem, proto se nikde nevolá geometry.dispose()
// na věcech vrácených touto funkcí.
export function loadItemModel(item: ItemDef): Promise<THREE.Object3D> {
  if (!item.modelUrl) {
    return Promise.reject(new Error(`Item "${item.id}" nemá modelUrl`));
  }
  const modelUrl = item.modelUrl;

  let cached = modelCache.get(item.id);
  if (!cached) {
    cached = new Promise<THREE.Object3D>((resolve, reject) => {
      gltfLoader.load(modelUrl, (gltf) => resolve(gltf.scene), undefined, reject);
    });
    modelCache.set(item.id, cached);
  }

  return cached.then((scene) => {
    const clone = scene.clone(true);
    clone.rotation.set(item.rotationX ?? 0, item.rotationY ?? 0, item.rotationZ ?? 0);
    const size = new THREE.Box3().setFromObject(clone).getSize(new THREE.Vector3());
    const scale = (item.targetSize ?? 1) / Math.max(size.x, size.y, size.z, 0.0001);
    clone.scale.setScalar(scale);
    return clone;
  });
}
