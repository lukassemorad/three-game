import { Injectable } from '@angular/core';
import { SpatialGrid } from '../world/spatial-grid';

export interface CircleCollider {
  readonly x: number;
  readonly z: number;
  readonly radius: number;
}

// Buňka o pár metrů - dost hrubá na to, aby dotaz zabral jen málo buněk, dost jemná na
// to, aby v okolí hráče nekončilo tisíce koliderů z druhého konce mapy ve stejné buňce.
const CELL_SIZE = 4;
// Bezpečnostní rezerva navíc k poloměru největšího registrovaného kolideru - `resolve()`
// řeší přesahy postupně a může výsledný bod o kousek posunout mimo původní dotazovanou
// oblast; malá rezerva pokryje i zřetězené odražení o víc koliderů najednou.
const QUERY_MARGIN = 1;

@Injectable({ providedIn: 'root' })
export class CollisionService {
  private readonly grid = new SpatialGrid<CircleCollider>(CELL_SIZE);
  private maxColliderRadius = 0;

  register(id: string, collider: CircleCollider): void {
    this.grid.insert(id, collider);
    if (collider.radius > this.maxColliderRadius) this.maxColliderRadius = collider.radius;
  }

  unregister(id: string): void {
    this.grid.remove(id);
  }

  clear(): void {
    this.grid.clear();
    this.maxColliderRadius = 0;
  }

  resolve(x: number, z: number, radius: number): { x: number; z: number } {
    let resultX = x;
    let resultZ = z;

    const candidates = this.grid.queryRadius(x, z, radius + this.maxColliderRadius + QUERY_MARGIN);
    for (const collider of candidates) {
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
