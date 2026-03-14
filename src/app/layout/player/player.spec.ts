declare const jasmine: any;
declare const spyOn: any;
import { fakeAsync, tick, ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { Router } from '@angular/router';
import { BehaviorSubject, of, Subject } from 'rxjs';
import { PlayerComponent } from './player.component';
import { PlayerService, PlayerState } from '../../core/services/player.service';
import { PlaylistService } from '../../core/services/playlist.service';
import { LikesService } from '../../core/services/likes.service';
import { BrowseService } from '../../listener/services/browse.service';
import { PremiumService } from '../../core/services/premium.service';

describe('PlayerComponent', () => {
  let component: PlayerComponent;
  let fixture: ComponentFixture<PlayerComponent>;
  let httpMock: HttpTestingController;
  let playerState$: BehaviorSubject<PlayerState>;
  let nowPlayingOpenRequest$: Subject<void>;
  let playerServiceMock: {
    state$: any;
    nowPlayingOpenRequest$: any;
    seek: any;
    setVolume: any;
    refreshQueueFromServer: any;
    playQueueItem: any;
    addToQueue: any;
    removeFromQueue: any;
    reorderQueue: any;
  };

  beforeEach(async () => {
    const initialState: PlayerState = {
      currentItem: null,
      queue: [],
      currentIndex: -1,
      isPlaying: false,
      repeatMode: 'OFF',
      isShuffle: false,
      volume: 50,
      duration: 0,
      currentTime: 0,
      bufferedPercent: 0,
      isLoading: false,
      isQueueSyncing: false,
      autoplayEnabled: true,
      autoplayMessage: null,
      songsPlayedCount: 0,
      isAdPlaying: false
    };

    playerState$ = new BehaviorSubject<PlayerState>(initialState);
    nowPlayingOpenRequest$ = new Subject<void>();

    playerServiceMock = {
      state$: playerState$.asObservable(),
      nowPlayingOpenRequest$: nowPlayingOpenRequest$.asObservable(),
      seek: jasmine.createSpy('seek'),
      setVolume: jasmine.createSpy('setVolume'),
      refreshQueueFromServer: jasmine.createSpy('refreshQueueFromServer'),
      playQueueItem: jasmine.createSpy('playQueueItem'),
      addToQueue: jasmine.createSpy('addToQueue'),
      removeFromQueue: jasmine.createSpy('removeFromQueue'),
      reorderQueue: jasmine.createSpy('reorderQueue')
    };

    await TestBed.configureTestingModule({
      imports: [PlayerComponent, HttpClientTestingModule],
      providers: [
        { provide: PlayerService, useValue: playerServiceMock },
        {
          provide: PlaylistService,
          useValue: {
            getUserPlaylists: jasmine.createSpy('getUserPlaylists').and.returnValue(of({ content: [] })),
            addSongToPlaylist: jasmine.createSpy('addSongToPlaylist').and.returnValue(of({}))
          }
        },
        {
          provide: LikesService,
          useValue: {
            getUserLikes: jasmine.createSpy('getUserLikes').and.returnValue(of([])),
            likeSong: jasmine.createSpy('likeSong').and.returnValue(of({ id: 1 })),
            unlikeByLikeId: jasmine.createSpy('unlikeByLikeId').and.returnValue(of({})),
            getSongLikeId: jasmine.createSpy('getSongLikeId').and.returnValue(of(1))
          }
        },
        {
          provide: BrowseService,
          useValue: {
            getSongById: jasmine.createSpy('getSongById').and.returnValue(of({}))
          }
        },
        {
          provide: PremiumService,
          useValue: {
            isPremiumUser: false,
            status$: of({ isPremium: false })
          }
        },
        {
          provide: Router,
          useValue: jasmine.createSpyObj('Router', ['navigate'])
        }
      ]
    })
      .overrideComponent(PlayerComponent, {
        set: { template: '' }
      })
      .compileComponents();

    fixture = TestBed.createComponent(PlayerComponent);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
    fixture.destroy();
    localStorage.clear();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should subscribe to player state during ngOnInit', () => {
    component.ngOnInit();
    playerState$.next({
      ...playerState$.value,
      songsPlayedCount: 3,
      currentItem: { id: 1, title: 'Track' }
    });

    expect(component.songsPlayedCount).toBe(3);
    expect(component.playerState.currentItem).toEqual(jasmine.objectContaining({ id: 1 }));
  });

  it('should format time correctly', () => {
    expect(component.formatTime(0)).toBe('0:00');
    expect(component.formatTime(125)).toBe('2:05');
  });

  it('should call player service on seek and volume changes', () => {
    component.onSeek({ target: { value: '45' } });
    component.onVolumeChange({ target: { value: '70' } });

    expect(playerServiceMock.seek).toHaveBeenCalledWith(45);
    expect(playerServiceMock.setVolume).toHaveBeenCalledWith(70);
  });

  it('should refresh queue when queue panel opens', () => {
    component.toggleQueuePanel();

    expect(component.queuePanelOpen).toBe(true);
    expect(playerServiceMock.refreshQueueFromServer).toHaveBeenCalled();
  });

  it('should add current song to queue through player service', () => {
    component.playerState = {
      ...component.playerState,
      currentItem: { id: 5, songId: 5, title: 'Current' }
    };

    component.addCurrentSongToQueue();

    expect(playerServiceMock.addToQueue).toHaveBeenCalledWith(jasmine.objectContaining({ id: 5 }));
    expect(component.actionMessage).toBe('Added to queue.');
  });

  it('should clean up subscriptions on destroy', () => {
    expect(() => component.ngOnDestroy()).not.toThrow();
  });

  it('should resolve current track image from available fields', () => {
    component.playerState = {
      ...component.playerState,
      currentItem: { coverArtUrl: '/cover.jpg' }
    };

    expect(component.currentTrackImage()).toBe('/cover.jpg');
  });

  it('should return default time format for invalid value', () => {
    expect(component.formatTime(NaN as any)).toBe('0:00');
  });

  it('should not add current song to queue when nothing is playing', () => {
    component.playerState = { ...component.playerState, currentItem: null };

    component.addCurrentSongToQueue();

    expect(playerServiceMock.addToQueue).not.toHaveBeenCalled();
  });

  it('should open and close now playing overlay based on current track', () => {
    component.playerState = { ...component.playerState, currentItem: null };
    component.openNowPlayingOverlay();
    expect(component.showNowPlayingOverlay).toBe(false);

    component.playerState = { ...component.playerState, currentItem: { id: 4, title: 'Song' } };
    component.openNowPlayingOverlay();
    expect(component.showNowPlayingOverlay).toBe(true);

    component.closeNowPlayingOverlay();
    expect(component.showNowPlayingOverlay).toBe(false);
  });

  it('should remove and reorder queue items through player service', () => {
    component.removeQueueItem({ queueId: 12 });
    component.moveQueueItem({ queueId: 13 }, 'UP');

    expect(playerServiceMock.removeFromQueue).toHaveBeenCalledWith(12);
    expect(playerServiceMock.reorderQueue).toHaveBeenCalledWith(13, 'UP');
  });

  it('should detect current queue item correctly', () => {
    component.playerState = {
      ...component.playerState,
      currentItem: { queueId: 22 }
    };

    expect(component.isCurrentQueueItem({ queueId: 22 })).toBe(true);
    expect(component.isCurrentQueueItem({ queueId: 23 })).toBe(false);
  });

  it('should show download error when song or user is unavailable', () => {
    component.playerState = { ...component.playerState, currentItem: null };
    (component as any).currentUserId = null;

    component.downloadCurrentSong();

    expect(component.actionError).toContain('Unable to download');
  });

  it('should show premium modal for non-premium users', () => {
    component.playerState = { ...component.playerState, currentItem: { songId: 99, title: 'Song' } };
    (component as any).currentUserId = 10;
    component.isPremiumUser = false;

    component.downloadCurrentSong();

    expect(component.showPremiumFeatureModal).toBe(true);
  });

  it('should download song for premium users and show toast', fakeAsync(() => {
    component.playerState = { ...component.playerState, currentItem: { songId: 99, title: 'My Song' } };
    (component as any).currentUserId = 10;
    component.isPremiumUser = true;
    const triggerSpy = spyOn(component as any, 'triggerSongDownload');

    component.downloadCurrentSong();
    const req = httpMock.expectOne((request) => request.url.includes('/download/song/99'));
    expect(req.request.method).toBe('GET');
    req.flush(new Blob(['x'], { type: 'audio/mpeg' }));

    expect(triggerSpy).toHaveBeenCalled();
    expect(component.showDownloadToast).toBe(true);
    tick(2201);
    expect(component.showDownloadToast).toBe(false);
  }));

  it('should handle download API failure', () => {
    component.playerState = { ...component.playerState, currentItem: { songId: 99, title: 'My Song' } };
    (component as any).currentUserId = 10;
    component.isPremiumUser = true;

    component.downloadCurrentSong();
    const req = httpMock.expectOne((request) => request.url.includes('/download/song/99'));
    req.flush(new Blob(['error'], { type: 'text/plain' }), { status: 500, statusText: 'Server Error' });

    expect(component.actionError).toContain('Unable to download');
    expect(component.isDownloading).toBe(false);
  });

  it('should handle shareCurrentSong when no playable song exists', async () => {
    component.playerState = { ...component.playerState, currentItem: null };

    await component.shareCurrentSong();

    expect(component.actionError).toBe('No playable song selected.');
  });

  it('should handle shareCurrentSongTo when no song is selected', () => {
    component.playerState = { ...component.playerState, currentItem: null };

    component.shareCurrentSongTo('WHATSAPP');

    expect(component.actionError).toBe('No playable song selected.');
  });

  it('should open add-to-playlist picker and handle load failure', () => {
    component.playerState = { ...component.playerState, currentItem: { songId: 8 } };
    const playlistService = TestBed.inject(PlaylistService) as any;
    playlistService.getUserPlaylists.and.returnValue(of({ content: [{ id: 2, name: 'Fav' }] }));

    component.openAddToPlaylistPicker();
    expect(component.showAddToPlaylistPicker).toBe(true);
    expect(component.playlistTargets.length).toBe(1);

    component.closeAddToPlaylistPicker();
    expect(component.showAddToPlaylistPicker).toBe(false);
    expect(component.targetPlaylistIdForSongAdd).toBe('');

    playlistService.getUserPlaylists.and.returnValue(of({ content: [] }));
    component.playerState = { ...component.playerState, currentItem: null };
    component.openAddToPlaylistPicker();
    expect(component.actionError).toBe('No playable song selected.');
  });

  it('should add selected current song to playlist and handle invalid selection', () => {
    const playlistService = TestBed.inject(PlaylistService) as any;
    component.playerState = { ...component.playerState, currentItem: { songId: 12 } };
    component.targetPlaylistIdForSongAdd = '';

    component.addCurrentSongToSelectedPlaylist();
    expect(component.actionError).toBe('Please select a playlist.');

    component.targetPlaylistIdForSongAdd = '5';
    component.addCurrentSongToSelectedPlaylist();
    expect(playlistService.addSongToPlaylist).toHaveBeenCalledWith(5, 12);
    expect(component.actionMessage).toBe('Song added to playlist.');
  });

  it('should toggle current song like state for like and unlike paths', () => {
    const likesService = TestBed.inject(LikesService) as any;
    component.playerState = { ...component.playerState, currentItem: { songId: 19 } };
    (component as any).currentUserId = null;

    component.toggleCurrentSongLike();
    expect(component.actionError).toBe('User session not found.');

    (component as any).currentUserId = 1;
    component.toggleCurrentSongLike();
    expect(likesService.likeSong).toHaveBeenCalledWith(19);
    expect(component.actionMessage).toBe('Added to liked songs.');

    (component as any).likedSongIds.add(19);
    (component as any).likeIdBySongId.set(19, 7);
    component.toggleCurrentSongLike();
    expect(likesService.unlikeByLikeId).toHaveBeenCalledWith(7);
  });

  it('should resolve like id dynamically when cached id is missing', () => {
    const likesService = TestBed.inject(LikesService) as any;
    component.playerState = { ...component.playerState, currentItem: { songId: 25 } };
    (component as any).currentUserId = 1;
    (component as any).likedSongIds.add(25);
    likesService.getSongLikeId.and.returnValue(of(0));

    component.toggleCurrentSongLike();

    expect(likesService.getSongLikeId).toHaveBeenCalledWith(1, 25);
    expect(component.actionMessage).toBe('Removed from liked songs.');
  });

  it('should navigate to premium page from modal', () => {
    const router = TestBed.inject(Router) as any;
    component.showPremiumFeatureModal = true;

    component.goToPremiumPage();

    expect(component.showPremiumFeatureModal).toBe(false);
    expect(router.navigate).toHaveBeenCalledWith(['/premium']);
  });

  it('should resolve album and artist navigation from current track and fallback song details', () => {
    const router = TestBed.inject(Router) as any;
    const browseService = TestBed.inject(BrowseService) as any;

    component.playerState = { ...component.playerState, currentItem: { albumId: 3, artistName: 'Artist Z' } };
    component.goToAlbumFromCurrent();
    expect(router.navigate).toHaveBeenCalledWith(['/search'], { queryParams: { type: 'ALBUM', albumId: 3 } });

    component.goToArtistFromCurrent();
    expect(router.navigate).toHaveBeenCalledWith(['/search'], { queryParams: { q: 'Artist Z', type: 'ARTIST' } });

    browseService.getSongById.and.returnValue(of({ albumId: 44, artistName: 'Fallback Artist' }));
    component.playerState = { ...component.playerState, currentItem: { songId: 5 } };
    component.goToAlbumFromCurrent();
    component.goToArtistFromCurrent();
    expect(router.navigate).toHaveBeenCalledWith(['/search'], { queryParams: { type: 'ALBUM', albumId: 44 } });
    expect(router.navigate).toHaveBeenCalledWith(['/search'], { queryParams: { q: 'Fallback Artist', type: 'ARTIST' } });
  });

  it('should expose playback-related getters and queue segment helpers', () => {
    component.playerState = {
      ...component.playerState,
      volume: 0,
      repeatMode: 'ONE',
      duration: 200,
      currentTime: 50,
      isAdPlaying: true,
      currentIndex: 0,
      queue: [{ queueId: 1 }, { queueId: 2, isAutoplay: true }, { queueId: 3 }]
    };

    expect(component.volumeIcon).toBe('bi-volume-mute-fill');
    expect(component.repeatLabel).toBe('Repeat one');
    expect(component.playbackPercent).toBe(25);
    expect(component.adCountdownSeconds).toBe(150);
    expect(component.progressStartLabel).toBe('0:00');
    expect(component.progressEndLabel).toBe('2:30');
    expect(component.upcomingQueueItems.length).toBe(2);
    expect(component.manualUpNextItems.length).toBe(1);
    expect(component.autoplayUpNextItems.length).toBe(1);
    expect(component.isAutoplayQueueItem({ queueSection: 'AUTOPLAY' })).toBe(true);
  });

  it('should initialize with premium status and now-playing request behavior', () => {
    spyOn(window, 'matchMedia').and.returnValue({ matches: true } as any);
    localStorage.setItem('revplay_user', JSON.stringify({ userId: 9 }));

    component.ngOnInit();
    nowPlayingOpenRequest$.next();
    playerState$.next({
      ...playerState$.value,
      currentItem: { id: 1, title: 'Track' },
      isAdPlaying: false
    });

    expect(component.showNowPlayingOverlay).toBe(true);
  });

  it('should sanitize file names and resolve internal user id helper', () => {
    localStorage.setItem('revplay_user', JSON.stringify({ userId: 20 }));
    expect((component as any).resolveCurrentUserId()).toBe(20);
    expect((component as any).sanitizeFileName('  Demo Song 2026! ')).toBe('demo-song-2026');

    localStorage.setItem('revplay_user', '{bad');
    expect((component as any).resolveCurrentUserId()).toBeNull();
  });
});



