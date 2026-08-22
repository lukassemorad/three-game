import * as THREE from 'three';
import { GroundCoverVariant } from '../../shared/models/vegetation.model';
import { positionHash } from '../world/position-hash';
import { VEGETATION_DEFS } from '../world/vegetation.config';
import { PlanetTile } from './goldberg-mesh';
import { TileData, getBiomeDefinition } from './planet-biome';
import { PlanetTerrain } from './planet-terrain';
import { GROUND_COVER_PER_SQUARE_METER, PLANET_RADIUS } from './planet-config';

// Rozmístění ground-coveru po povrchu planety.
//
// Proti plochému světu tu úplně zmizelo rejection sampling (vegetation-placement.ts losuje
// body v x/z obdélníku a zahazuje ty mimo biom, s MAX_PLACEMENT_ATTEMPTS jako stropem).
// Dlaždice je herní jednotka, takže se místo toho iteruje po dlaždicích a body se losují
// *uvnitř* dlaždice - rovnoměrnost a determinismus jsou tím zdarma a nic se nezahazuje.

export interface PlanetVegetationPlacement {
  readonly position: THREE.Vector3;
  // Radiální normála v místě instance - podle ní se instance zarovná, aby stébla stála
  // kolmo k povrchu.
  readonly up: THREE.Vector3;
  // Dlaždice, ze které bod vznikl. Nese se s sebou, protože dohledávat ji zpětně přes
  // PlanetTileIndex by znamenalo stovky tisíc hledání při startu - a navíc by u hranic
  // nevyšla vždycky stejná: rohy dlaždice jsou centroidy okolních trojúhelníků, což není
  // úplně totožné s Voronoiho buňkou „nejbližší střed", takže pár promile bodů leží
  // geometricky o hranu vedle.
  readonly tile: number;
  readonly variant: GroundCoverVariant;
  readonly rotation: number;
  readonly scale: number;
  readonly tint: number;
}

// Vážené losování z předaného rollu 0..1. Nejde použít pickWeightedVariant z world/, protože
// ten si bere Math.random() - placement musí být deterministický, aby planeta vypadala po
// reloadu stejně (viz test na determinismus).
function pickWeighted<TVariant extends string>(
  weights: Record<TVariant, number>,
  roll: number
): TVariant {
  const entries = Object.entries(weights) as Array<[TVariant, number]>;
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  let remaining = roll * total;
  for (const [variant, weight] of entries) {
    remaining -= weight;
    if (remaining <= 0) return variant;
  }
  return entries[entries.length - 1][0];
}

// Několik nezávislých pseudonáhodných streamů z dvojice (dlaždice, vzorek). Offsety jen
// posouvají vzorkovací bod v hashovaném poli, aby jednotlivé streamy nekorelovaly - stejný
// princip jako getVisualVariation v position-hash.ts.
function stream(tileIndex: number, sampleIndex: number, salt: number): number {
  return positionHash(tileIndex + salt * 37.13, sampleIndex - salt * 11.71);
}

export function generatePlanetVegetation(
  tiles: readonly PlanetTile[],
  tileData: readonly TileData[],
  terrain: PlanetTerrain
): PlanetVegetationPlacement[] {
  // Dlaždice jsou téměř stejně velké, takže průměrná plocha stačí a nemusí se počítat
  // sférický obsah každého mnohoúhelníku zvlášť.
  const tileArea = (4 * Math.PI * PLANET_RADIUS * PLANET_RADIUS) / tiles.length;
  const perTile = Math.max(0, Math.round(tileArea * GROUND_COVER_PER_SQUARE_METER));

  const placements: PlanetVegetationPlacement[] = [];
  const sampleDir = new THREE.Vector3();

  tiles.forEach((tile, tileIndex) => {
    const vegetation = getBiomeDefinition(tileData[tileIndex].biome).vegetation;
    // Biomy bez vegetační konfigurace (dnes highlands a mountains) zůstanou holé - je to
    // vlastnost biome.config.ts, ne opomenutí; přidáním `vegetation` k nim tam tráva naroste.
    if (!vegetation) return;

    const cornerCount = tile.cornerDirs.length;

    for (let sample = 0; sample < perTile; sample++) {
      // Vějíř dlaždice: vyber trojúhelník (střed, roh i, roh i+1) a v něm bod barycentricky.
      const triangle = Math.min(
        cornerCount - 1,
        Math.floor(stream(tileIndex, sample, 1) * cornerCount)
      );
      let u = stream(tileIndex, sample, 2);
      let v = stream(tileIndex, sample, 3);
      // Zrcadlení přes úhlopříčku - jinak by body padaly jen do poloviny čtverce, ne
      // rovnoměrně do trojúhelníku.
      if (u + v > 1) {
        u = 1 - u;
        v = 1 - v;
      }

      const cornerA = tile.cornerDirs[triangle];
      const cornerB = tile.cornerDirs[(triangle + 1) % cornerCount];
      sampleDir
        .copy(tile.centerDir)
        .addScaledVector(cornerA.clone().sub(tile.centerDir), u)
        .addScaledVector(cornerB.clone().sub(tile.centerDir), v)
        .normalize();

      const variant = pickWeighted(
        vegetation.groundCoverWeights,
        stream(tileIndex, sample, 4)
      );
      const range = VEGETATION_DEFS[variant].variation;

      placements.push({
        position: sampleDir.clone().multiplyScalar(terrain.getSurfaceRadius(sampleDir)),
        up: sampleDir.clone(),
        tile: tileIndex,
        variant,
        rotation: stream(tileIndex, sample, 5) * Math.PI * 2,
        scale: range.scaleMin + stream(tileIndex, sample, 6) * range.scaleRange,
        tint: range.tintMin + stream(tileIndex, sample, 7) * range.tintRange
      });
    }
  });

  return placements;
}
