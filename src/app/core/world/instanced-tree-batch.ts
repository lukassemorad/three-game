import * as THREE from 'three';
import { IntactTreeVisual } from './tree.entity';

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
  private readonly wedgeMeshes: THREE.InstancedMesh[];
  private readonly foliageMeshes: THREE.InstancedMesh[];
  private readonly wedgeOffsetY: number;
  private readonly foliageOffsetsY: readonly number[];
  private readonly slots: (InstanceSlot | null)[];
  private readonly idToIndex = new Map<string, number>();
  private count = 0;

  constructor(visual: IntactTreeVisual, capacity: number) {
    this.wedgeOffsetY = visual.trunkPositionY;
    this.foliageOffsetsY = visual.foliageLayers.map((layer) => layer.positionY);
    this.slots = new Array(capacity).fill(null);

    this.wedgeMeshes = visual.wedgeGeometries.map((geometry) => {
      const mesh = new THREE.InstancedMesh(geometry, visual.wedgeMaterial, capacity);
      mesh.count = 0;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      return mesh;
    });
    this.foliageMeshes = visual.foliageLayers.map((layer) => {
      const mesh = new THREE.InstancedMesh(layer.geometry, layer.material ?? visual.foliageMaterial, capacity);
      mesh.count = 0;
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

  get instanceCount(): number {
    return this.count;
  }

  addInstance(treeId: string, position: THREE.Vector3): void {
    const index = this.count;
    this.slots[index] = { treeId };
    this.idToIndex.set(treeId, index);
    this.count++;

    const matrix = new THREE.Matrix4();
    for (const mesh of this.wedgeMeshes) {
      matrix.makeTranslation(position.x, position.y + this.wedgeOffsetY, position.z);
      mesh.setMatrixAt(index, matrix);
    }
    this.foliageMeshes.forEach((mesh, i) => {
      matrix.makeTranslation(position.x, position.y + this.foliageOffsetsY[i], position.z);
      mesh.setMatrixAt(index, matrix);
    });
    for (const mesh of this.allMeshes) {
      mesh.count = this.count;
      mesh.instanceMatrix.needsUpdate = true;
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
      for (const mesh of this.allMeshes) {
        mesh.getMatrixAt(lastIndex, matrix);
        mesh.setMatrixAt(index, matrix);
      }
    }

    this.slots[lastIndex] = null;
    this.idToIndex.delete(treeId);
    this.count--;
    for (const mesh of this.allMeshes) {
      mesh.count = this.count;
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  getTreeIdAt(instanceId: number): string | undefined {
    return this.slots[instanceId]?.treeId;
  }
}
