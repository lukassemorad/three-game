import * as THREE from 'three';
import { Choppable } from '../../shared/models/interactable.model';
import { TreeVariant } from '../../shared/models/tree.model';
import { FallenLogHandle } from '../engine/physics.service';

export type { TreeVariant };

export interface TreeConfig {
  readonly position: THREE.Vector3;
  readonly variant?: TreeVariant;
  readonly sectorCount?: number;
  readonly woodYield?: number;
}

export interface ChopResult {
  readonly outcome: 'newSector' | 'repeatedSector' | 'felled' | 'alreadyFallen';
  readonly sectorsRemaining: number;
  readonly woodGained: number;
}

interface TreeFoliageLayer {
  readonly geometry: THREE.ConeGeometry;
  readonly positionY: number;
}

interface TreeVariantDefinition {
  readonly trunkRadiusTop: number;
  readonly trunkRadiusBottom: number;
  readonly trunkHeight: number;
  readonly trunkMaterial: THREE.MeshStandardMaterial;
  readonly trunkPositionY: number;
  readonly foliageMaterial: THREE.MeshStandardMaterial;
  readonly foliageLayers: readonly TreeFoliageLayer[];
  readonly defaultSectorCount: number;
  readonly defaultWoodYield: number;
}

const FALL_DURATION_SECONDS = 1.3;

// Kmen není jeden válec, ale sada samostatných "klínů" (pizza slices) - jeden na sektor.
// Díky tomu se dá zásah skutečně vykrojit do geometrie zasaženého klínu (viz carveWedge),
// místo lepení dalšího objektu na povrch. Zároveň se to hodí do budoucna - každý klín je
// od začátku vlastní objekt, který půjde později dál dělit na menší špalíčky.
// Dost jemné dělení (na výšku i po obvodu), aby se do něj vešel malý, úzký a ostrý zásek -
// s hrubým dělením neměl výřez na čem se vykreslit a "rozlil" se přes celou plochu klínu.
const WEDGE_RADIAL_SEGMENTS = 8;
const WEDGE_HEIGHT_SEGMENTS = 48;
const NOTCH_DEPTH = 0.55;
const NOTCH_MIN_RADIUS_FRACTION = 0.15;
const NOTCH_FALLOFF_HEIGHT = 0.22;
// Zásek zabírá jen zlomek šířky klínu (ne skoro celou jeho tvář) - úzký a ostrý "kousek",
// ne široký plochý plátek.
const NOTCH_ANGULAR_WIDTH_FRACTION = 0.42;

// Klíč = `${variant}-${sectorCount}` - geometrie "nedotčeného" klínu se sdílí napříč
// všemi stromy se stejnou variantou a stejným počtem sektorů (běžný/výchozí případ).
// Jakmile je klín zasažen, dostane vlastní klon (viz carveWedge) a přestává být sdílený.
const intactWedgeGeometryCache = new Map<string, THREE.BufferGeometry[]>();

function getIntactWedgeGeometries(
  variantKey: TreeVariant,
  variant: TreeVariantDefinition,
  sectorCount: number
): THREE.BufferGeometry[] {
  const cacheKey = `${variantKey}-${sectorCount}`;
  const cached = intactWedgeGeometryCache.get(cacheKey);
  if (cached) return cached;

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
        WEDGE_HEIGHT_SEGMENTS,
        false,
        i * sectorAngle,
        sectorAngle
      )
    );
  }
  intactWedgeGeometryCache.set(cacheKey, geometries);
  return geometries;
}

const TREE_VARIANTS: Record<TreeVariant, TreeVariantDefinition> = {
  oak: {
    trunkRadiusTop: 0.35,
    trunkRadiusBottom: 0.47,
    trunkHeight: 3.77,
    trunkMaterial: new THREE.MeshStandardMaterial({ color: 0x6b4423 }),
    trunkPositionY: 1.89,
    foliageMaterial: new THREE.MeshStandardMaterial({ color: 0x2e7d32 }),
    foliageLayers: [{ geometry: new THREE.ConeGeometry(2.34, 4.68, 8), positionY: 4.91 }],
    defaultSectorCount: 3,
    defaultWoodYield: 5
  },
  pine: {
    trunkRadiusTop: 0.21,
    trunkRadiusBottom: 0.29,
    trunkHeight: 4.42,
    trunkMaterial: new THREE.MeshStandardMaterial({ color: 0x4a3222 }),
    trunkPositionY: 2.21,
    foliageMaterial: new THREE.MeshStandardMaterial({ color: 0x1b4d3e }),
    // tři zužující se kužely nad sebou = siluetová vrstvená koruna (typický smrk/borovice)
    foliageLayers: [
      { geometry: new THREE.ConeGeometry(2.08, 2.73, 8), positionY: 3.9 },
      { geometry: new THREE.ConeGeometry(1.5, 2.47, 8), positionY: 5.53 },
      { geometry: new THREE.ConeGeometry(0.91, 2.21, 8), positionY: 7.02 }
    ],
    defaultSectorCount: 6,
    defaultWoodYield: 10
  }
};

let nextTreeId = 0;

export class TreeEntity {
  readonly id: string;
  readonly group: THREE.Group;
  readonly state: Choppable;

  private readonly variant: TreeVariantDefinition;
  private readonly wedgeMeshes: THREE.Mesh[];
  private readonly foliageMeshes: THREE.Mesh[];
  private fallAxis: THREE.Vector3 | null = null;
  physicsHandle: FallenLogHandle | null = null;

  get colliderRadius(): number {
    return this.variant.trunkRadiusBottom;
  }

  get trunkHeight(): number {
    return this.variant.trunkHeight;
  }

  constructor(config: TreeConfig) {
    this.id = `tree-${nextTreeId++}`;

    const variantKey = config.variant ?? 'oak';
    this.variant = TREE_VARIANTS[variantKey];

    const sectorCount = config.sectorCount ?? this.variant.defaultSectorCount;
    const wedgeGeometries = getIntactWedgeGeometries(variantKey, this.variant, sectorCount);
    this.wedgeMeshes = wedgeGeometries.map((geometry) => {
      const mesh = new THREE.Mesh(geometry, this.variant.trunkMaterial);
      mesh.position.y = this.variant.trunkPositionY;
      return mesh;
    });

    this.foliageMeshes = this.variant.foliageLayers.map((layer) => {
      const mesh = new THREE.Mesh(layer.geometry, this.variant.foliageMaterial);
      mesh.position.y = layer.positionY;
      return mesh;
    });

    this.group = new THREE.Group();
    this.group.add(...this.wedgeMeshes, ...this.foliageMeshes);
    this.group.position.copy(config.position);

    this.state = {
      kind: 'choppable',
      sectorCount,
      choppedSectors: new Set<number>(),
      lastHitSector: null,
      lifecycle: 'standing',
      fallProgress: 0,
      resource: { type: 'wood', amount: config.woodYield ?? this.variant.defaultWoodYield }
    };
  }

  registerHit(worldHitPoint: THREE.Vector3): ChopResult {
    if (this.state.lifecycle !== 'standing') {
      return { outcome: 'alreadyFallen', sectorsRemaining: this.remainingSectors(), woodGained: 0 };
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
      return { outcome: 'repeatedSector', sectorsRemaining: this.remainingSectors(), woodGained: 0 };
    }

    this.state.choppedSectors.add(sectorIndex);
    this.state.lastHitSector = sectorIndex;
    this.carveWedge(sectorIndex, sectorAngle, local.y);

    const remaining = this.remainingSectors();
    if (remaining === 0) {
      this.startFalling(sectorIndex, sectorAngle);
      return { outcome: 'felled', sectorsRemaining: 0, woodGained: this.state.resource.amount };
    }
    return { outcome: 'newSector', sectorsRemaining: remaining, woodGained: 0 };
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
    const end = start.clone().add(new THREE.Vector2(axis.x, axis.z).multiplyScalar(this.variant.trunkHeight));
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
    this.group.quaternion.setFromAxisAngle(this.fallAxis!, this.state.fallProgress * (Math.PI / 2));
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
  private carveWedge(sectorIndex: number, sectorAngle: number, hitY: number): void {
    const mesh = this.wedgeMeshes[sectorIndex];
    // Od teď patří jen tomuto klínu - přestává být sdílená s ostatními stromy stejné varianty.
    const carved = mesh.geometry.clone();
    const position = carved.attributes['position'] as THREE.BufferAttribute;
    // Záloha analytických normál - computeVertexNormals níže je potřeba jen pro samotný
    // zásek (viz konec metody), jinde by přepočtené (průměrované) normály neseděly s tím,
    // co má sousední klín, a na švu by vznikla viditelná čára.
    const originalNormal = (carved.attributes['normal'] as THREE.BufferAttribute).clone();
    const displaced = new Uint8Array(position.count);

    const halfHeight = this.variant.trunkHeight / 2;
    const margin = 0.2;
    const wedgeLocalHitY = THREE.MathUtils.clamp(
      hitY - this.variant.trunkPositionY,
      -halfHeight + margin,
      halfHeight - margin
    );
    const midAngle = (sectorIndex + 0.5) * sectorAngle;
    // Poloviční šířka samotného záseku - záměrně menší než polovina celého klínu, aby
    // zásek nezabíral skoro celou tvář klínu a zůstal ostrý, úzký "kousek".
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
      // Lineární (ne smoothstep) - ostrá hrana záseku. Nulu dosáhne dřív, než narazí na
      // hranici klínu, takže se švu se sousedem nikdy nedotkne.
      const angularFalloff = Math.max(0, 1 - Math.abs(normalizedAngle - midAngle) / notchHalfWidth);
      if (angularFalloff <= 0) continue;

      // Výškově záměrně lineární (ne smoothstep) - ostřejší "véčkový" zásek jako od sekery,
      // ne pozvolný kulatý důlek.
      const verticalFalloff = Math.max(0, 1 - Math.abs(vy - wedgeLocalHitY) / NOTCH_FALLOFF_HEIGHT);
      const falloff = angularFalloff * verticalFalloff;
      if (falloff <= 0) continue;

      const newRadius = Math.max(radius - NOTCH_DEPTH * falloff, radius * NOTCH_MIN_RADIUS_FRACTION);
      const scale = newRadius / radius;
      position.setX(i, vx * scale);
      position.setZ(i, vz * scale);
      displaced[i] = 1;
    }

    position.needsUpdate = true;
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
    this.fallAxis = new THREE.Vector3(fallDir.z, 0, -fallDir.x).normalize();

    for (const mesh of this.foliageMeshes) this.group.remove(mesh);

    this.state.lifecycle = 'falling';
    this.state.fallProgress = 0;
  }
}
