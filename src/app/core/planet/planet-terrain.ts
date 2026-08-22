import * as THREE from 'three';
import { ImprovedNoise } from 'three/addons/math/ImprovedNoise.js';
import {
  MASSIF_ELEVATION,
  MASSIF_FREQ,
  MASSIF_THRESHOLD_HIGH,
  MASSIF_THRESHOLD_LOW,
  MAX_ELEVATION,
  PLANET_RADIUS,
  RELIEF_BASE_AMPLITUDE,
  RELIEF_BASE_FREQ,
  RELIEF_DETAIL_AMPLITUDE,
  RELIEF_DETAIL_FREQ,
  RIDGE_AMPLITUDE,
  RIDGE_EXPONENT,
  RIDGE_FREQ_1,
  RIDGE_FREQ_2
} from './planet-config';

// Tvar povrchu planety. Obdoba TerrainGenerator z plochého světa, jen s doménou
// "normalizovaný směr od středu" místo (x, z).
//
// Klíčová výhoda 3D noise: ImprovedNoise.noise(x,y,z) se vzorkuje přímo na směrovém
// vektoru, takže na kouli nevznikají žádné švy ani singularity na pólech. Klasická 2D
// lat/long heightmapa by měla obojí.

export interface TerrainSample {
  // Vzdálenost povrchu od středu planety.
  readonly surfaceRadius: number;
  // Výška nad PLANET_RADIUS znormalizovaná do 0..1 podle MAX_ELEVATION.
  readonly elevation: number;
  // Jak silně je bod v horském masivu (0..1). Řídí relief i biom, takže hory a horský biom
  // sedí na sebe.
  readonly massif: number;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

// Vzdálenost, na které se měří sklon. Stejná hodnota jako SLOPE_SAMPLE_STEP v plochém světě -
// dost velká, aby se neměřil jemný noise, dost malá, aby to byl lokální sklon.
const SLOPE_SAMPLE_STEP = 0.4;

export class PlanetTerrain {
  // Oddělená noise pole pro tvar, masku a hřebeny - jinak by maska korelovala s tvarem
  // a masivy by vždy sedly na stejná místa jako velkoplošné vlny.
  private readonly shapeNoise = new ImprovedNoise();
  private readonly massifNoise = new ImprovedNoise();
  private readonly ridgeNoise = new ImprovedNoise();

  // Scratch vektory pro getSlopeAlongDirection - volá se každý frame jízdy, takže se tu
  // nealokuje.
  private readonly slopeTangent = new THREE.Vector3();
  private readonly slopeAhead = new THREE.Vector3();

  // Jediná definice povrchu - používá ji vizuální mesh, trimesh collider i analytický
  // debug ground-snap, takže se nemohou rozejít.
  getSurfaceRadius(dir: THREE.Vector3): number {
    return PLANET_RADIUS + this.getElevationMeters(dir);
  }

  sample(dir: THREE.Vector3): TerrainSample {
    const meters = this.getElevationMeters(dir);
    return {
      surfaceRadius: PLANET_RADIUS + meters,
      elevation: THREE.MathUtils.clamp(meters / MAX_ELEVATION, 0, 1),
      massif: this.getMassif(dir)
    };
  }

  // Sklon povrchu ve zvoleném tečném směru (kladné = do kopce). Sférická obdoba
  // ThreeSceneService.getSlopeAlongDirection - vzorkuje se o krok dál po povrchu a porovná
  // se poloměr. `tangent` nemusí být přesně tečný ani jednotkový, radiální složka se odečte.
  getSlopeAlongDirection(dir: THREE.Vector3, tangent: THREE.Vector3): number {
    this.slopeTangent.copy(tangent);
    this.slopeTangent.addScaledVector(dir, -this.slopeTangent.dot(dir));
    if (this.slopeTangent.lengthSq() < 1e-8) return 0;
    this.slopeTangent.normalize();

    // Krok po povrchu: posun v tečné rovině a promítnutí zpátky na jednotkovou kouli. Pro
    // krok řádově decimetrů je rozdíl proti pohybu po velké kružnici zanedbatelný.
    this.slopeAhead
      .copy(dir)
      .addScaledVector(this.slopeTangent, SLOPE_SAMPLE_STEP / PLANET_RADIUS)
      .normalize();

    const here = this.getSurfaceRadius(dir);
    const ahead = this.getSurfaceRadius(this.slopeAhead);
    return (ahead - here) / SLOPE_SAMPLE_STEP;
  }

  getMassif(dir: THREE.Vector3): number {
    const raw = this.massifNoise.noise(
      dir.x * MASSIF_FREQ,
      dir.y * MASSIF_FREQ,
      dir.z * MASSIF_FREQ
    );
    return smoothstep(MASSIF_THRESHOLD_LOW, MASSIF_THRESHOLD_HIGH, raw);
  }

  private getElevationMeters(dir: THREE.Vector3): number {
    const base = this.shapeNoise.noise(
      dir.x * RELIEF_BASE_FREQ,
      dir.y * RELIEF_BASE_FREQ,
      dir.z * RELIEF_BASE_FREQ
    );
    const detail = this.shapeNoise.noise(
      dir.x * RELIEF_DETAIL_FREQ,
      dir.y * RELIEF_DETAIL_FREQ,
      dir.z * RELIEF_DETAIL_FREQ
    );
    const massif = this.getMassif(dir);

    // Ridged noise: 1-|noise| dá hřebeny místo kopců, exponent je zaostří.
    const ridgeA = Math.pow(
      1 -
        Math.abs(
          this.ridgeNoise.noise(dir.x * RIDGE_FREQ_1, dir.y * RIDGE_FREQ_1, dir.z * RIDGE_FREQ_1)
        ),
      RIDGE_EXPONENT
    );
    const ridgeB = Math.pow(
      1 -
        Math.abs(
          this.ridgeNoise.noise(dir.x * RIDGE_FREQ_2, dir.y * RIDGE_FREQ_2, dir.z * RIDGE_FREQ_2)
        ),
      RIDGE_EXPONENT
    );
    const ridge = (ridgeA * 0.65 + ridgeB * 0.35) * RIDGE_AMPLITUDE;

    // Hřebeny i vyzdvižení masivu se násobí maskou, takže mimo masivy zůstává krajina
    // zvlněná, ne hornatá. `base` je posunutý do 0..1, takže PLANET_RADIUS je (skoro) dno
    // terénu, ne jeho střed - hlouběji než o RELIEF_DETAIL_AMPLITUDE se povrch nedostane.
    const rolling = (base * 0.5 + 0.5) * RELIEF_BASE_AMPLITUDE;
    const fine = detail * RELIEF_DETAIL_AMPLITUDE;
    return rolling + fine + massif * (MASSIF_ELEVATION + ridge);
  }
}
