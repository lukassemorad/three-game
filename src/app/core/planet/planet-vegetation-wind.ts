import * as THREE from 'three';
import { PLANET_CENTER } from './planet-config';

// Vítr pro vegetaci na kouli.
//
// Proč nešel použít vegetation-wind.ts z plochého světa: fáze vlny se tam počítá jako
// `dot(worldPos.xz, windDir2D)`, tedy projekcí do world XZ. Na kouli to degeneruje - u „pólů"
// world-Y osy má celá čepička skoro stejnou fázi a vlnila by se naráz. A směr výchylky se
// přičítá v lokálním XZ dávky, což platí jen když je dávka rovnoběžná s terénem.
//
// Sférická verze je celá ve world space:
//   - fáze = `dot(worldPos, windDir3)` - rovinná vlna procházející prostorem, na povrchu
//     kouleto dá pásy putující podél směru větru. Nikde nedegeneruje ani nemá šev.
//   - směr výchylky = tangenciální složka windDir3 v daném bodě, tedy vítr „obtéká" kouli.
//     Vynuluje se jen ve dvou bodech, kde vítr fouká přesně do země - a tam je nulová
//     výchylka fyzikálně správná.
// Výchylka se pak přičítá až ve view space, takže nezávisí na orientaci instance ani dávky.

const WIND_DIRECTION = new THREE.Vector3(0.82, 0.31, 0.48).normalize();

export const PLANET_WIND_CONFIG = {
  speed: 1.6, // rad/s - rychlost putování vlny v čase
  amplitude: 0.05, // m - max. boční výchylka vrcholu stébla
  spatialFrequency: 0.6, // rad/m - vlnová délka ~10 m
  heightExponent: 1.6 // >1 = výchylka roste k vrcholu nelineárně
} as const;

// Jedna sdílená sada uniformů pro všechny wind materiály - update času na jednom místě
// (PlanetVegetationService.tick) se promítne do všech dávek.
const windUniforms = {
  time: { value: 0 },
  direction: { value: WIND_DIRECTION.clone() },
  planetCenter: { value: PLANET_CENTER.clone() },
  speed: { value: PLANET_WIND_CONFIG.speed },
  amplitude: { value: PLANET_WIND_CONFIG.amplitude },
  spatialFrequency: { value: PLANET_WIND_CONFIG.spatialFrequency },
  heightExponent: { value: PLANET_WIND_CONFIG.heightExponent }
};

export function updatePlanetWindTime(elapsedSeconds: number): void {
  windUniforms.time.value = elapsedSeconds;
}

const UNIFORM_DECLARATIONS = /* glsl */ `
uniform float uPlanetWindMinY;
uniform float uPlanetWindMaxY;
uniform vec3 uPlanetWindDirection;
uniform vec3 uPlanetWindCenter;
uniform float uPlanetWindTime;
uniform float uPlanetWindSpeed;
uniform float uPlanetWindAmplitude;
uniform float uPlanetWindSpatialFrequency;
uniform float uPlanetWindHeightExponent;
`;

// Výškový faktor bere `position.y`, tedy atribut geometrie v *modelovém* prostoru (loader
// normalizuje model tak, že roste v +Y s pivotem u paty). Orientace instance na to nemá vliv,
// takže tahle část je stejná jako v plochém světě.
const BEGIN_VERTEX_INJECTION = /* glsl */ `
#include <begin_vertex>

float planetWindSway = 0.0;
vec3 planetWindSwayDir = vec3( 0.0 );
#ifdef USE_INSTANCING
{
  vec3 planetWindInstancePos = ( modelMatrix * vec4( instanceMatrix[ 3 ].xyz, 1.0 ) ).xyz;
  float planetWindHeightT = clamp(
    ( position.y - uPlanetWindMinY ) / max( uPlanetWindMaxY - uPlanetWindMinY, 1e-4 ),
    0.0,
    1.0
  );
  float planetWindFalloff = pow( planetWindHeightT, uPlanetWindHeightExponent );
  float planetWindPhase = dot( planetWindInstancePos, uPlanetWindDirection ) * uPlanetWindSpatialFrequency
    + uPlanetWindTime * uPlanetWindSpeed;
  planetWindSway = sin( planetWindPhase ) * uPlanetWindAmplitude * planetWindFalloff;

  vec3 planetWindNormal = normalize( planetWindInstancePos - uPlanetWindCenter );
  vec3 planetWindTangent = uPlanetWindDirection - planetWindNormal * dot( uPlanetWindDirection, planetWindNormal );
  float planetWindTangentLen = length( planetWindTangent );
  planetWindSwayDir = planetWindTangentLen > 1e-4 ? planetWindTangent / planetWindTangentLen : vec3( 0.0 );
}
#endif
`;

// Kopie three@^0.185.1 ShaderChunk/project_vertex.glsl.js + blok navíc. Výchylka se přičítá
// až PO modelViewMatrix, ve view space - směr výchylky je world vektor, takže se sem
// dostane přes viewMatrix (w=0, tedy jen rotace). Tím je posun nezávislý na rotaci instance
// i celé dávky, což je přesně to, co na kouli potřebujeme.
// POZOR při upgradu three.js: zkontrolovat diff proti aktuálnímu obsahu tohoto chunku.
const PROJECT_VERTEX_INJECTION = /* glsl */ `
vec4 mvPosition = vec4( transformed, 1.0 );

#ifdef USE_BATCHING
	mvPosition = batchingMatrix * mvPosition;
#endif

#ifdef USE_INSTANCING
	mvPosition = instanceMatrix * mvPosition;
#endif

mvPosition = modelViewMatrix * mvPosition;

#ifdef USE_INSTANCING
	mvPosition.xyz += ( viewMatrix * vec4( planetWindSwayDir, 0.0 ) ).xyz * planetWindSway;
#endif

gl_Position = projectionMatrix * mvPosition;
`;

export function applyPlanetWindShader(
  material: THREE.MeshStandardMaterial,
  minY: number,
  maxY: number
): THREE.MeshStandardMaterial {
  const windMaterial = material.clone();
  windMaterial.onBeforeCompile = (shader) => {
    shader.uniforms['uPlanetWindMinY'] = { value: minY };
    shader.uniforms['uPlanetWindMaxY'] = { value: maxY };
    shader.uniforms['uPlanetWindDirection'] = windUniforms.direction;
    shader.uniforms['uPlanetWindCenter'] = windUniforms.planetCenter;
    shader.uniforms['uPlanetWindTime'] = windUniforms.time;
    shader.uniforms['uPlanetWindSpeed'] = windUniforms.speed;
    shader.uniforms['uPlanetWindAmplitude'] = windUniforms.amplitude;
    shader.uniforms['uPlanetWindSpatialFrequency'] = windUniforms.spatialFrequency;
    shader.uniforms['uPlanetWindHeightExponent'] = windUniforms.heightExponent;

    shader.vertexShader = shader.vertexShader
      .replace('void main() {', `${UNIFORM_DECLARATIONS}\nvoid main() {`)
      .replace('#include <begin_vertex>', BEGIN_VERTEX_INJECTION)
      .replace('#include <project_vertex>', PROJECT_VERTEX_INJECTION);
  };
  return windMaterial;
}
