import * as THREE from 'three';
import { PlanetTile } from './goldberg-mesh';
import { createIcosphere } from './icosphere';
import { CHUNK_SUBDIVISION_LEVEL } from './planet-config';

// Vyhledávání „která dlaždice leží v tomhle směru" a seskupení dlaždic do chunků.
//
// Brute force přes 10 242 dlaždic je per-frame nepoužitelný, ale nabízí se lepší cesta:
// dlaždice mají graf sousednosti a funkce `dot(centerDir, query)` je na konvexním dláždění
// sféry unimodální - nemá lokální maximum jinde než v globálním. Takže stačí z libovolné
// dlaždice opakovaně přeskočit na souseda s vyšším `dot`, dokud se to zlepšuje (hill
// climbing). S cachováním poslední známé dlaždice (hráč se mezi framy pohne o jednu, dvě)
// je to O(1) amortizovaně.

export class PlanetTileIndex {
  // Přiřazení dlaždice -> chunk, a obrácený seznam.
  private readonly tileChunk: Int32Array;
  private readonly chunkTiles: number[][];
  private readonly chunkCenters: THREE.Vector3[];

  // Poslední nalezená dlaždice slouží jako startovní bod dalšího hledání.
  private lastFound = 0;

  constructor(private readonly tiles: readonly PlanetTile[]) {
    // Chunk centra = vrcholy hrubší geodesické koule. Použít stejnou konstrukci jako pro
    // dlaždice znamená, že chunky jsou rovnoměrné a hledání chunku je ta samá úloha.
    const coarse = createIcosphere(CHUNK_SUBDIVISION_LEVEL);
    this.chunkCenters = coarse.vertices.map((v) => v.clone());
    this.chunkTiles = this.chunkCenters.map(() => []);

    this.tileChunk = new Int32Array(tiles.length);
    for (let i = 0; i < tiles.length; i++) {
      // Chunků je málo (162 při level 2), takže brute force jednorázově při buildu je
      // levnější než stavět druhý graf sousednosti.
      const chunk = this.findNearestByBruteForce(this.chunkCenters, tiles[i].centerDir);
      this.tileChunk[i] = chunk;
      this.chunkTiles[chunk].push(i);
    }
  }

  get chunkCount(): number {
    return this.chunkCenters.length;
  }

  getChunkCenterDir(chunk: number): THREE.Vector3 {
    return this.chunkCenters[chunk];
  }

  getTilesInChunk(chunk: number): readonly number[] {
    return this.chunkTiles[chunk];
  }

  getChunkOfTile(tile: number): number {
    return this.tileChunk[tile];
  }

  // Dlaždice nejblíž danému směru. `dir` nemusí být normalizovaný - `dot` porovnáváme jen
  // mezi sebou, takže na jeho délce nezáleží.
  findTile(dir: THREE.Vector3): number {
    let current = this.lastFound;
    let currentDot = this.tiles[current].centerDir.dot(dir);

    // Strop iterací je jen pojistka proti zacyklení při poškozené topologii; reálně to
    // konverguje v jednotkách kroků (nebo v ~O(průměr grafu) při skoku přes půl planety).
    for (let step = 0; step < this.tiles.length; step++) {
      let bestNeighbor = -1;
      let bestDot = currentDot;
      for (const neighbor of this.tiles[current].neighbors) {
        const neighborDot = this.tiles[neighbor].centerDir.dot(dir);
        if (neighborDot > bestDot) {
          bestDot = neighborDot;
          bestNeighbor = neighbor;
        }
      }
      if (bestNeighbor === -1) break;
      current = bestNeighbor;
      currentDot = bestDot;
    }

    this.lastFound = current;
    return current;
  }

  // Referenční implementace pro testy a pro jednorázové hledání chunku při buildu.
  findTileByBruteForce(dir: THREE.Vector3): number {
    return this.findNearestByBruteForce(
      this.tiles.map((t) => t.centerDir),
      dir
    );
  }

  private findNearestByBruteForce(centers: readonly THREE.Vector3[], dir: THREE.Vector3): number {
    let best = 0;
    let bestDot = -Infinity;
    for (let i = 0; i < centers.length; i++) {
      const d = centers[i].dot(dir);
      if (d > bestDot) {
        bestDot = d;
        best = i;
      }
    }
    return best;
  }
}
