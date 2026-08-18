import { Injectable } from '@angular/core';
import { SpatialGrid } from '../world/spatial-grid';

export interface CircleCollider {
  readonly x: number;
  readonly z: number;
  readonly radius: number;
  // Absolutní world Y vršku objektu. `undefined` = bez výškového omezení, blokuje vždy
  // bez ohledu na výšku hráče (dnešní chování) - viz `resolve()`/`getSupportHeight()`.
  readonly topY?: number;
}

export interface BoxCollider {
  readonly center: { x: number; y: number; z: number };
  readonly halfExtents: { x: number; y: number; z: number };
}

// Plochá obdélníková "stojná plocha" (např. střecha) - na rozdíl od `CircleCollider` nikdy
// neblokuje pohyb, jen ji `getSupportHeight()` nabízí jako místo k dopadu/stání, pokud je
// výš než terén. Samostatný typ od `BoxCollider`, protože ten reprezentuje svislé zdi
// (plný 3D box pro nesený kmen), kdežto tohle je vodorovná plocha v jedné výšce.
export interface RectSupportSurface {
  readonly x: number;
  readonly z: number;
  readonly halfWidth: number;
  readonly halfDepth: number;
  readonly topY: number;
}

// Buňka o pár metrů - dost hrubá na to, aby dotaz zabral jen málo buněk, dost jemná na
// to, aby v okolí hráče nekončilo tisíce koliderů z druhého konce mapy ve stejné buňce.
const CELL_SIZE = 4;
// Bezpečnostní rezerva navíc k poloměru největšího registrovaného kolideru - `resolve()`
// řeší přesahy postupně a může výsledný bod o kousek posunout mimo původní dotazovanou
// oblast; malá rezerva pokryje i zřetězené odražení o víc koliderů najednou.
const QUERY_MARGIN = 1;
// Tolerance pro `getSupportHeight()` u plošných `RectSupportSurface` (střechy) - hráč smí
// plochu použít jako podlahu, jen když je (aspoň přibližně) už v její výšce, ne když do jejího
// půdorysu vejde zespodu (např. dveřním otvorem bez zdi) - jinak by ho to vymrštilo nahoru.
const SUPPORT_SURFACE_STEP_TOLERANCE = 0.5;

@Injectable({ providedIn: 'root' })
export class CollisionService {
  private readonly grid = new SpatialGrid<CircleCollider>(CELL_SIZE);
  private maxColliderRadius = 0;
  // Statické axis-aligned boxy (zdi budov) - jen pár budov ve scéně, takže lineární
  // Map bez prostorové mřížky stačí (na rozdíl od kruhových koliderů výše).
  private readonly boxesByOwner = new Map<string, readonly BoxCollider[]>();
  // Jen pár budov ve scéně, takže lineární Map bez prostorové mřížky stačí (stejné
  // zdůvodnění jako u `boxesByOwner` výše).
  private readonly supportSurfaces = new Map<string, RectSupportSurface>();

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
    this.supportSurfaces.clear();
  }

  resolve(x: number, z: number, radius: number, feetY: number): { x: number; z: number } {
    let resultX = x;
    let resultZ = z;

    const candidates = this.grid.queryRadius(x, z, radius + this.maxColliderRadius + QUERY_MARGIN);
    for (const collider of candidates) {
      // Hráč je už nad vrškem objektu (např. uprostřed skoku) - neblokuj, ať jím může
      // proletět/přejít. Bez `topY` se chová jako dřív, blokuje vždy.
      if (collider.topY !== undefined && feetY >= collider.topY) continue;

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

  // Nejvyšší `topY` ze všech kolidérů (kruhy i obdélníkové plochy), jejichž půdorys
  // obsahuje (x, z) - použito jako kandidát na "podlahu" vedle terénu (viz
  // ThreeSceneService.animate() - max(getGroundHeight, getSupportHeight)). Do půdorysu
  // kruhového kolidéru se hráč může dostat jen tak, že nad ním už je (viz `resolve()`
  // výjimka výše), takže tohle nikdy nezpůsobí "propadnutí" objektem ze strany.
  getSupportHeight(x: number, z: number, feetY: number): number | null {
    let best: number | null = null;

    const candidates = this.grid.queryRadius(x, z, this.maxColliderRadius);
    for (const collider of candidates) {
      if (collider.topY === undefined) continue;
      const dx = x - collider.x;
      const dz = z - collider.z;
      if (dx * dx + dz * dz > collider.radius * collider.radius) continue;
      if (best === null || collider.topY > best) best = collider.topY;
    }

    for (const surface of this.supportSurfaces.values()) {
      if (Math.abs(x - surface.x) > surface.halfWidth || Math.abs(z - surface.z) > surface.halfDepth) continue;
      // Stejná ochrana jako u kruhových koliderů v `resolve()` - plocha je podlaha, jen když
      // hráč je (přibližně) už v její výšce (skočil/přešel z vyššího terénu), ne když do jejího
      // půdorysu vejde zespodu (např. dveřním otvorem, viz ShopEntity - dveře bez zdi na úrovni
      // terénu spadají do půdorysu střechy).
      if (feetY < surface.topY - SUPPORT_SURFACE_STEP_TOLERANCE) continue;
      if (best === null || surface.topY > best) best = surface.topY;
    }

    return best;
  }

  registerSupportSurface(id: string, surface: RectSupportSurface): void {
    this.supportSurfaces.set(id, surface);
  }

  unregisterSupportSurface(id: string): void {
    this.supportSurfaces.delete(id);
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
