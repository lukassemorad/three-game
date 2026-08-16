import { Injectable } from '@angular/core';

export interface CircleCollider {
  readonly x: number;
  readonly z: number;
  readonly radius: number;
}

@Injectable({ providedIn: 'root' })
export class CollisionService {
  private readonly colliders = new Map<string, CircleCollider>();

  register(id: string, collider: CircleCollider): void {
    this.colliders.set(id, collider);
  }

  unregister(id: string): void {
    this.colliders.delete(id);
  }

  clear(): void {
    this.colliders.clear();
  }

  resolve(x: number, z: number, radius: number): { x: number; z: number } {
    let resultX = x;
    let resultZ = z;

    for (const collider of this.colliders.values()) {
      const dx = resultX - collider.x;
      const dz = resultZ - collider.z;
      const distSq = dx * dx + dz * dz;
      const minDist = radius + collider.radius;
      if (distSq >= minDist * minDist || distSq < 1e-9) continue;

      const dist = Math.sqrt(distSq);
      const overlap = minDist - dist;
      resultX += (dx / dist) * overlap;
      resultZ += (dz / dist) * overlap;
    }

    return { x: resultX, z: resultZ };
  }
}
