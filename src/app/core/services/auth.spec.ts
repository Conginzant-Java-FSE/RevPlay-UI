import { TestBed } from '@angular/core/testing';
import { AuthService } from './auth';
import { ApiService } from './api';
import { TokenService } from './token';
import { Router } from '@angular/router';
import { of, throwError } from 'rxjs';
import { StateService } from './state.service';
import { PremiumService } from './premium.service';
import { PlayerService } from './player.service';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { RouterTestingModule } from '@angular/router/testing';

describe('AuthService', () => {
  let service: AuthService;
  let apiServiceMock: any;
  let tokenServiceMock: any;
  let routerMock: any;
  let stateServiceMock: any;
  let premiumServiceMock: any;
  let playerServiceMock: any;

  beforeEach(() => {
    apiServiceMock = {
      post: jasmine.createSpy('post'),
      get: jasmine.createSpy('get')
    };
    tokenServiceMock = {
      setTokens: jasmine.createSpy('setTokens'),
      getToken: jasmine.createSpy('getToken'),
      getRefreshToken: jasmine.createSpy('getRefreshToken'),
      clearTokens: jasmine.createSpy('clearTokens'),
      hasToken: jasmine.createSpy('hasToken').and.returnValue(false)
    };
    routerMock = {
      navigate: jasmine.createSpy('navigate')
    };
    stateServiceMock = {
      setArtistId: jasmine.createSpy('setArtistId'),
      setArtistIdForUser: jasmine.createSpy('setArtistIdForUser'),
      getArtistIdForUser: jasmine.createSpy('getArtistIdForUser').and.returnValue(null)
    };
    premiumServiceMock = {
      refreshStatus: jasmine.createSpy('refreshStatus').and.returnValue(of(null)),
      clearStatus: jasmine.createSpy('clearStatus')
    };
    playerServiceMock = {
      reset: jasmine.createSpy('reset'),
      restoreLastPlayback: jasmine.createSpy('restoreLastPlayback')
    };

    TestBed.configureTestingModule({
      providers: [
        AuthService,
        { provide: ApiService, useValue: apiServiceMock },
        { provide: TokenService, useValue: tokenServiceMock },
        { provide: Router, useValue: routerMock },
        { provide: StateService, useValue: stateServiceMock },
        { provide: PremiumService, useValue: premiumServiceMock },
        { provide: PlayerService, useValue: playerServiceMock }
      ]
    });
    service = TestBed.inject(AuthService);
  });

  it('should login successfully', (done) => {
    const mockResponse = { accessToken: 'mock-token', refreshToken: 'mock-refresh', user: { id: 1, username: 'test' } };
    apiServiceMock.post.and.returnValue(of(mockResponse));

    service.login({ usernameOrEmail: 'test', password: 'password' }).subscribe(res => {
      expect(res).toEqual(mockResponse);
      expect(tokenServiceMock.setTokens).toHaveBeenCalledWith('mock-token', 'mock-refresh');
      expect(playerServiceMock.restoreLastPlayback).toHaveBeenCalled();
      done();
    });
  });

  it('should logout correctly', () => {
    service.logout();
    expect(tokenServiceMock.clearTokens).toHaveBeenCalled();
    expect(routerMock.navigate).toHaveBeenCalledWith(['/auth/login']);
  });
});
