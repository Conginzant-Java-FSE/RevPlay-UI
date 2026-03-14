declare const jasmine: any;
declare const spyOn: any;
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BehaviorSubject, of } from 'rxjs';
import { DashboardComponent } from './dashboard.component';
import { ArtistService } from '../../core/services/artist.service';
import { StateService } from '../../core/services/state.service';
import { AuthService } from '../../core/services/auth';

describe('Artist DashboardComponent', () => {
  let component: DashboardComponent;
  let fixture: ComponentFixture<DashboardComponent>;
  let artistServiceSpy: any;
  let stateServiceSpy: any;

  beforeEach(async () => {
    artistServiceSpy = jasmine.createSpyObj('ArtistService', [
      'getArtistDashboard',
      'getArtistSummary',
      'getArtistTrends',
      'getArtistSongsPopularity',
      'getArtistSongs',
      'getArtistAlbums',
      'findArtistByUsername',
      'getCachedAlbumImage',
      'getCachedSongImage',
      'resolveImageUrl',
      'getSong',
      'cacheSongImage',
      'createArtist'
    ]);

    artistServiceSpy.getArtistDashboard.and.returnValue(of({ totalPlays: 10 }));
    artistServiceSpy.getArtistSummary.and.returnValue(of({ totalSongs: 2 }));
    artistServiceSpy.getArtistTrends.and.returnValue(of([]));
    artistServiceSpy.getArtistSongsPopularity.and.returnValue(of([]));
    artistServiceSpy.getArtistSongs.and.returnValue(of({ content: [] }));
    artistServiceSpy.getArtistAlbums.and.returnValue(of({ content: [] }));
    artistServiceSpy.findArtistByUsername.and.returnValue(of({ artistId: 10 }));
    artistServiceSpy.getCachedAlbumImage.and.returnValue('');
    artistServiceSpy.getCachedSongImage.and.returnValue('');
    artistServiceSpy.resolveImageUrl.and.returnValue('');
    artistServiceSpy.getSong.and.returnValue(of(null));
    artistServiceSpy.cacheSongImage.and.stub();
    artistServiceSpy.createArtist.and.returnValue(of({ artistId: 10 }));

    const artistId$ = new BehaviorSubject<number | null>(10);

    stateServiceSpy = {
      artistId: 10,
      artistId$: artistId$.asObservable(),
      setArtistId: jasmine.createSpy('setArtistId'),
      setArtistIdForUser: jasmine.createSpy('setArtistIdForUser'),
      getArtistIdForUser: jasmine.createSpy('getArtistIdForUser').and.returnValue(10)
    };

    await TestBed.configureTestingModule({
      imports: [DashboardComponent],
      providers: [
        { provide: ArtistService, useValue: artistServiceSpy },
        { provide: StateService, useValue: stateServiceSpy },
        {
          provide: AuthService,
          useValue: {
            getCurrentUserSnapshot: jasmine.createSpy('getCurrentUserSnapshot').and.returnValue({
              userId: 1,
              username: 'artist1',
              artistId: 10,
              role: 'ARTIST'
            }),
            currentUser$: of(null)
          }
        }
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

  it('should call loadDashboardData during ngOnInit lifecycle', () => {
    const loadSpy = spyOn(component, 'loadDashboardData');

    component.ngOnInit();

    expect(loadSpy).toHaveBeenCalled();
  });

  it('should request dashboard data from ArtistService', () => {
    component.loadDashboardData();

    expect(artistServiceSpy.getArtistDashboard).toHaveBeenCalledWith(10);
    expect(artistServiceSpy.getArtistSummary).toHaveBeenCalledWith(10);
  });

  it('should set fallback image on track image load error', () => {
    const image = document.createElement('img');

    component.onTrackImageError({ target: image } as any);

    expect(image.src).toContain('/assets/images/placeholder-album.png');
  });

  it('should trigger reload from refreshDashboard', () => {
    const loadSpy = spyOn(component, 'loadDashboardData');

    component.refreshDashboard();

    expect(loadSpy).toHaveBeenCalled();
  });

  it('should calculate trend values and labels safely', () => {
    const point = { songTitle: 'Demo Track', playCount: 12 };

    expect(component.getTrendLabel(point, 0)).toBe('Demo Track');
    expect(component.getTrendValue(point)).toBe(12);
  });

  it('should return zero percent when no trend max exists', () => {
    component.maxTrendPlays = 0;

    expect(component.getTrendPercent({ playCount: 10 })).toBe(0);
  });

  it('should calculate trend percent using max trend plays', () => {
    component.maxTrendPlays = 50;

    expect(component.getTrendPercent({ playCount: 25 })).toBe(50);
  });

  it('should resolve chart source using top songs when trend points miss names', () => {
    component.topSongs = [{ title: 'Song A', playCount: 10 }];

    const source = (component as any).resolveChartSource([{ playCount: 5 }]);

    expect(source).toEqual(component.topSongs);
  });

  it('should compute total plays from stats, songs, and trends fallback', () => {
    expect((component as any).resolveTotalPlays({ totalPlays: 15 }, [], [])).toBe(15);
    expect((component as any).resolveTotalPlays({}, [{ playCount: 3 }, { playCount: 7 }], [])).toBe(10);
    expect((component as any).resolveTotalPlays({}, [], [{ playCount: 2 }, { playCount: 8 }])).toBe(10);
  });

  it('should prefer fallback songs when fallback has higher plays', () => {
    const primary = [{ playCount: 1 }];
    const fallback = [{ playCount: 10 }];

    const chosen = (component as any).preferSongsWithPlays(primary, fallback);

    expect(chosen).toBe(fallback);
  });

  it('should resolve song image from indexed album cover and cached song image', () => {
    (component as any).albumCoverById.set(9, '/album-cover.jpg');
    const fromAlbum = (component as any).resolveSongImageUrl({ albumId: 9 });
    expect(fromAlbum).toBe('/album-cover.jpg');

    artistServiceSpy.getCachedSongImage.and.returnValue('/song-cover.jpg');
    const fromSongCache = (component as any).resolveSongImageUrl({ songId: 11 });
    expect(fromSongCache).toBe('/song-cover.jpg');
  });

  it('should persist and restore cached dashboard snapshot per user', () => {
    (component as any).userId = 77;
    const snapshot = {
      stats: { totalPlays: 90 },
      summary: { totalSongs: 4 },
      trendPoints: [{ playCount: 10 }],
      topSongs: [{ songId: 1, title: 'A' }],
      savedAt: Date.now()
    };

    (component as any).saveDashboardSnapshotForCurrentUser(snapshot);
    const restored = (component as any).getCachedDashboardSnapshotForCurrentUser();

    expect(restored?.stats?.totalPlays).toBe(90);
    expect(restored?.summary?.totalSongs).toBe(4);
    expect(Array.isArray(restored?.topSongs)).toBe(true);
  });

  it('should initialize user context and set artist id when direct artist id exists', () => {
    (component as any).initializeUserContext({
      userId: 5,
      username: 'artist5',
      artistId: 99
    });

    expect(stateServiceSpy.setArtistId).toHaveBeenCalledWith(99);
    expect(stateServiceSpy.setArtistIdForUser).toHaveBeenCalledWith(5, 99);
  });

  it('should classify section issues based on response status', () => {
    (component as any).captureSectionIssue({ status: 401 }, 'summary');
    (component as any).captureSectionIssue({ status: 403 }, 'trends');
    (component as any).captureSectionIssue({ status: 500 }, 'songs');

    const issues = (component as any).sectionIssues as Set<string>;
    expect(Array.from(issues.values())).toContain('summary: session');
    expect(Array.from(issues.values())).toContain('trends: access');
    expect(Array.from(issues.values())).toContain('songs');
  });

  it('should find best artist-like search result by user id and username', () => {
    (component as any).userId = 21;
    const result = (component as any).findBestArtistSearchResult([
      { type: 'ARTIST', artistId: 2, userId: 8, username: 'abc' },
      { type: 'ARTIST', artistId: 3, userId: 21, username: 'target' }
    ], 'target');

    expect(result.artistId).toBe(3);
    expect((component as any).isArtistLikeSearchItem({ type: 'SONG', artistId: 3 })).toBe(false);
    expect((component as any).isArtistLikeSearchItem({ type: 'ARTIST', artistId: 3 })).toBe(true);
  });

  it('should destroy trend chart during ngOnDestroy', () => {
    const destroySpy = jasmine.createSpy('destroy');
    (component as any).trendChartInstance = { destroy: destroySpy };

    component.ngOnDestroy();

    expect(destroySpy).toHaveBeenCalled();
  });
});



