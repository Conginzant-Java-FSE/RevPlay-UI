declare const jasmine: any;
declare const spyOn: any;
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { of, throwError } from 'rxjs';
import { RegisterComponent } from './register.component';
import { AuthService } from '../../core/services/auth';

describe('RegisterComponent', () => {
  let component: RegisterComponent;
  let fixture: ComponentFixture<RegisterComponent>;
  let authServiceSpy: any;
  let routerSpy: any;

  beforeEach(async () => {
    authServiceSpy = jasmine.createSpyObj('AuthService', ['register']);
    routerSpy = jasmine.createSpyObj('Router', ['navigate']);

    authServiceSpy.register.and.returnValue(of({
      user: { id: 1 },
      message: 'Registration successful'
    }));

    await TestBed.configureTestingModule({
      imports: [RegisterComponent],
      providers: [
        { provide: AuthService, useValue: authServiceSpy },
        { provide: Router, useValue: routerSpy }
      ]
    })
      .overrideComponent(RegisterComponent, {
        set: { template: '' }
      })
      .compileComponents();

    fixture = TestBed.createComponent(RegisterComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => {
    fixture.destroy();
    localStorage.clear();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should validate password strength helper', () => {
    component.userData.password = 'weak';
    expect(component.isPasswordStrong()).toBe(false);

    component.userData.password = 'Strong123!';
    expect(component.isPasswordStrong()).toBe(true);
  });

  it('should block submission when required fields are missing', () => {
    component.userData = {
      fullName: '',
      username: '',
      email: '',
      password: '',
      confirmPassword: '',
      role: 'LISTENER'
    };

    component.onSubmit();

    expect(component.error).toContain('Please fill all required fields');
    expect(authServiceSpy.register).not.toHaveBeenCalled();
  });

  it('should register and redirect to verify-email with normalized email', () => {
    component.userData = {
      fullName: 'Demo User',
      username: 'demo_user',
      email: 'USER@MAIL.COM',
      password: 'Strong123!',
      confirmPassword: 'Strong123!',
      role: 'LISTENER'
    };

    component.onSubmit();

    expect(authServiceSpy.register).toHaveBeenCalledWith(jasmine.objectContaining({
      email: 'user@mail.com',
      username: 'demo_user'
    }));
    expect(routerSpy.navigate).toHaveBeenCalledWith(['/verify-email'], jasmine.objectContaining({
      queryParams: jasmine.objectContaining({ email: 'user@mail.com' })
    }));
  });

  it('should block submission for invalid full name', () => {
    component.userData = {
      fullName: '1',
      username: 'demo_user',
      email: 'demo@mail.com',
      password: 'Strong123!',
      confirmPassword: 'Strong123!',
      role: 'LISTENER'
    };

    component.onSubmit();

    expect(component.error).toContain('valid full name');
    expect(authServiceSpy.register).not.toHaveBeenCalled();
  });

  it('should block submission for invalid username format', () => {
    component.userData = {
      fullName: 'Demo User',
      username: '1demo',
      email: 'demo@mail.com',
      password: 'Strong123!',
      confirmPassword: 'Strong123!',
      role: 'LISTENER'
    };

    component.onSubmit();

    expect(component.error).toContain('Username must start with a letter');
    expect(authServiceSpy.register).not.toHaveBeenCalled();
  });

  it('should block submission for reserved username from local cache', () => {
    localStorage.setItem('revplay_registered_username_map', JSON.stringify({ demo_user: 42 }));
    component.userData = {
      fullName: 'Demo User',
      username: 'demo_user',
      email: 'demo@mail.com',
      password: 'Strong123!',
      confirmPassword: 'Strong123!',
      role: 'LISTENER'
    };

    component.onSubmit();

    expect(component.error).toContain('already in use');
    expect(authServiceSpy.register).not.toHaveBeenCalled();
  });

  it('should block submission for invalid email and weak password', () => {
    component.userData = {
      fullName: 'Demo User',
      username: 'demo_user',
      email: 'invalid-email',
      password: 'weak',
      confirmPassword: 'weak',
      role: 'LISTENER'
    };

    component.onSubmit();
    expect(component.error).toContain('valid email');

    component.userData.email = 'demo@mail.com';
    component.onSubmit();
    expect(component.error).toContain('at least');
    expect(authServiceSpy.register).not.toHaveBeenCalled();
  });

  it('should block submission when passwords do not match', () => {
    component.userData = {
      fullName: 'Demo User',
      username: 'demo_user',
      email: 'demo@mail.com',
      password: 'Strong123!',
      confirmPassword: 'Wrong123!',
      role: 'LISTENER'
    };

    component.onSubmit();

    expect(component.error).toContain('Passwords do not match');
    expect(authServiceSpy.register).not.toHaveBeenCalled();
  });

  it('should persist registration caches when user id exists in response', () => {
    authServiceSpy.register.and.returnValue(of({
      user: { id: 55 },
      message: 'Check your email for OTP'
    }));
    component.userData = {
      fullName: 'Demo User',
      username: 'demo_user',
      email: 'demo@mail.com',
      password: 'Strong123!',
      confirmPassword: 'Strong123!',
      role: 'LISTENER'
    };

    component.onSubmit();

    const emailMap = JSON.parse(localStorage.getItem('revplay_user_email_map') ?? '{}');
    const usernameMap = JSON.parse(localStorage.getItem('revplay_registered_username_map') ?? '{}');
    const logs = JSON.parse(localStorage.getItem('revplay_pending_registration_logs') ?? '[]');

    expect(emailMap['55']).toBe('demo@mail.com');
    expect(usernameMap['demo_user']).toBe(55);
    expect(Array.isArray(logs)).toBeTrue();
    expect(logs.length).toBeGreaterThan(0);
    expect(routerSpy.navigate).toHaveBeenCalledWith(['/verify-email'], jasmine.objectContaining({
      queryParams: jasmine.objectContaining({ email: 'demo@mail.com', message: 'Check your email for OTP' })
    }));
  });

  it('should map duplicate registration errors', () => {
    authServiceSpy.register.and.returnValue(throwError(() => ({ status: 409 })));
    component.userData = {
      fullName: 'Demo User',
      username: 'demo_user',
      email: 'demo@mail.com',
      password: 'Strong123!',
      confirmPassword: 'Strong123!',
      role: 'LISTENER'
    };

    component.onSubmit();

    expect(component.error).toContain('already registered');
  });

  it('should map username field-level duplicate errors', () => {
    authServiceSpy.register.and.returnValue(throwError(() => ({
      error: {
        errors: [{ field: 'username', reason: 'already exists' }]
      }
    })));
    component.userData = {
      fullName: 'Demo User',
      username: 'demo_user',
      email: 'demo@mail.com',
      password: 'Strong123!',
      confirmPassword: 'Strong123!',
      role: 'LISTENER'
    };

    component.onSubmit();

    expect(component.error).toContain('already in use');
  });

  it('should map timeout registration errors', () => {
    authServiceSpy.register.and.returnValue(throwError(() => ({ name: 'TimeoutError' })));
    component.userData = {
      fullName: 'Demo User',
      username: 'demo_user',
      email: 'demo@mail.com',
      password: 'Strong123!',
      confirmPassword: 'Strong123!',
      role: 'LISTENER'
    };

    component.onSubmit();

    expect(component.error).toContain('taking longer');
  });
});



