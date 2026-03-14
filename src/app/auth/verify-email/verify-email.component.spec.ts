declare const jasmine: any;
declare const spyOn: any;
import { fakeAsync, ComponentFixture, TestBed, tick } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { of, throwError } from 'rxjs';
import { VerifyEmailComponent } from './verify-email.component';
import { AuthService } from '../../core/services/auth';

describe('VerifyEmailComponent', () => {
  let component: VerifyEmailComponent;
  let fixture: ComponentFixture<VerifyEmailComponent>;
  let authServiceSpy: any;
  let routerSpy: any;

  beforeEach(async () => {
    authServiceSpy = jasmine.createSpyObj('AuthService', ['verifyEmail', 'resendVerification']);
    routerSpy = jasmine.createSpyObj('Router', ['navigate']);

    authServiceSpy.verifyEmail.and.returnValue(of({ message: 'verified' }));
    authServiceSpy.resendVerification.and.returnValue(of({ message: 'resent' }));

    await TestBed.configureTestingModule({
      imports: [VerifyEmailComponent],
      providers: [
        { provide: AuthService, useValue: authServiceSpy },
        { provide: Router, useValue: routerSpy },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              queryParamMap: convertToParamMap({
                email: 'user@example.com',
                message: 'Use your OTP'
              })
            }
          }
        }
      ]
    })
      .overrideComponent(VerifyEmailComponent, {
        set: { template: '' }
      })
      .compileComponents();

    fixture = TestBed.createComponent(VerifyEmailComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => {
    fixture.destroy();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
    expect(component.email).toBe('user@example.com');
  });

  it('should normalize OTP input to digits only', () => {
    component.onOtpInput('12a3-45b6');
    expect(component.otp).toBe('123456');
  });

  it('should validate OTP length before verification', () => {
    component.otp = '123';

    component.verifyEmail();

    expect(component.error).toContain('6-digit OTP');
    expect(authServiceSpy.verifyEmail).not.toHaveBeenCalled();
  });

  it('should verify email and navigate to login on success', fakeAsync(() => {
    component.otp = '123456';

    component.verifyEmail();

    expect(authServiceSpy.verifyEmail).toHaveBeenCalledWith('user@example.com', '123456');
    expect(component.isVerified).toBe(true);

    tick(1201);
    expect(routerSpy.navigate).toHaveBeenCalledWith(['/auth/login']);
  }));

  it('should resend verification code', () => {
    component.resendCode();

    expect(authServiceSpy.resendVerification).toHaveBeenCalledWith('user@example.com');
    expect(component.resendSuccessMessage).toBeTruthy();
  });

  it('should require email before verification', () => {
    component.email = '';
    component.otp = '123456';

    component.verifyEmail();

    expect(component.error).toContain('Email is required');
    expect(authServiceSpy.verifyEmail).not.toHaveBeenCalled();
  });

  it('should require OTP input before verification', () => {
    component.otp = '';

    component.verifyEmail();

    expect(component.error).toContain('enter the OTP code');
    expect(authServiceSpy.verifyEmail).not.toHaveBeenCalled();
  });

  it('should show invalid/expired OTP message from API responses', () => {
    authServiceSpy.verifyEmail.and.returnValue(throwError(() => ({ status: 410, error: { message: 'OTP expired' } })));
    component.otp = '123456';

    component.verifyEmail();

    expect(component.error).toContain('Invalid or expired');
    expect(component.isVerifying).toBeFalse();
  });

  it('should show timeout message on verify request timeout', () => {
    authServiceSpy.verifyEmail.and.returnValue(throwError(() => ({ name: 'TimeoutError' })));
    component.otp = '123456';

    component.verifyEmail();

    expect(component.error).toContain('timed out');
    expect(component.isVerifying).toBeFalse();
  });

  it('should guard resend code when already resending', () => {
    component.isResending = true;

    component.resendCode();

    expect(authServiceSpy.resendVerification).not.toHaveBeenCalled();
  });

  it('should show timeout message when resend request times out', () => {
    component.isResending = false;
    authServiceSpy.resendVerification.and.returnValue(throwError(() => ({ name: 'TimeoutError' })));

    component.resendCode();

    expect(component.error).toContain('Resend request timed out');
    expect(component.isResending).toBeFalse();
  });

  it('should expose verify/resend disabled getters from state', () => {
    component.email = 'user@example.com';
    component.otp = '123456';
    component.isVerifying = false;
    component.isResending = false;
    expect(component.isVerifyDisabled).toBeFalse();
    expect(component.isResendDisabled).toBeFalse();

    component.isVerifying = true;
    expect(component.isVerifyDisabled).toBeTrue();
    expect(component.isResendDisabled).toBeTrue();
  });
});



