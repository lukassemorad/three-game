import * as THREE from 'three';
import { VegetationVariant } from '../../shared/models/vegetation.model';

// Nízká vegetace, kde je vlnění ve větru vidět a očekávané - keře/houby/stromy z toho jsou
// záměrně vyňaty (u nich by plošné vlnění vypadalo nepatřičně).
export const WIND_AFFECTED_VARIANTS: ReadonlySet<VegetationVariant> = new Set<VegetationVariant>([
  'grassPatch',
  'tuftOfGrass',
  'dandelions',
  'tulip'
]);

const WIND_DIRECTION_DEGREES = 35; // 0 = +X, 90 = +Z (world-space)
const windAngle = (WIND_DIRECTION_DEGREES * Math.PI) / 180;

// Napevno zadrátované konstanty - žádný "wind service", ale odděleně od vegetation.config.ts
// (asset-defy), takže budoucí napojení na systém počasí sahá jen do tohoto souboru.
export const WIND_CONFIG = {
  direction: { x: Math.cos(windAngle), z: Math.sin(windAngle) },
  speed: 1.6, // rad/s - rychlost putování vlny v čase
  amplitude: 0.05, // m - max. boční výchylka vrcholu stébla
  spatialFrequency: 0.6, // rad/m - "vlnová délka" přes pole
  heightExponent: 1.6 // >1 = výchylka roste k vrcholu nelineárně
} as const;

// Jedna sdílená sada uniformů - referencovaná všemi wind materiály, takže update time.value
// na jednom místě (VegetationService.tick) se promítne do všech najednou.
const windUniforms = {
  time: { value: 0 },
  direction: { value: new THREE.Vector2(WIND_CONFIG.direction.x, WIND_CONFIG.direction.z).normalize() },
  speed: { value: WIND_CONFIG.speed },
  amplitude: { value: WIND_CONFIG.amplitude },
  spatialFrequency: { value: WIND_CONFIG.spatialFrequency },
  heightExponent: { value: WIND_CONFIG.heightExponent }
};

export function updateVegetationWindTime(elapsedSeconds: number): void {
  windUniforms.time.value = elapsedSeconds;
}

const UNIFORM_DECLARATIONS = /* glsl */ `
uniform float uVegWindMinY;
uniform float uVegWindMaxY;
uniform vec2 uVegWindDirection;
uniform float uVegWindTime;
uniform float uVegWindSpeed;
uniform float uVegWindAmplitude;
uniform float uVegWindSpatialFrequency;
uniform float uVegWindHeightExponent;
`;

// vegWindSway se spočítá tady (v lokálním prostoru, dřív než se position vůbec transformuje),
// ale přičte se až v project_vertex - AŽ PO instanceMatrix (viz komentář tam).
const BEGIN_VERTEX_INJECTION = /* glsl */ `
#include <begin_vertex>

float vegWindSway = 0.0;
#ifdef USE_INSTANCING
{
  vec3 vegWindInstancePos = ( modelMatrix * vec4( instanceMatrix[ 3 ].xyz, 1.0 ) ).xyz;
  float vegWindHeightT = clamp( ( position.y - uVegWindMinY ) / max( uVegWindMaxY - uVegWindMinY, 1e-4 ), 0.0, 1.0 );
  float vegWindFalloff = pow( vegWindHeightT, uVegWindHeightExponent );
  float vegWindPhase = dot( vegWindInstancePos.xz, uVegWindDirection ) * uVegWindSpatialFrequency
    + uVegWindTime * uVegWindSpeed;
  vegWindSway = sin( vegWindPhase ) * uVegWindAmplitude * vegWindFalloff;
}
#endif
`;

// Kopie three@^0.185.1 ShaderChunk/project_vertex.glsl.js + 2 řádky navíc. Sway se přičítá AŽ
// PO instanceMatrix, protože každé stéblo má náhodnou rotationY (viz instanced-vegetation-batch.ts)
// - kdyby se world-aligned směr větru aplikoval před rotací instance, každé stéblo by se hnulo
// jiným směrem a vítr by vypadal chaoticky místo jednotného směru přes celé pole.
// POZOR při upgradu three.js: zkontrolovat diff proti aktuálnímu obsahu tohoto chunku.
const PROJECT_VERTEX_INJECTION = /* glsl */ `
vec4 mvPosition = vec4( transformed, 1.0 );

#ifdef USE_BATCHING
	mvPosition = batchingMatrix * mvPosition;
#endif

#ifdef USE_INSTANCING
	mvPosition = instanceMatrix * mvPosition;
	mvPosition.x += vegWindSway * uVegWindDirection.x;
	mvPosition.z += vegWindSway * uVegWindDirection.y;
#endif

mvPosition = modelViewMatrix * mvPosition;

gl_Position = projectionMatrix * mvPosition;
`;

export function applyWindShader(
  material: THREE.MeshStandardMaterial,
  minY: number,
  maxY: number
): THREE.MeshStandardMaterial {
  const windMaterial = material.clone();
  windMaterial.onBeforeCompile = (shader) => {
    shader.uniforms['uVegWindMinY'] = { value: minY };
    shader.uniforms['uVegWindMaxY'] = { value: maxY };
    shader.uniforms['uVegWindDirection'] = windUniforms.direction;
    shader.uniforms['uVegWindTime'] = windUniforms.time;
    shader.uniforms['uVegWindSpeed'] = windUniforms.speed;
    shader.uniforms['uVegWindAmplitude'] = windUniforms.amplitude;
    shader.uniforms['uVegWindSpatialFrequency'] = windUniforms.spatialFrequency;
    shader.uniforms['uVegWindHeightExponent'] = windUniforms.heightExponent;

    shader.vertexShader = shader.vertexShader
      .replace('void main() {', `${UNIFORM_DECLARATIONS}\nvoid main() {`)
      .replace('#include <begin_vertex>', BEGIN_VERTEX_INJECTION)
      .replace('#include <project_vertex>', PROJECT_VERTEX_INJECTION);
  };
  return windMaterial;
}
