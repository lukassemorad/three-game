import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ITEM_DEFS, SHOP_ITEM_IDS } from '../../shared/models/item.model';
import { BoxColliderSpec, WallGroundSegment } from './building.entity';
import { loadItemModel } from './item-model-loader';

export interface ShopConfig {
  readonly position: THREE.Vector3;
}

const HALF_WIDTH = 3.6;
const HALF_DEPTH = 3.6;
const WALL_HEIGHT = 4.2;
const WALL_THICKNESS = 0.35;
// Vchod (na rozdíl od okna výkupny sahá až na zem) - hráč jím prochází dovnitř.
const DOOR_HALF_WIDTH = 1;
const DOOR_HEIGHT = 2.4;
const ROOF_OVERHANG = 0.5;

const shopWallMaterial = new THREE.MeshStandardMaterial({ color: 0xb08d57 });
const shopRoofMaterial = new THREE.MeshStandardMaterial({ color: 0x5a4636 });
const doorFrameMaterial = new THREE.MeshStandardMaterial({ color: 0xd8c9a3 });
const shopSignPostMaterial = new THREE.MeshStandardMaterial({ color: 0x3a2a1a });
const shelfMaterial = new THREE.MeshStandardMaterial({ color: 0xc9a06c });
const stepMaterial = new THREE.MeshStandardMaterial({ color: 0x6e5636 });
// Tmavší než zeď i podlaha - jasně odděluje, kde končí stěna a začíná podlaha, místo aby
// obě splývaly do jednoho podobného odstínu dřeva/omítky.
const baseboardMaterial = new THREE.MeshStandardMaterial({ color: 0x3d2a1a });
const FLOOR_THICKNESS = 0.1;
const BASEBOARD_HEIGHT = 0.22;
const BASEBOARD_THICKNESS = 0.05;

// Podlaha z prken - vlastní canvas textura (stejný sdílený-canvas-texture vzor jako
// createShopSignTexture) s prkny v mírně odlišných odstínech + tmavšími spárami, ať podlaha
// nesplývá do jedné ploché barvy podobné stěnám a interiér má trochu kresby.
function createFloorTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;
  const plankColors = ['#7a5836', '#6f4f30', '#835f3d', '#734f2d', '#7d5a38'];
  const plankCount = plankColors.length;
  const plankWidth = canvas.width / plankCount;
  for (let i = 0; i < plankCount; i++) {
    ctx.fillStyle = plankColors[i % plankColors.length];
    ctx.fillRect(i * plankWidth, 0, plankWidth, canvas.height);
  }
  ctx.strokeStyle = '#3c2717';
  ctx.lineWidth = 3;
  for (let i = 1; i < plankCount; i++) {
    ctx.beginPath();
    ctx.moveTo(i * plankWidth, 0);
    ctx.lineTo(i * plankWidth, canvas.height);
    ctx.stroke();
  }
  // Pár nepravidelných příčných spár na každém prkně - přeruší dojem jedné dlouhé desky.
  ctx.strokeStyle = 'rgba(30, 18, 10, 0.35)';
  ctx.lineWidth = 2;
  for (let i = 0; i < plankCount; i++) {
    const jointY = ((i * 173) % canvas.height) * 0.8 + canvas.height * 0.1;
    ctx.beginPath();
    ctx.moveTo(i * plankWidth, jointY);
    ctx.lineTo((i + 1) * plankWidth, jointY);
    ctx.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

const floorMaterial = new THREE.MeshStandardMaterial({ map: createFloorTexture() });
// Výška schůdku odpovídá nadzvednutí terénu pod budovou (SHOP_FLAT_ZONE.raise v
// game-canvas.component.ts) - vrchní hrana schůdku tak navazuje na podlahu, spodní na
// (nižší) okolní terén před dorovnanou zónou.
const DOOR_STEP_HEIGHT = 0.18;
const DOOR_STEP_DEPTH = 0.6;
// Podlaha i schůdek mají vrchní stranu o kousek NAD úrovní terénu (y=0), ne přesně v ní -
// terén pod budovou je teď dorovnaný na stejnou výšku (FlatZone), takže by přesně splývající
// plochy (stejná výška, stejná normála) blikaly (z-fighting). Pár centimetrů rezervy jasně
// odliší, který povrch je nahoře, a spodek desky/schůdku klidně zůstane pár cm zavrtaný
// v (ploché) zemi - není to vidět, terén je nad tím "zavřený".
const SURFACE_CLEARANCE = 0.03;

// Cedule s ikonou košíku na střeše - stejný sdílený-canvas-texture vzor jako u výkupny
// (createSignTexture v building.entity.ts), jen kreslený tvar místo znaku '$'.
function createShopSignTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#1f4a7a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = '#f2d94e';
  ctx.lineWidth = 12;
  ctx.strokeRect(6, 6, canvas.width - 12, canvas.height - 12);

  ctx.fillStyle = '#f2d94e';
  ctx.beginPath();
  ctx.moveTo(60, 110);
  ctx.lineTo(196, 110);
  ctx.lineTo(176, 190);
  ctx.lineTo(80, 190);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = '#1f4a7a';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(72, 140);
  ctx.lineTo(188, 140);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(76, 165);
  ctx.lineTo(182, 165);
  ctx.stroke();

  ctx.strokeStyle = '#f2d94e';
  ctx.lineWidth = 14;
  ctx.beginPath();
  ctx.arc(128, 110, 50, Math.PI, 0, false);
  ctx.stroke();

  ctx.fillStyle = '#f2d94e';
  ctx.beginPath();
  ctx.arc(95, 205, 14, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(161, 205, 14, 0, Math.PI * 2);
  ctx.fill();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

const shopSignMaterial = new THREE.MeshBasicMaterial({ map: createShopSignTexture(), side: THREE.DoubleSide });

// Pozice jednotlivých položek podél poličky (lokální Z souřadnice shopu) - samotná
// cena/model/damage žije v ITEM_DEFS (sdíleno s inventářem a rukou hráče), tohle je čistě
// prostorové rozmístění na poličce v tomto konkrétním obchodě.
const SHOP_SHELF_Z_OFFSETS: Readonly<Record<string, number>> = {
  hatchet: -1,
  axeDouble: 0,
  chainsaw: 1
};

// Cenovka pod podstavcem - stejný canvas-text vzor jako createShopSignTexture/createSignTexture,
// jen s cenou místo ikony. Font se Segoe UI Emoji fallbackem, aby se mince vykreslila barevně.
function createPriceTagTexture(text: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#1f1710';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = '#f2d94e';
  ctx.lineWidth = 8;
  ctx.strokeRect(4, 4, canvas.width - 8, canvas.height - 8);

  ctx.fillStyle = '#f2d94e';
  ctx.font = 'bold 42px "Segoe UI Emoji", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, canvas.width / 2, canvas.height / 2 + 4);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// Textury/materiály cenovek předpočítané jednou za modul (jeden canvas na položku), stejně
// jako shopSignMaterial - text ceny se nemění, není důvod jej kreslit pokaždé znovu.
const shopItemPriceMaterials: Readonly<Record<string, THREE.MeshBasicMaterial>> = Object.fromEntries(
  SHOP_ITEM_IDS.map((id) => [
    id,
    new THREE.MeshBasicMaterial({ map: createPriceTagTexture(`🪙 ${ITEM_DEFS[id].price}`), side: THREE.DoubleSide })
  ])
);

// Podstavce pod zbožím sdílí materiál se sloupky cedule - stejné tmavé dřevo, žádný nový materiál.
const shopItemPedestalMaterial = shopSignPostMaterial;

// Stejná technika jako v building.entity.ts - pozice zapečená přímo do vrcholů (translate),
// aby šlo víc zdí sloučit přes mergeGeometries do jednoho draw callu.
function wallGeometry(halfExtents: { x: number; y: number; z: number }, center: { x: number; y: number; z: number }): THREE.BufferGeometry {
  return new THREE.BoxGeometry(halfExtents.x * 2, halfExtents.y * 2, halfExtents.z * 2).translate(
    center.x,
    center.y,
    center.z
  );
}

let nextShopId = 0;

// Jedna vystavená (nekoupená) položka na poličce - `anchor` je skupina obsahující podstavec
// a cenovku hned od začátku (model se do ní doplní až po dotažení GLTF), takže funguje jako
// cíl pro registerInteractable i předtím, než se model stihne načíst.
export interface ShopPurchasableItem {
  readonly itemId: string;
  readonly anchor: THREE.Object3D;
}

// Obchod bez rotace, stejně jako výkupna dřeva - vchod je vždy v západní zdi (-X), otočený
// stejným směrem k cestě jako okno výkupny. Na rozdíl od výkupny sahá otvor až na zem, takže
// jím hráč skutečně prochází (viz groundWallSegments níže).
export class ShopEntity {
  readonly id: string;
  readonly group: THREE.Group;

  readonly wallBoxColliders: readonly BoxColliderSpec[];
  readonly groundWallSegments: readonly WallGroundSegment[];
  // Jen položky, které hráč ještě nevlastní - viz `ownedItemIds` v konstruktoru. Po koupi se
  // odpovídající záznam odstraní voláním removeItem().
  readonly purchasableItems: ShopPurchasableItem[] = [];
  private readonly itemAnchorsById = new Map<string, THREE.Object3D>();
  // Chrání proti pozdě příchozímu GLTF callbacku, pokud je item mezitím koupen (removeItem)
  // dřív, než se jeho model stihl načíst.
  private readonly removedItemIds = new Set<string>();

  constructor(config: ShopConfig, ownedItemIds: ReadonlySet<string>) {
    this.id = `shop-${nextShopId++}`;
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

    // Západní zeď (u cesty) rozdělená na segmenty vlevo/vpravo od vchodu - na rozdíl od okna
    // výkupny tu není žádný parapet, otvor sahá až na zem.
    const westSegmentHalfLength = (HALF_DEPTH - DOOR_HALF_WIDTH) / 2;
    const westLeftWall = {
      center: { x: -HALF_WIDTH, y: WALL_HEIGHT / 2, z: -(DOOR_HALF_WIDTH + HALF_DEPTH) / 2 },
      halfExtents: { x: WALL_THICKNESS / 2, y: WALL_HEIGHT / 2, z: westSegmentHalfLength }
    };
    const westRightWall = {
      center: { x: -HALF_WIDTH, y: WALL_HEIGHT / 2, z: (DOOR_HALF_WIDTH + HALF_DEPTH) / 2 },
      halfExtents: { x: WALL_THICKNESS / 2, y: WALL_HEIGHT / 2, z: westSegmentHalfLength }
    };
    const doorLintelHalfHeight = (WALL_HEIGHT - DOOR_HEIGHT) / 2;
    const doorLintel = {
      center: { x: -HALF_WIDTH, y: DOOR_HEIGHT + doorLintelHalfHeight, z: 0 },
      halfExtents: { x: WALL_THICKNESS / 2, y: doorLintelHalfHeight, z: DOOR_HALF_WIDTH }
    };

    const structuralWalls = [northWall, southWall, eastWall, westLeftWall, westRightWall];
    this.wallBoxColliders = [...structuralWalls, doorLintel];
    // Vchod sahá až na zem, takže na úrovni pohybu hráče (2D kruhy) musí být mezera mezi
    // dvěma kratšími segmenty západní zdi - jinak by hráč dovnitř nemohl vejít.
    this.groundWallSegments = [
      { start: new THREE.Vector2(-HALF_WIDTH, HALF_DEPTH), end: new THREE.Vector2(HALF_WIDTH, HALF_DEPTH), radius: WALL_THICKNESS / 2 },
      { start: new THREE.Vector2(-HALF_WIDTH, -HALF_DEPTH), end: new THREE.Vector2(HALF_WIDTH, -HALF_DEPTH), radius: WALL_THICKNESS / 2 },
      { start: new THREE.Vector2(HALF_WIDTH, -HALF_DEPTH), end: new THREE.Vector2(HALF_WIDTH, HALF_DEPTH), radius: WALL_THICKNESS / 2 },
      { start: new THREE.Vector2(-HALF_WIDTH, -HALF_DEPTH), end: new THREE.Vector2(-HALF_WIDTH, -DOOR_HALF_WIDTH), radius: WALL_THICKNESS / 2 },
      { start: new THREE.Vector2(-HALF_WIDTH, DOOR_HALF_WIDTH), end: new THREE.Vector2(-HALF_WIDTH, HALF_DEPTH), radius: WALL_THICKNESS / 2 }
    ];

    const wallGeometries = structuralWalls.map((wall) => wallGeometry(wall.halfExtents, wall.center));
    const mergedWalls = mergeGeometries(wallGeometries);
    for (const geometry of wallGeometries) geometry.dispose();
    this.group.add(new THREE.Mesh(mergedWalls, shopWallMaterial));

    this.group.add(new THREE.Mesh(wallGeometry(doorLintel.halfExtents, doorLintel.center), doorFrameMaterial));

    // Podlaha - vrchní strana SURFACE_CLEARANCE nad terénem (ne přesně v y=0, viz komentář
    // u SURFACE_CLEARANCE výše), spodek schovaný pod (dorovnaným plochým) terénem. Terén pod
    // celou budovou je dorovnaný na plocho (viz FlatZone v game-canvas.component.ts), jinak
    // by tahle rovná deska nesouhlasila s nerovným terénem po okrajích půdorysu.
    const floorHalfWidth = HALF_WIDTH - WALL_THICKNESS / 2;
    const floor = new THREE.Mesh(
      new THREE.BoxGeometry(floorHalfWidth * 2, FLOOR_THICKNESS, HALF_DEPTH * 2 - WALL_THICKNESS),
      floorMaterial
    );
    floor.position.set(0, SURFACE_CLEARANCE - FLOOR_THICKNESS / 2, 0);
    this.group.add(floor);

    // Schůdek u vchodu - přemosťuje nadzvednutou (dorovnanou) plochu pod budovou a okolní
    // terén, viz SHOP_FLAT_ZONE.raise v game-canvas.component.ts. Hned venku před prahem,
    // pravou hranou přesně navazuje na podlahu (žádný přesah/splývání ploch mezi nimi),
    // vrchní strana ve stejné výšce jako podlaha.
    const doorStep = new THREE.Mesh(
      new THREE.BoxGeometry(DOOR_STEP_DEPTH, DOOR_STEP_HEIGHT, DOOR_HALF_WIDTH * 2 + 0.4),
      stepMaterial
    );
    doorStep.position.set(
      -floorHalfWidth - DOOR_STEP_DEPTH / 2,
      SURFACE_CLEARANCE - DOOR_STEP_HEIGHT / 2,
      0
    );
    this.group.add(doorStep);

    // Vlys (baseboard) podél vnitřní strany zdí, tam kde se dotýkají podlahy - tmavší
    // kontrastní pruh přesně odděluje zeď od podlahy, aby nesplývaly do jedné barvy dřeva.
    // Odvozený přímo ze stejných wall-specs jako nosné zdi (viz structuralWalls výše), jen
    // zúžený na tloušťku vlysu a posunutý na vnitřní líc zdi - u vchodu tak automaticky
    // vynechává mezeru (westLeftWall/westRightWall už mezeru mají).
    const baseboardGeometries = structuralWalls.map((wall) => {
      const offset = WALL_THICKNESS / 2 + BASEBOARD_THICKNESS / 2;
      const thinInZ = wall.halfExtents.z === WALL_THICKNESS / 2;
      const center = thinInZ
        ? { x: wall.center.x, y: SURFACE_CLEARANCE + BASEBOARD_HEIGHT / 2, z: wall.center.z - Math.sign(wall.center.z) * offset }
        : { x: wall.center.x - Math.sign(wall.center.x) * offset, y: SURFACE_CLEARANCE + BASEBOARD_HEIGHT / 2, z: wall.center.z };
      const halfExtents = thinInZ
        ? { x: wall.halfExtents.x, y: BASEBOARD_HEIGHT / 2, z: BASEBOARD_THICKNESS / 2 }
        : { x: BASEBOARD_THICKNESS / 2, y: BASEBOARD_HEIGHT / 2, z: wall.halfExtents.z };
      return wallGeometry(halfExtents, center);
    });
    const mergedBaseboard = mergeGeometries(baseboardGeometries);
    for (const geometry of baseboardGeometries) geometry.dispose();
    this.group.add(new THREE.Mesh(mergedBaseboard, baseboardMaterial));

    const roofTopY = WALL_HEIGHT + 0.15;
    const roof = new THREE.Mesh(
      new THREE.BoxGeometry((HALF_WIDTH + ROOF_OVERHANG) * 2, 0.15, (HALF_DEPTH + ROOF_OVERHANG) * 2),
      shopRoofMaterial
    );
    roof.position.set(0, WALL_HEIGHT + 0.075, 0);
    this.group.add(roof);

    // Cedule s košíkem na sloupcích u vstupní (západní) strany střechy - natočená tak, aby
    // byla čitelná od vchodu/cesty, stejná konvence jako u výkupny.
    const signPostHeight = 1;
    const signWidth = 2;
    const signHeight = 1.1;
    const signX = -(HALF_WIDTH - 0.5);
    const signPostGeometry = new THREE.BoxGeometry(0.12, signPostHeight, 0.12);
    for (const postZ of [-(signWidth / 2 - 0.2), signWidth / 2 - 0.2]) {
      const post = new THREE.Mesh(signPostGeometry, shopSignPostMaterial);
      post.position.set(signX, roofTopY + signPostHeight / 2, postZ);
      this.group.add(post);
    }
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(signWidth, signHeight), shopSignMaterial);
    sign.position.set(signX, roofTopY + signPostHeight + signHeight / 2, 0);
    sign.rotation.y = -Math.PI / 2;
    this.group.add(sign);

    // Polička na vnitřní straně východní zdi (protilehlé od vchodu) - jedna položka na
    // zboží, které hráč ještě nevlastní (viz ownedItemIds výše). Každá položka žije ve
    // vlastní skupině (podstavec + cenovka + model), aby šla registrovat jako interactable
    // (raycast trefí kteroukoli z nich, ThreeSceneService pak najde tuhle skupinu procházením
    // parent řetězce) a případně kompletně odstranit po koupi (viz removeItem()).
    const shelfHalfHeight = 0.03;
    const shelf = new THREE.Mesh(new THREE.BoxGeometry(0.4, shelfHalfHeight * 2, 3), shelfMaterial);
    const shelfX = HALF_WIDTH - WALL_THICKNESS / 2 - 0.2;
    shelf.position.set(shelfX, 1.1, 0);
    this.group.add(shelf);

    const shelfTopY = shelf.position.y + shelfHalfHeight;
    const pedestalHalfExtents = { x: 0.15, y: 0.1, z: 0.15 };
    for (const itemId of SHOP_ITEM_IDS) {
      if (ownedItemIds.has(itemId)) continue; // hráč už vlastní - na poličce se vůbec nezobrazí

      const item = ITEM_DEFS[itemId];
      const zOffset = SHOP_SHELF_Z_OFFSETS[itemId];
      // Anchor sedí přímo na poličce (ne v počátku shopu) - vzdálenostní prefiltr interactables
      // (viz ThreeSceneService.filterNearbyInteractables) měří od pozice registrovaného
      // objektu, takže musí odpovídat tomu, kde věc skutečně vizuálně je. Děti (podstavec,
      // model, cenovka) jsou pak v lokálním prostoru anchoru, ne shopu.
      const itemAnchor = new THREE.Group();
      itemAnchor.position.set(shelfX, shelfTopY, zOffset);
      this.group.add(itemAnchor);
      this.purchasableItems.push({ itemId, anchor: itemAnchor });
      this.itemAnchorsById.set(itemId, itemAnchor);

      const pedestal = new THREE.Mesh(
        new THREE.BoxGeometry(pedestalHalfExtents.x * 2, pedestalHalfExtents.y * 2, pedestalHalfExtents.z * 2),
        shopItemPedestalMaterial
      );
      pedestal.position.set(0, pedestalHalfExtents.y, 0);
      itemAnchor.add(pedestal);

      const pedestalTopYLocal = pedestalHalfExtents.y * 2;
      loadItemModel(item).then((model) => {
        if (this.removedItemIds.has(itemId)) return; // koupeno dřív, než se model stihl načíst
        // Posun tak, aby po scale i rotaci (obojí už hotovo v loadItemModel) stál spodkem
        // bbox na vršku podstavce.
        const groundOffset = new THREE.Box3().setFromObject(model).min.y;
        model.position.set(0, pedestalTopYLocal - groundOffset, 0);
        itemAnchor.add(model);
      });

      const priceTag = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.15), shopItemPriceMaterials[itemId]);
      // Kousek před podstavcem (blíž ke středu místnosti) a při horní hraně poličky, natočená
      // stejně jako cedule na střeše - normála -X, čitelná pro hráče přicházejícího od vchodu.
      priceTag.position.set(-pedestalHalfExtents.x - 0.02, 0.05, 0);
      priceTag.rotation.y = -Math.PI / 2;
      itemAnchor.add(priceTag);
    }
  }

  // Zavolá ShopService po úspěšné koupi - odstraní vizuál položky z poličky (natrvalo, dokud
  // shop existuje) a vrátí anchor, aby ho volající mohl odregistrovat z interactables.
  removeItem(itemId: string): void {
    this.removedItemIds.add(itemId);
    const anchor = this.itemAnchorsById.get(itemId);
    if (!anchor) return;
    this.itemAnchorsById.delete(itemId);
    const index = this.purchasableItems.findIndex((entry) => entry.itemId === itemId);
    if (index !== -1) this.purchasableItems.splice(index, 1);
    this.group.remove(anchor);
  }
}
