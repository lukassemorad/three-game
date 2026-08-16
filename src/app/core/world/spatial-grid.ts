export interface SpatialPoint {
  readonly x: number;
  readonly z: number;
}

interface Entry<T> {
  readonly item: T;
  cellKey: string;
}

// Uniformní mřížka bucketující 2D body podle buňky - dotaz na okolí bodu tak nemusí
// procházet všechny registrované položky, jen ty v okolních buňkách. Použito pro
// CollisionService.resolve(), tree-placement rejection sampling a interactable
// raycast pre-filter, aby žádné z nich neškálovalo lineárně/kvadraticky s celkovým
// počtem objektů na mapě.
export class SpatialGrid<T extends SpatialPoint> {
  private readonly cells = new Map<string, Map<string, Entry<T>>>();
  private readonly entries = new Map<string, Entry<T>>();

  constructor(private readonly cellSize: number) {}

  private cellKeyFor(x: number, z: number): string {
    const cx = Math.floor(x / this.cellSize);
    const cz = Math.floor(z / this.cellSize);
    return `${cx},${cz}`;
  }

  private cellFor(key: string): Map<string, Entry<T>> {
    let cell = this.cells.get(key);
    if (!cell) {
      cell = new Map();
      this.cells.set(key, cell);
    }
    return cell;
  }

  // Vloží/přesune položku pod daným id - druhé volání se stejným id ji jen přemístí
  // (stejná sémantika jako Map.set), takže jde bezpečně volat i pro pohybující se
  // objekty (např. padlý kmen re-registrovaný každý tick).
  insert(id: string, item: T): void {
    this.remove(id);
    const cellKey = this.cellKeyFor(item.x, item.z);
    const entry: Entry<T> = { item, cellKey };
    this.entries.set(id, entry);
    this.cellFor(cellKey).set(id, entry);
  }

  remove(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    const cell = this.cells.get(entry.cellKey);
    cell?.delete(id);
    if (cell && cell.size === 0) this.cells.delete(entry.cellKey);
    this.entries.delete(id);
  }

  clear(): void {
    this.cells.clear();
    this.entries.clear();
  }

  // Vrací kandidáty ze všech buněk, které mohou obsahovat bod ve vzdálenosti `radius`
  // od (x, z). Nefiltruje přesně na kruh - volající si přesnou vzdálenost ověří sám
  // (mřížka jen omezuje množinu kandidátů na "dost blízko", ne na "přesně v dosahu").
  queryRadius(x: number, z: number, radius: number): T[] {
    const results: T[] = [];
    const minCx = Math.floor((x - radius) / this.cellSize);
    const maxCx = Math.floor((x + radius) / this.cellSize);
    const minCz = Math.floor((z - radius) / this.cellSize);
    const maxCz = Math.floor((z + radius) / this.cellSize);

    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cz = minCz; cz <= maxCz; cz++) {
        const cell = this.cells.get(`${cx},${cz}`);
        if (!cell) continue;
        for (const entry of cell.values()) results.push(entry.item);
      }
    }
    return results;
  }
}
