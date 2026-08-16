import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class PlayerStateService {
  private readonly moneySignal = signal(0);
  readonly money = this.moneySignal.asReadonly();

  private readonly treesChoppedCountSignal = signal(0);
  readonly treesChoppedCount = this.treesChoppedCountSignal.asReadonly();

  addMoney(amount: number): void {
    this.moneySignal.update((m) => m + amount);
  }

  incrementTreesChopped(): void {
    this.treesChoppedCountSignal.update((count) => count + 1);
  }

  hydrate(state: { money: number; treesChoppedCount: number }): void {
    this.moneySignal.set(state.money);
    this.treesChoppedCountSignal.set(state.treesChoppedCount);
  }

  reset(): void {
    this.moneySignal.set(0);
    this.treesChoppedCountSignal.set(0);
  }
}
