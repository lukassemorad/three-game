import * as THREE from 'three';
import { Choppable, TreeLifecycle } from '../../shared/models/interactable.model';
import { QuatLike, TreeSectorHit, Vec3Like } from '../../shared/models/save-game.model';
import { TreeVariant } from '../../shared/models/tree.model';
import { FallenLogHandle } from '../engine/physics.service';

export type { TreeVariant };

export interface TreeRestoreState {
  readonly choppedSectorHits: readonly TreeSectorHit[];
  readonly lifecycle: TreeLifecycle;
  readonly fallProgress: number;
  readonly fallAxis: Vec3Like | null;
  readonly rotation: QuatLike;
}

export interface TreeConfig {
  readonly position: THREE.Vector3;
  readonly variant?: TreeVariant;
  readonly sectorCount?: number;
  readonly hitsPerSector?: number;
  readonly woodYield?: number;
  readonly restore?: TreeRestoreState;
}

export interface ChopResult {
  readonly outcome: 'sectorProgress' | 'sectorFelled' | 'repeatedSector' | 'felled' | 'alreadyFallen';
  readonly sectorsRemaining: number;
  readonly woodGained: number;
  readonly hitsRemaining: number;
}

export interface TreeFoliageLayer {
  readonly geometry: THREE.ConeGeometry;
  readonly positionY: number;
  readonly material?: THREE.MeshStandardMaterial;
}

interface TreeVariantDefinition {
  readonly trunkRadiusTop: number;
  readonly trunkRadiusBottom: number;
  readonly trunkHeight: number;
  readonly trunkMaterial: THREE.MeshStandardMaterial;
  readonly trunkPositionY: number;
  readonly foliageMaterial: THREE.MeshStandardMaterial;
  readonly foliageLayers: readonly TreeFoliageLayer[];
  readonly defaultHitsPerSector: number;
  readonly defaultWoodYield: number;
}

const FALL_DURATION_SECONDS = 1.3;

// Deterministický pseudo-náhodný hash z world pozice ([0,1)) - stejná pozice dá vždy
// stejnou hodnotu. Díky tomu je vizuální variace (rotace/škála/barevný tón) stabilní i po
// znovunačtení uloženého stavu (ten ukládá jen pozici) a je IDENTICKÁ pro nedotčenou
// instanci v InstancedTreeBatch i pro TreeEntity povýšené na stejné pozici - žádný
// vizuální "pop" při prvním zásahu (viz getTreeVisualVariation, InstancedTreeBatch.addInstance).
function positionHash(x: number, z: number): number {
  const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

const TREE_SCALE_MIN = 0.9;
const TREE_SCALE_RANGE = 0.2;
const TREE_TINT_MIN = 0.85;
const TREE_TINT_RANGE = 0.3;

export interface TreeVisualVariation {
  readonly rotationY: number;
  readonly scale: number;
  readonly tint: number;
}

export function getTreeVisualVariation(x: number, z: number): TreeVisualVariation {
  return {
    rotationY: positionHash(x, z) * Math.PI * 2,
    scale: TREE_SCALE_MIN + positionHash(x + 71.3, z - 13.7) * TREE_SCALE_RANGE,
    tint: TREE_TINT_MIN + positionHash(x - 45.2, z + 88.9) * TREE_TINT_RANGE
  };
}

// Vrací tónovaný klon materiálu (ne sdílenou instanci) - jinak by ztmavení/zesvětlení
// jednoho stromu ovlivnilo i všechny ostatní stromy stejné varianty, které tento
// materiál sdílejí (viz TREE_VARIANTS).
function tintMaterial(base: THREE.MeshStandardMaterial, tint: number): THREE.MeshStandardMaterial {
  const material = base.clone();
  material.color.multiplyScalar(tint);
  return material;
}

// Kmen není jeden válec, ale sada samostatných "klínů" (pizza slices) - jeden na sektor.
// Díky tomu se dá zásah skutečně vykrojit do geometrie zasaženého klínu (viz carveWedge),
// místo lepení dalšího objektu na povrch. Zároveň se to hodí do budoucna - každý klín je
// od začátku vlastní objekt, který půjde později dál dělit na menší špalíčky.
// Dost jemné dělení (na výšku i po obvodu), aby se do něj vešel malý, úzký a ostrý zásek -
// s hrubým dělením neměl výřez na čem se vykreslit a "rozlil" se přes celou plochu klínu.
const WEDGE_RADIAL_SEGMENTS = 8;
const WEDGE_HEIGHT_SEGMENTS = 48;
// Nedotčený klín je rovný kuželový segment - CylinderGeometry počítá normály analyticky
// z úhlu/sklonu, ne z počtu height segmentů, takže s 1 segmentem vypadá úplně stejně jako
// s 48 (ty jsou potřeba jen pro samotné vykrojení zásahu, viz carveWedge). Instancovaná
// dávka nedotčených stromů (viz getIntactTreeVisual/InstancedTreeBatch) se nikdy nevykrajuje,
// takže může použít tuhle mnohem levnější geometrii - žádný vizuální rozdíl, jen míň
// vertexů na (drtivou většinu) stromů, které nikdo nesekl.
const WEDGE_HEIGHT_SEGMENTS_DISPLAY = 1;
const NOTCH_DEPTH = 0.55;
const NOTCH_MIN_RADIUS_FRACTION = 0.15;
const NOTCH_FALLOFF_HEIGHT = 0.22;
// Zásek zabírá skoro celou šířku klínu (od okraje k okraji) - díky tomu, když jsou
// rozseknuté sousední sektory, jejich zásky na sebe navazují a tvoří kolem kmene souvislý
// prstenec, ne oddělené "kousky". Musí zůstat < 1 (ne přesně 1) - přesně na hranici klínu
// je posun vrcholu nulový, takže i nerozseknutý soused zůstane bez viditelné mezery/trhliny.
const NOTCH_ANGULAR_WIDTH_FRACTION = 0.92;
// Fixní počet sektorů pro všechny druhy stromů - díky tomu má zásek u každého druhu stejný
// úhlový poměr ke kmeni (a tedy stejnou vizuální šířku), i když se druhy liší obtížností
// pokácení. Tu dnes řídí defaultHitsPerSector (viz TREE_VARIANTS) - ne počet sektorů.
const TRUNK_SECTOR_COUNT = 4;
// Jakmile sektor dosáhne plného počtu zásahů, vrcholy samotné díry (ne celý klín) dostanou
// tenhle násobek barvy navíc - "ohořelý"/tmavší odstín uvnitř výřezu jde poznat i zdálky.
const CHOPPED_SECTOR_DARKEN = 0.45;

// Klíč = `${variant}-${sectorCount}` - geometrie "nedotčeného" klínu se sdílí napříč
// všemi stromy se stejnou variantou a stejným počtem sektorů (běžný/výchozí případ).
// Jakmile je klín zasažen, dostane vlastní klon (viz carveWedge) a přestává být sdílený.
const intactWedgeGeometryCache = new Map<string, THREE.BufferGeometry[]>();

function buildWedgeGeometries(
  variant: TreeVariantDefinition,
  sectorCount: number,
  heightSegments: number
): THREE.BufferGeometry[] {
  const sectorAngle = (Math.PI * 2) / sectorCount;
  const geometries: THREE.BufferGeometry[] = [];
  for (let i = 0; i < sectorCount; i++) {
    // Necháváme CylinderGeometry spočítat normály analyticky (z úhlu a sklonu kužele) -
    // to je přesně to, co dva sousední (nedotčené) klíny potřebují, aby na švu měly
    // identické normály. Viz carveWedge, kde se toto pro nedotčenou část klínu zachovává.
    geometries.push(
      new THREE.CylinderGeometry(
        variant.trunkRadiusTop,
        variant.trunkRadiusBottom,
        variant.trunkHeight,
        WEDGE_RADIAL_SEGMENTS,
        heightSegments,
        false,
        i * sectorAngle,
        sectorAngle
      )
    );
  }
  return geometries;
}

// Výchozí (bílá = beze změny) barva na vrchol - jen tahle varianta geometrie se kdy
// vykrajuje (viz carveWedge), takže jen ona potřebuje atribut barvy pro zvýraznění
// samotné díry po dokončení strany. Nedotčená instancovaná dávka (getDisplayWedgeGeometries)
// se nikdy nevykrajuje a její materiál `vertexColors` nepoužívá - atribut by tam byl
// zbytečná paměť navíc pro drtivou většinu (nikdy nezasažených) stromů.
function addDefaultVertexColors(geometries: readonly THREE.BufferGeometry[]): void {
  for (const geometry of geometries) {
    const vertexCount = geometry.attributes['position'].count;
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(vertexCount * 3).fill(1), 3));
  }
}

function getIntactWedgeGeometries(
  variantKey: TreeVariant,
  variant: TreeVariantDefinition,
  sectorCount: number
): THREE.BufferGeometry[] {
  const cacheKey = `${variantKey}-${sectorCount}`;
  const cached = intactWedgeGeometryCache.get(cacheKey);
  if (cached) return cached;

  const geometries = buildWedgeGeometries(variant, sectorCount, WEDGE_HEIGHT_SEGMENTS);
  addDefaultVertexColors(geometries);
  intactWedgeGeometryCache.set(cacheKey, geometries);
  return geometries;
}

// Levnější varianta getIntactWedgeGeometries - jen pro InstancedTreeBatch (viz
// getIntactTreeVisual), nikdy pro TreeEntity (ten musí zůstat carve-ready, viz komentář
// u WEDGE_HEIGHT_SEGMENTS_DISPLAY výše).
const intactDisplayWedgeGeometryCache = new Map<string, THREE.BufferGeometry[]>();

function getDisplayWedgeGeometries(
  variantKey: TreeVariant,
  variant: TreeVariantDefinition,
  sectorCount: number
): THREE.BufferGeometry[] {
  const cacheKey = `${variantKey}-${sectorCount}`;
  const cached = intactDisplayWedgeGeometryCache.get(cacheKey);
  if (cached) return cached;

  const geometries = buildWedgeGeometries(variant, sectorCount, WEDGE_HEIGHT_SEGMENTS_DISPLAY);
  intactDisplayWedgeGeometryCache.set(cacheKey, geometries);
  return geometries;
}

const TREE_VARIANTS: Record<TreeVariant, TreeVariantDefinition> = {
  oak: {
    trunkRadiusTop: 0.35,
    trunkRadiusBottom: 0.47,
    trunkHeight: 3.77,
    trunkMaterial: new THREE.MeshStandardMaterial({ color: 0x6b4423, flatShading: true }),
    trunkPositionY: 1.89,
    foliageMaterial: new THREE.MeshStandardMaterial({ color: 0x2e7d32, flatShading: true }),
    foliageLayers: [{ geometry: new THREE.ConeGeometry(2.34, 4.68, 8), positionY: 4.91 }],
    defaultHitsPerSector: 8,
    defaultWoodYield: 5
  },
  pine: {
    trunkRadiusTop: 0.21,
    trunkRadiusBottom: 0.29,
    trunkHeight: 4.42,
    trunkMaterial: new THREE.MeshStandardMaterial({ color: 0x4a3222, flatShading: true }),
    trunkPositionY: 2.21,
    foliageMaterial: new THREE.MeshStandardMaterial({ color: 0x1b4d3e, flatShading: true }),
    // tři zužující se kužely nad sebou = siluetová vrstvená koruna (typický smrk/borovice)
    foliageLayers: [
      { geometry: new THREE.ConeGeometry(2.08, 2.73, 8), positionY: 3.9 },
      { geometry: new THREE.ConeGeometry(1.5, 2.47, 8), positionY: 5.53 },
      { geometry: new THREE.ConeGeometry(0.91, 2.21, 8), positionY: 7.02 }
    ],
    defaultHitsPerSector: 15,
    defaultWoodYield: 10
  },
  frostFir: {
    trunkRadiusTop: 0.4,
    trunkRadiusBottom: 0.62,
    trunkHeight: 7.8,
    trunkMaterial: new THREE.MeshStandardMaterial({ color: 0x5c564c, flatShading: true }),
    trunkPositionY: 3.9,
    foliageMaterial: new THREE.MeshStandardMaterial({ color: 0x445c53, flatShading: true }),
    // 4 vrstvy (o jednu víc než pine) pro majestátnější siluetu; nejvyšší vrstva má
    // vlastní (skoro bílý) materiál - "sněhová čepička" odlišující strom na první pohled.
    foliageLayers: [
      { geometry: new THREE.ConeGeometry(3.9, 5.2, 8), positionY: 6.8 },
      { geometry: new THREE.ConeGeometry(2.9, 4.6, 8), positionY: 9.4 },
      { geometry: new THREE.ConeGeometry(2.0, 4.0, 8), positionY: 11.7 },
      {
        geometry: new THREE.ConeGeometry(1.1, 2.2, 8),
        positionY: 13.6,
        material: new THREE.MeshStandardMaterial({ color: 0xe8f0ee, flatShading: true })
      }
    ],
    defaultHitsPerSector: 20,
    defaultWoodYield: 24
  }
};

// Vizuální data potřebná k vykreslení dávky NEDOTČENÝCH stromů jedné varianty jako
// THREE.InstancedMesh (viz InstancedTreeBatch) - stejné materiály jako TreeEntity
// konstruktor níže, ale odlehčená geometrie klínů (getDisplayWedgeGeometries místo
// getIntactWedgeGeometries - viz WEDGE_HEIGHT_SEGMENTS_DISPLAY). Nedotčený klín vypadá
// s oběma geometriemi identicky, takže povýšení stromu z instance na plnohodnotný
// TreeEntity (viz TreeService.chopIntact) nezpůsobí žádný vizuální "pop".
export interface IntactTreeVisual {
  readonly sectorCount: number;
  readonly wedgeGeometries: readonly THREE.BufferGeometry[];
  readonly wedgeMaterial: THREE.MeshStandardMaterial;
  readonly trunkPositionY: number;
  readonly foliageLayers: readonly TreeFoliageLayer[];
  readonly foliageMaterial: THREE.MeshStandardMaterial;
}

export function getIntactTreeVisual(variantKey: TreeVariant): IntactTreeVisual {
  const variant = TREE_VARIANTS[variantKey];
  const sectorCount = TRUNK_SECTOR_COUNT;
  return {
    sectorCount,
    wedgeGeometries: getDisplayWedgeGeometries(variantKey, variant, sectorCount),
    wedgeMaterial: variant.trunkMaterial,
    trunkPositionY: variant.trunkPositionY,
    foliageLayers: variant.foliageLayers,
    foliageMaterial: variant.foliageMaterial
  };
}

export function getTreeColliderInfo(variantKey: TreeVariant): { radius: number; height: number } {
  const variant = TREE_VARIANTS[variantKey];
  return { radius: variant.trunkRadiusBottom, height: variant.trunkHeight };
}

let nextTreeId = 0;

export class TreeEntity {
  readonly id: string;
  readonly group: THREE.Group;
  readonly state: Choppable;
  readonly variant: TreeVariant;

  private readonly variantDef: TreeVariantDefinition;
  // Sdílené (cache) geometrie klínů z konstruktoru - NIKDY se nemění (carveWedge z nich jen
  // klonuje), takže z nich jde i po libovolném počtu zásahů spočítat vykrojení od nuly. Díky
  // tomu je hloubka záseku vždy přesně `NOTCH_DEPTH * progress`, ne součet přes všechny dosavadní
  // zásahy - kdyby se klonovalo z `mesh.geometry` (už jednou vykrojené), každý další zásah by
  // vykrajoval znovu z už zmenšeného poloměru a strana by byla prokousnutá mnohem hlouběji, než
  // odpovídá jejímu skutečnému postupu.
  private readonly pristineWedgeGeometries: readonly THREE.BufferGeometry[];
  private readonly wedgeMeshes: THREE.Mesh[];
  private readonly foliageMeshes: THREE.Mesh[];
  // Baseline (stojící, nepadající) rotace odvozená z pozice - viz getTreeVisualVariation.
  // updateFall na ni pádovou rotaci NAVAZUJE (baseline * fallDelta), místo aby ji přepsal,
  // jinak by strom v okamžiku pádu vizuálně "odskočil" zpět na nulové natočení.
  private readonly baselineQuaternion: THREE.Quaternion;
  private fallAxisVector: THREE.Vector3 | null = null;
  physicsHandle: FallenLogHandle | null = null;

  get colliderRadius(): number {
    return this.variantDef.trunkRadiusBottom;
  }

  get trunkHeight(): number {
    return this.variantDef.trunkHeight;
  }

  get fallAxis(): THREE.Vector3 | null {
    return this.fallAxisVector;
  }

  constructor(config: TreeConfig) {
    this.id = `tree-${nextTreeId++}`;

    this.variant = config.variant ?? 'oak';
    this.variantDef = TREE_VARIANTS[this.variant];
    // Stejná (deterministická, z pozice) variace jako u nedotčené instance v
    // InstancedTreeBatch - povýšení stromu (chopIntact) tak nezmění jeho vzhled.
    const variation = getTreeVisualVariation(config.position.x, config.position.z);
    this.baselineQuaternion = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), variation.rotationY);

    const sectorCount = config.sectorCount ?? TRUNK_SECTOR_COUNT;
    const wedgeGeometries = getIntactWedgeGeometries(this.variant, this.variantDef, sectorCount);
    this.pristineWedgeGeometries = wedgeGeometries;
    const trunkMaterial = tintMaterial(this.variantDef.trunkMaterial, variation.tint);
    // Jen tenhle (per-strom) klon materiálu - sdílená báze ve TREE_VARIANTS zůstává beze
    // změny, protože ji přímo (bez klonování) používá i InstancedTreeBatch pro nedotčené
    // stromy, jejichž geometrie atribut barvy nemá (viz addDefaultVertexColors výše).
    trunkMaterial.vertexColors = true;
    this.wedgeMeshes = wedgeGeometries.map((geometry) => {
      const mesh = new THREE.Mesh(geometry, trunkMaterial);
      mesh.position.y = this.variantDef.trunkPositionY;
      return mesh;
    });

    const tintedFoliageMaterial = tintMaterial(this.variantDef.foliageMaterial, variation.tint);
    this.foliageMeshes = this.variantDef.foliageLayers.map((layer) => {
      const material = layer.material ? tintMaterial(layer.material, variation.tint) : tintedFoliageMaterial;
      const mesh = new THREE.Mesh(layer.geometry, material);
      mesh.position.y = layer.positionY;
      // Koruna nesmí být cílem klikání - hráč má sekat kmen, ne listí. Interaktabilní je
      // celá group (viz TreeService.registerTree), takže raycast musí korunu úplně
      // přeskočit, jinak by paprsek trefil bližší kužel dřív, než dosáhne kmene pod ním.
      mesh.raycast = () => {};
      return mesh;
    });

    this.group = new THREE.Group();
    this.group.add(...this.wedgeMeshes, ...this.foliageMeshes);
    this.group.position.copy(config.position);
    this.group.scale.setScalar(variation.scale);
    this.group.quaternion.copy(this.baselineQuaternion);

    const hitsPerSector = config.hitsPerSector ?? this.variantDef.defaultHitsPerSector;
    const sectorAngle = (Math.PI * 2) / sectorCount;
    const sectorHits = new Map<number, number>();
    const sectorHitY = new Map<number, number>();
    const choppedSectors = new Set<number>();
    const restore = config.restore;
    if (restore) {
      for (const hit of restore.choppedSectorHits) {
        sectorHits.set(hit.sector, hit.hits);
        sectorHitY.set(hit.sector, hit.hitY);
        this.carveWedge(hit.sector, sectorAngle, hit.hitY, hit.hits / hitsPerSector);
        if (hit.hits >= hitsPerSector) {
          choppedSectors.add(hit.sector);
        }
      }
      if (restore.lifecycle !== 'standing') {
        for (const mesh of this.foliageMeshes) this.group.remove(mesh);
      }
      if (restore.lifecycle === 'falling' && restore.fallAxis) {
        this.fallAxisVector = new THREE.Vector3(restore.fallAxis.x, restore.fallAxis.y, restore.fallAxis.z);
      }
      this.group.quaternion.set(restore.rotation.x, restore.rotation.y, restore.rotation.z, restore.rotation.w);
    }

    this.state = {
      kind: 'choppable',
      sectorCount,
      hitsPerSector,
      sectorHits,
      sectorHitY,
      choppedSectors,
      lastHitSector: restore?.choppedSectorHits.at(-1)?.sector ?? null,
      lifecycle: restore?.lifecycle ?? 'standing',
      fallProgress: restore?.fallProgress ?? 0,
      resource: { type: 'wood', amount: config.woodYield ?? this.variantDef.defaultWoodYield }
    };
  }

  registerHit(worldHitPoint: THREE.Vector3, damage = 1): ChopResult {
    if (this.state.lifecycle !== 'standing') {
      return { outcome: 'alreadyFallen', sectorsRemaining: this.remainingSectors(), woodGained: 0, hitsRemaining: 0 };
    }

    const local = this.group.worldToLocal(worldHitPoint.clone());
    const sectorAngle = (Math.PI * 2) / this.state.sectorCount;
    // THREE.CylinderGeometry staví torzo jako x = r*sin(theta), z = r*cos(theta) (viz zdroj
    // CylinderGeometry.js) - úhel proto musí být atan2(x, z), ne atan2(z, x), jinak se vykrojí
    // jiný klín, než na který hráč klikl.
    const angle = Math.atan2(local.x, local.z);
    const normalized = angle < 0 ? angle + Math.PI * 2 : angle;
    const sectorIndex = Math.floor(normalized / sectorAngle) % this.state.sectorCount;

    if (this.state.choppedSectors.has(sectorIndex)) {
      return { outcome: 'repeatedSector', sectorsRemaining: this.remainingSectors(), woodGained: 0, hitsRemaining: 0 };
    }

    const newHits = Math.min((this.state.sectorHits.get(sectorIndex) ?? 0) + damage, this.state.hitsPerSector);
    this.state.sectorHits.set(sectorIndex, newHits);
    this.state.sectorHitY.set(sectorIndex, local.y);
    this.state.lastHitSector = sectorIndex;
    this.carveWedge(sectorIndex, sectorAngle, local.y, newHits / this.state.hitsPerSector);

    if (newHits < this.state.hitsPerSector) {
      return {
        outcome: 'sectorProgress',
        sectorsRemaining: this.remainingSectors(),
        woodGained: 0,
        hitsRemaining: this.state.hitsPerSector - newHits
      };
    }

    this.state.choppedSectors.add(sectorIndex);

    const remaining = this.remainingSectors();
    if (remaining === 0) {
      this.startFalling(sectorIndex, sectorAngle);
      return { outcome: 'felled', sectorsRemaining: 0, woodGained: this.state.resource.amount, hitsRemaining: 0 };
    }
    return { outcome: 'sectorFelled', sectorsRemaining: remaining, woodGained: 0, hitsRemaining: 0 };
  }

  // Vrací úsečku, kterou ležící kmen zaujímá na zemi (báze -> špička), pro kolize padlého
  // stromu. Báze zůstává na `group.position` (origin fyzikálního tělesa je taky báze, viz
  // PhysicsService.createFallenLogBody). Směr se počítá z AKTUÁLNÍ rotace (lokální osa Y),
  // ne ze zafixovaného směru pádu - jakmile kmen převezme Rapier, může se dál pootočit
  // (kutálení, náraz), takže původní směr pádu by rychle přestal odpovídat realitě.
  getFallenLogSegment(): { start: THREE.Vector2; end: THREE.Vector2; radius: number } | null {
    if (this.state.lifecycle !== 'fallen') return null;
    const axis = new THREE.Vector3(0, 1, 0).applyQuaternion(this.group.quaternion);
    const start = new THREE.Vector2(this.group.position.x, this.group.position.z);
    const length = this.variantDef.trunkHeight * this.group.scale.y;
    const end = start.clone().add(new THREE.Vector2(axis.x, axis.z).multiplyScalar(length));
    return { start, end, radius: this.colliderRadius };
  }

  // Po předání kmene fyzice (viz TreeService) je `group` transformace řízená rigid body -
  // volá se každý tick s výsledkem `PhysicsService.readTransform`/kinematickým cílem.
  applyPhysicsTransform(translation: THREE.Vector3Like, rotation: THREE.QuaternionLike): void {
    this.group.position.set(translation.x, translation.y, translation.z);
    this.group.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
  }

  updateFall(delta: number): boolean {
    if (this.state.lifecycle !== 'falling') return true;
    this.state.fallProgress = Math.min(1, this.state.fallProgress + delta / FALL_DURATION_SECONDS);
    const fallDelta = new THREE.Quaternion().setFromAxisAngle(this.fallAxis!, this.state.fallProgress * (Math.PI / 2));
    this.group.quaternion.copy(this.baselineQuaternion).multiply(fallDelta);
    if (this.state.fallProgress >= 1) {
      this.state.lifecycle = 'fallen';
      return true;
    }
    return false;
  }

  private remainingSectors(): number {
    return this.state.sectorCount - this.state.choppedSectors.size;
  }

  // Vykrojí prohlubeň přímo do geometrie zasaženého klínu - vrcholy poblíž výšky a úhlu
  // zásahu se posunou radiálně dovnitř. Skutečná díra ve dřevu, ne přilepený objekt.
  // Úhlový spád (angularFalloff) je nutný, aby výřez nikdy nezasáhl přesnou hranici
  // klínu - jinak by hrana klínu přestala navazovat na souseda a vznikla by mezera,
  // kterou je vidět skrz dutý strom ven.
  private carveWedge(sectorIndex: number, sectorAngle: number, hitY: number, progress: number): void {
    const mesh = this.wedgeMeshes[sectorIndex];
    // Vždy z NEZMĚNĚNÉ (pristine) geometrie, ne z `mesh.geometry` (tou už může být dřívější
    // vykrojený klon) - viz komentář u pristineWedgeGeometries výše. Od teď klon patří jen
    // tomuto klínu - přestává být sdílený s ostatními stromy stejné varianty.
    const carved = this.pristineWedgeGeometries[sectorIndex].clone();
    const position = carved.attributes['position'] as THREE.BufferAttribute;
    // Záloha analytických normál - computeVertexNormals níže je potřeba jen pro samotný
    // zásek (viz konec metody), jinde by přepočtené (průměrované) normály neseděly s tím,
    // co má sousední klín, a na švu by vznikla viditelná čára.
    const originalNormal = (carved.attributes['normal'] as THREE.BufferAttribute).clone();
    const color = carved.attributes['color'] as THREE.BufferAttribute;
    // Až strana dosáhne plného počtu zásahů, ztmavíme jen vrcholy uvnitř samotné díry (podle
    // stejného úhlového/výškového spádu jako posun geometrie) - ne celý klín, aby zbytek strany
    // vypadal pořád jako normální dřevo.
    const complete = progress >= 1;
    const displaced = new Uint8Array(position.count);

    const halfHeight = this.variantDef.trunkHeight / 2;
    const margin = 0.2;
    const wedgeLocalHitY = THREE.MathUtils.clamp(
      hitY - this.variantDef.trunkPositionY,
      -halfHeight + margin,
      halfHeight - margin
    );
    const midAngle = (sectorIndex + 0.5) * sectorAngle;
    // Poloviční šířka samotného záseku - těsně pod polovinou celého klínu (viz
    // NOTCH_ANGULAR_WIDTH_FRACTION), aby zásek sahal skoro až k hranici klínu, ale nikdy
    // ji nepřekročil.
    const notchHalfWidth = (sectorAngle / 2) * NOTCH_ANGULAR_WIDTH_FRACTION;

    for (let i = 0; i < position.count; i++) {
      const vx = position.getX(i);
      const vy = position.getY(i);
      const vz = position.getZ(i);
      const radius = Math.sqrt(vx * vx + vz * vz);
      if (radius < 1e-4) continue; // střed víček (osa) - dutinu se netýká

      // Stejná konvence jako v registerHit - atan2(x, z), ne atan2(z, x).
      const vertexAngle = Math.atan2(vx, vz);
      const normalizedAngle = vertexAngle < 0 ? vertexAngle + Math.PI * 2 : vertexAngle;
      // Lineární (ne smoothstep) - ostrá hrana záseku. Nulu dosáhne přesně na hranici
      // klínu (nikdy za ní), takže se švu se sousedem nedotkne, ale skoro celá šířka
      // klínu je "v dosahu" záseku - viz NOTCH_ANGULAR_WIDTH_FRACTION.
      const angularFalloff = Math.max(0, 1 - Math.abs(normalizedAngle - midAngle) / notchHalfWidth);
      if (angularFalloff <= 0) continue;

      // Výškově záměrně lineární (ne smoothstep) - ostřejší "véčkový" zásek jako od sekery,
      // ne pozvolný kulatý důlek.
      const verticalFalloff = Math.max(0, 1 - Math.abs(vy - wedgeLocalHitY) / NOTCH_FALLOFF_HEIGHT);
      const falloff = angularFalloff * verticalFalloff;
      if (falloff <= 0) continue;

      const newRadius = Math.max(radius - NOTCH_DEPTH * progress * falloff, radius * NOTCH_MIN_RADIUS_FRACTION);
      const scale = newRadius / radius;
      position.setX(i, vx * scale);
      position.setZ(i, vz * scale);
      displaced[i] = 1;

      if (complete) {
        const darken = 1 - (1 - CHOPPED_SECTOR_DARKEN) * falloff;
        color.setXYZ(i, darken, darken, darken);
      }
    }

    position.needsUpdate = true;
    color.needsUpdate = true;
    carved.computeVertexNormals();

    // Průměrované normály z computeVertexNormals ponecháme jen tam, kde se vrchol skutečně
    // posunul (samotný zásek) - všude jinde vrátíme původní analytickou normálu, aby zbytek
    // klínu (a hlavně jeho hranice se sousedy) svítil úplně stejně jako předtím.
    const normal = carved.attributes['normal'] as THREE.BufferAttribute;
    for (let i = 0; i < normal.count; i++) {
      if (displaced[i]) continue;
      normal.setXYZ(i, originalNormal.getX(i), originalNormal.getY(i), originalNormal.getZ(i));
    }
    normal.needsUpdate = true;

    mesh.geometry = carved;
  }

  private startFalling(sectorIndex: number, sectorAngle: number): void {
    const hitAngle = (sectorIndex + 0.5) * sectorAngle;
    // "pryč od poslední rány" - strom padá na opačnou stranu, než přišel poslední zásah.
    // Směr ven z kmene při úhlu theta je (sin theta, 0, cos theta) - viz konvence CylinderGeometry výše.
    const fallDir = new THREE.Vector3(-Math.sin(hitAngle), 0, -Math.cos(hitAngle));
    this.fallAxisVector = new THREE.Vector3(fallDir.z, 0, -fallDir.x).normalize();

    for (const mesh of this.foliageMeshes) this.group.remove(mesh);

    this.state.lifecycle = 'falling';
    this.state.fallProgress = 0;
  }
}
