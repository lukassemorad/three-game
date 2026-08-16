import * as THREE from 'three';

export interface BuildingConfig {
  readonly position: THREE.Vector3;
}

export interface BoxColliderSpec {
  readonly center: { x: number; y: number; z: number };
  readonly halfExtents: { x: number; y: number; z: number };
}

export interface WallGroundSegment {
  readonly start: THREE.Vector2;
  readonly end: THREE.Vector2;
  readonly radius: number;
}

const HALF_WIDTH = 2;
const HALF_DEPTH = 2;
const WALL_HEIGHT = 2.4;
const WALL_THICKNESS = 0.25;
// Okno (ne dveře) uprostřed západní zdi - hráč jím kmeny hází dovnitř, neprochází jím.
const WINDOW_HALF_LENGTH = 1;
const WINDOW_SILL_HEIGHT = 0.9;
const WINDOW_HEIGHT = 1.3;
const COLLECTION_RADIUS = 1.4;

const wallMaterial = new THREE.MeshStandardMaterial({ color: 0x8b5a2b });
const roofMaterial = new THREE.MeshStandardMaterial({ color: 0x4a3222 });
const collectorMaterial = new THREE.MeshStandardMaterial({ color: 0x555555 });

function wallMesh(halfExtents: { x: number; y: number; z: number }, center: { x: number; y: number; z: number }): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(halfExtents.x * 2, halfExtents.y * 2, halfExtents.z * 2),
    wallMaterial
  );
  mesh.position.set(center.x, center.y, center.z);
  return mesh;
}

let nextBuildingId = 0;

// Jednoduchá dřevěná kůlna bez rotace - okno je vždy v západní zdi (-X). Střed skupiny
// (group.position) leží na zemi ve středu půdorysu, takže je zároveň i středem výkupní
// zóny - žádný přepočet lokální -> world rotace není potřeba.
export class BuildingEntity {
  readonly id: string;
  readonly group: THREE.Group;
  readonly collectionRadius = COLLECTION_RADIUS;

  // Všechny zdi včetně nadpraží - pro fyzikální (Rapier) kolidery hozených kmenů.
  readonly wallBoxColliders: readonly BoxColliderSpec[];
  // Zdi v úrovni země - pro řetězec kruhových koliderů pohybu hráče (CollisionService umí
  // jen kruhy, stejná technika jako u ležícího kmene). Okno je nad zemí, takže tu žádná
  // zeď mezeru nemá.
  readonly groundWallSegments: readonly WallGroundSegment[];

  constructor(config: BuildingConfig) {
    this.id = `building-${nextBuildingId++}`;
    this.group = new THREE.Group();
    this.group.position.copy(config.position);

    const northWall = {
      center: { x: 0, y: WALL_HEIGHT / 2, z: HALF_DEPTH },
      halfExtents: { x: HALF_WIDTH, y: WALL_HEIGHT / 2, z: WALL_THICKNESS / 2 }
    };
    const southWall = {
      center: { x: 0, y: WALL_HEIGHT / 2, z: -HALF_DEPTH },
      halfExtents: { x: HALF_WIDTH, y: WALL_HEIGHT / 2, z: WALL_THICKNESS / 2 }
    };
    const eastWall = {
      center: { x: HALF_WIDTH, y: WALL_HEIGHT / 2, z: 0 },
      halfExtents: { x: WALL_THICKNESS / 2, y: WALL_HEIGHT / 2, z: HALF_DEPTH }
    };

    // Západní zeď (u cesty) - rozdělená na segment za oknem, před oknem, parapet pod ním
    // a nadpraží nad ním. Okno samotné (mezera) je jen v pásu mezi parapetem a nadpražím,
    // takže na úrovni země zeď zůstává vcelku (viz groundWallSegments níže).
    const westSegmentHalfLength = (HALF_DEPTH - WINDOW_HALF_LENGTH) / 2;
    const westBackWall = {
      center: { x: -HALF_WIDTH, y: WALL_HEIGHT / 2, z: -(WINDOW_HALF_LENGTH + HALF_DEPTH) / 2 },
      halfExtents: { x: WALL_THICKNESS / 2, y: WALL_HEIGHT / 2, z: westSegmentHalfLength }
    };
    const westFrontWall = {
      center: { x: -HALF_WIDTH, y: WALL_HEIGHT / 2, z: (WINDOW_HALF_LENGTH + HALF_DEPTH) / 2 },
      halfExtents: { x: WALL_THICKNESS / 2, y: WALL_HEIGHT / 2, z: westSegmentHalfLength }
    };
    const windowSill = {
      center: { x: -HALF_WIDTH, y: WINDOW_SILL_HEIGHT / 2, z: 0 },
      halfExtents: { x: WALL_THICKNESS / 2, y: WINDOW_SILL_HEIGHT / 2, z: WINDOW_HALF_LENGTH }
    };
    const windowTop = WINDOW_SILL_HEIGHT + WINDOW_HEIGHT;
    const windowLintelHalfHeight = (WALL_HEIGHT - windowTop) / 2;
    const windowLintel = {
      center: { x: -HALF_WIDTH, y: windowTop + windowLintelHalfHeight, z: 0 },
      halfExtents: { x: WALL_THICKNESS / 2, y: windowLintelHalfHeight, z: WINDOW_HALF_LENGTH }
    };

    this.wallBoxColliders = [northWall, southWall, eastWall, westBackWall, westFrontWall, windowSill, windowLintel];
    // Okno je nad zemí, takže na úrovni pohybu hráče (2D kruhy) je i západní zeď vcelku -
    // žádná mezera k obcházení, log jím musí proletět nad parapetem.
    this.groundWallSegments = [
      { start: new THREE.Vector2(-HALF_WIDTH, HALF_DEPTH), end: new THREE.Vector2(HALF_WIDTH, HALF_DEPTH), radius: WALL_THICKNESS / 2 },
      { start: new THREE.Vector2(-HALF_WIDTH, -HALF_DEPTH), end: new THREE.Vector2(HALF_WIDTH, -HALF_DEPTH), radius: WALL_THICKNESS / 2 },
      { start: new THREE.Vector2(HALF_WIDTH, -HALF_DEPTH), end: new THREE.Vector2(HALF_WIDTH, HALF_DEPTH), radius: WALL_THICKNESS / 2 },
      { start: new THREE.Vector2(-HALF_WIDTH, -HALF_DEPTH), end: new THREE.Vector2(-HALF_WIDTH, HALF_DEPTH), radius: WALL_THICKNESS / 2 }
    ];

    for (const wall of this.wallBoxColliders) {
      this.group.add(wallMesh(wall.halfExtents, wall.center));
    }

    const roof = new THREE.Mesh(
      new THREE.BoxGeometry((HALF_WIDTH + WALL_THICKNESS) * 2, 0.15, (HALF_DEPTH + WALL_THICKNESS) * 2),
      roofMaterial
    );
    roof.position.set(0, WALL_HEIGHT + 0.075, 0);
    this.group.add(roof);

    // Výkupna - čistě vizuální marker objektu, co kmeny "ničí" a přičítá za ně dřevo.
    const collector = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 0.8, 16), collectorMaterial);
    collector.position.set(0, 0.4, 0);
    this.group.add(collector);
  }
}
