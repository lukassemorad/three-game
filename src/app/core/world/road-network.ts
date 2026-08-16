import * as THREE from 'three';
import { RoadDefinition } from '../../shared/models/road.model';

const SAMPLES_PER_SEGMENT = 20;

interface SampledPoint {
  readonly x: number;
  readonly z: number;
}

export class RoadNetwork {
  readonly width: number;
  readonly surfaceColor: THREE.Color;

  private readonly samples: SampledPoint[];

  constructor(definition: RoadDefinition) {
    this.width = definition.width;
    this.surfaceColor = new THREE.Color(definition.surfaceColor);

    const curve = new THREE.CatmullRomCurve3(
      definition.points.map((point) => new THREE.Vector3(point.x, 0, point.z))
    );
    const divisions = Math.max(1, definition.points.length - 1) * SAMPLES_PER_SEGMENT;
    this.samples = curve
      .getSpacedPoints(divisions)
      .map((point) => ({ x: point.x, z: point.z }));
  }

  distanceToNearest(x: number, z: number): number {
    let min = Infinity;
    for (const sample of this.samples) {
      const dx = sample.x - x;
      const dz = sample.z - z;
      const distSq = dx * dx + dz * dz;
      if (distSq < min) min = distSq;
    }
    return Math.sqrt(min);
  }
}
