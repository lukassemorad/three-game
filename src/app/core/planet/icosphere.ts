import * as THREE from 'three';

// Geodesická koule (icosphere) = ikosaedr rekurzivně dělený na 4 trojúhelníky, s vrcholy
// promítnutými na jednotkovou kouli.
//
// Proč vlastní kód a ne THREE.IcosahedronGeometry: PolyhedronGeometry staví non-indexed
// geometrii (duplikované vrcholy na švech) a nevrací žádnou informaci o tom, které
// trojúhelníky sdílí který vrchol. Pro Goldberg duál (viz goldberg-mesh.ts) je právě tahle
// adjacency to podstatné - musíme mít každý vrchol právě jednou a vědět, co k němu patří.

export interface Icosphere {
  // Směry z počátku na jednotkovou kouli, každý vrchol právě jednou.
  readonly vertices: readonly THREE.Vector3[];
  // Trojice indexů do `vertices`, po třech na trojúhelník.
  readonly indices: readonly number[];
  // Prvních 12 vrcholů jsou vrcholy původního ikosaedru - mají valenci 5 (ne 6) a stanou se
  // z nich těch 12 povinných pětiúhelníků. Subdivision je jen přidává na konec, nikdy
  // nepřeskládává, takže "index < 12" je platný test i po libovolném počtu dělení.
  readonly baseVertexCount: number;
}

const PHI = (1 + Math.sqrt(5)) / 2;

// 12 vrcholů ikosaedru jako cyklické permutace (0, ±1, ±phi).
function createBaseVertices(): THREE.Vector3[] {
  const raw: readonly [number, number, number][] = [
    [-1, PHI, 0],
    [1, PHI, 0],
    [-1, -PHI, 0],
    [1, -PHI, 0],
    [0, -1, PHI],
    [0, 1, PHI],
    [0, -1, -PHI],
    [0, 1, -PHI],
    [PHI, 0, -1],
    [PHI, 0, 1],
    [-PHI, 0, -1],
    [-PHI, 0, 1]
  ];
  return raw.map(([x, y, z]) => new THREE.Vector3(x, y, z).normalize());
}

// 20 stěn ikosaedru, všechny navinuté proti směru hodinových ručiček zvenku (CCW), aby
// výsledné normály mířily od středu. Na tomhle navinutí závisí orientace celého meshe
// i trimesh collideru.
const BASE_FACES: readonly [number, number, number][] = [
  [0, 11, 5],
  [0, 5, 1],
  [0, 1, 7],
  [0, 7, 10],
  [0, 10, 11],
  [1, 5, 9],
  [5, 11, 4],
  [11, 10, 2],
  [10, 7, 6],
  [7, 1, 8],
  [3, 9, 4],
  [3, 4, 2],
  [3, 2, 6],
  [3, 6, 8],
  [3, 8, 9],
  [4, 9, 5],
  [2, 4, 11],
  [6, 2, 10],
  [8, 6, 7],
  [9, 8, 1]
];

export function createIcosphere(subdivisions: number): Icosphere {
  const vertices = createBaseVertices();
  const baseVertexCount = vertices.length;
  let faces = BASE_FACES.map(([a, b, c]) => [a, b, c] as [number, number, number]);

  for (let level = 0; level < subdivisions; level++) {
    // Cache středů hran: bez ní by každý vnitřní midpoint vznikl dvakrát (jednou za každý
    // ze dvou trojúhelníků sdílejících hranu) a topologie by se rozpadla na nespojité
    // trojúhelníky - duál by pak nešel spočítat vůbec.
    const midpointCache = new Map<number, number>();
    const nextFaces: [number, number, number][] = [];

    const midpointIndex = (a: number, b: number): number => {
      // Klíč nezávislý na pořadí, aby ho obě strany hrany trefily stejně. Vertex count
      // roste na 10*4^N+2 (level 8 = ~655k), takže násobek 1e7 je bezpečně nad rozsahem.
      const key = a < b ? a * 10_000_000 + b : b * 10_000_000 + a;
      const cached = midpointCache.get(key);
      if (cached !== undefined) return cached;

      const midpoint = new THREE.Vector3()
        .addVectors(vertices[a], vertices[b])
        .normalize();
      const index = vertices.length;
      vertices.push(midpoint);
      midpointCache.set(key, index);
      return index;
    };

    for (const [a, b, c] of faces) {
      const ab = midpointIndex(a, b);
      const bc = midpointIndex(b, c);
      const ca = midpointIndex(c, a);
      // Všechny čtyři navinuté stejně jako rodič (CCW).
      nextFaces.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
    }

    faces = nextFaces;
  }

  const indices: number[] = [];
  for (const [a, b, c] of faces) indices.push(a, b, c);

  return { vertices, indices, baseVertexCount };
}
