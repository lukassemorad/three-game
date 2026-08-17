import * as THREE from 'three';
import { getTreeVisualVariation, IntactTreeVisual } from './tree.entity';

const UP = new THREE.Vector3(0, 1, 0);

interface InstanceSlot {
  readonly treeId: string;
}

// Vykresluje všechny NEDOTČENÉ stromy jedné varianty jako hrstku THREE.InstancedMesh
// objektů (jeden na klín kmene + jeden na vrstvu koruny) místo N samostatných meshů/
// draw callů na strom - draw call count tak nezávisí na počtu stromů dané varianty.
// Jakmile je strom poprvé zasažen, TreeService ho z dávky odebere (removeInstance) a
// nahradí plnohodnotným TreeEntity, které umí do klínu skutečně vykrojit zásek
// (viz TreeService.chopIntact - "promote-on-chop").
export class InstancedTreeBatch {
  private readonly origin: THREE.Vector3;
  private readonly wedgeMeshes: THREE.InstancedMesh[];
  private readonly foliageMeshes: THREE.InstancedMesh[];
  private readonly wedgeOffsetY: number;
  private readonly foliageOffsetsY: readonly number[];
  private readonly slots: (InstanceSlot | null)[];
  private readonly idToIndex = new Map<string, number>();
  private count = 0;

  // origin posouvá celou dávku (skupinu InstancedMesh) na střed jejího chunku - instance
  // matice se pak staví jen z lokálního offsetu vůči tomuto středu (viz addInstance), místo
  // absolutní world pozice. Výsledná world pozice instance (mesh.matrixWorld * instanceMatrix)
  // je stejná jako dřív, ale bounding sphere spočtená z lokálních matic pokrývá jen jeden
  // chunk, ne celou mapu - to je to, co dělá per-chunk frustum culling smysluplným (viz
  // TreeService, kde se dávky rozdělují po chunk-key).
  constructor(visual: IntactTreeVisual, capacity: number, origin: THREE.Vector3 = new THREE.Vector3()) {
    this.origin = origin;
    this.wedgeOffsetY = visual.trunkPositionY;
    this.foliageOffsetsY = visual.foliageLayers.map((layer) => layer.positionY);
    this.slots = new Array(capacity).fill(null);

    this.wedgeMeshes = visual.wedgeGeometries.map((geometry) => {
      const mesh = new THREE.InstancedMesh(geometry, visual.wedgeMaterial, capacity);
      mesh.count = 0;
      mesh.position.copy(origin);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      return mesh;
    });
    this.foliageMeshes = visual.foliageLayers.map((layer) => {
      const mesh = new THREE.InstancedMesh(layer.geometry, layer.material ?? visual.foliageMaterial, capacity);
      mesh.count = 0;
      mesh.position.copy(origin);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      return mesh;
    });
  }

  private get allMeshes(): THREE.InstancedMesh[] {
    return [...this.wedgeMeshes, ...this.foliageMeshes];
  }

  // Objekty pro scene.addToScene()/registerInteractable() - jeden interactable meta
  // stačí sdílet napříč všemi meshi dávky, protože všechny instance v ní jsou vždy
  // stejně nedotčené (žádná vlastní odlišná "zbývá X/Y stran" hláška).
  getMeshes(): readonly THREE.Object3D[] {
    return this.allMeshes;
  }

  // Jen kmenové (wedge) meshe - pro registraci jako interaktabilní (viz TreeService.spawnTrees).
  // Koruna se přidává do scény přes getMeshes(), ale klikatelná být nemá - hráč má sekat
  // kmen, ne listí (stejné pravidlo jako u povýšeného TreeEntity, viz tree.entity.ts).
  getWedgeMeshes(): readonly THREE.Object3D[] {
    return this.wedgeMeshes;
  }

  get instanceCount(): number {
    return this.count;
  }

  // Volá se jednou po naplnění dávky instancemi (viz TreeService.spawnTrees) - spočte
  // bounding sphere explicitně místo spoléhání na lazy výpočet při prvním renderu.
  // Po removeInstance přepočet NENÍ potřeba: zbylé instance jsou vždy podmnožina
  // původní množiny, takže původní (větší) sphere zůstává platným obalem.
  computeBounds(): void {
    for (const mesh of this.allMeshes) mesh.computeBoundingSphere();
  }

  addInstance(treeId: string, position: THREE.Vector3): void {
    const index = this.count;
    this.slots[index] = { treeId };
    this.idToIndex.set(treeId, index);
    this.count++;

    // Lokální offset vůči origin (střed chunku) - viz konstruktor.
    const localX = position.x - this.origin.x;
    const localZ = position.z - this.origin.z;

    // Deterministická (z pozice) rotace/škála/tón - stejná varianta jako povýšené
    // TreeEntity na stejné pozici (viz getTreeVisualVariation), takže chopIntact
    // nezpůsobí žádný vizuální "pop".
    const variation = getTreeVisualVariation(position.x, position.z);
    const rotation = new THREE.Quaternion().setFromAxisAngle(UP, variation.rotationY);
    const scaleVec = new THREE.Vector3(variation.scale, variation.scale, variation.scale);
    const tint = new THREE.Color(variation.tint, variation.tint, variation.tint);

    const matrix = new THREE.Matrix4();
    for (const mesh of this.wedgeMeshes) {
      matrix.compose(new THREE.Vector3(localX, position.y + this.wedgeOffsetY * variation.scale, localZ), rotation, scaleVec);
      mesh.setMatrixAt(index, matrix);
      mesh.setColorAt(index, tint);
    }
    this.foliageMeshes.forEach((mesh, i) => {
      matrix.compose(
        new THREE.Vector3(localX, position.y + this.foliageOffsetsY[i] * variation.scale, localZ),
        rotation,
        scaleVec
      );
      mesh.setMatrixAt(index, matrix);
      mesh.setColorAt(index, tint);
    });
    for (const mesh of this.allMeshes) {
      mesh.count = this.count;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      // Vynutí přepočet bounding sphere při dalším frustum testu - instance se přidávají
      // jen při spawnu/loadu (dřív, než dávka poprvé renderuje), takže tohle je čistě
      // defensivní pojistka pro budoucí "regrow stromu" apod., ne cesta, která dnes běží.
      mesh.boundingSphere = null;
    }
  }

  // Swap-with-last-and-shrink - odebraná instance uvolní své místo přesunem poslední
  // aktivní instance na její index, aby aktivní instance vždy tvořily souvislý blok
  // [0, count) bez děr (InstancedMesh vykresluje přesně prvních `count` instancí).
  removeInstance(treeId: string): void {
    const index = this.idToIndex.get(treeId);
    if (index === undefined) return;

    const lastIndex = this.count - 1;
    if (index !== lastIndex) {
      const lastSlot = this.slots[lastIndex]!;
      this.slots[index] = lastSlot;
      this.idToIndex.set(lastSlot.treeId, index);

      const matrix = new THREE.Matrix4();
      const color = new THREE.Color();
      for (const mesh of this.allMeshes) {
        mesh.getMatrixAt(lastIndex, matrix);
        mesh.setMatrixAt(index, matrix);
        if (mesh.instanceColor) {
          mesh.getColorAt(lastIndex, color);
          mesh.setColorAt(index, color);
        }
      }
    }

    this.slots[lastIndex] = null;
    this.idToIndex.delete(treeId);
    this.count--;
    for (const mesh of this.allMeshes) {
      mesh.count = this.count;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }

  getTreeIdAt(instanceId: number): string | undefined {
    return this.slots[instanceId]?.treeId;
  }
}
