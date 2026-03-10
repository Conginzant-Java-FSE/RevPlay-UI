import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class TokenService {

  private readonly TOKEN_KEY = 'revplay_auth_token';
  private readonly REFRESH_TOKEN_KEY = 'revplay_refresh_token';

  constructor() { }

  setTokens(token: string, refreshToken?: string): void {
    localStorage.setItem(this.TOKEN_KEY, token);
    if (refreshToken) {
      localStorage.setItem(this.REFRESH_TOKEN_KEY, refreshToken);
    }
  }

  getToken(): string | null {
    return localStorage.getItem(this.TOKEN_KEY);
  }

  getRefreshToken(): string | null {
    return localStorage.getItem(this.REFRESH_TOKEN_KEY);
  }

  clearTokens(): void {
    localStorage.removeItem(this.TOKEN_KEY);
    localStorage.removeItem(this.REFRESH_TOKEN_KEY);
  }

  hasToken(): boolean {
    return !!this.getToken();
  }
}
