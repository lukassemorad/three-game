import { Injectable } from '@angular/core';
import { SpatialGrid } from '../world/spatial-grid';

export interface CircleCollider {
  readonly x: number;
  readonly z: number;
  readonly radius: number;
}

export interface BoxCollider {
  readonly center: { x: number; y: number; z: number };
  readonly halfExtents: { x: number; y: number; z: number };
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
  // Statické axis-aligned boxy (zdi budov) - jen pár budov ve scéně, takže lineární
  // Map bez prostorové mřížky stačí (na rozdíl od kruhových koliderů výše).
  private readonly boxesByOwner = new Map<string, readonly BoxCollider[]>();

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

  registerBoxes(ownerId: string, boxes: readonly BoxCollider[]): void {
    this.boxesByOwner.set(ownerId, boxes);
  }

  unregisterBoxes(ownerId: string): void {
    this.boxesByOwner.delete(ownerId);
  }

  // Bod (nafouklý o `margin`, např. poloměr kmene) vysunutý ven ze všech statických boxů,
  // do kterých zasahuje - použito pro nesený kmen, kde chybí jakýkoli test proti zdím
  // (viz TreeService.tickGrab). Na rozdíl od prostého "zamítni celý pohyb" tohle vytlačí
  // bod jen podél osy s nejmenším průnikem (stejný princip jako `resolve()` u kruhů výš),
  // takže pohyb podél zdi (tangenciální složka) zůstává volný - kmen po zdi klouže, ne lepí.
  resolvePointAgainstBoxes(
    point: { x: number; y: number; z: number },
    margin: number
  ): { x: number; y: number; z: number } {
    let resultX = point.x;
    let resultY = point.y;
    let resultZ = point.z;

    for (const boxes of this.boxesByOwner.values()) {
      for (const box of boxes) {
        const dx = resultX - box.center.x;
        const dy = resultY - box.center.y;
        const dz = resultZ - box.center.z;
        const overlapX = box.halfExtents.x + margin - Math.abs(dx);
        const overlapY = box.halfExtents.y + margin - Math.abs(dy);
        const overlapZ = box.halfExtents.z + margin - Math.abs(dz);
        if (overlapX <= 0 || overlapY <= 0 || overlapZ <= 0) continue;

        if (overlapX <= overlapY && overlapX <= overlapZ) {
          resultX += dx < 0 ? -overlapX : overlapX;
        } else if (overlapY <= overlapZ) {
          resultY += dy < 0 ? -overlapY : overlapY;
        } else {
          resultZ += dz < 0 ? -overlapZ : overlapZ;
        }
      }
    }

    return { x: resultX, y: resultY, z: resultZ };
  }
}
