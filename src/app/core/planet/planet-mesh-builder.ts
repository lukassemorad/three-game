import * as THREE from 'three';
import { PlanetTile } from './goldberg-mesh';
import { PlanetTerrain } from './planet-terrain';
import { getTileColor, TileData } from './planet-biome';
import { COLOR_PENTAGON_DEBUG } from './planet-config';

export interface PlanetSurface {
  readonly geometry: THREE.BufferGeometry;
  // Stejná data jako v geometrii, pro Rapier trimesh collider. Držíme si referenci, aby
  // fyzika nemusela sahat do atributů geometrie a nezávisela na tom, že je non-indexed.
  readonly positions: Float32Array;
  readonly indices: Uint32Array;
  readonly triangleCount: number;
}

export interface BuildSurfaceOptions {
  // Obarví 12 pětiúhelníků výrazně, aby se daly při testování na kouli najít.
  readonly highlightPentagons?: boolean;
}

// Každá dlaždice se triangulizuje jako vějíř ze svého středu do rohů (6 trojúhelníků pro
// hexagon, 5 pro pentagon).
//
// Geometrie je záměrně non-indexed: žádné vrcholy se nesdílí, takže computeVertexNormals()
// spočítá normálu per stěnu a dlaždice vyjdou opticky ploché. To je u hex planety žádoucí
// styl, ne vedlejší efekt (u plochého terénu vzniká flat shading naopak z jemné 1m mřížky).
export function buildPlanetSurface(
  tiles: readonly PlanetTile[],
  tileData: readonly TileData[],
  terrain: PlanetTerrain,
  options: BuildSurfaceOptions = {}
): PlanetSurface {
  let triangleCount = 0;
  for (const tile of tiles) triangleCount += tile.cornerDirs.length;

  const positions = new Float32Array(triangleCount * 9);
  const colors = new Float32Array(triangleCount * 9);

  const pentagonColor = new THREE.Color(COLOR_PENTAGON_DEBUG);
  const tileColor = new THREE.Color();
  const centerPos = new THREE.Vector3();
  const cornerPositions: THREE.Vector3[] = [];
  const edgeA = new THREE.Vector3();
  const edgeB = new THREE.Vector3();
  const faceNormal = new THREE.Vector3();

  let offset = 0;

  const writeVertex = (position: THREE.Vector3, color: THREE.Color) => {
    positions[offset] = position.x;
    positions[offset + 1] = position.y;
    positions[offset + 2] = position.z;
    colors[offset] = color.r;
    colors[offset + 1] = color.g;
    colors[offset + 2] = color.b;
    offset += 3;
  };

  tiles.forEach((tile, tileIndex) => {
    const data = tileData[tileIndex];
    centerPos.copy(tile.centerDir).multiplyScalar(data.surfaceRadius);

    // Rohy vzorkované každý zvlášť stejnou funkcí směru - sousední dlaždice tak dostanou
    // pro společný roh identickou výšku a mezi dlaždicemi nevzniknou díry.
    cornerPositions.length = 0;
    for (const cornerDir of tile.cornerDirs) {
      cornerPositions.push(
        cornerDir.clone().multiplyScalar(terrain.getSurfaceRadius(cornerDir))
      );
    }

    if (options.highlightPentagons && tile.isPentagon) {
      tileColor.copy(pentagonColor);
    } else {
      getTileColor(tile.centerDir, data, tileColor);
    }

    // Kontrola navinutí: prstenec z goldberg-mesh.ts má vyjít CCW zvenku, ale spoléhat se
    // na to naslepo by znamenalo riskovat prohozené normály (černý terén a nefunkční
    // trimesh collider). Ověříme na prvním trojúhelníku a případně obrátíme pořadí rohů.
    edgeA.subVectors(cornerPositions[0], centerPos);
    edgeB.subVectors(cornerPositions[1], centerPos);
    faceNormal.crossVectors(edgeA, edgeB);
    if (faceNormal.dot(tile.centerDir) < 0) cornerPositions.reverse();

    const cornerCount = cornerPositions.length;
    for (let i = 0; i < cornerCount; i++) {
      const next = (i + 1) % cornerCount;
      writeVertex(centerPos, tileColor);
      writeVertex(cornerPositions[i], tileColor);
      writeVertex(cornerPositions[next], tileColor);
    }
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();

  // Trimesh v Rapieru dedup vrcholů nepotřebuje - sekvenční indexy nad stejným polem pozic
  // jsou korektní vstup a při ~61k trojúhelnících je paměť zanedbatelná.
  const indices = new Uint32Array(triangleCount * 3);
  for (let i = 0; i < indices.length; i++) indices[i] = i;

  return { geometry, positions, indices, triangleCount };
}
