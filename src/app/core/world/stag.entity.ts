import { isDevMode } from '@angular/core';
import * as THREE from 'three';
import { clone as cloneSkinnedModel } from 'three/addons/utils/SkeletonUtils.js';
import { WorldEntity } from './entity-service.base';
import { GrazeBehavior, GrazeState } from './graze-behavior';
import { AggroBehavior, AggroPhase } from './aggro-behavior';

export interface StagTemplate {
  readonly scene: THREE.Object3D;
  readonly animations: THREE.AnimationClip[];
}

// POZOR: číslo NENÍ v metrech, přestože position/collider (STAG_COLLIDER_RADIUS, spawn
// pozice, world bounds, tree/road radius...) jsou v reálných metrech. `model.scale.setScalar`
// normalizuje na Box3 výšku NAKLONOVANÉHO GLTF modelu, a ta neodpovídá metrické konvenci
// zbytku scény (stejná nekonzistence u FROG_HEIGHT=70 ve frog.entity.ts) - vyladěno okem
// tak, aby při STAG_HEIGHT = REFERENCE_STAG_HEIGHT zvíře vedle ostatních entit vypadalo
// cca REFERENCE_STAG_HEIGHT_METERS vysoké v kohoutku.
const STAG_HEIGHT = 150;
export const STAG_COLLIDER_RADIUS = 0.65;

const REFERENCE_STAG_HEIGHT = 170;
const REFERENCE_STAG_HEIGHT_METERS = 1.5;
// Skutečná metrická výška - použito jen pro `topY` kolideru (CollisionService), aby šlo
// jelena teoreticky přeskočit/vylézt na něj. Dopočtená poměrem ze STAG_HEIGHT (scale je
// uniformní `setScalar`, takže reálná výška škáluje lineárně s ním) - při změně STAG_HEIGHT
// (vizuální velikost) se tak automaticky srovná i kolize, není potřeba ladit dvě čísla zvlášť.
export const STAG_HEIGHT_METERS = STAG_HEIGHT * (REFERENCE_STAG_HEIGHT_METERS / REFERENCE_STAG_HEIGHT);

// Názvy klipů ověřené přímo v GLB souboru (prefixovaný tvar `AnimalArmature|...`, stejná
// konvence jako u frog - `FrogArmature|Frog_Idle`; soubor obsahuje i neprefixované duplicity,
// prefixovaná varianta je ta kanonická vázaná na armaturu).
const IDLE_CLIP_NAME = 'AnimalArmature|Idle';
const WALK_CLIP_NAME = 'AnimalArmature|Walk';
const GALLOP_CLIP_NAME = 'AnimalArmature|Gallop';
const EATING_CLIP_NAME = 'AnimalArmature|Eating';
const DEATH_CLIP_NAME = 'AnimalArmature|Death';
const ATTACK_CLIP_NAME = 'AnimalArmature|Attack_Headbutt';

const CROSSFADE_SECONDS = 0.2;

// Kolik zásahů aktivním nástrojem jelen vydrží, než "zemře" (zmizí + odměna) - viz
// StagEntity.registerHit / StagService.hit. Ladicí hodnota, ne odvozená z ničeho jiného.
export const STAG_MAX_HP = 10;

// Regenerace mimo boj - viz update()/registerHit() níže. Jelen po zásahu chvíli počká
// (STAG_REGEN_DELAY_SECONDS), a pokud se do té doby vrátí do 'graze' (přestal být v
// aggro), postupně doplňuje životy rychlostí STAG_REGEN_PER_SECOND až po STAG_MAX_HP.
const STAG_REGEN_DELAY_SECONDS = 5;
const STAG_REGEN_PER_SECOND = 1;

// Po smrtelném zásahu jelen zůstane ležet (Death klip, zamrzlý na posledním snímku)
// tuto dobu, než ho StagService skutečně odstraní ze scény (viz onDeath callback).
const DEATH_DESPAWN_SECONDS = 10;

// Chase/attack ladicí konstanty pro AggroBehavior - viz aggro-behavior.ts pro sémantiku.
// Rychlejší než hráčova MOVE_SPEED (6, viz three-scene.service.ts) - jinak by prchající
// hráč nikdy nemohl být dostižen a honička by vždy skončila jen leashem/timeoutem.
const AGGRO_CHASE_SPEED = 6.5;
const AGGRO_ATTACK_RANGE = 1.6; // STAG_COLLIDER_RADIUS (0.65) + rezerva na poloměr hráče
const AGGRO_ATTACK_COOLDOWN_SECONDS = 1;
const AGGRO_LEASH_RADIUS = 20; // max. vzdálenost od spawnu, než se jelen vzdá honičky
const AGGRO_LOSE_INTEREST_RADIUS = 15; // max. vzdálenost od hráče, než se jelen vzdá honičky
const AGGRO_MAX_SECONDS = 20; // bezpečnostní pojistka proti nekonečné honičce

// SkinnedMesh.raycast (viz three.js SkinnedMesh.js) testuje jen BIND-POSE geometrii, ne
// aktuálně animovanou pózu kostry - za cvalu/kopání se tak vizuální silueta a raycastovaný
// tvar rozjedou a klik na běžícího/kopajícího jelena často "mine". Neviditelný statický box
// (viz konstruktor) přidaný vedle animovaného modelu tenhle problém obchází - je vždy
// přesně tam, kde model právě stojí, bez ohledu na animaci. Mírně naddimenzovaný pro
// rezervu (paroží, ocas apod. mimo přesný bind-pose Box3).
const HITBOX_PADDING = 1.15;

// Kolider je půdorysně kruh (i s topY pořád jen kruhový sloupec, ne box) - vizualizace
// proto kreslí jen plochý prstenec na úrovni terénu. Jen v dev módu, ať v produkci
// nezatěžuje scénu navíc geometrií, kterou hráč nemá vidět.
const DEBUG_RING_COLOR = 0x00ff88;
const DEBUG_RING_THICKNESS = 0.04;
const DEBUG_RING_Y_OFFSET = 0.05;

// Wireframe kopie neviditelného raycast hitboxu (viz HITBOX_PADDING výše) - jen v dev
// módu, aby bylo přesně vidět, kam je potřeba mířit, než se v raycastu spolehneme na
// animovaný model. Čistě diagnostický nástroj, nijak neovlivňuje samotný raycast (ten
// míří na `hitbox` níže bez ohledu na to, jestli je tenhle helper zapnutý).
const DEBUG_HITBOX_COLOR = 0xff00ff;

let nextStagId = 0;

export class StagEntity implements WorldEntity {
  readonly id: string;
  readonly group: THREE.Group;

  private readonly mixer: THREE.AnimationMixer;
  private readonly actionsByState: Record<GrazeState, THREE.AnimationAction>;
  private readonly attackAction: THREE.AnimationAction;
  private readonly deathAction: THREE.AnimationAction;
  private currentAction: THREE.AnimationAction;
  private readonly grazeBehavior: GrazeBehavior;
  private readonly aggroBehavior: AggroBehavior;
  private readonly onColliderMoved: (x: number, z: number, groundY: number) => void;
  private readonly onDeath: () => void;

  private mode: 'graze' | 'aggro' | 'dead' = 'graze';
  private hp = STAG_MAX_HP;
  private deathTimer = 0;
  private regenDelayRemaining = 0;

  get remainingHp(): number {
    // Zaokrouhleno jen pro zobrazení - interní `hp` zůstává necelé číslo díky plynulé
    // regeneraci v update() (STAG_REGEN_PER_SECOND * delta).
    return Math.round(this.hp);
  }

  constructor(
    position: THREE.Vector3,
    template: StagTemplate,
    getGroundHeight: (x: number, z: number) => number,
    onColliderMoved: (x: number, z: number, groundY: number) => void,
    getPlayerPosition: () => THREE.Vector3,
    onAttackPlayer: () => void,
    onDeath: () => void,
    onCombatEnd: () => void
  ) {
    this.id = `stag-${nextStagId++}`;
    this.onColliderMoved = onColliderMoved;
    this.onDeath = onDeath;

    // SkeletonUtils.clone (ne Object3D.clone) - jinak by klony sdílely skeleton a nešlo by
    // je animovat nezávisle na sobě. Klonuje celý object graph, tedy i oba meshe
    // (Stag, Stag_Horns), které visí pod stejným skeletonem.
    const model = cloneSkinnedModel(template.scene);
    const size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
    model.scale.setScalar(STAG_HEIGHT / Math.max(size.y, 0.0001));

    this.mixer = new THREE.AnimationMixer(model);
    const idleClip = THREE.AnimationClip.findByName(template.animations, IDLE_CLIP_NAME)!;
    const walkClip = THREE.AnimationClip.findByName(template.animations, WALK_CLIP_NAME)!;
    const gallopClip = THREE.AnimationClip.findByName(template.animations, GALLOP_CLIP_NAME)!;
    const eatingClip = THREE.AnimationClip.findByName(template.animations, EATING_CLIP_NAME)!;
    const deathClip = THREE.AnimationClip.findByName(template.animations, DEATH_CLIP_NAME)!;
    const attackClip = THREE.AnimationClip.findByName(template.animations, ATTACK_CLIP_NAME)!;

    this.actionsByState = {
      idle: this.mixer.clipAction(idleClip),
      walking: this.mixer.clipAction(walkClip),
      galloping: this.mixer.clipAction(gallopClip),
      grazing: this.mixer.clipAction(eatingClip)
    };
    this.currentAction = this.actionsByState.idle;
    this.currentAction.play();

    this.deathAction = this.mixer.clipAction(deathClip);
    // Jednorázově, zamrzlé na posledním snímku (jelen zůstane ležet) - na rozdíl od
    // ostatních akcí výše, které se donekonečna loopují.
    this.deathAction.setLoop(THREE.LoopOnce, 1);
    this.deathAction.clampWhenFinished = true;

    // Útočná animace se naopak loopuje (výchozí LoopRepeat) - dokud jelen stojí v
    // attackRange, opakovaně "trká" místo aby jen donekonečna běžel na místě v cvalu
    // (viz AggroBehavior.onPhaseChange níže).
    this.attackAction = this.mixer.clipAction(attackClip);
    // Samotný klip trvá výrazně kratší dobu než AGGRO_ATTACK_COOLDOWN_SECONDS (skutečná
    // perioda mezi jednotlivými zásahy - viz AggroBehavior.onAttack) - bez zpomalení by
    // LoopRepeat stihl přehrát několik švihů headbuttu na jeden reálný úder, což vypadá
    // jako hektický spam. timeScale dorovná délku jedné smyčky přesně na cooldown, ať
    // jeden vizuální švih odpovídá jednomu skutečnému zásahu.
    if (attackClip.duration > 0) {
      this.attackAction.timeScale = attackClip.duration / AGGRO_ATTACK_COOLDOWN_SECONDS;
    }

    // Výchozí (neposovaná/bind-pose) geometrie má nohy jinak než reálná Idle póza - offset
    // spočtený z ní by neseděl se skutečně vykresleným modelem. mixer.update(0) +
    // updateMatrixWorld přepózuje kosti do skutečné Idle pózy a precise Box3 pak měří
    // skutečné (skinované) vrcholy místo syrové T-pose geometrie.
    this.mixer.update(0);
    model.updateMatrixWorld(true);
    const groundOffset = new THREE.Box3().setFromObject(model, true).min.y;
    model.position.y = -groundOffset;

    // Box3 se počítá, dokud `model` ještě nemá rodiče - jeho matrixWorld je tak stejná
    // jako matice, kterou bude mít jako dítě `group` (parenting nemění lokální matici
    // dítěte), takže rozměry/střed jsou rovnou ve správném lokálním prostoru pro hitbox
    // níže, bez nutnosti odečítat pozici/rotaci spawnu. `precise = true` je tu nutné, ne
    // volitelné - bez něj Box3 použije jen `geometry.boundingBox` (bind-pose, neposovaná
    // T-pose geometrie protažená KOMBINOVANÝM měřítkem z armatury zapečeným přímo v GLB
    // uzlech), což dá naprosto nesmyslně obří box (viz stejný důvod u `groundOffset`
    // výše). S `precise = true` se měří skutečné, správně kostrou vyskinované vrcholy.
    const hitboxBounds = new THREE.Box3().setFromObject(model, true);
    const hitboxSize = hitboxBounds.getSize(new THREE.Vector3()).multiplyScalar(HITBOX_PADDING);
    const hitboxCenter = hitboxBounds.getCenter(new THREE.Vector3());

    this.group = new THREE.Group();
    this.group.position.copy(position);
    this.group.rotation.y = Math.random() * Math.PI * 2;
    this.group.add(model);

    // Neviditelný statický box - viz komentář u HITBOX_PADDING výše. `visible = false`
    // vypne vykreslování, ale THREE.Raycaster viditelnost nekontroluje (jen `layers`),
    // takže zůstává plně klikatelný.
    const hitbox = new THREE.Mesh(new THREE.BoxGeometry(hitboxSize.x, hitboxSize.y, hitboxSize.z));
    hitbox.visible = false;
    hitbox.position.copy(hitboxCenter);
    this.group.add(hitbox);

    if (isDevMode()) {
      const hitboxHelper = new THREE.Mesh(
        new THREE.BoxGeometry(hitboxSize.x, hitboxSize.y, hitboxSize.z),
        new THREE.MeshBasicMaterial({ color: DEBUG_HITBOX_COLOR, wireframe: true })
      );
      hitboxHelper.position.copy(hitboxCenter);
      this.group.add(hitboxHelper);

      const ringGeometry = new THREE.RingGeometry(
        STAG_COLLIDER_RADIUS - DEBUG_RING_THICKNESS,
        STAG_COLLIDER_RADIUS,
        32
      );
      const debugRing = new THREE.Mesh(
        ringGeometry,
        new THREE.MeshBasicMaterial({ color: DEBUG_RING_COLOR, side: THREE.DoubleSide })
      );
      debugRing.rotation.x = -Math.PI / 2;
      debugRing.position.y = DEBUG_RING_Y_OFFSET;
      // Přidán do `group`, ne do `model` - kolider sleduje `group.position` (viz
      // onColliderMoved v update()), takže musí zůstat nezávislý na modelově vlastním
      // scale/offsetu.
      this.group.add(debugRing);
    }

    this.grazeBehavior = new GrazeBehavior(this.group, {
      anchor: position.clone(),
      minIdleSeconds: 4,
      maxIdleSeconds: 9,
      minGrazeSeconds: 4,
      maxGrazeSeconds: 9,
      walkMinDistance: 3,
      walkMaxDistance: 8,
      walkSpeed: 1.2,
      gallopMinDistance: 10,
      gallopMaxDistance: 18,
      gallopSpeed: 5,
      getGroundHeight,
      onStateChange: (next) => this.crossfadeTo(next)
    });

    this.aggroBehavior = new AggroBehavior(this.group, {
      anchor: position.clone(),
      chaseSpeed: AGGRO_CHASE_SPEED,
      attackRange: AGGRO_ATTACK_RANGE,
      attackCooldownSeconds: AGGRO_ATTACK_COOLDOWN_SECONDS,
      leashRadius: AGGRO_LEASH_RADIUS,
      loseInterestRadius: AGGRO_LOSE_INTEREST_RADIUS,
      maxAggroSeconds: AGGRO_MAX_SECONDS,
      getPlayerPosition,
      getGroundHeight,
      onPhaseChange: (phase) => this.crossfadeToAggroPhase(phase),
      onAttack: onAttackPlayer,
      onGiveUp: () => {
        this.mode = 'graze';
        this.grazeBehavior.enterIdle();
        onCombatEnd();
      }
    });
  }

  private crossfadeTo(next: GrazeState): void {
    const nextAction = this.actionsByState[next];
    if (nextAction === this.currentAction) return;
    this.currentAction.crossFadeTo(nextAction.reset().play(), CROSSFADE_SECONDS, false);
    this.currentAction = nextAction;
  }

  // Honička (cval) vs. kontaktní útok (headbutt) mají každá vlastní animaci - bez tohohle
  // by jelen po dosažení attackRange dál přehrával cval donekonečna, což vypadá, jako by
  // pořád "běžel" i když se ve skutečnosti už vůbec nehýbe.
  private crossfadeToAggroPhase(phase: AggroPhase): void {
    const nextAction = phase === 'chasing' ? this.actionsByState.galloping : this.attackAction;
    if (nextAction === this.currentAction) return;
    this.currentAction.crossFadeTo(nextAction.reset().play(), CROSSFADE_SECONDS, false);
    this.currentAction = nextAction;
  }

  // Volá StagService po zásahu aktivním nástrojem - vrací 'killed', pokud tenhle zásah
  // vyčerpal poslední životy (StagService na to hned odregistruje interactable/kolider a
  // připíše odměnu, stejně jako u TreeService.chop `felled`; samotné zmizení ze scény ale
  // přijde až po DEATH_DESPAWN_SECONDS - viz update()/onDeath), jinak rozzuří jelena
  // (přepne na honičku hráče).
  registerHit(damage: number): 'hit' | 'killed' {
    this.hp -= damage;
    this.regenDelayRemaining = STAG_REGEN_DELAY_SECONDS;
    if (this.hp <= 0) {
      this.mode = 'dead';
      this.deathTimer = DEATH_DESPAWN_SECONDS;
      this.currentAction.crossFadeTo(this.deathAction.reset().play(), CROSSFADE_SECONDS, false);
      this.currentAction = this.deathAction;
      return 'killed';
    }

    if (this.mode !== 'aggro') {
      // Plný start - animaci (cval/útok) nastaví hned první update() přes onPhaseChange
      // podle skutečné vzdálenosti k hráči v tu chvíli.
      this.mode = 'aggro';
      this.aggroBehavior.start(this.group.position);
    } else {
      // Další zásah během JIŽ probíhající honičky jen prodlouží dobu do vzdání se (viz
      // AggroBehavior.extend) - neresetuje cooldown útoku, jinak by každý úspěšný zásah
      // hráče vyvolal okamžitou odvetu jelena a souboj by pak vypadal jako nepřetržitá
      // výměna úderů.
      this.aggroBehavior.extend();
    }
    return 'hit';
  }

  update(delta: number): void {
    this.mixer.update(delta);

    if (this.mode === 'dead') {
      // Mrtvý jelen se dál nehýbe (žádný behavior/kolider) - jen doběhne Death klip a
      // po uplynutí DEATH_DESPAWN_SECONDS zmizí ze scény přes onDeath (StagService.unregister).
      this.deathTimer -= delta;
      if (this.deathTimer <= 0) this.onDeath();
      return;
    }

    if (this.mode === 'aggro') {
      this.aggroBehavior.update(delta);
    } else {
      this.grazeBehavior.update(delta);
      if (this.regenDelayRemaining > 0) {
        this.regenDelayRemaining -= delta;
      } else if (this.hp < STAG_MAX_HP) {
        this.hp = Math.min(STAG_MAX_HP, this.hp + STAG_REGEN_PER_SECOND * delta);
      }
    }
    this.onColliderMoved(this.group.position.x, this.group.position.z, this.group.position.y);
  }

  dispose(): void {
    this.mixer.stopAllAction();
  }
}
