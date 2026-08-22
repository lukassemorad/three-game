import * as THREE from 'three';
import { VISIBILITY_SWEEP_INTERVAL } from './planet-config';

// Zapínání/vypínání chunků podle vzdálenosti od kamery.
//
// Sférická obdoba ChunkVisibilitySweep z plochého světa. Ten počítá vzdálenost jen v x/z,
// což na kouli nejde - antipodální chunk má podobné x/z jako ten pod nohama a nikdy by se
// neskryl. Tady je vzdálenost 3D (tětiva), která je pro dohled do ~70 m na poloměru 150 m
// dostatečně blízká geodetické.
//
// Hystereze (skrýt dál než zobrazit) i throttling jsou převzaté beze změny - bez hystereze
// by chunk na hranici blikal, bez throttlingu by se přepočítávalo každý frame zbytečně.
interface VisibilityChunk {
  readonly center: THREE.Vector3;
  readonly objects: readonly THREE.Object3D[];
  visible: boolean;
}

export class PlanetChunkVisibility {
  private readonly chunks: VisibilityChunk[] = [];
  private elapsed = 0;

  constructor(
    private readonly hideDistance: number,
    private readonly showDistance: number
  ) {}

  register(center: THREE.Vector3, objects: readonly THREE.Object3D[]): void {
    // Startuje se skryté - první sweep zapne, co je opravdu blízko, místo aby se na jeden
    // frame vykreslila celá planeta.
    for (const object of objects) object.visible = false;
    this.chunks.push({ center: center.clone(), objects, visible: false });
  }

  update(delta: number, cameraPosition: THREE.Vector3): void {
    this.elapsed += delta;
    if (this.elapsed < VISIBILITY_SWEEP_INTERVAL) return;
    this.elapsed = 0;

    const hideSq = this.hideDistance * this.hideDistance;
    const showSq = this.showDistance * this.showDistance;

    for (const chunk of this.chunks) {
      const distanceSq = chunk.center.distanceToSquared(cameraPosition);
      const shouldBeVisible = chunk.visible ? distanceSq <= hideSq : distanceSq <= showSq;
      if (shouldBeVisible === chunk.visible) continue;
      chunk.visible = shouldBeVisible;
      for (const object of chunk.objects) object.visible = shouldBeVisible;
    }
  }

  get visibleChunkCount(): number {
    let count = 0;
    for (const chunk of this.chunks) if (chunk.visible) count++;
    return count;
  }

  clear(): void {
    this.chunks.length = 0;
    this.elapsed = 0;
  }
}
