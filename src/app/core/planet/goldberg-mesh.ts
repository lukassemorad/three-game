import * as THREE from 'three';
import { Icosphere } from './icosphere';

// Goldberg polyhedron = duál geodesické koule. Každý vrchol icosphere se stane jednou
// dlaždicí, jejíž rohy jsou centroidy trojúhelníků okolo toho vrcholu.
//
// Proč tu vždycky bude 12 pětiúhelníků: Eulerova formule (V - E + F = 2) pro mnohostěn
// složený jen z pěti- a šestiúhelníků vynucuje přesně 12 pětiúhelníků, bez ohledu na
// jemnost dělení. Čistě hexagonální síť na kouli neexistuje. Sedí na 12 vrcholech
// původního ikosaedru, tedy na prvních 12 vrcholech icosphere (viz `baseVertexCount`).

export interface PlanetTile {
  // Střed dlaždice = přesně ten vrchol icosphere, jehož duálem dlaždice je (ne aproximace
  // z centroidů rohů).
  readonly centerDir: THREE.Vector3;
  // Rohy v pořadí okolo dlaždice (CCW zvenku), 6 pro hexagon, 5 pro pentagon.
  readonly cornerDirs: readonly THREE.Vector3[];
  readonly isPentagon: boolean;
  // Indexy sousedních dlaždic, ve stejném pořadí jako `cornerDirs` (soused i leží za hranou
  // mezi rohem i a i+1). Dlaždice jsou sousedi právě když jejich vrcholy icosphere sdílí
  // hranu - a to je informace, kterou ring walk níž stejně prochází.
  readonly neighbors: readonly number[];
}

export function buildGoldbergTiles(sphere: Icosphere): PlanetTile[] {
  const { vertices, indices, baseVertexCount } = sphere;
  const faceCount = indices.length / 3;

  // Centroidy trojúhelníků - rohy dlaždic. Promítnuté na jednotkovou kouli, aby všechny
  // rohy ležely na stejné referenční sféře jako vrcholy (výšku terénu přidá až mesh builder).
  const faceCentroids: THREE.Vector3[] = new Array(faceCount);
  for (let f = 0; f < faceCount; f++) {
    const a = indices[f * 3];
    const b = indices[f * 3 + 1];
    const c = indices[f * 3 + 2];
    faceCentroids[f] = new THREE.Vector3()
      .add(vertices[a])
      .add(vertices[b])
      .add(vertices[c])
      .normalize();
  }

  // Pro každý vrchol seznam trojúhelníků, které se ho dotýkají.
  const incidentFaces: number[][] = Array.from({ length: vertices.length }, () => []);
  for (let f = 0; f < faceCount; f++) {
    incidentFaces[indices[f * 3]].push(f);
    incidentFaces[indices[f * 3 + 1]].push(f);
    incidentFaces[indices[f * 3 + 2]].push(f);
  }

  const tiles: PlanetTile[] = [];

  for (let v = 0; v < vertices.length; v++) {
    const faces = incidentFaces[v];

    // Prstenec trojúhelníků okolo vrcholu: každý trojúhelník přerovnáme na (v, p, q) se
    // zachovaným CCW navinutím. Sousední trojúhelník v prstenci je ten, který začíná tam,
    // kde tenhle končí - takže `p -> {face, q}` je řetěz, po kterém se dá jít dokola.
    const chain = new Map<number, { face: number; end: number }>();
    for (const f of faces) {
      const a = indices[f * 3];
      const b = indices[f * 3 + 1];
      const c = indices[f * 3 + 2];
      if (a === v) chain.set(b, { face: f, end: c });
      else if (b === v) chain.set(c, { face: f, end: a });
      else chain.set(a, { face: f, end: b });
    }

    const orderedFaces: number[] = [];
    const orderedNeighbors: number[] = [];
    let start = chain.keys().next().value as number;
    for (let step = 0; step < faces.length; step++) {
      const link = chain.get(start);
      // Prstenec musí jít uzavřít - u korektní icosphere vždy jde (viz test na uzavřenost
      // povrchu). Kdyby praskl, nesmí se dlaždice zahodit, protože indexy dlaždic musí
      // zůstat totožné s indexy vrcholů - na tom stojí `neighbors`.
      if (!link) {
        throw new Error(`Prstenec okolo vrcholu ${v} nejde uzavřít - poškozená topologie.`);
      }
      orderedFaces.push(link.face);
      // Soused za hranou mezi rohem `step` a `step+1` je vrchol, který obě tyto stěny sdílí,
      // tedy `link.end`.
      orderedNeighbors.push(link.end);
      start = link.end;
    }

    tiles.push({
      centerDir: vertices[v].clone(),
      cornerDirs: orderedFaces.map((f) => faceCentroids[f].clone()),
      isPentagon: v < baseVertexCount,
      neighbors: orderedNeighbors
    });
  }

  return tiles;
}
