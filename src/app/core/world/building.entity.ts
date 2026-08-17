import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

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

const HALF_WIDTH = 2.6;
const HALF_DEPTH = 2.6;
const WALL_HEIGHT = 3.1;
const WALL_THICKNESS = 0.3;
// Okno (ne dveře) uprostřed západní zdi - hráč jím kmeny hází dovnitř, neprochází jím.
const WINDOW_HALF_LENGTH = 1.3;
const WINDOW_SILL_HEIGHT = 1.15;
const WINDOW_HEIGHT = 1.7;
// Odvozeno z rozměru budovy, ne pevná konstanta - zóna tak vždy dosáhne až k vnitřní
// straně zdí (dřív nedosahovala ani k oknu), i kdyby se rozměry budovy znovu změnily.
const COLLECTION_RADIUS = (HALF_WIDTH - WALL_THICKNESS) * 0.8;
// Přesah okapu střechy přes zdi - výraznější než tloušťka zdi, aby střecha vizuálně
// "chránila" fasádu a cedule na sloupcích měla kam nasednout.
const ROOF_OVERHANG = 0.4;

const wallMaterial = new THREE.MeshStandardMaterial({ color: 0x8b5a2b });
const roofMaterial = new THREE.MeshStandardMaterial({ color: 0x4a3222 });
const collectorMaterial = new THREE.MeshStandardMaterial({ color: 0x555555 });
// Kontrastní rám okna (parapet/nadpraží) - odlišuje otvor prodejní zóny od zbytku fasády.
const windowFrameMaterial = new THREE.MeshStandardMaterial({ color: 0xd8c9a3 });
const signPostMaterial = new THREE.MeshStandardMaterial({ color: 0x3a2a1a });

// Cedule s ikonou dolaru na střeše - kreslená jednou do canvasu a použitá jako sdílená
// textura pro všechny instance budovy (stejný vzor jako sdílené materiály výše).
function createSignTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#1f6b3a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = '#f2d94e';
  ctx.lineWidth = 12;
  ctx.strokeRect(6, 6, canvas.width - 12, canvas.height - 12);
  ctx.fillStyle = '#f2d94e';
  ctx.font = 'bold 170px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('$', canvas.width / 2, canvas.height / 2 + 10);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

const signMaterial = new THREE.MeshBasicMaterial({ map: createSignTexture(), side: THREE.DoubleSide });

// Beaver jako maskot výkupny dřeva - jeden sdílený loader, model se stahuje jen jednou
// (browser cache) i při více instancích budovy.
const gltfLoader = new GLTFLoader();
const BEAVER_MODEL_URL = 'assets/models/beaver.glb';
const BEAVER_HEIGHT = 0.6;

// Geometrie zdi s pozicí zapečenou přímo do vrcholů (translate) místo mesh.position -
// takhle jde víc zdí sloučit přes mergeGeometries do jednoho draw callu (viz konstruktor
// níže), protože sloučení kopíruje jen vrcholová data, ne transform jednotlivých meshů.
function wallGeometry(halfExtents: { x: number; y: number; z: number }, center: { x: number; y: number; z: number }): THREE.BufferGeometry {
  return new THREE.BoxGeometry(halfExtents.x * 2, halfExtents.y * 2, halfExtents.z * 2).translate(
    center.x,
    center.y,
    center.z
  );
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

    const structuralWalls = [northWall, southWall, eastWall, westBackWall, westFrontWall];
    const windowFrameWalls = [windowSill, windowLintel];
    this.wallBoxColliders = [...structuralWalls, ...windowFrameWalls];
    // Okno je nad zemí, takže na úrovni pohybu hráče (2D kruhy) je i západní zeď vcelku -
    // žádná mezera k obcházení, log jím musí proletět nad parapetem.
    this.groundWallSegments = [
      { start: new THREE.Vector2(-HALF_WIDTH, HALF_DEPTH), end: new THREE.Vector2(HALF_WIDTH, HALF_DEPTH), radius: WALL_THICKNESS / 2 },
      { start: new THREE.Vector2(-HALF_WIDTH, -HALF_DEPTH), end: new THREE.Vector2(HALF_WIDTH, -HALF_DEPTH), radius: WALL_THICKNESS / 2 },
      { start: new THREE.Vector2(HALF_WIDTH, -HALF_DEPTH), end: new THREE.Vector2(HALF_WIDTH, HALF_DEPTH), radius: WALL_THICKNESS / 2 },
      { start: new THREE.Vector2(-HALF_WIDTH, -HALF_DEPTH), end: new THREE.Vector2(-HALF_WIDTH, HALF_DEPTH), radius: WALL_THICKNESS / 2 }
    ];

    // Nosné zdi sloučené do jedné geometrie -> 1 draw call místo 5 (fyzikální kolidery
    // zůstávají per-box, viz wallBoxColliders/BuildingService, tohle je jen render).
    const wallGeometries = structuralWalls.map((wall) => wallGeometry(wall.halfExtents, wall.center));
    const mergedWalls = mergeGeometries(wallGeometries);
    for (const geometry of wallGeometries) geometry.dispose();
    this.group.add(new THREE.Mesh(mergedWalls, wallMaterial));

    // Parapet + nadpraží okna zvlášť, kontrastním materiálem - odlišuje otvor prodejní
    // zóny od zbytku fasády.
    const frameGeometries = windowFrameWalls.map((wall) => wallGeometry(wall.halfExtents, wall.center));
    const mergedFrame = mergeGeometries(frameGeometries);
    for (const geometry of frameGeometries) geometry.dispose();
    this.group.add(new THREE.Mesh(mergedFrame, windowFrameMaterial));

    const roofTopY = WALL_HEIGHT + 0.15;
    const roof = new THREE.Mesh(
      new THREE.BoxGeometry((HALF_WIDTH + ROOF_OVERHANG) * 2, 0.15, (HALF_DEPTH + ROOF_OVERHANG) * 2),
      roofMaterial
    );
    roof.position.set(0, WALL_HEIGHT + 0.075, 0);
    this.group.add(roof);

    // Cedule s dolarem na sloupcích u okenní (západní) strany střechy - natočená tak, aby
    // byla čitelná od okna/cesty (normála směřuje v -X, stejný směr jako okno).
    const signPostHeight = 0.9;
    const signWidth = 1.8;
    const signHeight = 1;
    const signX = -(HALF_WIDTH - 0.5);
    const signPostGeometry = new THREE.BoxGeometry(0.12, signPostHeight, 0.12);
    for (const postZ of [-(signWidth / 2 - 0.2), signWidth / 2 - 0.2]) {
      const post = new THREE.Mesh(signPostGeometry, signPostMaterial);
      post.position.set(signX, roofTopY + signPostHeight / 2, postZ);
      this.group.add(post);
    }
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(signWidth, signHeight), signMaterial);
    sign.position.set(signX, roofTopY + signPostHeight + signHeight / 2, 0);
    sign.rotation.y = -Math.PI / 2;
    this.group.add(sign);

    // Výkupna - čistě vizuální marker objektu, co kmeny "ničí" a přičítá za ně dřevo.
    const collector = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 0.8, 16), collectorMaterial);
    collector.position.set(0, 0.4, 0);
    this.group.add(collector);

    // Beaver jako "obsluha" výkupny, sedící na vršku prostředního válce (collector) -
    // hráč na něj hledí přímo skrz okno při hazení kmenů.
    const collectorTopY = 0.4 + 0.8 / 2;
    gltfLoader.load(BEAVER_MODEL_URL, (gltf) => {
      const beaver = gltf.scene;
      const size = new THREE.Box3().setFromObject(beaver).getSize(new THREE.Vector3());
      beaver.scale.setScalar(BEAVER_HEIGHT / Math.max(size.y, 0.0001));
      // Posun tak, aby po scale stál spodkem bbox na vršku válce, ne podle pivotu modelu.
      const groundOffset = new THREE.Box3().setFromObject(beaver).min.y;
      beaver.position.set(0, collectorTopY - groundOffset, 0);
      // Natočení čelem k oknu (-X); pokud model po importu hledí opačně, otoč o Math.PI navíc.
      beaver.rotation.y = -Math.PI / 2;
      this.group.add(beaver);
    });
  }
}
