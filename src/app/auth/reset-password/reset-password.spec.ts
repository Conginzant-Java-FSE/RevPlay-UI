declare const jasmine: any;
declare const spyOn: any;
import { fakeAsync, ComponentFixture, TestBed, tick } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { of, throwError } from 'rxjs';
import { ResetPassword } from './reset-password';
import { AuthService } from '../../core/services/auth';

describe('ResetPassword', () => {
  let component: ResetPassword;
  let fixture: ComponentFixture<ResetPassword>;
  let authServiceSpy: any;
  let routerSpy: any;

  beforeEach(async () => {
    authServiceSpy = jasmine.createSpyObj('AuthService', ['resetPassword']);
    routerSpy = jasmine.createSpyObj('Router', ['navigate']);
    authServiceSpy.resetPassword.and.returnValue(of({ success: true }));

    await TestBed.configureTestingModule({
      imports: [ResetPassword],
      providers: [
        { provide: AuthService, useValue: authServiceSpy },
        { provide: Router, useValue: routerSpy },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              queryParamMap: convertToParamMap({ token: 'abc123' })
            }
          }
        }
      ]
    })
      .overrideComponent(ResetPassword, {
        set: { template: '' }
      })
      .compileComponents();

    fixture = TestBed.createComponent(ResetPassword);
    component = fixture.componentInstance;
  });

  afterEach(() => {
    fixture.destroy();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
    expect(component.token).toBe('abc123');
  });

  it('should disable submit when passwords do not match', () => {
    component.newPassword = 'Strong123!';
    component.confirmPassword = 'Mismatch123!';

    expect(component.isSubmitDisabled).toBe(true);
  });

  it('should validate matching passwords before API call', () => {
    component.newPassword = 'Strong123!';
    component.confirmPassword = 'Wrong123!';

    component.onSubmit();

    expect(component.error).toContain('Confirm password must match');
    expect(authServiceSpy.resetPassword).not.toHaveBeenCalled();
  });

  it('should call resetPassword and navigate to login on success', fakeAsync(() => {
    component.newPassword = 'Strong123!';
    component.confirmPassword = 'Strong123!';

    component.onSubmit();

    expect(authServiceSpy.resetPassword).toHaveBeenCalledWith({
      token: 'abc123',
      newPassword: 'Strong123!'
    });
    expect(component.resetSuccessful).toBe(true);

    tick(901);
    expect(routerSpy.navigate).toHaveBeenCalledWith(['/auth/login']);
  }));

  it('should mark token invalid when token is missing', () => {
    component.token = '';
    component.newPassword = 'Strong123!';
    component.confirmPassword = 'Strong123!';

    component.onSubmit();

    expect(component.invalidOrExpiredToken).toBeTrue();
    expect(component.error).toBeNull();
    expect(authServiceSpy.resetPassword).not.toHaveBeenCalled();
  });

  it('should require both password fields', () => {
    component.newPassword = '';
    component.confirmPassword = '';

    component.onSubmit();

    expect(component.error).toContain('required');
    expect(authServiceSpy.resetPassword).not.toHaveBeenCalled();
  });

  it('should mark invalid/expired token from API status response', () => {
    authServiceSpy.resetPassword.and.returnValue(throwError(() => ({ status: 410 })));
    component.newPassword = 'Strong123!';
    component.confirmPassword = 'Strong123!';

    component.onSubmit();

    expect(component.invalidOrExpiredToken).toBeTrue();
    expect(component.error).toBeNull();
  });

  it('should show timeout message when reset request times out', () => {
    authServiceSpy.resetPassword.and.returnValue(throwError(() => ({ name: 'TimeoutError' })));
    component.newPassword = 'Strong123!';
    component.confirmPassword = 'Strong123!';

    component.onSubmit();

    expect(component.error).toContain('timed out');
    expect(component.isLoading).toBeFalse();
  });

  it('should navigate to forgot-password route', () => {
    component.goToForgotPassword();

    expect(routerSpy.navigate).toHaveBeenCalledWith(['/auth/forgot-password']);
  });

  it('should compute isSubmitDisabled for loading and mismatch states', () => {
    component.newPassword = 'Strong123!';
    component.confirmPassword = 'Strong123!';
    component.isLoading = false;
    expect(component.isSubmitDisabled).toBeFalse();

    component.isLoading = true;
    expect(component.isSubmitDisabled).toBeTrue();

    component.isLoading = false;
    component.confirmPassword = 'Wrong123!';
    expect(component.isSubmitDisabled).toBeTrue();
  });
});



