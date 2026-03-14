import { TestBed } from '@angular/core/testing';
import { CanActivateFn } from '@angular/router';
import { roleGuard } from './role-guard';

describe('roleGuard', () => {
  const executeGuard: CanActivateFn = (...guardParameters) =>
    TestBed.runInInjectionContext(() => roleGuard(...guardParameters));

  beforeEach(() => {
    TestBed.configureTestingModule({});
  });

  it('should be created', () => {
    expect(executeGuard).toBeTruthy();
  });

  it('should allow route activation', () => {
    const result = executeGuard({} as any, {} as any);
    expect(result).toBe(true);
  });

  it('should still allow activation when route metadata is present', () => {
    const result = executeGuard(
      { data: { role: 'ADMIN', requiresAuth: true } } as any,
      { url: '/admin-studio/dashboard' } as any
    );

    expect(result).toBe(true);
  });
});


