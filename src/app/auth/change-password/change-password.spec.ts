declare const jasmine: any;
declare const spyOn: any;
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { ChangePassword } from './change-password';
import { AuthService } from '../../core/services/auth';

describe('ChangePassword', () => {
  let component: ChangePassword;
  let fixture: ComponentFixture<ChangePassword>;
  let authServiceSpy: any;

  beforeEach(async () => {
    authServiceSpy = jasmine.createSpyObj('AuthService', ['changePassword']);
    authServiceSpy.changePassword.and.returnValue(of({ success: true, message: 'Changed' }));

    await TestBed.configureTestingModule({
      imports: [ChangePassword],
      providers: [{ provide: AuthService, useValue: authServiceSpy }]
    })
      .overrideComponent(ChangePassword, {
        set: { template: '' }
      })
      .compileComponents();

    fixture = TestBed.createComponent(ChangePassword);
    component = fixture.componentInstance;
  });

  afterEach(() => {
    fixture.destroy();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should evaluate password strength', () => {
    component.newPassword = 'weak';
    expect(component.isPasswordStrong()).toBe(false);

    component.newPassword = 'Strong123!';
    expect(component.isPasswordStrong()).toBe(true);
  });

  it('should stop submission when passwords do not match', () => {
    component.currentPassword = 'Current123!';
    component.newPassword = 'Strong123!';
    component.confirmNewPassword = 'Wrong123!';

    component.onSubmit();

    expect(component.error).toContain('Passwords do not match');
    expect(authServiceSpy.changePassword).not.toHaveBeenCalled();
  });

  it('should call changePassword on valid form submit', () => {
    component.currentPassword = 'Current123!';
    component.newPassword = 'Strong123!';
    component.confirmNewPassword = 'Strong123!';

    component.onSubmit();

    expect(authServiceSpy.changePassword).toHaveBeenCalledWith({
      currentPassword: 'Current123!',
      newPassword: 'Strong123!'
    });
  });

  it('should block submission when required fields are missing', () => {
    component.currentPassword = '';
    component.newPassword = '';
    component.confirmNewPassword = '';

    component.onSubmit();

    expect(component.error).toContain('required fields');
    expect(authServiceSpy.changePassword).not.toHaveBeenCalled();
  });

  it('should block submission for weak passwords', () => {
    component.currentPassword = 'Current123!';
    component.newPassword = 'weak';
    component.confirmNewPassword = 'weak';

    component.onSubmit();

    expect(component.error).toContain('at least');
    expect(authServiceSpy.changePassword).not.toHaveBeenCalled();
  });

  it('should handle API responses with success=false', () => {
    authServiceSpy.changePassword.and.returnValue(of({ success: false, message: 'Cannot reuse password' }));
    component.currentPassword = 'Current123!';
    component.newPassword = 'Strong123!';
    component.confirmNewPassword = 'Strong123!';

    component.onSubmit();

    expect(component.error).toBe('Cannot reuse password');
    expect(component.successMessage).toBeNull();
    expect(component.isLoading).toBeFalse();
  });

  it('should clear fields and set success message on successful password change', () => {
    authServiceSpy.changePassword.and.returnValue(of({ success: true, message: 'Password changed successfully' }));
    component.currentPassword = 'Current123!';
    component.newPassword = 'Strong123!';
    component.confirmNewPassword = 'Strong123!';

    component.onSubmit();

    expect(component.successMessage).toBe('Password changed successfully');
    expect(component.currentPassword).toBe('');
    expect(component.newPassword).toBe('');
    expect(component.confirmNewPassword).toBe('');
  });

  it('should set error when changePassword API throws', () => {
    authServiceSpy.changePassword.and.returnValue(throwError(() => ({ status: 500, error: { message: 'Server down' } })));
    component.currentPassword = 'Current123!';
    component.newPassword = 'Strong123!';
    component.confirmNewPassword = 'Strong123!';

    component.onSubmit();

    expect(component.error).toBeTruthy();
    expect(component.successMessage).toBeNull();
    expect(component.isLoading).toBeFalse();
  });
});



