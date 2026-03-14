declare const jasmine: any;
declare const spyOn: any;
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { DashboardComponent } from './dashboard.component';
import { AdminService } from '../../core/services/admin.service';
import { ApiService } from '../../core/services/api';

describe('Admin DashboardComponent', () => {
  let component: DashboardComponent;
  let fixture: ComponentFixture<DashboardComponent>;
  let adminServiceSpy: any;
  let apiServiceSpy: any;

  beforeEach(async () => {
    adminServiceSpy = jasmine.createSpyObj('AdminService', [
      'getDashboardMetrics',
      'getTopArtists',
      'getTopContent',
      'getAuditLogs',
      'getUsersPage'
    ]);

    adminServiceSpy.getDashboardMetrics.and.returnValue(of({
      totalPlatformPlays: 10,
      playsLast24Hours: 2,
      activeUsers: { last7Days: 1, last30Days: 2 }
    }));
    adminServiceSpy.getTopArtists.and.returnValue(of([]));
    adminServiceSpy.getTopContent.and.returnValue(of([]));
    adminServiceSpy.getAuditLogs.and.returnValue(of({
      content: [],
      totalElements: 0,
      totalPages: 1,
      page: 0,
      size: 50
    }));
    adminServiceSpy.getUsersPage.and.returnValue(of({ content: [] }));
    apiServiceSpy = jasmine.createSpyObj('ApiService', ['get']);
    apiServiceSpy.get.and.returnValue(of(null));

    await TestBed.configureTestingModule({
      imports: [DashboardComponent],
      providers: [
        { provide: AdminService, useValue: adminServiceSpy },
        { provide: ApiService, useValue: apiServiceSpy }
      ]
    })
      .overrideComponent(DashboardComponent, {
        set: { template: '' }
      })
      .compileComponents();

    fixture = TestBed.createComponent(DashboardComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => {
    fixture.destroy();
    localStorage.clear();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should trigger lifecycle loading on ngOnInit', () => {
    const loadSpy = spyOn(component, 'loadDashboardData');
    const refreshSpy = spyOn(component, 'startAutoRefresh');

    component.ngOnInit();

    expect(loadSpy).toHaveBeenCalled();
    expect(refreshSpy).toHaveBeenCalled();
  });

  it('should load dashboard metrics from admin service', () => {
    component.loadDashboardData();

    expect(adminServiceSpy.getDashboardMetrics).toHaveBeenCalled();
    expect(adminServiceSpy.getTopArtists).toHaveBeenCalledWith(10);
    expect(adminServiceSpy.getTopContent).toHaveBeenCalledWith(10);
  });

  it('should not trigger data load when already loading', () => {
    component.isLoading = true;

    component.loadDashboardData();

    expect(adminServiceSpy.getDashboardMetrics).not.toHaveBeenCalled();
  });

  it('should format action labels safely', () => {
    expect(component.formatActionLabel('USER_CREATED')).toBe('User Created');
    expect(component.formatActionLabel('')).toBe('-');
  });

  it('should clear auto refresh timer during ngOnDestroy', () => {
    (component as any).autoRefreshTimer = window.setInterval(() => {}, 1000);

    component.ngOnDestroy();

    expect((component as any).autoRefreshTimer).toBeNull();
  });

  it('should set partial warning when a dashboard section fails', () => {
    adminServiceSpy.getTopArtists.and.returnValue(throwError(() => new Error('failed-artists')));

    component.loadDashboardData();

    expect(component.partialWarning).toContain('Top Artists');
    expect(component.isLoading).toBeFalse();
  });

  it('should use users-page fallback for recent registrations when registration logs are absent', () => {
    adminServiceSpy.getAuditLogs.and.returnValue(of({
      content: [],
      totalElements: 0,
      totalPages: 1,
      page: 0,
      size: 50
    }));
    adminServiceSpy.getUsersPage.and.returnValue(of({
      content: [{ userId: 5, fullName: 'New User', email: 'new@user.com', createdAt: '2026-03-01T00:00:00Z' }]
    }));

    component.loadDashboardData();

    expect(component.recentRegistrations.length).toBe(1);
    expect(component.recentRegistrations[0]).toEqual(jasmine.objectContaining({
      actorId: 5,
      actorName: 'New User',
      actorEmail: 'new@user.com'
    }));
  });

  it('should normalize metrics safely when payload is null', () => {
    const normalized = (component as any).normalizeMetrics(null);

    expect(normalized).toEqual({
      totalPlatformPlays: 0,
      playsLast24Hours: 0,
      activeUsers: { last7Days: 0, last30Days: 0 }
    });
  });

  it('should normalize and filter smoke test artists/content items', () => {
    const artists = (component as any).normalizeTopArtists([
      { artistId: 2, displayName: 'Artist A', playCount: '12' },
      { artistId: 3, name: 'smoke-user', playCount: 1 }
    ]);
    const content = (component as any).normalizeTopContent([
      { contentId: 7, title: 'Focus Song', type: 'song', artistId: 2, playCount: '5' },
      { contentId: 8, title: 'smoke endpoint', type: 'song', artistId: 2, playCount: 9 }
    ], new Map<number, string>([[2, 'Artist A']]));

    expect(artists.length).toBe(1);
    expect(artists[0].playCount).toBe(12);
    expect(content.length).toBe(1);
    expect(content[0]).toEqual(jasmine.objectContaining({
      title: 'Focus Song',
      artistName: 'Artist A',
      playCount: 5
    }));
  });

  it('should normalize logs and resolve actor/email details', () => {
    const normalized = (component as any).normalizeLog({
      performedBy: 9,
      action: 'user_created',
      details: 'Created account for demo@site.com'
    }, new Map<number, string>());

    expect(normalized.actorId).toBe(9);
    expect(normalized.actorName).toBe('User #9');
    expect(normalized.actorEmail).toBe('demo@site.com');
    expect(normalized.actionType).toBe('USER_CREATED');
  });

  it('should merge pending registration logs without duplicates', () => {
    localStorage.setItem('revplay_pending_registration_logs', JSON.stringify([
      {
        actorId: 1,
        action: 'REGISTER',
        entityType: 'USER',
        actorEmail: 'user1@mail.com',
        actorName: 'User #1',
        timestamp: '2026-03-14T10:00:00Z'
      }
    ]));

    const merged = (component as any).mergeLogsWithPendingRegistrations([
      {
        actorId: 1,
        actionType: 'REGISTER',
        entityType: 'USER',
        actorEmail: 'user1@mail.com',
        actorName: 'User #1',
        timestamp: '2026-03-14T09:00:00Z'
      }
    ]);

    expect(merged.length).toBe(1);
    expect(merged[0].actorEmail).toBe('user1@mail.com');
  });

  it('should resolve actor id and normalize email helpers', () => {
    const actorId = (component as any).resolveActorId({ performedById: 44 });
    const extracted = (component as any).extractEmail('hello TEST@MAIL.COM world');
    const normalizedEmail = (component as any).normalizeEmail(' TEST@MAIL.COM ');
    const invalidEmail = (component as any).normalizeEmail('not-an-email');

    expect(actorId).toBe(44);
    expect(extracted).toBe('test@mail.com');
    expect(normalizedEmail).toBe('test@mail.com');
    expect(invalidEmail).toBe('');
  });

  it('should extract email recursively from nested values', () => {
    const email = (component as any).extractEmailFromAny({
      profile: {
        contacts: ['nope', { email: 'nested@demo.com' }]
      }
    });

    expect(email).toBe('nested@demo.com');
  });

  it('should persist and read cached user email by user id', () => {
    (component as any).persistCachedEmailByUserId(77, 'cached@demo.com');
    const email = (component as any).getCachedEmailByUserId(77);

    expect(email).toBe('cached@demo.com');
  });

  it('should resolve artist name by song title from search endpoint', () => {
    apiServiceSpy.get.and.returnValue(of({
      content: [{ title: 'Focus Song', artistName: 'DJ Alpha' }]
    }));
    let result = '';

    (component as any).resolveArtistBySongTitle('Focus Song').subscribe((artistName: string) => {
      result = artistName;
    });

    expect(apiServiceSpy.get).toHaveBeenCalled();
    expect(result).toBe('DJ Alpha');
  });

  it('should enrich log emails from users page when actor email is missing', () => {
    adminServiceSpy.getUsersPage.and.returnValue(of({
      content: [{ userId: 21, email: 'mapped@demo.com' }]
    }));
    let enriched: any[] = [];

    (component as any).enrichLogEmailsFromProfiles([
      { actorId: 21, actorEmail: '', details: 'created user' }
    ]).subscribe((items: any[]) => {
      enriched = items;
    });

    expect(enriched[0].actorEmail).toBe('mapped@demo.com');
  });

  it('should detect registration actions from action and details text', () => {
    expect((component as any).isRegistrationAction({ actionType: 'USER_CREATED' })).toBeTrue();
    expect((component as any).isRegistrationAction({ details: 'Account created for listener' })).toBeTrue();
    expect((component as any).isRegistrationAction({ actionType: 'PLAY_STARTED', details: 'Played song' })).toBeFalse();
  });

  it('should build user contact map from logs', () => {
    const contactMap = (component as any).buildUserContactMap([
      { performedBy: 10, actorEmail: 'first@demo.com' },
      { performedBy: 11, details: 'new account for second@demo.com' },
      { performedBy: 10, actorEmail: 'duplicate@demo.com' }
    ]);

    expect(contactMap.get(10)).toBe('first@demo.com');
    expect(contactMap.get(11)).toBe('second@demo.com');
  });

  it('should normalize registration fallback users with defaults', () => {
    const normalized = (component as any).normalizeRegistrationFallback([
      { id: 99, username: 'fallbackUser', email: 'fallback@demo.com' }
    ]);

    expect(normalized[0]).toEqual(jasmine.objectContaining({
      actorId: 99,
      actorName: 'fallbackUser',
      actorEmail: 'fallback@demo.com',
      actionType: 'REGISTER'
    }));
  });

  it('should enrich top content artist names using song details and fallback search', () => {
    apiServiceSpy.get.and.callFake((path: string) => {
      if (path === '/songs/12') {
        return of({ data: { artistName: '' } });
      }
      if (path.includes('/search?q=')) {
        return of({ content: [{ title: 'Mystery Song', artistName: 'Resolved Artist' }] });
      }
      return of(null);
    });
    let enriched: any[] = [];

    (component as any).enrichTopContentWithSongDetails([
      { contentId: 12, type: 'SONG', title: 'Mystery Song', artistName: '', artistId: 0 }
    ], new Map<number, string>()).subscribe((items: any[]) => {
      enriched = items;
    });

    expect(enriched.length).toBe(1);
    expect(enriched[0].artistName).toBe('Resolved Artist');
  });

  it('should return empty artist from title resolver on API failure', () => {
    apiServiceSpy.get.and.returnValue(throwError(() => new Error('search-failed')));
    let artistName = 'unset';

    (component as any).resolveArtistBySongTitle('Any Song').subscribe((name: string) => {
      artistName = name;
    });

    expect(artistName).toBe('');
  });

  it('should generate stable log keys and timestamps', () => {
    const key = (component as any).getLogKey({
      actorId: 7,
      actionType: 'REGISTER',
      actorEmail: 'USER@MAIL.COM',
      entityType: 'USER',
      actorName: 'User #7'
    });
    const ts = (component as any).toTimestamp('2026-03-14T10:10:10Z');
    const invalidTs = (component as any).toTimestamp('not-a-date');

    expect(key).toContain('REGISTER');
    expect(key).toContain('user@mail.com');
    expect(ts).toBeGreaterThan(0);
    expect(invalidTs).toBe(0);
  });
});



