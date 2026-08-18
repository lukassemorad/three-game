import * as THREE from 'three';
import { AnimalBehavior } from './hop-behavior';

export type AggroPhase = 'chasing' | 'attacking';

export interface AggroBehaviorOptions {
  readonly anchor: THREE.Vector3;
  readonly chaseSpeed: number;
  readonly attackRange: number;
  readonly attackCooldownSeconds: number;
  readonly leashRadius: number;
  readonly loseInterestRadius: number;
  readonly maxAggroSeconds: number;
  readonly getPlayerPosition: () => THREE.Vector3;
  readonly getGroundHeight: (x: number, z: number) => number;
  // Volá se jen při skutečné změně fáze (ne každý frame) - StagEntity na to naváže
  // crossfade mezi cvalem (chasing) a útočnou animací (attacking), aby jelen vizuálně
  // přestal "běžet" ve chvíli, kdy už skutečně stojí v attackRange.
  readonly onPhaseChange: (phase: AggroPhase) => void;
  readonly onAttack: () => void;
  readonly onGiveUp: () => void;
}

// Honička/útok bez pathfindingu (stejné zjednodušení jako GrazeBehavior/HopBehavior) -
// jelen běží přímo za živou pozicí hráče, dokud není v attackRange, pak jen opakovaně
// "útočí" (kontaktně, bez fyzického dopadu, jen animace + onAttack) s cooldownem. Leash
// (vzdálenost od anchor i od hráče) + maxAggroSeconds zajišťují, že honička nepokračuje
// donekonečna přes celou mapu.
//
// Hystereze vstup/výstup z attackRange (viz ATTACK_EXIT_RANGE_MULTIPLIER) je záměrně
// jediný mechanismus proti "škubání" mezi honičkou a útokem - pohyb (jen v chasing větvi)
// a animace (StagEntity.crossfadeToAggroPhase, navázaná na onPhaseChange) se přepínají
// vždy SPOLEČNĚ na stejné hraně. Dřív jsme zkoušeli animaci a pohyb rozpojit (animace by
// počkala na doběhnutí headbuttu, pohyb by se spustil hned) - výsledkem bylo, že se tělo
// posouvalo dopředu, zatímco pořád hrála útočná animace ("klouzání" po zemi). Držet oboje
// svázané na jedné hysterezní hraně tohle vylučuje: dokud je jelen ve fázi attacking, malé
// poposkakování hráče kolem attackRange fázi vůbec nerozkmitá (žádný pohyb, žádný restart
// animace); skutečné odpoutání hráče za ATTACK_EXIT_RANGE_MULTIPLIER pak spustí pohyb i
// přechod na cval ve stejném okamžiku.
const ATTACK_EXIT_RANGE_MULTIPLIER = 1.5;

export class AggroBehavior implements AnimalBehavior {
  private elapsed = 0;
  private attackCooldownRemaining = 0;
  private phase: AggroPhase | null = null;

  constructor(
    private readonly group: THREE.Group,
    private readonly options: AggroBehaviorOptions
  ) {}

  // Plný start nové aggro epizody (první zásah, co jelena rozzuří) - i cooldown útoku
  // jde na 0, ať jelen "vrátí úder" hned, pokud je hráč už na dosah. `anchor` se
  // přetáhne na aktuální pozici (viz StagEntity.registerHit - volá se s `group.position`) -
  // po předchozí honičce, která skončila vzdáním se leash/loseInterest checkem (viz
  // update() níže), jelen zůstává stát tam, kde honičku vzdal, klidně i za starým
  // leashRadius. Bez přetažení kotvy by `distanceToAnchor` u dalšího zásahu okamžitě
  // znovu narazila na leashRadius (pokud hráč seká z trochu větší vzdálenosti, než je
  // attackRange, a update() tak jde větví honičky, ne přímo do attacking), takže by
  // se aggro na stejném snímku znovu vzdalo - jelen by vypadal, že si seknutí vůbec
  // nevšiml.
  start(anchor: THREE.Vector3): void {
    this.options.anchor.copy(anchor);
    this.elapsed = 0;
    this.attackCooldownRemaining = 0;
    this.phase = null;
  }

  // Další zásah během JIŽ probíhající honičky - jen prodlouží dobu, než se jelen vzdá
  // (viz maxAggroSeconds), ale NEresetuje attackCooldownRemaining. Bez tohohle rozlišení
  // by každý úspěšný zásah hráče vyvolal okamžitou odvetu jelena, takže by při delším
  // souboji (víc ran do zabití) protiútoky přicházely prakticky nepřetržitě.
  extend(): void {
    this.elapsed = 0;
  }

  update(delta: number): void {
    this.elapsed += delta;

    const position = this.group.position;
    const playerPosition = this.options.getPlayerPosition();
    const dx = playerPosition.x - position.x;
    const dz = playerPosition.z - position.z;
    const distanceToPlayer = Math.hypot(dx, dz);

    if (this.elapsed > this.options.maxAggroSeconds) {
      this.options.onGiveUp();
      return;
    }

    // Ve fázi attacking platí širší (výstupní) dosah než při vstupu do ní - viz komentář
    // u ATTACK_EXIT_RANGE_MULTIPLIER výše.
    const rangeThreshold =
      this.phase === 'attacking' ? this.options.attackRange * ATTACK_EXIT_RANGE_MULTIPLIER : this.options.attackRange;

    if (distanceToPlayer > rangeThreshold) {
      // Leash/lose-interest se vyhodnocují jen během skutečné honičky (mimo attackRange) -
      // v attackRange už jelen s hráčem fyzicky bojuje, takže by ho vzdálenost od anchoru
      // neměla odehnat (viz i start() výše, který kotvu při čerstvém re-aggro přetáhne na
      // aktuální pozici - i tak by bez tohohle vynětí honička kdykoliv během attacking
      // fáze zbytečně mohla skončit leashem, i když stojí na místě).
      const dxAnchor = position.x - this.options.anchor.x;
      const dzAnchor = position.z - this.options.anchor.z;
      const distanceToAnchor = Math.hypot(dxAnchor, dzAnchor);
      if (distanceToAnchor > this.options.leashRadius || distanceToPlayer > this.options.loseInterestRadius) {
        this.options.onGiveUp();
        return;
      }

      this.setPhase('chasing');
      const step = Math.min(distanceToPlayer, this.options.chaseSpeed * delta);
      position.x += (dx / distanceToPlayer) * step;
      position.z += (dz / distanceToPlayer) * step;
      position.y = this.options.getGroundHeight(position.x, position.z);
      this.group.rotation.y = Math.atan2(dx, dz);
      return;
    }

    this.setPhase('attacking');
    this.group.rotation.y = Math.atan2(dx, dz);
    this.attackCooldownRemaining -= delta;
    if (this.attackCooldownRemaining <= 0) {
      this.attackCooldownRemaining = this.options.attackCooldownSeconds;
      this.options.onAttack();
    }
  }

  private setPhase(next: AggroPhase): void {
    if (this.phase === next) return;
    this.phase = next;
    this.options.onPhaseChange(next);
  }
}
