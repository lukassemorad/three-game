import { Injectable, signal } from '@angular/core';

// TESTOVACÍ SEED - startovní peníze nové hry, aby šel snadno otestovat nákup v obchodě
// bez nutnosti nejdřív nasekat dřevo. Před ostrým nasazením vrátit zpět na 0.
const TESTING_START_MONEY = 50;

@Injectable({ providedIn: 'root' })
export class PlayerStateService {
  private readonly moneySignal = signal(0);
  readonly money = this.moneySignal.asReadonly();

  private readonly treesChoppedCountSignal = signal(0);
  readonly treesChoppedCount = this.treesChoppedCountSignal.asReadonly();

  addMoney(amount: number): void {
    this.moneySignal.update((m) => m + amount);
  }

  spendMoney(amount: number): boolean {
    if (this.moneySignal() < amount) return false;
    this.moneySignal.update((m) => m - amount);
    return true;
  }

  incrementTreesChopped(): void {
    this.treesChoppedCountSignal.update((count) => count + 1);
  }

  hydrate(state: { money: number; treesChoppedCount: number }): void {
    this.moneySignal.set(state.money);
    this.treesChoppedCountSignal.set(state.treesChoppedCount);
  }

  reset(): void {
    this.moneySignal.set(TESTING_START_MONEY);
    this.treesChoppedCountSignal.set(0);
  }
}
