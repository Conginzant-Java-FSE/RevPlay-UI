declare const jasmine: any;
declare const spyOn: any;
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { of, throwError } from 'rxjs';
import { LoginComponent } from './login.component';
import { AuthService } from '../../core/services/auth';
import { TokenService } from '../../core/services/token';

describe('LoginComponent', () => {
  let component: LoginComponent;
  let fixture: ComponentFixture<LoginComponent>;
  let authServiceSpy: any;
  let tokenServiceSpy: any;
  let routerSpy: any;

  beforeEach(async () => {
    authServiceSpy = jasmine.createSpyObj('AuthService', ['login', 'getCurrentUserSnapshot', 'getPostLoginRedirect']);
    tokenServiceSpy = jasmine.createSpyObj('TokenService', ['clearTokens']);
    routerSpy = jasmine.createSpyObj('Router', ['navigateByUrl', 'navigate']);

    authServiceSpy.getPostLoginRedirect.and.returnValue('/home');
    authServiceSpy.login.and.returnValue(of({ user: { role: 'LISTENER' } }));

    await TestBed.configureTestingModule({
      imports: [LoginComponent],
      providers: [
        { provide: AuthService, useValue: authServiceSpy },
        { provide: TokenService, useValue: tokenServiceSpy },
        { provide: Router, useValue: routerSpy },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              queryParamMap: convertToParamMap({ returnUrl: '/target' })
            }
          }
        }
      ]
    })
      .overrideComponent(LoginComponent, {
        set: { template: '' }
      })
      .compileComponents();

    fixture = TestBed.createComponent(LoginComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => {
    fixture.destroy();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should clear tokens when component is constructed', () => {
    expect(tokenServiceSpy.clearTokens).toHaveBeenCalled();
  });

  it('should validate required fields on submit', () => {
    component.credentials.usernameOrEmail = '';
    component.credentials.password = '';

    component.onSubmit();

    expect(component.error).toContain('Please enter username/email and password');
    expect(authServiceSpy.login).not.toHaveBeenCalled();
  });

  it('should submit normalized credentials and navigate on success', () => {
    component.credentials.usernameOrEmail = 'USER@MAIL.COM';
    component.credentials.password = 'Secret123!';

    component.onSubmit();

    expect(authServiceSpy.login).toHaveBeenCalledWith({
      usernameOrEmail: 'user@mail.com',
      password: 'Secret123!'
    });
    expect(routerSpy.navigateByUrl).toHaveBeenCalledWith('/target');
  });

  it('should validate email format when username looks like an email', () => {
    component.credentials.usernameOrEmail = 'bad-email@';
    component.credentials.password = 'Secret123!';

    component.onSubmit();

    expect(component.error).toContain('valid email');
    expect(authServiceSpy.login).not.toHaveBeenCalled();
  });

  it('should use role-based redirect when returnUrl is empty', () => {
    component.returnUrl = '';
    component.credentials.usernameOrEmail = 'demoUser';
    component.credentials.password = 'Secret123!';
    authServiceSpy.login.and.returnValue(of({ user: { role: 'ARTIST' } }));
    authServiceSpy.getPostLoginRedirect.and.returnValue('/creator-studio/dashboard');

    component.onSubmit();

    expect(authServiceSpy.getPostLoginRedirect).toHaveBeenCalled();
    expect(routerSpy.navigateByUrl).toHaveBeenCalledWith('/creator-studio/dashboard');
  });

  it('should route to verify-email when backend reports unverified email', () => {
    component.credentials.usernameOrEmail = 'USER@MAIL.COM';
    component.credentials.password = 'Secret123!';
    authServiceSpy.login.and.returnValue(throwError(() => ({
      error: {
        code: 'EMAIL_NOT_VERIFIED',
        email: 'USER@MAIL.COM',
        message: 'Email not verified'
      }
    })));

    component.onSubmit();

    expect(routerSpy.navigate).toHaveBeenCalledWith(
      ['/verify-email'],
      jasmine.objectContaining({
        queryParams: jasmine.objectContaining({ email: 'user@mail.com' })
      })
    );
    expect(component.error).toBeNull();
  });

  it('should map unauthorized username login failures to user-friendly message', () => {
    component.credentials.usernameOrEmail = 'demoUser';
    component.credentials.password = 'bad-pass';
    authServiceSpy.login.and.returnValue(throwError(() => ({ status: 401 })));

    component.onSubmit();

    expect(component.error).toBe('Password is incorrect or username is not registered.');
  });

  it('should map unauthorized email login failures to user-friendly message', () => {
    component.credentials.usernameOrEmail = 'demo@mail.com';
    component.credentials.password = 'bad-pass';
    authServiceSpy.login.and.returnValue(throwError(() => ({ status: 401 })));

    component.onSubmit();

    expect(component.error).toBe('Password is incorrect or email is not registered.');
  });

  it('should map disabled account responses', () => {
    component.credentials.usernameOrEmail = 'demoUser';
    component.credentials.password = 'bad-pass';
    authServiceSpy.login.and.returnValue(throwError(() => ({
      status: 403,
      error: { message: 'Account disabled' }
    })));

    component.onSubmit();

    expect(component.error).toContain('not allowed');
  });

  it('should surface backend message when available', () => {
    component.credentials.usernameOrEmail = 'demoUser';
    component.credentials.password = 'bad-pass';
    authServiceSpy.login.and.returnValue(throwError(() => ({
      status: 500,
      error: { message: 'Custom server issue' }
    })));

    component.onSubmit();

    expect(component.error).toBe('Custom server issue');
    expect(component.isLoading).toBeFalse();
  });
});



