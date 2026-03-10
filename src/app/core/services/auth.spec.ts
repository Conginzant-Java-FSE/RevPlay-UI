import { TestBed } from '@angular/core/testing';
import { AuthService } from './auth.ts';
import { ApiService } from './api';
import { TokenService } from './token';
import { Router } from '@angular/router';
import { of, throwError } from 'rxjs';

describe('AuthService', () => {
  let service: AuthService;
  let apiServiceMock: any;
  let tokenServiceMock: any;
  let routerMock: any;

  beforeEach(() => {
    apiServiceMock = {
      post: jasmine.createSpy('post'),
      get: jasmine.createSpy('get')
    };
    tokenServiceMock = {
      saveToken: jasmine.createSpy('saveToken'),
      getToken: jasmine.createSpy('getToken'),
      removeToken: jasmine.createSpy('removeToken')
    };
    routerMock = {
      navigate: jasmine.createSpy('navigate')
    };

    TestBed.configureTestingModule({
      providers: [
        AuthService,
        { provide: ApiService, useValue: apiServiceMock },
        { provide: TokenService, useValue: tokenServiceMock },
        { provide: Router, useValue: routerMock }
      ]
    });
    service = TestBed.inject(AuthService);
  });

  it('should login successfully', (done) => {
    const mockResponse = { token: 'mock-token', user: { id: 1, username: 'test' } };
    apiServiceMock.post.and.returnValue(of(mockResponse));

    service.login('test', 'password').subscribe(res => {
      expect(res).toEqual(mockResponse);
      expect(tokenServiceMock.saveToken).toHaveBeenCalledWith('mock-token');
      expect(routerMock.navigate).toHaveBeenCalledWith(['/']);
      done();
    });
  });

  it('should logout correctly', () => {
    service.logout();
    expect(tokenServiceMock.removeToken).toHaveBeenCalled();
    expect(routerMock.navigate).toHaveBeenCalledWith(['/login']);
  });
});
