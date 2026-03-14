declare const jasmine: any;
declare const spyOn: any;
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { Router } from '@angular/router';
import { of, throwError } from 'rxjs';
import { BrowseComponent } from './browse.component';
import { BrowseService } from '../services/browse.service';
import { PlayerService } from '../../core/services/player.service';
import { AuthService } from '../../core/services/auth';
import { ArtistService } from '../../core/services/artist.service';
import { StateService } from '../../core/services/state.service';
import { FollowingService } from '../../core/services/following.service';
import { PlaylistService } from '../../core/services/playlist.service';
import { LikesService } from '../../core/services/likes.service';
import { PremiumService } from '../../core/services/premium.service';
import { ApiService } from '../../core/services/api';

describe('BrowseComponent', () => {
  let component: BrowseComponent;
  let fixture: ComponentFixture<BrowseComponent>;
  let playerServiceSpy: any;
  let routerSpy: any;
  let playlistServiceSpy: any;
  let likesServiceSpy: any;
  let artistServiceSpy: any;

  beforeEach(async () => {
    playerServiceSpy = jasmine.createSpyObj('PlayerService', ['addToQueue', 'playTrack']);

    routerSpy = jasmine.createSpyObj('Router', ['navigate']);

    playlistServiceSpy = jasmine.createSpyObj('PlaylistService', ['getUserPlaylists', 'addSongToPlaylist', 'removeSongFromPlaylist']);
    playlistServiceSpy.getUserPlaylists.and.returnValue(of({ content: [] }));
    playlistServiceSpy.addSongToPlaylist.and.returnValue(of({}));
    playlistServiceSpy.removeSongFromPlaylist.and.returnValue(of({}));

    likesServiceSpy = jasmine.createSpyObj('LikesService', ['getUserLikes', 'likeSong', 'unlikeByLikeId', 'getSongLikeId']);
    likesServiceSpy.getUserLikes.and.returnValue(of([]));
    likesServiceSpy.likeSong.and.returnValue(of({ id: 1 }));
    likesServiceSpy.unlikeByLikeId.and.returnValue(of({}));
    likesServiceSpy.getSongLikeId.and.returnValue(of(1));

    artistServiceSpy = jasmine.createSpyObj('ArtistService', [
      'getCachedSongImage',
      'getCachedAlbumImage',
      'resolveImageUrl',
      'getPodcastEpisodes',
      'getArtistSongs',
      'getPodcast',
      'getAlbum',
      'getArtistById'
    ]);
    artistServiceSpy.getCachedSongImage.and.returnValue('');
    artistServiceSpy.getCachedAlbumImage.and.returnValue('');
    artistServiceSpy.resolveImageUrl.and.returnValue('');
    artistServiceSpy.getPodcastEpisodes.and.returnValue(of({ content: [] }));
    artistServiceSpy.getArtistSongs.and.returnValue(of({ content: [] }));
    artistServiceSpy.getPodcast.and.returnValue(of(null));
    artistServiceSpy.getAlbum.and.returnValue(of(null));
    artistServiceSpy.getArtistById.and.returnValue(of(null));

    await TestBed.configureTestingModule({
      imports: [BrowseComponent, HttpClientTestingModule],
      providers: [
        {
          provide: BrowseService,
          useValue: {
            getTrending: jasmine.createSpy('getTrending').and.returnValue(of([])),
            getNewReleases: jasmine.createSpy('getNewReleases').and.returnValue(of({ content: [] })),
            getTopArtists: jasmine.createSpy('getTopArtists').and.returnValue(of({ content: [] })),
            getBrowseSongs: jasmine.createSpy('getBrowseSongs').and.returnValue(of({ content: [] })),
            getPopularPodcasts: jasmine.createSpy('getPopularPodcasts').and.returnValue(of({ content: [] })),
            getRecommendedPodcasts: jasmine.createSpy('getRecommendedPodcasts').and.returnValue(of({ content: [] })),
            getSystemPlaylists: jasmine.createSpy('getSystemPlaylists').and.returnValue(of([])),
            getRecommendationsForYou: jasmine.createSpy('getRecommendationsForYou').and.returnValue(of({ youMightLike: [] })),
            getDiscoverWeekly: jasmine.createSpy('getDiscoverWeekly').and.returnValue(of({ items: [] })),
            getDiscoveryFeed: jasmine.createSpy('getDiscoveryFeed').and.returnValue(of({ discoverWeekly: [] })),
            getSongById: jasmine.createSpy('getSongById').and.returnValue(of({}))
          }
        },
        { provide: PlayerService, useValue: playerServiceSpy },
        {
          provide: AuthService,
          useValue: {
            getCurrentUserSnapshot: jasmine.createSpy('getCurrentUserSnapshot').and.returnValue({
              userId: 1,
              role: 'LISTENER',
              roles: ['LISTENER']
            })
          }
        },
        { provide: ArtistService, useValue: artistServiceSpy },
        {
          provide: StateService,
          useValue: {
            artistId: null,
            getArtistIdForUser: jasmine.createSpy('getArtistIdForUser').and.returnValue(null)
          }
        },
        {
          provide: FollowingService,
          useValue: {
            isArtistFollowed: jasmine.createSpy('isArtistFollowed').and.returnValue(false),
            toggleArtist: jasmine.createSpy('toggleArtist').and.returnValue(true),
            isPodcastFollowed: jasmine.createSpy('isPodcastFollowed').and.returnValue(false),
            togglePodcast: jasmine.createSpy('togglePodcast').and.returnValue(true)
          }
        },
        { provide: PlaylistService, useValue: playlistServiceSpy },
        { provide: LikesService, useValue: likesServiceSpy },
        { provide: PremiumService, useValue: { isPremiumUser: false } },
        {
          provide: ApiService,
          useValue: {
            get: jasmine.createSpy('get').and.returnValue(of({ content: [] }))
          }
        },
        { provide: Router, useValue: routerSpy }
      ]
    })
      .overrideComponent(BrowseComponent, {
        set: { template: '' }
      })
      .compileComponents();

    fixture = TestBed.createComponent(BrowseComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => {
    fixture.destroy();
    localStorage.clear();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should execute ngOnInit lifecycle setup', () => {
    const loadLikedSpy = spyOn(component, 'loadLikedSongs');
    const loadDataSpy = spyOn(component, 'loadData');

    component.ngOnInit();

    expect(loadLikedSpy).toHaveBeenCalled();
    expect(loadDataSpy).toHaveBeenCalled();
  });

  it('should add song to queue and set action message', () => {
    component.addSongToQueue({ id: 4, title: 'Queue Song' });

    expect(playerServiceSpy.addToQueue).toHaveBeenCalledWith(jasmine.objectContaining({ id: 4 }));
    expect(component.actionMessage).toBe('Added to queue.');
  });

  it('should clear browse data state', () => {
    component.trendingNow = [{ id: 1 }];
    component.error = 'x';

    (component as any).clearBrowseData();

    expect(component.trendingNow).toEqual([]);
    expect(component.error).toBe('x');
  });

  it('should not play when track does not have playable reference', () => {
    playerServiceSpy.playTrack.calls.reset();

    component.playTrack({});

    expect(playerServiceSpy.playTrack).not.toHaveBeenCalled();
  });

  it('should reset playlist picker state', () => {
    component.showAddToPlaylistPicker = true;
    component.songForPlaylistAdd = { songId: 8 };
    component.targetPlaylistIdForSongAdd = '2';

    component.closeAddToPlaylistPicker();

    expect(component.showAddToPlaylistPicker).toBe(false);
    expect(component.songForPlaylistAdd).toBeNull();
    expect(component.targetPlaylistIdForSongAdd).toBe('');
  });

  it('should not add song to playlist without required selection', () => {
    const playlistService = TestBed.inject(PlaylistService) as any;
    component.songForPlaylistAdd = { songId: 8 };
    component.targetPlaylistIdForSongAdd = '';

    component.addCurrentSongToSelectedPlaylist();

    expect(playlistService.addSongToPlaylist).not.toHaveBeenCalled();
  });

  it('should ignore add-to-playlist open for invalid song id', () => {
    component.openAddToPlaylistPicker({});

    expect(component.showAddToPlaylistPicker).toBe(false);
  });

  it('should apply fallback cover on image load failure', () => {
    const image = document.createElement('img');
    image.src = 'http://localhost/current-cover.png';

    component.onCoverLoadError({ target: image } as any);

    expect(image.src).not.toContain('current-cover.png');
  });

  it('should not navigate to mix playlist when slug is missing', () => {
    component.openMixPlaylist({ name: 'No Slug Mix' });

    expect(routerSpy.navigate).not.toHaveBeenCalled();
  });

  it('should navigate to mix playlist when slug exists', () => {
    component.openMixPlaylist({ slug: 'focus-mix' });

    expect(routerSpy.navigate).toHaveBeenCalledWith(['/mix', 'focus-mix']);
  });

  it('should open add-to-playlist picker and load playlist targets', () => {
    playlistServiceSpy.getUserPlaylists.and.returnValue(of({
      content: [{ id: 12, name: 'Workout' }]
    }));

    component.openAddToPlaylistPicker({ songId: 10 });

    expect(component.showAddToPlaylistPicker).toBe(true);
    expect(playlistServiceSpy.getUserPlaylists).toHaveBeenCalledWith(0, 100);
    expect(component.playlistTargets.length).toBe(1);
    expect(component.playlistTargets[0].id).toBe(12);
  });

  it('should set error when playlist targets fail to load', () => {
    playlistServiceSpy.getUserPlaylists.and.returnValue(throwError(() => new Error('failed')));

    component.openAddToPlaylistPicker({ songId: 10 });

    expect(component.error).toBe('Unable to load your playlists right now.');
    expect(component.playlistTargets).toEqual([]);
  });

  it('should add current song to selected playlist successfully', () => {
    component.songForPlaylistAdd = { songId: 22 };
    component.targetPlaylistIdForSongAdd = '8';
    component.showAddToPlaylistPicker = true;

    component.addCurrentSongToSelectedPlaylist();

    expect(playlistServiceSpy.addSongToPlaylist).toHaveBeenCalledWith(8, 22);
    expect(component.actionMessage).toBe('Song added to playlist.');
    expect(component.showAddToPlaylistPicker).toBe(false);
  });

  it('should set error when add current song to playlist fails', () => {
    playlistServiceSpy.addSongToPlaylist.and.returnValue(throwError(() => new Error('failed')));
    component.songForPlaylistAdd = { songId: 22 };
    component.targetPlaylistIdForSongAdd = '8';

    component.addCurrentSongToSelectedPlaylist();

    expect(component.error).toBe('Failed to add song to selected playlist.');
  });

  it('should navigate to album search when album id exists', () => {
    component.goToAlbum({ albumId: 17 });

    expect(routerSpy.navigate).toHaveBeenCalledWith(['/search'], {
      queryParams: { type: 'ALBUM', albumId: 17 }
    });
  });

  it('should set error when album id is missing for goToAlbum', () => {
    component.goToAlbum({});

    expect(component.error).toBe('Album details are not available for this song.');
  });

  it('should navigate to artist search when artist name exists', () => {
    component.goToArtist({ artistName: 'Shreya' });

    expect(routerSpy.navigate).toHaveBeenCalledWith(['/search'], {
      queryParams: { q: 'Shreya', type: 'ARTIST' }
    });
  });

  it('should set error when artist name is missing for goToArtist', () => {
    component.goToArtist({});

    expect(component.error).toBe('Artist details are not available for this song.');
  });

  it('should set session error when toggling like without user', () => {
    (component as any).userId = null;

    component.toggleSongLike({ songId: 11 });

    expect(component.error).toBe('User session not found.');
    expect(likesServiceSpy.likeSong).not.toHaveBeenCalled();
  });

  it('should like song when user session is available', () => {
    (component as any).userId = 3;

    component.toggleSongLike({ songId: 11 });

    expect(likesServiceSpy.likeSong).toHaveBeenCalledWith(11);
    expect(component.actionMessage).toBe('Added to liked songs.');
  });

  it('should play podcast queue when episodes are playable', () => {
    artistServiceSpy.getPodcastEpisodes.and.returnValue(of({
      content: [{ episodeId: 1, title: 'Ep', fileUrl: '/x.mp3' }]
    }));

    component.playPodcast({ id: 5, title: 'Podcast' });

    expect(playerServiceSpy.playTrack).toHaveBeenCalled();
  });

  it('should return mix gradient style string', () => {
    const gradient = component.getMixGradient({ slug: 'mix-a' }, 0);
    expect(String(gradient)).toContain('gradient');
  });

  it('should resolve user id from auth snapshot and local storage fallback', () => {
    const authService = TestBed.inject(AuthService) as any;
    expect((component as any).resolveUserId()).toBe(1);

    authService.getCurrentUserSnapshot.and.returnValue(null);
    localStorage.setItem('revplay_user', JSON.stringify({ userId: 77 }));
    expect((component as any).resolveUserId()).toBe(77);
  });

  it('should clear notice for generic access issue statuses', () => {
    component.notice = null;
    (component as any).noteAccessIssue({ status: 401 }, 'recommendations');
    expect(component.notice ?? '').toContain('Sign in again');

    (component as any).noteAccessIssue({ status: 403 }, 'trending');
    expect(component.notice ?? '').toContain('Some sections are unavailable');
  });

  it('should resolve image handling branches for data and protected paths', () => {
    (component as any).hasListenerBackendAccess = false;
    expect((component as any).resolveImage('data:image/png;base64,abc')).toContain('data:image/png;base64,abc');
    expect((component as any).resolveImage('/files/images/cover.png')).toBe('');

    (component as any).hasListenerBackendAccess = true;
    const apiRelative = (component as any).resolveImage('/api/v1/files/images/cover.png');
    expect(String(apiRelative)).toContain('/api/v1/files/images/cover.png');
  });

  it('should extract content arrays from different response envelopes', () => {
    expect((component as any).extractContentArray([{ id: 1 }]).length).toBe(1);
    expect((component as any).extractContentArray({ content: [{ id: 2 }] }).length).toBe(1);
    expect((component as any).extractContentArray({ data: { content: [{ id: 3 }] } }).length).toBe(1);
    expect((component as any).extractContentArray({ items: [{ id: 4 }] }).length).toBe(1);
    expect((component as any).extractContentArray(null)).toEqual([]);
  });

  it('should resolve play counts from supported keys and default to zero for unknown shapes', () => {
    expect((component as any).resolvePlayCount({ playCount: 5 })).toBe(5);
    expect((component as any).resolvePlayCount({ totalPlays: 6 })).toBe(6);
    expect((component as any).resolvePlayCount({ streams: 7 })).toBe(7);
    expect((component as any).resolvePlayCount({ metrics: { totalPlays: 8 } })).toBe(0);
    expect((component as any).resolvePlayCount({})).toBe(0);
  });

  it('should map media helper methods for audio and image utilities', () => {
    expect((component as any).extractAudioFileName({ fileUrl: '/files/songs/demo.mp3?x=1' })).toBe('demo.mp3');
    expect((component as any).buildSongStreamUrl(9)).toContain('/songs/9/stream');
    expect((component as any).buildSongFileUrl('demo song.mp3')).toContain('/files/songs/');
    expect((component as any).isLikelyImageFile('cover.webp')).toBe(true);
    expect((component as any).isLikelyImageFile('audio.mp3')).toBe(false);
    expect((component as any).sanitizeFileName('  Demo Song 2026 ')).toBe('demo-song-2026');
  });

  it('should merge and dedupe song cards by song id', () => {
    const merged = (component as any).mergeSongCards(
      [{ songId: 1, title: 'A' }],
      [{ id: 1, title: 'A2' }, { songId: 2, title: 'B' }]
    );

    expect(merged.length).toBe(2);
  });

  it('should merge podcast cards and attach follow state', () => {
    const merged = (component as any).mergePodcastCards(
      [{ id: 1, title: 'P1' }],
      [{ podcastId: 1, title: 'P1 duplicate' }, { id: 2, title: 'P2' }]
    );

    expect(merged.length).toBe(2);
    expect(merged[0].isFollowed).toBe(false);
  });

  it('should increment and persist podcast play counts per user', () => {
    (component as any).userId = 12;
    component.popularPodcasts = [{ id: 9, playCount: 1 }];

    (component as any).incrementPodcastPlayCount(9);

    expect((component as any).getPersistedPodcastPlayCount(9)).toBe(1);
    expect(component.popularPodcasts[0].playCount).toBe(2);
  });

  it('should evaluate smoke-test names', () => {
    expect((component as any).isSmokeTestName('smoke account')).toBe(true);
    expect((component as any).isSmokeTestName('real user')).toBe(false);
  });

  it('should resolve song artist fallback safely', () => {
    expect((component as any).resolveSongArtistName({ artistName: 'Known Artist' }, 'X')).toBe('Known Artist');
    expect((component as any).resolveSongArtistName({}, 'Fallback Artist')).toBe('Fallback Artist');
  });

  it('should build podcast player track with fallback fields', () => {
    const track = (component as any).buildPodcastPlayerTrack(
      { episodeId: 21, title: 'Ep', fileUrl: '/a.mp3' },
      { id: 5, title: 'Podcast Name', coverUrl: '/img.png' }
    );

    expect(track.episodeId).toBe(21);
    expect(track.podcastId).toBe(5);
    expect(track.type).toBe('PODCAST');
  });

  it('should resolve playable reference helpers', () => {
    expect((component as any).hasPlayableSongReference({ fileUrl: '/a.mp3' })).toBe(true);
    expect((component as any).hasPlayableSongReference({})).toBe(false);
    expect((component as any).hasPlayablePodcastReference({ streamUrl: '/b.mp3' })).toBe(true);
    expect((component as any).hasPlayablePodcastReference({})).toBe(false);
  });

  it('should mark and unmark playlist mappings for song ids', () => {
    expect(component.isSongInPlaylist({ songId: 90 })).toBe(false);

    (component as any).markSongInPlaylist(90, 5);
    expect(component.isSongInPlaylist({ songId: 90 })).toBe(true);

    (component as any).unmarkSongInPlaylist(90, 5);
    expect(component.isSongInPlaylist({ songId: 90 })).toBe(false);
  });

  it('should remove song from playlist and handle missing selection', () => {
    component.removeFromPlaylistForSong({ songId: 10 });
    expect(component.error).toBe('No playlist selected for removal.');

    (component as any).markSongInPlaylist(10, 7);
    component.removeFromPlaylistForSong({ songId: 10 });
    expect(playlistServiceSpy.removeSongFromPlaylist).toHaveBeenCalledWith(7, 10);
    expect(component.actionMessage).toBe('Song removed from playlist.');
  });

  it('should set error when remove song from playlist fails', () => {
    playlistServiceSpy.removeSongFromPlaylist.and.returnValue(throwError(() => new Error('failed')));
    (component as any).markSongInPlaylist(15, 3);

    component.removeFromPlaylistForSong({ songId: 15 });

    expect(component.error).toBe('Failed to remove song from playlist.');
  });

  it('should toggle follow state for artists and podcasts', () => {
    component.toggleArtistFollow({ id: 5, name: 'Artist Five', isFollowed: false });
    expect(component.actionMessage).toContain('following Artist Five');

    component.togglePodcastFollow({ id: 8, title: 'Podcast Eight', isFollowed: false });
    expect(component.actionMessage).toContain('following Podcast Eight');
  });

  it('should resolve current artist id from direct and mapped state', () => {
    const authService = TestBed.inject(AuthService) as any;
    const stateService = TestBed.inject(StateService) as any;

    authService.getCurrentUserSnapshot.and.returnValue({ userId: 1, artistId: 44 });
    expect((component as any).resolveCurrentArtistId()).toBe(44);

    authService.getCurrentUserSnapshot.and.returnValue({ userId: 1 });
    stateService.getArtistIdForUser.and.returnValue(55);
    expect((component as any).resolveCurrentArtistId()).toBe(55);
  });

  it('should parse stored user safely from local storage', () => {
    localStorage.setItem('revplay_user', JSON.stringify({ userId: 8 }));
    expect((component as any).getStoredUser()).toEqual(jasmine.objectContaining({ userId: 8 }));

    localStorage.setItem('revplay_user', '{bad-json');
    expect((component as any).getStoredUser()).toBeNull();
  });

  it('should normalize system playlists and build simple song fallbacks', () => {
    const playlists = (component as any).normalizeSystemPlaylists([
      { id: 1, name: 'Mix 1', slug: 'mix-1' },
      { id: 0, name: 'Invalid', slug: 'invalid' },
      { id: 2, name: '  ', slug: 'mix-2' }
    ]);
    const fallback = (component as any).buildHomeSongFallback(
      [{ songId: 1, title: 'A' }],
      [{ id: 1, title: 'A duplicate' }, { songId: 2, title: 'B' }]
    );
    const filtered = (component as any).filterOutSongById(fallback, 1);

    expect(playlists.length).toBe(1);
    expect(fallback.length).toBe(2);
    expect(filtered.length).toBe(1);
  });

  it('should resolve song artist name with fallback', () => {
    expect((component as any).resolveSongArtistName({ artistName: 'Known' })).toBe('Known');
    expect((component as any).resolveSongArtistName({ user: { username: 'user-a' } })).toBe('user-a');
    expect((component as any).resolveSongArtistName({}, 'Fallback')).toBe('Fallback');
  });

  it('should resolve play count from nested analytics and stats keys', () => {
    expect((component as any).resolvePlayCount({ analytics: { playCount: 4 } })).toBe(4);
    expect((component as any).resolvePlayCount({ stats: { streams: 6 } })).toBe(6);
    expect((component as any).resolvePlayCount({})).toBe(0);
  });

  it('should resolve artist images from nested candidate objects', () => {
    const resolved = (component as any).resolveArtistImage({
      profilePicture: { fileName: 'avatar.png' }
    });

    expect(String(resolved)).toContain('/files/images/avatar.png');
  });

  it('should combine and prefer better artist cards', () => {
    (component as any).currentArtistId = 10;
    const existing = { id: 10, name: 'My Artist', imageUrl: '', playCount: 5 };
    const candidate = { id: 11, name: 'Other Artist', imageUrl: '/img.jpg', playCount: 3 };
    const combined = (component as any).combineArtistCards(existing, candidate);

    expect(combined.id).toBe(10);
    expect(combined.name).toBe('My Artist');
    expect(combined.playCount).toBe(5);
  });

  it('should resolve current-user artist image and play count from cache', () => {
    const authService = TestBed.inject(AuthService) as any;
    authService.getCurrentUserSnapshot.and.returnValue({
      userId: 1,
      username: 'demo',
      profileImageUrl: '/demo.png'
    });
    (component as any).userId = 1;
    localStorage.setItem('revplay_artist_dashboard_cache', JSON.stringify({
      '1': { stats: { playCount: 77 } }
    }));

    expect((component as any).resolveCurrentUserArtistImage('demo')).toContain('/demo.png');
    expect((component as any).resolveCurrentUserArtistPlayCount('demo')).toBe(77);
  });

  it('should resolve current artist id from fallback state artistId', () => {
    const authService = TestBed.inject(AuthService) as any;
    const stateService = TestBed.inject(StateService) as any;
    authService.getCurrentUserSnapshot.and.returnValue({ userId: 1 });
    stateService.getArtistIdForUser.and.returnValue(null);
    stateService.artistId = 123;

    expect((component as any).resolveCurrentArtistId()).toBe(123);
  });

  it('should return empty creator fallback catalog for non-artist users', () => {
    const authService = TestBed.inject(AuthService) as any;
    authService.getCurrentUserSnapshot.and.returnValue({ userId: 1, role: 'LISTENER', roles: ['LISTENER'] });
    let payload: any;

    (component as any).loadCreatorFallbackCatalog().subscribe((response: any) => {
      payload = response;
    });

    expect(payload).toEqual(jasmine.objectContaining({
      songs: [],
      albums: [],
      podcasts: [],
      artists: []
    }));
  });

  it('should convert raw creator catalog safely', () => {
    const normalized = (component as any).toCreatorCatalog({
      songs: [{ id: 1 }],
      albums: null,
      podcasts: [{ id: 3 }],
      artists: 'x'
    });

    expect(normalized.songs.length).toBe(1);
    expect(normalized.albums).toEqual([]);
    expect(normalized.podcasts.length).toBe(1);
    expect(normalized.artists).toEqual([]);
  });

  it('should resolve trusted cached audio URLs only for allowed forms', () => {
    expect((component as any).resolveTrustedCachedAudioUrl('https://cdn.example.com/a.mp3')).toContain('https://');
    expect((component as any).resolveTrustedCachedAudioUrl('/api/v1/files/songs/a.mp3')).toContain('/api/v1/files/songs');
    expect((component as any).resolveTrustedCachedAudioUrl('relative.mp3')).toBe('');
  });

  it('should derive artists from recent uploads uniquely', () => {
    const artists = (component as any).deriveArtistsFromRecentUploads([
      { artistName: 'A' },
      { artistName: 'A' },
      { artistName: 'B' }
    ]);

    expect(artists.length).toBe(2);
    expect(artists[0]).toEqual(jasmine.objectContaining({
      id: jasmine.any(Number),
      name: jasmine.any(String),
      playCount: jasmine.any(Number)
    }));
  });

  it('should create deterministic synthetic artist ids', () => {
    const idA1 = (component as any).syntheticArtistId('Artist A');
    const idA2 = (component as any).syntheticArtistId('Artist A');
    const idB = (component as any).syntheticArtistId('Artist B');

    expect(idA1).toBe(idA2);
    expect(idA1).not.toBe(idB);
  });

  it('should build discovery feed from response and fallback groups', () => {
    const fromResponse = (component as any).buildDiscoveryFeedList({
      discoverWeekly: [{ songId: 1 }],
      newReleases: [{ songId: 2 }]
    }, [{ songId: 3 }]);

    const fromFallback = (component as any).buildDiscoveryFeedList(
      { discoverWeekly: [], newReleases: [] },
      [{ songId: 4 }],
      [{ songId: 4 }, { songId: 5 }]
    );

    expect(fromResponse.length).toBe(2);
    expect(fromFallback.length).toBe(2);
  });

  it('should map song cards and filter inactive/smoke entries', () => {
    const cards = (component as any).mapSongCards([
      { songId: 1, title: 'Good Song', isActive: true, fileName: 'a.mp3' },
      { songId: 2, title: 'smoke-test', isActive: true },
      { songId: 3, title: 'Inactive Song', isActive: false }
    ]);

    expect(cards.length).toBe(1);
    expect(cards[0].songId).toBe(1);
  });

  it('should map artist cards with follow state and play count', () => {
    const cards = (component as any).mapArtistCards([
      { artistId: 6, displayName: 'Artist Six', playCount: 11 }
    ]);

    expect(cards.length).toBe(1);
    expect(cards[0]).toEqual(jasmine.objectContaining({
      id: 6,
      name: 'Artist Six',
      playCount: 11,
      isFollowed: false
    }));
  });

  it('should resolve image candidates from nested object fields', () => {
    (component as any).hasListenerBackendAccess = true;
    const resolved = (component as any).resolveImageCandidate({
      fileName: 'nested.jpg'
    });

    expect(String(resolved)).toContain('/files/images/nested.jpg');
  });

  it('should resolve merged podcast play count using persisted cache', () => {
    (component as any).userId = 10;
    localStorage.setItem('revplay_podcast_play_count_cache_v1', JSON.stringify({
      '10': { '88': 3 }
    }));

    const count = (component as any).resolveMergedPodcastPlayCount({ id: 88, playCount: 1 });
    expect(count).toBe(3);
  });

  it('should return empty podcast play-count cache on invalid json', () => {
    localStorage.setItem('revplay_podcast_play_count_cache_v1', '{bad-json');
    expect((component as any).getPodcastPlayCountCache()).toEqual({});
  });

  it('should evaluate listener backend role access helper', () => {
    expect((component as any).canUseListenerBackend({ role: 'LISTENER', roles: ['LISTENER'] })).toBe(true);
    expect((component as any).canUseListenerBackend({ role: 'ARTIST', roles: ['ARTIST'] })).toBe(true);
    expect((component as any).canUseListenerBackend({ role: 'GUEST', roles: ['GUEST'] })).toBe(false);
  });

  it('should resolve user id from malformed localStorage as null', () => {
    const authService = TestBed.inject(AuthService) as any;
    authService.getCurrentUserSnapshot.and.returnValue(null);
    localStorage.setItem('revplay_user', '{bad-json');

    expect((component as any).resolveUserId()).toBeNull();
  });

  it('should return empty cached uploads when user id is missing', () => {
    (component as any).userId = null;
    localStorage.setItem('revplay_artist_recent_uploads_cache', JSON.stringify({
      '1': [{ songId: 1 }]
    }));

    expect((component as any).getCachedRecentUploadsForCurrentUser()).toEqual([]);
  });

  it('should parse cached uploads for current user and keep valid song ids only', () => {
    (component as any).userId = 1;
    localStorage.setItem('revplay_artist_recent_uploads_cache', JSON.stringify({
      '1': [
        { songId: 4, title: 'A', artistName: 'Artist A', fileUrl: '/files/songs/a.mp3' },
        { songId: 0, title: 'Invalid' }
      ]
    }));

    const uploads = (component as any).getCachedRecentUploadsForCurrentUser();

    expect(uploads.length).toBe(1);
    expect(uploads[0].songId).toBe(4);
  });

  it('should fallback creator catalog to cached uploads when backend access is blocked', () => {
    const authService = TestBed.inject(AuthService) as any;
    authService.getCurrentUserSnapshot.and.returnValue({ userId: 1, role: 'ARTIST', roles: ['ARTIST'] });
    (component as any).userId = 1;
    (component as any).currentArtistId = 0;
    (component as any).hasListenerBackendAccess = false;
    localStorage.setItem('revplay_artist_recent_uploads_cache', JSON.stringify({
      '1': [{ songId: 4, title: 'A', artistName: 'Artist A', fileUrl: '/files/songs/a.mp3' }]
    }));
    let catalog: any;

    (component as any).loadCreatorFallbackCatalog().subscribe((response: any) => {
      catalog = response;
    });

    expect(Array.isArray(catalog?.songs)).toBeTrue();
    expect(catalog.songs.length).toBe(1);
  });

  it('should extract nested data arrays from extractContentArray fallback branch', () => {
    const data = (component as any).extractContentArray({
      data: {
        topSongs: [{ id: 1 }],
        topArtists: [{ id: 2 }]
      }
    });

    expect(data.length).toBe(1);
    expect(data[0]).toEqual(jasmine.objectContaining({ id: 1 }));
  });

  it('should map podcast cards with persisted play count and follow state', () => {
    (component as any).userId = 5;
    localStorage.setItem('revplay_podcast_play_count_cache_v1', JSON.stringify({
      '5': { '2': 9 }
    }));

    const cards = (component as any).mapPodcastCards([
      { id: 2, title: 'Podcast Two', playCount: 3 },
      { id: 0, title: 'Invalid' }
    ]);

    expect(cards.length).toBe(1);
    expect(cards[0].playCount).toBe(9);
    expect(cards[0].isFollowed).toBe(false);
  });

  it('should filter song id from list using helper', () => {
    const items = [{ songId: 1 }, { songId: 2 }, { id: 3 }];
    const filtered = (component as any).filterOutSongById(items, 2);
    expect(filtered.length).toBe(2);
  });

  it('should resolve artist image as empty for unresolvable object values', () => {
    const resolved = (component as any).resolveArtistImage({ profilePicture: {} });
    expect(resolved).toBe('');
  });

  it('should treat synthetic artist id detection correctly', () => {
    const id = (component as any).syntheticArtistId('Artist A');
    expect((component as any).isSyntheticArtistId(id, 'Artist A')).toBe(true);
    expect((component as any).isSyntheticArtistId(999, 'Artist A')).toBe(false);
  });

  it('should prefer existing card when existing has target current artist id', () => {
    (component as any).currentArtistId = 33;
    const existing = { id: 33, name: 'Me', imageUrl: '', playCount: 2 };
    const candidate = { id: 99, name: 'Other', imageUrl: '/x.jpg', playCount: 10 };

    const preferred = (component as any).preferArtistCard(existing, candidate);

    expect(preferred).toBe(existing);
  });

  it('should choose candidate card when existing is synthetic and candidate is real', () => {
    const syntheticId = (component as any).syntheticArtistId('Same Name');
    const existing = { id: syntheticId, name: 'Same Name', imageUrl: '' };
    const candidate = { id: 45, name: 'Same Name', imageUrl: '/real.jpg' };

    const preferred = (component as any).preferArtistCard(existing, candidate);

    expect(preferred).toBe(candidate);
  });
});



