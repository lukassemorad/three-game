import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Klidová (view-model) pozice v lokálních souřadnicích kamery - vpravo dole, mírně
// natočená, jako obvyklá FPS "ruka".
const REST_POSITION = new THREE.Vector3(0.34, -0.42, -0.42);
const REST_ROTATION = new THREE.Euler(0.15, -0.35, 0.25);
// Quaternion předpočítaný z klidové rotace - animace se na něj násobí (ne přímo
// přepisují Euler.x/y), jinak by se kombinace s naklopením v REST_ROTATION projevila
// jako pokřivený pohyb do strany místo čistého pohybu kolem osy ruky (viz update() níže).
const REST_QUATERNION = new THREE.Quaternion().setFromEuler(REST_ROTATION);

const SWING_AXIS = new THREE.Vector3(1, 0, 0);
// Sekundární osa pro diagonální/twistové seknutí - kombinuje se s SWING_AXIS násobením
// dvou quaternionů (ne sečtením úhlů), takže výsledná rotace není jen "překlopení kolem
// jedné osy", ale mírně kroucené seknutí (jako otočení zápěstí při skutečném seku sekerou).
const SWING_TWIST_AXIS = new THREE.Vector3(0, 0, 1);

// O něco delší než původních 0.25 s - dává prostor nápřahu a seknutí, aby byly čitelné,
// při zachování svižnosti (viz swingEase() níže pro rozdělení na fáze).
const SWING_DURATION_SECONDS = 0.3;
// Nápřah + samotné seknutí dohromady tvoří menšinu celkové délky, zbytek je hladké
// dosednutí zpět do klidu - napodobuje animátorské principy anticipation/action/follow-through.
const SWING_WINDUP_FRACTION = 0.22;
const SWING_STRIKE_FRACTION = 0.28;
// Jak hluboko nápřah "couvne" oproti vrcholu seknutí (1 = stejně hluboko jako vrchol seknutí,
// 0 = žádný nápřah / dřívější chování). 0.35 = znatelné, ale ne přehnané couvnutí.
const SWING_WINDUP_DEPTH = 0.35;

// Švih = houpnutí ruky dozadu/nahoru (nápřah), pak dopředu/dolů přes vrchol (seknutí) a
// zpět do klidu. Amplitudy níže se násobí znaménkovou křivkou swingEase() (viz update()) -
// záporná hodnota v nápřahu proto automaticky vychýlí ruku OPAČNÝM směrem než při seknutí.
const SWING_DROP_Y = 0.05;
const SWING_FORWARD_Z = -0.32;
// Boční posun pro pocit oblouku (arc) - při nápřahu ruka mírně vyjede do strany (dál od
// středu), při seknutí prosviští opačným směrem (přes tělo), místo přímočarého pohybu.
const SWING_ARC_X = -0.1;
const SWING_ROTATION_X = -0.6;
// Twist/kroucení kolem druhé osy - menší amplituda než hlavní pitch, aby bylo doplňkové
// (dělá ze seknutí diagonální švih), ne dominantní nad hlavním pohybem dolů.
const SWING_TWIST_Z = 0.3;

const INSPECT_AXIS = new THREE.Vector3(0, 1, 0);
const INSPECT_DURATION_SECONDS = 2;
// Prohlédnutí = vytažení ruky blíž k obrazovce/výš a pomalé pootočení, ať jde vidět
// i z jiného úhlu - stejný princip jako "inspect" animace nástroje ve zbrani ve FPS hrách.
const INSPECT_RIGHT_OFFSET = -0.22;
const INSPECT_UP_OFFSET = 0.3;
const INSPECT_FORWARD_OFFSET = 0.2;
const INSPECT_ROTATION_Y = 1.8;

const handMaterial = new THREE.MeshStandardMaterial({ color: 0xe0ac69 });

type HandAction = 'idle' | 'swing' | 'inspect';

// Znaménková křivka švihu: 0 -> -WINDUP_DEPTH (nápřah) -> 1 (vrchol seknutí) -> 0 (klid).
// Každá fáze používá smoothstep s nulovou rychlostí na svém konci/začátku, takže hodnota
// i rychlost sedí přesně na obou vnitřních švech (žádný skok, žádný znatelný zlom) a na
// t=0/t=1 křivka přesně odpovídá klidové póze (stejná záruka jako u původního sin(t*pi)),
// takže i rychlé opakované kliknutí (swing() reset elapsed=0 z libovolného bodu) zůstává
// dobře definované - nová animace vždy startuje čistě od t=0.
function swingEase(t: number): number {
  if (t < SWING_WINDUP_FRACTION) {
    const w = t / SWING_WINDUP_FRACTION;
    return -SWING_WINDUP_DEPTH * Math.sin(w * Math.PI * 0.5);
  }
  const strikeEnd = SWING_WINDUP_FRACTION + SWING_STRIKE_FRACTION;
  if (t < strikeEnd) {
    const s = (t - SWING_WINDUP_FRACTION) / SWING_STRIKE_FRACTION;
    const smooth = s * s * (3 - 2 * s);
    return -SWING_WINDUP_DEPTH + (1 + SWING_WINDUP_DEPTH) * smooth;
  }
  const r = (t - strikeEnd) / (1 - strikeEnd);
  const smooth = r * r * (3 - 2 * r);
  return 1 - smooth;
}

// Ruka poskládaná z primitivní geometrie (předloktí + pěst), sloučená do jednoho meshe
// stejnou technikou jako zdi v building.entity.ts - žádný GLTF loader/model asset v
// projektu není zapojen. `toolAnchor` je zatím prázdný uzel na vršku pěsti - místo, kam
// se později připojí vyměnitelný nástroj (sekera apod.).
export class PlayerHandEntity {
  readonly group: THREE.Group;
  readonly toolAnchor: THREE.Object3D;

  private action: HandAction = 'idle';
  private elapsed = 0;
  private readonly animQuaternion = new THREE.Quaternion();
  // Pomocné quaterniony na kombinaci dvou os švihu - drženy jako pole místo lokálních
  // proměnných, ať se v update() (voláno každý frame) nic nealokuje.
  private readonly pitchQuaternion = new THREE.Quaternion();
  private readonly twistQuaternion = new THREE.Quaternion();

  constructor() {
    this.group = new THREE.Group();
    this.group.position.copy(REST_POSITION);
    this.group.quaternion.copy(REST_QUATERNION);

    // Předloktí je záměrně dlouhé a jde daleko "za" pěst (dolů v lokálním prostoru ruky) -
    // po natočení REST_ROTATION zajíždí blízko ke kameře/mimo záběr, takže ruka vypadá
    // přichycená k hráči, ne jako osamocená kostka visící ve vzduchu.
    const forearm = new THREE.CylinderGeometry(0.06, 0.08, 1.05, 8).translate(0, -0.525, 0);
    const fist = new THREE.BoxGeometry(0.13, 0.13, 0.16).translate(0, 0.03, 0);
    const merged = mergeGeometries([forearm, fist]);
    forearm.dispose();
    fist.dispose();
    this.group.add(new THREE.Mesh(merged, handMaterial));

    this.toolAnchor = new THREE.Object3D();
    this.toolAnchor.position.set(0, 0.11, 0.04);
    this.group.add(this.toolAnchor);
  }

  // Vybavený nástroj se připojuje/odpojuje na toolAnchor - viz komentář u třídy výše.
  // Model se do ruky posílá už naškálovaný/natočený (stejná logika jako na poličce
  // v obchodě), tady se jen přichytí na místo.
  attachTool(model: THREE.Object3D): void {
    this.clearTool();
    this.toolAnchor.add(model);
  }

  // Modely nástrojů se cachují a klonují ve sdíleném loaderu (viz item-model-loader.ts) -
  // klon sdílí geometrii/materiál s cachovaným originálem, takže se tu nic nedisposuje,
  // jen odpojí ze scény.
  clearTool(): void {
    for (const child of [...this.toolAnchor.children]) {
      this.toolAnchor.remove(child);
    }
  }

  // Švih i prohlédnutí se navzájem přeruší - druhá akce vždy okamžitě nahradí tu první,
  // ať se spustí odkudkoli (klid, uprostřed druhé animace, nebo i uprostřed sebe sama
  // pro responzivní opakované klikání/mačkání).
  swing(): void {
    this.action = 'swing';
    this.elapsed = 0;
  }

  inspect(): void {
    this.action = 'inspect';
    this.elapsed = 0;
  }

  update(delta: number): void {
    if (this.action === 'idle') return;

    const duration = this.action === 'swing' ? SWING_DURATION_SECONDS : INSPECT_DURATION_SECONDS;
    this.elapsed = Math.min(duration, this.elapsed + delta);
    const t = this.elapsed / duration;

    if (this.action === 'swing') {
      const ease = swingEase(t);
      this.group.position.x = REST_POSITION.x + ease * SWING_ARC_X;
      this.group.position.y = REST_POSITION.y - ease * SWING_DROP_Y;
      this.group.position.z = REST_POSITION.z + ease * SWING_FORWARD_Z;
      this.pitchQuaternion.setFromAxisAngle(SWING_AXIS, ease * SWING_ROTATION_X);
      this.twistQuaternion.setFromAxisAngle(SWING_TWIST_AXIS, ease * SWING_TWIST_Z);
      this.animQuaternion.copy(this.pitchQuaternion).multiply(this.twistQuaternion);
    } else {
      const ease = Math.sin(t * Math.PI);
      this.group.position.x = REST_POSITION.x + ease * INSPECT_RIGHT_OFFSET;
      this.group.position.y = REST_POSITION.y + ease * INSPECT_UP_OFFSET;
      this.group.position.z = REST_POSITION.z + ease * INSPECT_FORWARD_OFFSET;
      this.animQuaternion.setFromAxisAngle(INSPECT_AXIS, ease * INSPECT_ROTATION_Y);
    }
    this.group.quaternion.copy(REST_QUATERNION).multiply(this.animQuaternion);

    if (this.elapsed >= duration) {
      this.action = 'idle';
      this.group.position.copy(REST_POSITION);
      this.group.quaternion.copy(REST_QUATERNION);
    }
  }
}
