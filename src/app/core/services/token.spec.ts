import { TestBed } from '@angular/core/testing';
import { TokenService } from './token';

describe('TokenService', () => {
  let service: TokenService;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({});
    service = TestBed.inject(TokenService);
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should store and return access and refresh tokens', () => {
    service.setTokens('access-token', 'refresh-token');

    expect(service.getToken()).toBe('access-token');
    expect(service.getRefreshToken()).toBe('refresh-token');
    expect(service.hasToken()).toBe(true);
  });

  it('should clear stored tokens', () => {
    service.setTokens('access-token', 'refresh-token');
    service.clearTokens();

    expect(service.getToken()).toBeNull();
    expect(service.getRefreshToken()).toBeNull();
    expect(service.hasToken()).toBe(false);
  });

  it('should store access token even without refresh token', () => {
    service.setTokens('access-only');

    expect(service.getToken()).toBe('access-only');
    expect(service.getRefreshToken()).toBeNull();
    expect(service.hasToken()).toBe(true);
  });

  it('should report no token when storage is empty', () => {
    localStorage.removeItem('revplay_auth_token');
    localStorage.removeItem('revplay_refresh_token');

    expect(service.getToken()).toBeNull();
    expect(service.getRefreshToken()).toBeNull();
    expect(service.hasToken()).toBe(false);
  });

  it('should preserve existing refresh token when updating only access token', () => {
    service.setTokens('old-access', 'old-refresh');
    service.setTokens('new-access');

    expect(service.getToken()).toBe('new-access');
    expect(service.getRefreshToken()).toBe('old-refresh');
  });

  it('should treat empty-string token as unauthenticated', () => {
    localStorage.setItem('revplay_auth_token', '');

    expect(service.hasToken()).toBe(false);
  });

  it('should clear tokens safely when called repeatedly', () => {
    service.setTokens('access', 'refresh');

    service.clearTokens();
    service.clearTokens();

    expect(service.getToken()).toBeNull();
    expect(service.getRefreshToken()).toBeNull();
  });
});


