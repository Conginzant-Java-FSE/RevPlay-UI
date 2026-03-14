// @ts-nocheck
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { AuditLogsComponent } from './audit-logs.component';
import { AdminService } from '../../core/services/admin.service';

describe('AuditLogsComponent', () => {
  let component: AuditLogsComponent;
  let fixture: ComponentFixture<AuditLogsComponent>;
  let adminServiceSpy: any;

  beforeEach(async () => {
    adminServiceSpy = jasmine.createSpyObj('AdminService', ['getAuditLogs']);
    adminServiceSpy.getAuditLogs.and.returnValue(of({
      content: [],
      totalElements: 0,
      totalPages: 1,
      page: 0,
      size: 20
    }));

    await TestBed.configureTestingModule({
      imports: [AuditLogsComponent],
      providers: [{ provide: AdminService, useValue: adminServiceSpy }]
    })
      .overrideComponent(AuditLogsComponent, {
        set: { template: '' }
      })
      .compileComponents();

    fixture = TestBed.createComponent(AuditLogsComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => {
    fixture.destroy();
    localStorage.clear();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should trigger loading flow on ngOnInit', () => {
    const loadSpy = spyOn(component, 'loadLogs');
    const refreshSpy = spyOn(component, 'startAutoRefresh');

    component.ngOnInit();

    expect(loadSpy).toHaveBeenCalledWith(1);
    expect(refreshSpy).toHaveBeenCalled();
  });

  it('should load logs through AdminService', () => {
    component.loadLogs(1);

    expect(adminServiceSpy.getAuditLogs).toHaveBeenCalledWith(jasmine.objectContaining({
      page: 0,
      size: component.pageSize
    }));
    expect(component.logs).toEqual([]);
  });

  it('should reset to first page when applying filters', () => {
    component.currentPage = 3;
    spyOn(component, 'loadLogs');

    component.applyFilters();

    expect(component.loadLogs).toHaveBeenCalledWith(1);
  });

  it('should clear filters and reload first page', () => {
    component.filters = { user: '1', action: 'LOGIN', date: '2026-01-01' };
    const loadSpy = spyOn(component, 'loadLogs');

    component.clearFilters();

    expect(component.filters).toEqual({ user: '', action: '', date: '' });
    expect(loadSpy).toHaveBeenCalledWith(1);
  });

  it('should load keyword-filtered logs and collapse pagination to one page', () => {
    adminServiceSpy.getAuditLogs.and.returnValue(of({
      content: [
        { action: 'LOGIN', actorName: 'Alice', actorEmail: 'alice@mail.com', details: 'ok', timestamp: '2026-03-01' },
        { action: 'LOGIN', actorName: 'Bob', actorEmail: 'bob@mail.com', details: 'ok', timestamp: '2026-03-02' }
      ],
      totalElements: 2,
      totalPages: 1
    }));
    component.filters.user = 'alice';

    component.loadLogs(2);

    expect(component.logs.length).toBe(1);
    expect(component.logs[0].actorName).toBe('Alice');
    expect(component.currentPage).toBe(1);
    expect(component.totalPages).toBe(1);
  });

  it('should set error state when loading logs fails', () => {
    adminServiceSpy.getAuditLogs.and.returnValue(throwError(() => new Error('fail')));

    component.loadLogs(1);

    expect(component.error).toBe('Failed to load audit logs.');
    expect(component.logs).toEqual([]);
    expect(component.totalItems).toBe(0);
    expect(component.totalPages).toBe(1);
  });

  it('should avoid loading when requested page equals current page', () => {
    component.currentPage = 2;
    component.totalPages = 5;
    const loadSpy = spyOn(component, 'loadLogs');

    component.goToPage(2);

    expect(loadSpy).not.toHaveBeenCalled();
  });

  it('should clamp and load valid page on goToPage', () => {
    component.currentPage = 1;
    component.totalPages = 3;
    const loadSpy = spyOn(component, 'loadLogs');

    component.goToPage(99);

    expect(loadSpy).toHaveBeenCalledWith(3);
  });

  it('should generate page list around current window', () => {
    component.currentPage = 3;
    component.totalPages = 10;

    expect(component.getPageList()).toEqual([1, 2, 3, 4, 5]);
  });

  it('should normalize log values and resolve actor email from details', () => {
    const normalized = (component as any).normalizeLog({
      action: 'user_created',
      performedBy: 7,
      details: 'Created account for demo@example.com',
      timestamp: '2026-03-14'
    });

    expect(normalized.actionType).toBe('USER_CREATED');
    expect(normalized.actorId).toBe(7);
    expect(normalized.actorName).toBe('User #7');
    expect(normalized.actorEmail).toBe('demo@example.com');
    expect(normalized.actorDisplay).toContain('demo@example.com');
  });

  it('should merge and deduplicate server logs with pending registration logs', () => {
    localStorage.setItem('revplay_pending_registration_logs', JSON.stringify([
      {
        action: 'REGISTER',
        actorId: 9,
        actorName: 'User #9',
        actorEmail: 'new@demo.com',
        entityType: 'USER',
        timestamp: '2026-03-10'
      }
    ]));

    const merged = (component as any).mergeLogsWithPendingRegistrations([
      {
        action: 'REGISTER',
        actorId: 9,
        actorName: 'User #9',
        actorEmail: 'new@demo.com',
        entityType: 'USER',
        timestamp: '2026-03-11'
      }
    ]);

    expect(merged.length).toBe(1);
    expect(merged[0].actorId).toBe(9);
  });

  it('should clear auto refresh timer on destroy', () => {
    (component as any).autoRefreshTimer = window.setInterval(() => {}, 1000);

    component.ngOnDestroy();

    expect((component as any).autoRefreshTimer).toBeNull();
  });

  it('should not load logs when already loading', () => {
    component.isLoading = true;
    adminServiceSpy.getAuditLogs.calls.reset();

    component.loadLogs(1);

    expect(adminServiceSpy.getAuditLogs).not.toHaveBeenCalled();
  });

  it('should normalize actor name candidates and numeric fallbacks', () => {
    expect((component as any).resolveActorName({ actorName: 'John' }, 2)).toBe('John');
    expect((component as any).resolveActorName({ actorName: '123' }, 4)).toBe('User #4');
    expect((component as any).resolveActorName({}, null)).toBe('System');
  });

  it('should resolve actor id from multiple candidate keys', () => {
    expect((component as any).resolveActorId({ performedById: 8 })).toBe(8);
    expect((component as any).resolveActorId({ actorId: 6 })).toBe(6);
    expect((component as any).resolveActorId({ actorId: 0 })).toBeNull();
  });

  it('should normalize and validate email helpers', () => {
    expect((component as any).extractEmail('contact me at test@mail.com now')).toBe('test@mail.com');
    expect((component as any).normalizeEmail(' TEST@MAIL.COM ')).toBe('test@mail.com');
    expect((component as any).normalizeEmail('invalid-email')).toBe('');
  });

  it('should compute timestamp fallback for invalid values', () => {
    expect((component as any).toTimestamp('2026-03-14T00:00:00Z')).toBeGreaterThan(0);
    expect((component as any).toTimestamp('not-a-date')).toBe(0);
  });

  it('should build stable log key across normalized fields', () => {
    const key = (component as any).getLogKey({
      actorId: 2,
      actionType: 'REGISTER',
      actorEmail: 'User@Mail.com',
      actorName: 'User #2',
      entityType: 'USER'
    });

    expect(key).toContain('REGISTER');
    expect(key).toContain('user@mail.com');
    expect(key).toContain('user #2');
  });

  it('should return cached email by user id when present', () => {
    localStorage.setItem('revplay_user_email_map', JSON.stringify({ '11': 'cached@mail.com' }));

    expect((component as any).getCachedEmailByUserId(11)).toBe('cached@mail.com');
    expect((component as any).getCachedEmailByUserId(0)).toBe('');
  });

  it('should safely read pending logs from malformed local storage', () => {
    localStorage.setItem('revplay_pending_registration_logs', '{bad-json');

    expect((component as any).getPendingRegistrationLogs()).toEqual([]);
  });

  it('should start auto refresh timer once', () => {
    (component as any).startAutoRefresh();
    const firstTimer = (component as any).autoRefreshTimer;

    (component as any).startAutoRefresh();
    const secondTimer = (component as any).autoRefreshTimer;

    expect(firstTimer).toBeTruthy();
    expect(secondTimer).toBe(firstTimer);
  });
});



