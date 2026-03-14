declare const jasmine: any;
declare const spyOn: any;
import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { ForgotPassword } from './forgot-password';
import { AuthService } from '../../core/services/auth';

describe('ForgotPassword', () => {
  let component: ForgotPassword;
  let fixture: ComponentFixture<ForgotPassword>;
  let authServiceSpy: any;

  beforeEach(async () => {
    authServiceSpy = jasmine.createSpyObj('AuthService', ['forgotPassword']);
    authServiceSpy.forgotPassword.and.returnValue(of({ message: 'ok' }));

    await TestBed.configureTestingModule({
      imports: [ForgotPassword],
      providers: [{ provide: AuthService, useValue: authServiceSpy }]
    })
      .overrideComponent(ForgotPassword, {
        set: { template: '' }
      })
      .compileComponents();

    fixture = TestBed.createComponent(ForgotPassword);
    component = fixture.componentInstance;
  });

  afterEach(() => {
    fixture.destroy();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should validate email before submitting', () => {
    component.email = 'invalid-email';

    component.onSubmit();

    expect(component.error).toContain('valid email');
    expect(authServiceSpy.forgotPassword).not.toHaveBeenCalled();
  });

  it('should submit normalized email and set success state', () => {
    component.email = 'USER@MAIL.COM ';

    component.onSubmit();

    expect(authServiceSpy.forgotPassword).toHaveBeenCalledWith('user@mail.com');
    expect(component.successMessage).toBeTruthy();
  });

  it('should require a non-empty email', () => {
    component.email = '';

    component.onSubmit();

    expect(component.error).toContain('registered email');
    expect(authServiceSpy.forgotPassword).not.toHaveBeenCalled();
  });

  it('should stop loader after short delay', fakeAsync(() => {
    component.email = 'user@mail.com';

    component.onSubmit();
    expect(component.isLoading).toBeTrue();

    tick(351);
    expect(component.isLoading).toBeFalse();
  }));

  it('should keep success message even when API fails', () => {
    authServiceSpy.forgotPassword.and.returnValue(throwError(() => new Error('network')));
    component.email = 'user@mail.com';

    component.onSubmit();

    expect(component.successMessage).toBe('Reset link sent to your mail.');
    expect(component.error).toBeNull();
  });

  it('should prefer backend success message when available', () => {
    authServiceSpy.forgotPassword.and.returnValue(of({ userMessage: 'Check inbox for reset link.' }));
    component.email = 'user@mail.com';

    component.onSubmit();

    expect(component.successMessage).toBe('Check inbox for reset link.');
  });
});



