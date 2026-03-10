import { Injectable } from '@angular/core';
import { ApiService } from './api';
import { TokenService } from './token';
import { StateService } from './state.service';
import { BehaviorSubject, Observable, of, throwError } from 'rxjs';
import { catchError, tap, timeout } from 'rxjs/operators';
import { Router } from '@angular/router';
import { hasRole, resolvePrimaryRole } from '../utils/role.util';
import { PremiumService } from './premium.service';
import { PlayerService } from './player.service';

interface AuthTokenResponse {
  tokenType: string;
  accessToken: string;
  accessTokenExpiresInSeconds: number;
  refreshToken: string;
  refreshTokenExpiresInSeconds: number;
  user: any;
}

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private readonly USER_KEY = 'revplay_user';
  private readonly USER_ID_KEY = 'revplay_user_id';
  private currentUserSubject = new BehaviorSubject<any>(null);
  public currentUser$ = this.currentUserSubject.asObservable();
  private isHydratingProfile = false;

  constructor(
    private apiService: ApiService,
    private tokenService: TokenService,
    private stateService: StateService,
    private router: Router,
    private premiumService: PremiumService,
    private playerService: PlayerService
  ) {
    this.checkAuthStatus();
  }

  private checkAuthStatus() {
    if (this.tokenService.hasToken()) {
      this.premiumService.refreshStatus().subscribe({ error: () => { } });
      const storedUser = this.normalizeUserObject(this.getStoredUser());
      if (storedUser) {
        this.currentUserSubject.next(storedUser);
        localStorage.setItem(this.USER_KEY, JSON.stringify(storedUser));
        this.storeUserId(storedUser);
        this.syncArtistContext(storedUser);
        this.hydrateCurrentUserProfile();
        this.logSessionResolution('checkAuthStatus', storedUser);
      } else {
        this.currentUserSubject.next({ isAuthenticated: true, role: 'LISTENER' });
        this.stateService.setArtistId(null);
        this.hydrateCurrentUserProfile();
        this.logSessionResolution('checkAuthStatus:noStoredUser', null);
      }
    } else {
      this.premiumService.clearStatus();
      localStorage.removeItem(this.USER_ID_KEY);
    }
  }

  login(credentials: any): Observable<any> {
    return this.apiService.post<AuthTokenResponse>('/auth/login', credentials).pipe(
      tap(authData => {
        if (authData?.accessToken) {
          this.setSession(authData);
        }
      })
    );
  }

  register(userData: any): Observable<any> {
    return this.apiService.post<AuthTokenResponse>('/auth/register', userData);
  }

  logout(): Observable<any> {
    this.performLogoutCleanup();
    return of({ success: true });
  }

  private performLogoutCleanup() {
    this.playerService.reset(true);
    this.tokenService.clearTokens();
    this.currentUserSubject.next(null);
    localStorage.removeItem(this.USER_KEY);
    localStorage.removeItem(this.USER_ID_KEY);
    localStorage.removeItem('revplay_last_song');
    localStorage.removeItem('revplay_user_email_map');
    localStorage.removeItem('revplay_pending_registration_logs');
    this.stateService.setArtistId(null);
    this.premiumService.clearStatus();
    this.router.navigate(['/auth/login']);
  }

  refreshToken(): Observable<any> {
    const refreshToken = this.tokenService.getRefreshToken();
    if (!refreshToken) {
      this.performLogoutCleanup();
      return throwError(() => new Error('No refresh token available'));
    }

    return this.apiService.post<AuthTokenResponse>('/auth/refresh', { refreshToken }).pipe(
      tap(authData => {
        if (authData?.accessToken) {
          this.setSession(authData);
        }
      }),
      catchError(err => {
        this.performLogoutCleanup();
        return throwError(() => err);
      })
    );
  }

  forgotPassword(email: string): Observable<any> {
    return this.apiService.post<any>('/auth/forgot-password', { email });
  }

  verifyEmail(email: string, otp: string): Observable<any> {
    return this.apiService.post<any>('/auth/verify-email', { email, otp });
  }

  resendVerification(email: string): Observable<any> {
    return this.apiService.post<any>('/auth/resend-verification', { email });
  }

  resetPassword(data: any): Observable<any> {
    return this.apiService.post<any>('/auth/reset-password', data);
  }

  changePassword(data: any): Observable<any> {
    return this.apiService.postRaw<any>('/auth/change-password', data);
  }

  private setSession(authData: AuthTokenResponse): void {
    this.tokenService.setTokens(authData.accessToken, authData.refreshToken);
    localStorage.removeItem('revplay_user_email_map');
    localStorage.removeItem('revplay_pending_registration_logs');
    this.premiumService.refreshStatus().subscribe({ error: () => { } });
    const normalizedUser = this.normalizeUserObject(authData.user) ?? this.normalizeUserObject(this.getStoredUser());
    if (normalizedUser) {
      this.currentUserSubject.next(normalizedUser);
      localStorage.setItem(this.USER_KEY, JSON.stringify(normalizedUser));
      this.storeUserId(normalizedUser);
      this.syncArtistContext(normalizedUser);
      this.hydrateCurrentUserProfile();
      this.playerService.restoreLastPlayback();
      this.logSessionResolution('setSession', normalizedUser);
    } else {
      this.stateService.setArtistId(null);
      this.hydrateCurrentUserProfile();
      this.logSessionResolution('setSession:noUser', null);
    }
  }

  private hydrateCurrentUserProfile(): void {
    if (this.isHydratingProfile || !this.tokenService.hasToken()) {
      return;
    }

    const userId = this.resolveProfileUserId();
    if (!userId) {
      return;
    }

    this.isHydratingProfile = true;
    this.apiService.get<any>(`/profile/${userId}`).pipe(
      catchError(() => of(null))
    ).subscribe((profilePayload) => {
      this.isHydratingProfile = false;
      if (!profilePayload || typeof profilePayload !== 'object') {
        return;
      }

      const current = this.currentUserSubject.value ?? this.getStoredUser() ?? {};
      const merged = this.normalizeUserObject({
        ...current,
        ...profilePayload,
        user: {
          ...(current?.user ?? {}),
          ...(profilePayload?.user ?? {})
        },
        profile: {
          ...(current?.profile ?? {}),
          ...(profilePayload?.profile ?? {})
        }
      }) ?? {
        ...current,
        ...profilePayload
      };

      this.currentUserSubject.next(merged);
      localStorage.setItem(this.USER_KEY, JSON.stringify(merged));
      this.syncArtistContext(merged);
      this.logSessionResolution('hydrateCurrentUserProfile', merged);
    });
  }

  private resolveProfileUserId(): number | null {
    const currentSnapshotId = Number(this.currentUserSubject.value?.userId ?? this.currentUserSubject.value?.id ?? 0);
    if (currentSnapshotId > 0) {
      return currentSnapshotId;
    }

    const stored = this.getStoredUser();
    const storedUserId = Number(stored?.userId ?? stored?.id ?? 0);
    return storedUserId > 0 ? storedUserId : null;
  }

  getCurrentUserSnapshot(): any {
    return this.currentUserSubject.value;
  }

  updateCurrentUser(partial: any): void {
    const current = this.currentUserSubject.value ?? this.getStoredUser();
    if (!current || typeof current !== 'object') {
      return;
    }

    const merged = this.normalizeUserObject({ ...current, ...(partial ?? {}) }) ?? { ...current, ...(partial ?? {}) };
    this.currentUserSubject.next(merged);
    localStorage.setItem(this.USER_KEY, JSON.stringify(merged));
    this.storeUserId(merged);
    this.syncArtistContext(merged);
  }

  getPostLoginRedirect(role?: string): string {
    if (hasRole(role, 'ARTIST')) {
      return '/creator-studio/dashboard';
    }
    if (hasRole(role, 'ADMIN')) {
      return '/admin-studio/dashboard';
    }
    return '/home';
  }

  getCurrentUserId(): number {
    const fromMemory = this.getUserId(this.currentUserSubject.value ?? {});
    if (fromMemory && fromMemory > 0) {
      return fromMemory;
    }
    const stored = this.getStoredUser();
    const fromStored = this.getUserId(stored ?? {});
    if (fromStored && fromStored > 0) {
      return fromStored;
    }
    try {
      const raw = localStorage.getItem(this.USER_ID_KEY);
      const parsed = Number(raw ?? 0);
      return parsed > 0 ? Math.floor(parsed) : 0;
    } catch {
      return 0;
    }
  }

  private getStoredUser(): any | null {
    const rawUser = localStorage.getItem(this.USER_KEY);
    if (!rawUser) {
      return null;
    }

    try {
      return JSON.parse(rawUser);
    } catch {
      localStorage.removeItem(this.USER_KEY);
      return null;
    }
  }

  private storeUserId(user: any): void {
    const userId = this.getUserId(user);
    if (userId && userId > 0) {
      localStorage.setItem(this.USER_ID_KEY, String(Math.floor(userId)));
    }
  }

  private resolveAndStoreArtistId(username: string, userId?: number | null): void {
    if (!username) {
      this.stateService.setArtistId(null);
      return;
    }
    // Do not auto-create artist profile here; backend may already create it and return 409 on duplicate.
    // Resolve only via search with retries to avoid noisy conflict requests in console.
    this.retryResolveArtistId(username, userId ?? null, 3);
  }

  private retryResolveArtistId(username: string, userId: number | null, retries: number): void {
    this.apiService.get<any>(`/search?q=${encodeURIComponent(username)}&type=ARTIST`).pipe(
      timeout(7000)
    ).subscribe({
      next: (pagedResult) => {
        const items = pagedResult?.content ?? [];
        const artist = this.findBestArtistSearchResult(items, username, userId);
        const artistId = Number(artist?.artistId ?? artist?.contentId ?? artist?.id ?? 0);
        if (artistId > 0) {
          this.stateService.setArtistId(artistId);
          this.stateService.setArtistIdForUser(userId, artistId);
          return;
        }

        if (retries > 0) {
          setTimeout(() => this.retryResolveArtistId(username, userId, retries - 1), 500);
          return;
        }
        this.stateService.setArtistId(null);
      },
      error: (err) => {
        const status = Number(err?.status ?? 0);
        if (status === 401 || status === 403) {
          this.stateService.setArtistId(null);
          return;
        }
        if (retries > 0) {
          setTimeout(() => this.retryResolveArtistId(username, userId, retries - 1), 500);
          return;
        }
        this.stateService.setArtistId(null);
      }
    });
  }

  private findBestArtistSearchResult(items: any[], username: string, userId: number | null): any {
    const artistItems = (items ?? []).filter((item: any) => this.isArtistLikeSearchItem(item));
    if (artistItems.length === 0) {
      return null;
    }

    const normalizedUsername = String(username ?? '').trim().toLowerCase();
    const expectedUserId = Number(userId ?? 0);

    if (expectedUserId > 0) {
      const byUserId = artistItems.find((item: any) => {
        const candidates = [
          item?.userId,
          item?.ownerUserId,
          item?.createdBy,
          item?.accountId,
          item?.artist?.userId
        ];
        return candidates.some((value) => Number(value ?? 0) === expectedUserId);
      });
      if (byUserId) {
        return byUserId;
      }
    }

    const byUsername = artistItems.find((item: any) => {
      const candidates = [
        item?.username,
        item?.title,
        item?.artistName,
        item?.displayName,
        item?.name
      ];
      return candidates.some((value) => String(value ?? '').trim().toLowerCase() === normalizedUsername);
    });
    if (byUsername) {
      return byUsername;
    }

    return null;
  }

  private isArtistLikeSearchItem(item: any): boolean {
    const type = String(item?.type ?? '').trim().toUpperCase();
    if (['SONG', 'ALBUM', 'PODCAST', 'PLAYLIST', 'GENRE'].includes(type)) {
      return false;
    }
    if (['ARTIST', 'BOTH', 'MUSIC', 'CREATOR', 'MUSICIAN'].includes(type)) {
      return true;
    }
    return Number(item?.artistId ?? 0) > 0;
  }

  private normalizeUserObject(user: any): any | null {
    if (!user || typeof user !== 'object') {
      return null;
    }

    const role = resolvePrimaryRole(user);
    const directUserId = this.getUserId(user);
    const tokenUserId = this.getUserIdFromToken();
    const resolvedUserId = directUserId ?? tokenUserId;
    const artistIdFromUser = this.getArtistIdFromUserLike(user);
    const artistIdFromToken = this.getArtistIdFromToken();
    const artistId = artistIdFromUser ?? artistIdFromToken;
    const profileImageUrl = String(
      user?.profileImageUrl ??
      user?.imageUrl ??
      user?.avatar ??
      user?.profilePicture ??
      user?.profilePictureUrl ??
      user?.profileImage ??
      user?.avatarUrl ??
      user?.image ??
      user?.user?.profileImageUrl ??
      user?.user?.imageUrl ??
      user?.user?.avatar ??
      user?.user?.profilePicture ??
      ''
    ).trim();

    return {
      ...user,
      userId: resolvedUserId ?? user?.userId,
      id: resolvedUserId ?? user?.id,
      role: role || user.role || '',
      artistId: artistId ?? user?.artistId,
      profileImageUrl
    };
  }

  private getUserId(user: any): number | null {
    const candidates = [
      user?.userId,
      user?.id,
      user?.user_id,
      user?.uid,
      user?.user?.userId,
      user?.user?.id,
      user?.data?.userId,
      user?.data?.id
    ];
    for (const value of candidates) {
      const userId = Number(value ?? 0);
      if (userId > 0) {
        return Math.floor(userId);
      }
    }
    return null;
  }

  private syncArtistContext(user: any): void {
    if (!hasRole(user, 'ARTIST')) {
      this.stateService.setArtistId(null);
      return;
    }

    const userId = this.getUserId(user);
    const directArtistId = this.getArtistIdFromUserLike(user) ?? this.getArtistIdFromToken();
    if (directArtistId) {
      this.stateService.setArtistId(directArtistId);
      this.stateService.setArtistIdForUser(userId, directArtistId);
      return;
    }

    const cachedArtistId = this.stateService.getArtistIdForUser(userId);
    if (cachedArtistId) {
      this.stateService.setArtistId(cachedArtistId);
      return;
    }

    // Clear potentially stale global artist id before resolving this user's artist profile.
    this.stateService.setArtistId(null);
    this.resolveAndStoreArtistId(user?.username ?? '', userId);
  }

  private getArtistIdFromUserLike(user: any): number | null {
    const candidates = [
      user?.artistId,
      user?.artist?.artistId,
      user?.artist?.id,
      user?.artistProfileId,
      user?.profile?.artistId
    ];
    for (const value of candidates) {
      const artistId = Number(value ?? 0);
      if (artistId > 0) {
        return artistId;
      }
    }
    return null;
  }

  private getArtistIdFromToken(): number | null {
    const token = this.tokenService.getToken();
    if (!token) {
      return null;
    }

    const chunks = token.split('.');
    if (chunks.length < 2) {
      return null;
    }

    try {
      const payload = chunks[1]
        .replace(/-/g, '+')
        .replace(/_/g, '/');
      const normalized = payload.padEnd(payload.length + ((4 - (payload.length % 4)) % 4), '=');
      const decoded = atob(normalized);
      const claims = JSON.parse(decoded);
      const candidates = [
        claims?.artistId,
        claims?.artist_id,
        claims?.artistID
      ];
      for (const value of candidates) {
        const artistId = Number(value ?? 0);
        if (artistId > 0) {
          return artistId;
        }
      }
    } catch {
      return null;
    }

    return null;
  }

  private getUserIdFromToken(): number | null {
    const token = this.tokenService.getToken();
    if (!token) {
      return null;
    }

    const chunks = token.split('.');
    if (chunks.length < 2) {
      return null;
    }

    try {
      const payload = chunks[1]
        .replace(/-/g, '+')
        .replace(/_/g, '/');
      const normalized = payload.padEnd(payload.length + ((4 - (payload.length % 4)) % 4), '=');
      const decoded = atob(normalized);
      const claims = JSON.parse(decoded);
      const candidates = [
        claims?.userId,
        claims?.user_id,
        claims?.id,
        claims?.uid,
        claims?.sub
      ];
      for (const value of candidates) {
        const userId = Number(value ?? 0);
        if (userId > 0) {
          return Math.floor(userId);
        }
      }
    } catch {
      return null;
    }

    return null;
  }

  private shouldLogSessionDebug(): boolean {
    try {
      return typeof window !== 'undefined' && window.location.hostname === 'localhost';
    } catch {
      return false;
    }
  }

  private logSessionResolution(context: string, user: any): void {
    if (!this.shouldLogSessionDebug()) {
      return;
    }

    const snapshotUser = user ?? this.getStoredUser();
    const resolvedRole = resolvePrimaryRole(snapshotUser);
    const resolvedUserId = this.getUserId(snapshotUser);
    const resolvedArtistId = this.getArtistIdFromUserLike(snapshotUser);
    const tokenUserId = this.getUserIdFromToken();
    const tokenArtistId = this.getArtistIdFromToken();
    const mappedArtistId = this.stateService.getArtistIdForUser(resolvedUserId);

    console.info('[RevPlay session]', {
      context,
      resolvedRole,
      resolvedUserId,
      resolvedArtistId,
      tokenUserId,
      tokenArtistId,
      mappedArtistId,
      stateArtistId: this.stateService.artistId,
      username: String(snapshotUser?.username ?? '').trim() || undefined
    });
  }
}
