import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

export type AppTheme = 'dark' | 'light';

@Injectable({
  providedIn: 'root'
})
export class ThemeService {
  private readonly storageKey = 'revplay_theme';
  private readonly fallbackTheme: AppTheme = 'dark';
  private readonly themeSubject = new BehaviorSubject<AppTheme>(this.resolveInitialTheme());
  readonly theme$ = this.themeSubject.asObservable();

  constructor() {
    this.applyTheme(this.themeSubject.value);
  }

  get theme(): AppTheme {
    return this.themeSubject.value;
  }

  setTheme(theme: AppTheme): void {
    const nextTheme: AppTheme = theme === 'light' ? 'light' : 'dark';
    if (nextTheme === this.themeSubject.value) {
      this.applyTheme(nextTheme);
      return;
    }

    this.themeSubject.next(nextTheme);
    this.persistTheme(nextTheme);
    this.applyTheme(nextTheme);
  }

  toggleTheme(): void {
    this.setTheme(this.theme === 'dark' ? 'light' : 'dark');
  }

  private resolveInitialTheme(): AppTheme {
    const storedTheme = this.readStoredTheme();
    if (storedTheme) {
      return storedTheme;
    }

    if (typeof window !== 'undefined' && window.matchMedia) {
      return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : this.fallbackTheme;
    }

    return this.fallbackTheme;
  }

  private readStoredTheme(): AppTheme | null {
    if (typeof localStorage === 'undefined') {
      return null;
    }

    const stored = String(localStorage.getItem(this.storageKey) ?? '').trim().toLowerCase();
    if (stored === 'light' || stored === 'dark') {
      return stored;
    }

    return null;
  }

  private persistTheme(theme: AppTheme): void {
    if (typeof localStorage === 'undefined') {
      return;
    }
    localStorage.setItem(this.storageKey, theme);
  }

  private applyTheme(theme: AppTheme): void {
    if (typeof document === 'undefined') {
      return;
    }

    const root = document.documentElement;
    const body = document.body;

    root.setAttribute('data-theme', theme);
    root.style.colorScheme = theme;
    body.classList.remove('theme-dark', 'theme-light');
    body.classList.add(`theme-${theme}`);
  }
}
