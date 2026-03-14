declare const jasmine: any;
declare const spyOn: any;
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { of, throwError } from 'rxjs';
import { AuthService } from './auth';
import { ApiService } from './api';
import { TokenService } from './token';
import { StateService } from './state.service';
import { PremiumService } from './premium.service';
import { PlayerService } from './player.service';

describe('AuthService', () => {
  let service: AuthService;
  let apiServiceSpy: any;
  let tokenServiceSpy: any;
  let stateServiceSpy: any;
  let routerSpy: any;
  let playerServiceSpy: any;
  const makeJwt = (payload: any): string => {
    const encoded = btoa(JSON.stringify(payload))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '');
    return `x.${encoded}.y`;
  };
  let premiumServiceMock: {
    status$: any;
    isPremiumUser: boolean;
    refreshStatus: any;
    clearStatus: any;
  };

  beforeEach(() => {
    localStorage.clear();

    apiServiceSpy = jasmine.createSpyObj('ApiService', ['post', 'postRaw', 'get']);
    tokenServiceSpy = jasmine.createSpyObj('TokenService', ['hasToken', 'setTokens', 'clearTokens', 'getRefreshToken', 'getToken']);
    stateServiceSpy = jasmine.createSpyObj('StateService', ['setArtistId', 'setArtistIdForUser', 'getArtistIdForUser']);
    routerSpy = jasmine.createSpyObj('Router', ['navigate']);
    playerServiceSpy = jasmine.createSpyObj('PlayerService', ['reset', 'restoreLastPlayback']);

    tokenServiceSpy.hasToken.and.returnValue(false);
    tokenServiceSpy.getToken.and.returnValue('');
    apiServiceSpy.get.and.returnValue(of({}));
    stateServiceSpy.getArtistIdForUser.and.returnValue(null);

    premiumServiceMock = {
      status$: of({ isPremium: false }),
      isPremiumUser: false,
      refreshStatus: jasmine.createSpy('refreshStatus').and.returnValue(of({ isPremium: false })),
      clearStatus: jasmine.createSpy('clearStatus')
    };

    TestBed.configureTestingModule({
      providers: [
        AuthService,
        { provide: ApiService, useValue: apiServiceSpy },
        { provide: TokenService, useValue: tokenServiceSpy },
        { provide: StateService, useValue: stateServiceSpy },
        { provide: Router, useValue: routerSpy },
        { provide: PremiumService, useValue: premiumServiceMock },
        { provide: PlayerService, useValue: playerServiceSpy }
      ]
    });

    service = TestBed.inject(AuthService);
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should login and set session tokens', () => {
    const authData = {
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      user: { userId: 42, role: 'LISTENER', username: 'demo' }
    };
    apiServiceSpy.post.and.returnValue(of(authData as any));

    let result: any;
    service.login({ usernameOrEmail: 'demo', password: 'pass' }).subscribe((response) => {
      result = response;
    });

    expect(apiServiceSpy.post).toHaveBeenCalledWith('/auth/login', {
      usernameOrEmail: 'demo',
      password: 'pass'
    });
    expect(tokenServiceSpy.setTokens).toHaveBeenCalledWith('access-token', 'refresh-token');
    expect(playerServiceSpy.restoreLastPlayback).toHaveBeenCalled();
    expect(result).toEqual(authData as any);
  });

  it('should clear session on logout', () => {
    service.logout().subscribe();

    expect(playerServiceSpy.reset).toHaveBeenCalledWith(true);
    expect(tokenServiceSpy.clearTokens).toHaveBeenCalled();
    expect(stateServiceSpy.setArtistId).toHaveBeenCalledWith(null);
    expect(premiumServiceMock.clearStatus).toHaveBeenCalled();
    expect(routerSpy.navigate).toHaveBeenCalledWith(['/auth/login']);
  });

  it('should return default redirect path for listener role', () => {
    expect(service.getPostLoginRedirect('LISTENER')).toBe('/home');
  });

  it('should return artist redirect path for artist role', () => {
    expect(service.getPostLoginRedirect('ARTIST')).toBe('/creator-studio/dashboard');
  });

  it('should return admin redirect path for admin role', () => {
    expect(service.getPostLoginRedirect('ADMIN')).toBe('/admin-studio/dashboard');
  });

  it('should refresh token and set a new session when refresh token exists', () => {
    const refreshedAuthData = {
      accessToken: 'new-access-token',
      refreshToken: 'new-refresh-token',
      user: { userId: 77, role: 'LISTENER', username: 'refreshed-user' }
    };
    tokenServiceSpy.getRefreshToken.and.returnValue('existing-refresh-token');
    apiServiceSpy.post.and.returnValue(of(refreshedAuthData as any));

    let result: any;
    service.refreshToken().subscribe((response) => {
      result = response;
    });

    expect(apiServiceSpy.post).toHaveBeenCalledWith('/auth/refresh', { refreshToken: 'existing-refresh-token' });
    expect(tokenServiceSpy.setTokens).toHaveBeenCalledWith('new-access-token', 'new-refresh-token');
    expect(playerServiceSpy.restoreLastPlayback).toHaveBeenCalled();
    expect(result).toEqual(refreshedAuthData as any);
  });

  it('should not set session when login response has no access token', () => {
    const partialAuthData = {
      refreshToken: 'refresh-only-token',
      user: { userId: 42, role: 'LISTENER', username: 'demo' }
    };
    apiServiceSpy.post.and.returnValue(of(partialAuthData as any));

    service.login({ usernameOrEmail: 'demo', password: 'pass' }).subscribe();

    expect(apiServiceSpy.post).toHaveBeenCalledWith('/auth/login', {
      usernameOrEmail: 'demo',
      password: 'pass'
    });
    expect(tokenServiceSpy.setTokens).not.toHaveBeenCalled();
    expect(playerServiceSpy.restoreLastPlayback).not.toHaveBeenCalled();
  });

  it('should fail refreshToken when refresh token is missing and cleanup session', () => {
    tokenServiceSpy.getRefreshToken.and.returnValue('');
    let capturedError: any = null;

    service.refreshToken().subscribe({
      next: () => {
        fail('expected refreshToken to error');
      },
      error: (err) => {
        capturedError = err;
      }
    });

    expect(capturedError).toBeTruthy();
    expect(playerServiceSpy.reset).toHaveBeenCalledWith(true);
    expect(tokenServiceSpy.clearTokens).toHaveBeenCalled();
    expect(routerSpy.navigate).toHaveBeenCalledWith(['/auth/login']);
  });

  it('should proxy forgot/verify/resend/reset/change requests to ApiService', () => {
    apiServiceSpy.post.and.returnValue(of({ ok: true }));
    apiServiceSpy.postRaw.and.returnValue(of({ ok: true }));

    service.forgotPassword('user@mail.com').subscribe();
    service.verifyEmail('user@mail.com', '123456').subscribe();
    service.resendVerification('user@mail.com').subscribe();
    service.resetPassword({ token: 'abc', newPassword: 'Strong123!' }).subscribe();
    service.changePassword({ currentPassword: 'Old123!', newPassword: 'New123!' }).subscribe();

    expect(apiServiceSpy.post).toHaveBeenCalledWith('/auth/forgot-password', { email: 'user@mail.com' });
    expect(apiServiceSpy.post).toHaveBeenCalledWith('/auth/verify-email', { email: 'user@mail.com', otp: '123456' });
    expect(apiServiceSpy.post).toHaveBeenCalledWith('/auth/resend-verification', { email: 'user@mail.com' });
    expect(apiServiceSpy.post).toHaveBeenCalledWith('/auth/reset-password', {
      token: 'abc',
      newPassword: 'Strong123!'
    });
    expect(apiServiceSpy.postRaw).toHaveBeenCalledWith('/auth/change-password', {
      currentPassword: 'Old123!',
      newPassword: 'New123!'
    });
  });

  it('should cleanup session if refresh endpoint fails', () => {
    tokenServiceSpy.getRefreshToken.and.returnValue('present-refresh-token');
    apiServiceSpy.post.and.returnValue(throwError(() => ({ status: 401 })));
    let capturedError: any = null;

    service.refreshToken().subscribe({
      next: () => fail('expected refresh to fail'),
      error: (err) => {
        capturedError = err;
      }
    });

    expect(capturedError).toBeTruthy();
    expect(playerServiceSpy.reset).toHaveBeenCalledWith(true);
    expect(tokenServiceSpy.clearTokens).toHaveBeenCalled();
    expect(stateServiceSpy.setArtistId).toHaveBeenCalledWith(null);
    expect(routerSpy.navigate).toHaveBeenCalledWith(['/auth/login']);
  });

  it('should return current user id from persisted fallback key', () => {
    localStorage.setItem('revplay_user_id', '19');

    expect(service.getCurrentUserId()).toBe(19);
  });

  it('should update current user and sync artist context', () => {
    (service as any).currentUserSubject.next({ userId: 14, role: 'ARTIST', username: 'artist1' });

    service.updateCurrentUser({ fullName: 'Artist User', artistId: 77 });

    expect(service.getCurrentUserSnapshot()).toEqual(jasmine.objectContaining({
      userId: 14,
      fullName: 'Artist User',
      artistId: 77
    }));
    expect(stateServiceSpy.setArtistId).toHaveBeenCalledWith(77);
    expect(stateServiceSpy.setArtistIdForUser).toHaveBeenCalledWith(14, 77);
  });

  it('should normalize user id and artist id from JWT token fallback', () => {
    tokenServiceSpy.getToken.and.returnValue(makeJwt({ userId: 27, artistId: 33 }));

    const normalized = (service as any).normalizeUserObject({
      role: 'ARTIST',
      username: 'token-user'
    });

    expect(normalized.userId).toBe(27);
    expect(normalized.artistId).toBe(33);
  });

  it('should return null ids for malformed JWT payloads', () => {
    tokenServiceSpy.getToken.and.returnValue('broken-token');

    expect((service as any).getUserIdFromToken()).toBeNull();
    expect((service as any).getArtistIdFromToken()).toBeNull();
  });

  it('should sync artist context from cached mapping', () => {
    stateServiceSpy.getArtistIdForUser.and.returnValue(88);

    (service as any).syncArtistContext({ role: 'ARTIST', userId: 7, username: 'cached-artist' });

    expect(stateServiceSpy.setArtistId).toHaveBeenCalledWith(88);
  });

  it('should classify search items and find best artist result', () => {
    const items = [
      { type: 'SONG', artistId: 10, title: 'Not Artist' },
      { type: 'ARTIST', artistId: 21, username: 'first', userId: 1001 },
      { type: 'ARTIST', artistId: 22, username: 'target', userId: 2002 }
    ];

    expect((service as any).isArtistLikeSearchItem(items[0])).toBeFalse();
    expect((service as any).isArtistLikeSearchItem(items[1])).toBeTrue();
    expect((service as any).isArtistLikeSearchItem({ artistId: 9 })).toBeTrue();

    const byUserId = (service as any).findBestArtistSearchResult(items, 'target', 1001);
    const byUsername = (service as any).findBestArtistSearchResult(items, 'target', null);

    expect(byUserId?.artistId).toBe(21);
    expect(byUsername?.artistId).toBe(22);
  });

  it('should prefer in-memory and stored user values when resolving current user id', () => {
    (service as any).currentUserSubject.next({ userId: 31 });
    expect(service.getCurrentUserId()).toBe(31);

    (service as any).currentUserSubject.next(null);
    localStorage.setItem('revplay_user', JSON.stringify({ userId: 45 }));
    expect(service.getCurrentUserId()).toBe(45);
  });

  it('should return zero when user id fallbacks are invalid', () => {
    localStorage.setItem('revplay_user_id', 'not-a-number');
    localStorage.setItem('revplay_user', '{bad-json');

    expect(service.getCurrentUserId()).toBe(0);
  });

  it('should resolve and store artist id as null for empty usernames', () => {
    (service as any).resolveAndStoreArtistId('', 5);

    expect(stateServiceSpy.setArtistId).toHaveBeenCalledWith(null);
  });

  it('should read direct artist id and user id candidates from user-like objects', () => {
    const artistId = (service as any).getArtistIdFromUserLike({
      artist: { id: 99 }
    });
    const userId = (service as any).getUserId({
      user: { id: 44 }
    });

    expect(artistId).toBe(99);
    expect(userId).toBe(44);
  });

  it('should derive profile user id from current snapshot first', () => {
    (service as any).currentUserSubject.next({ id: 17 });

    const profileUserId = (service as any).resolveProfileUserId();

    expect(profileUserId).toBe(17);
  });

  it('should clear stale user storage when getStoredUser sees invalid JSON', () => {
    localStorage.setItem('revplay_user', '{invalid-json');

    const stored = (service as any).getStoredUser();

    expect(stored).toBeNull();
    expect(localStorage.getItem('revplay_user')).toBeNull();
  });

  it('should clear artist context for non-artist users', () => {
    (service as any).syncArtistContext({ role: 'LISTENER', userId: 20 });

    expect(stateServiceSpy.setArtistId).toHaveBeenCalledWith(null);
  });

  it('should set direct artist context when artist id is present on user object', () => {
    (service as any).syncArtistContext({
      role: 'ARTIST',
      userId: 20,
      artistId: 501,
      username: 'artist-direct'
    });

    expect(stateServiceSpy.setArtistId).toHaveBeenCalledWith(501);
    expect(stateServiceSpy.setArtistIdForUser).toHaveBeenCalledWith(20, 501);
  });

  it('should default redirect for unknown roles', () => {
    expect(service.getPostLoginRedirect('UNKNOWN')).toBe('/home');
    expect(service.getPostLoginRedirect('')).toBe('/home');
  });

  it('should ignore updateCurrentUser when current snapshot is unavailable', () => {
    (service as any).currentUserSubject.next(null);
    localStorage.removeItem('revplay_user');

    service.updateCurrentUser({ fullName: 'Ignored' });

    expect(service.getCurrentUserSnapshot()).toBeNull();
  });

  it('should normalize invalid user payloads to null', () => {
    expect((service as any).normalizeUserObject(null)).toBeNull();
    expect((service as any).normalizeUserObject('x')).toBeNull();
  });

  it('should extract user id from nested candidate fields', () => {
    expect((service as any).getUserId({ data: { userId: 55 } })).toBe(55);
    expect((service as any).getUserId({ uid: 44 })).toBe(44);
    expect((service as any).getUserId({})).toBeNull();
  });

  it('should derive artist id from nested user-like fields', () => {
    expect((service as any).getArtistIdFromUserLike({ artist: { artistId: 91 } })).toBe(91);
    expect((service as any).getArtistIdFromUserLike({ profile: { artistId: 14 } })).toBe(14);
    expect((service as any).getArtistIdFromUserLike({})).toBeNull();
  });

  it('should decode user and artist ids from alternative token claim names', () => {
    tokenServiceSpy.getToken.and.returnValue(makeJwt({ sub: 63, artist_id: 77 }));
    expect((service as any).getUserIdFromToken()).toBe(63);
    expect((service as any).getArtistIdFromToken()).toBe(77);
  });

  it('should store user id in localStorage only for positive ids', () => {
    (service as any).storeUserId({ userId: 9 });
    expect(localStorage.getItem('revplay_user_id')).toBe('9');

    localStorage.removeItem('revplay_user_id');
    (service as any).storeUserId({ userId: 0 });
    expect(localStorage.getItem('revplay_user_id')).toBeNull();
  });

  it('should resolve profile user id from stored user fallback', () => {
    (service as any).currentUserSubject.next(null);
    localStorage.setItem('revplay_user', JSON.stringify({ userId: 81 }));

    expect((service as any).resolveProfileUserId()).toBe(81);
  });

  it('should check auth status with token and no stored user', () => {
    tokenServiceSpy.hasToken.and.returnValue(true);
    tokenServiceSpy.getToken.and.returnValue('');
    localStorage.removeItem('revplay_user');

    (service as any).checkAuthStatus();

    expect(service.getCurrentUserSnapshot()).toEqual(jasmine.objectContaining({
      isAuthenticated: true,
      role: 'LISTENER'
    }));
  });

  it('should clear premium status when no auth token exists', () => {
    tokenServiceSpy.hasToken.and.returnValue(false);

    (service as any).checkAuthStatus();

    expect(premiumServiceMock.clearStatus).toHaveBeenCalled();
  });
});



