import * as THREE from 'three';

interface TrackedChunk {
  readonly center: { x: number; z: number };
  readonly meshes: THREE.Object3D[];
  visible: boolean;
}

// Throttlovaný distance-based visibility sweep s hysterezí (hideDistance > showDistance) -
// skrývá meshe chunků daleko od hráče i uvnitř frustum (frustum culling řeší jen "není v
// záběru", ne "je v záběru, ale zbytečně daleko"). Hystereze zabraňuje blikání, když se hráč
// zdržuje přesně na hranici dvou vzdáleností. Sdíleno mezi TreeService a VegetationService -
// jediný rozdíl mezi nimi jsou vzdálenosti a registrované chunky.
export class ChunkVisibilitySweep {
  private readonly chunks = new Map<string, TrackedChunk>();
  private accumulator = 0;

  constructor(
    private readonly intervalSeconds: number,
    private readonly hideDistance: number,
    private readonly showDistance: number
  ) {}

  register(chunkKey: string, center: { x: number; z: number }, meshes: readonly THREE.Object3D[]): void {
    let chunk = this.chunks.get(chunkKey);
    if (!chunk) {
      chunk = { center, meshes: [], visible: true };
      this.chunks.set(chunkKey, chunk);
    }
    chunk.meshes.push(...meshes);
  }

  update(delta: number, cameraPosition: THREE.Vector3): void {
    if (this.chunks.size === 0) return;
    this.accumulator += delta;
    if (this.accumulator < this.intervalSeconds) return;
    this.accumulator = 0;

    const hideDistanceSq = this.hideDistance * this.hideDistance;
    const showDistanceSq = this.showDistance * this.showDistance;
    for (const chunk of this.chunks.values()) {
      const dx = chunk.center.x - cameraPosition.x;
      const dz = chunk.center.z - cameraPosition.z;
      const distSq = dx * dx + dz * dz;

      if (chunk.visible && distSq > hideDistanceSq) {
        chunk.visible = false;
        for (const mesh of chunk.meshes) mesh.visible = false;
      } else if (!chunk.visible && distSq < showDistanceSq) {
        chunk.visible = true;
        for (const mesh of chunk.meshes) mesh.visible = true;
      }
    }
  }

  clear(): void {
    this.chunks.clear();
    this.accumulator = 0;
  }
}
