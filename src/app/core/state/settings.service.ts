import { Injectable, signal } from '@angular/core';

const SETTINGS_STORAGE_KEY = 'three-game:settings';
const DEFAULT_LOOK_SENSITIVITY = 0.8;

interface StoredSettings {
  readonly lookSensitivity: number;
}

@Injectable({ providedIn: 'root' })
export class SettingsService {
  private readonly lookSensitivitySignal = signal(this.loadInitial());
  readonly lookSensitivity = this.lookSensitivitySignal.asReadonly();

  setLookSensitivity(value: number): void {
    this.lookSensitivitySignal.set(value);
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ lookSensitivity: value }));
  }

  private loadInitial(): number {
    try {
      const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
      if (!raw) return DEFAULT_LOOK_SENSITIVITY;
      const parsed = JSON.parse(raw) as StoredSettings;
      return typeof parsed.lookSensitivity === 'number' ? parsed.lookSensitivity : DEFAULT_LOOK_SENSITIVITY;
    } catch {
      return DEFAULT_LOOK_SENSITIVITY;
    }
  }
}
