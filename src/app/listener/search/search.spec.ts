declare const jasmine: any;
declare const spyOn: any;
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { BehaviorSubject, of, throwError } from 'rxjs';
import { SearchComponent } from './search.component';
import { ApiService } from '../../core/services/api';
import { GenreService } from '../../core/services/genre.service';
import { PlayerService } from '../../core/services/player.service';
import { PlaylistService } from '../../core/services/playlist.service';
import { LikesService } from '../../core/services/likes.service';
import { PremiumService } from '../../core/services/premium.service';
import { AuthService } from '../../core/services/auth';
import { ArtistService } from '../../core/services/artist.service';
import { StateService } from '../../core/services/state.service';
import { BrowseService } from '../services/browse.service';
import { FollowingService } from '../../core/services/following.service';

describe('SearchComponent', () => {
  let component: SearchComponent;
  let fixture: ComponentFixture<SearchComponent>;
  let playerServiceSpy: any;
  let routerSpy: any;
  let playlistServiceSpy: any;
  let likesServiceSpy: any;
  let artistServiceSpy: any;
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    const queryParams$ = new BehaviorSubject(convertToParamMap({ q: '', type: 'ALL' }));

    playerServiceSpy = jasmine.createSpyObj('PlayerService', ['addToQueue', 'playTrack']);

    routerSpy = jasmine.createSpyObj('Router', ['navigate']);

    playlistServiceSpy = jasmine.createSpyObj('PlaylistService', ['getUserPlaylists', 'addSongToPlaylist']);
    playlistServiceSpy.getUserPlaylists.and.returnValue(of({ content: [] }));
    playlistServiceSpy.addSongToPlaylist.and.returnValue(of({}));

    likesServiceSpy = jasmine.createSpyObj('LikesService', ['getUserLikes', 'likeSong', 'unlikeByLikeId', 'getSongLikeId']);
    likesServiceSpy.getUserLikes.and.returnValue(of([]));
    likesServiceSpy.likeSong.and.returnValue(of({ id: 1 }));
    likesServiceSpy.unlikeByLikeId.and.returnValue(of({}));
    likesServiceSpy.getSongLikeId.and.returnValue(of(1));

    artistServiceSpy = jasmine.createSpyObj('ArtistService', [
      'getCachedSongImage',
      'getCachedAlbumImage',
      'getArtistById',
      'resolveImageUrl'
    ]);
    artistServiceSpy.getCachedSongImage.and.returnValue('');
    artistServiceSpy.getCachedAlbumImage.and.returnValue('');
    artistServiceSpy.getArtistById.and.returnValue(of(null));
    artistServiceSpy.resolveImageUrl.and.returnValue('');

    await TestBed.configureTestingModule({
      imports: [SearchComponent, HttpClientTestingModule],
      providers: [
        {
          provide: ApiService,
          useValue: {
            get: jasmine.createSpy('get').and.returnValue(of({ content: [] }))
          }
        },
        {
          provide: GenreService,
          useValue: {
            getAllGenres: jasmine.createSpy('getAllGenres').and.returnValue(of([])),
            clearCache: jasmine.createSpy('clearCache')
          }
        },
        { provide: PlayerService, useValue: playerServiceSpy },
        { provide: PlaylistService, useValue: playlistServiceSpy },
        { provide: LikesService, useValue: likesServiceSpy },
        {
          provide: PremiumService,
          useValue: {
            isPremiumUser: false,
            status$: of({ isPremium: false })
          }
        },
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
          provide: BrowseService,
          useValue: {
            getSongById: jasmine.createSpy('getSongById').and.returnValue(of({})),
            getUserLikes: jasmine.createSpy('getUserLikes').and.returnValue(of([]))
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
        {
          provide: ActivatedRoute,
          useValue: {
            queryParamMap: queryParams$.asObservable(),
            snapshot: { queryParamMap: convertToParamMap({}) }
          }
        },
        { provide: Router, useValue: routerSpy }
      ]
    })
      .overrideComponent(SearchComponent, {
        set: { template: '' }
      })
      .compileComponents();

    fixture = TestBed.createComponent(SearchComponent);
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

  it('should execute ngOnInit lifecycle setup hooks', () => {
    const preloadSpy = spyOn(component, 'preloadCurrentArtistProfileImage');
    const initVoiceSpy = spyOn(component, 'initializeVoiceSearch');
    const loadLikedSpy = spyOn(component, 'loadLikedSongs');
    const setupStreamSpy = spyOn(component, 'setupSearchStream');
    const fetchSpy = spyOn(component, 'fetchSearchResults');

    component.ngOnInit();

    expect(preloadSpy).toHaveBeenCalled();
    expect(initVoiceSpy).toHaveBeenCalled();
    expect(loadLikedSpy).toHaveBeenCalled();
    expect(setupStreamSpy).toHaveBeenCalled();
    expect(fetchSpy).toHaveBeenCalled();
  });

  it('should return contextual empty result message', () => {
    component.searchQuery = 'jazz';
    expect(component.noResultsMessage).toBe('No results found for "jazz".');
  });

  it('should add song to queue through PlayerService', () => {
    component.addSongToQueue({ songId: 5, title: 'Song A' });

    expect(playerServiceSpy.addToQueue).toHaveBeenCalledWith(jasmine.objectContaining({ songId: 5 }));
    expect(component.actionMessage).toBe('Added to queue.');
  });

  it('should call dispose routine on ngOnDestroy', () => {
    const disposeSpy = spyOn(component, 'disposeVoiceSearch');

    component.ngOnDestroy();

    expect(disposeSpy).toHaveBeenCalled();
  });

  it('should update filter and trigger search when filter changes', () => {
    const fetchSpy = spyOn(component, 'fetchSearchResults');
    component.searchQuery = 'rock';
    component.selectedFilter = 'ALL' as any;

    component.onFilterChange('SONG' as any);

    expect(component.selectedFilter).toBe('SONG' as any);
    expect(fetchSpy).toHaveBeenCalled();
  });

  it('should not refetch when filter is unchanged', () => {
    const fetchSpy = spyOn(component, 'fetchSearchResults');
    component.selectedFilter = 'ALL' as any;

    component.onFilterChange('ALL' as any);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('should handle pagination boundaries', () => {
    const fetchSpy = spyOn(component, 'fetchSearchResults');
    component.pagination.page = 0;
    component.pagination.totalPages = 1;

    component.previousPage();
    component.nextPage();

    expect(fetchSpy).not.toHaveBeenCalled();

    component.pagination.totalPages = 3;
    component.nextPage();

    expect(component.pagination.page).toBe(1);
    expect(fetchSpy).toHaveBeenCalled();
  });

  it('should reset add-to-playlist picker state', () => {
    component.showAddToPlaylistPicker = true;
    component.songForPlaylistAdd = { songId: 10 };
    component.targetPlaylistIdForSongAdd = '5';

    component.closeAddToPlaylistPicker();

    expect(component.showAddToPlaylistPicker).toBe(false);
    expect(component.songForPlaylistAdd).toBeNull();
    expect(component.targetPlaylistIdForSongAdd).toBe('');
  });

  it('should not call addSongToPlaylist when picker is incomplete', () => {
    const playlistService = TestBed.inject(PlaylistService) as any;
    component.songForPlaylistAdd = { songId: 10 };
    component.targetPlaylistIdForSongAdd = '';

    component.addCurrentSongToSelectedPlaylist();

    expect(playlistService.addSongToPlaylist).not.toHaveBeenCalled();
  });

  it('should apply fallback image when song thumbnail fails', () => {
    const image = document.createElement('img');
    image.src = 'http://localhost/original.png';

    component.onSongThumbError({ target: image } as any);

    expect(image.src).not.toContain('original.png');
  });

  it('should clear error and push term when search input changes', () => {
    const nextSpy = spyOn((component as any).searchTerms, 'next');
    component.error = 'old error';

    component.onSearchInput('hello');

    expect(component.error).toBeNull();
    expect(nextSpy).toHaveBeenCalledWith('hello');
  });

  it('should set unsupported error when voice search is unavailable', () => {
    component.isVoiceSearchSupported = false;

    component.toggleVoiceSearch();

    expect(component.error).toBe('Voice search is not supported in this browser.');
  });

  it('should open add-to-playlist picker and load playlist targets', () => {
    playlistServiceSpy.getUserPlaylists.and.returnValue(of({
      content: [{ id: 12, name: 'Road Trip' }]
    }));

    component.openAddToPlaylistPicker({ songId: 10 });

    expect(component.showAddToPlaylistPicker).toBe(true);
    expect(playlistServiceSpy.getUserPlaylists).toHaveBeenCalledWith(0, 100);
    expect(component.playlistTargets.length).toBe(1);
    expect(component.playlistTargets[0].id).toBe(12);
  });

  it('should set error when add-to-playlist targets fail to load', () => {
    playlistServiceSpy.getUserPlaylists.and.returnValue(throwError(() => new Error('failed')));

    component.openAddToPlaylistPicker({ songId: 10 });

    expect(component.error).toBe('Unable to load your playlists right now.');
    expect(component.playlistTargets).toEqual([]);
  });

  it('should add current song to selected playlist successfully', () => {
    component.songForPlaylistAdd = { songId: 20 };
    component.targetPlaylistIdForSongAdd = '7';
    component.showAddToPlaylistPicker = true;

    component.addCurrentSongToSelectedPlaylist();

    expect(playlistServiceSpy.addSongToPlaylist).toHaveBeenCalledWith(7, 20);
    expect(component.actionMessage).toBe('Song added to playlist.');
    expect(component.showAddToPlaylistPicker).toBe(false);
  });

  it('should show error when adding current song to playlist fails', () => {
    playlistServiceSpy.addSongToPlaylist.and.returnValue(throwError(() => new Error('failed')));
    component.songForPlaylistAdd = { songId: 20 };
    component.targetPlaylistIdForSongAdd = '7';

    component.addCurrentSongToSelectedPlaylist();

    expect(component.error).toBe('Failed to add song to selected playlist.');
  });

  it('should navigate to album filter when album id is available', () => {
    component.goToAlbum({ albumId: 15 });

    expect(routerSpy.navigate).toHaveBeenCalledWith(['/search'], {
      queryParams: { type: 'ALBUM', albumId: 15 }
    });
  });

  it('should set album error when album details are unavailable', () => {
    component.goToAlbum({});

    expect(component.error).toBe('Album details are not available for this song.');
  });

  it('should navigate to artist filter when artist name exists', () => {
    component.goToArtist({ artistName: 'Arijit' });

    expect(routerSpy.navigate).toHaveBeenCalledWith(['/search'], {
      queryParams: { q: 'Arijit', type: 'ARTIST' }
    });
  });

  it('should set artist error when artist details are unavailable', () => {
    component.goToArtist({});

    expect(component.error).toBe('Artist details are not available for this song.');
  });

  it('should set user session error when liking song without user', () => {
    (component as any).currentUserId = null;

    component.toggleSongLike({ songId: 9 });

    expect(component.error).toBe('User session not found.');
    expect(likesServiceSpy.likeSong).not.toHaveBeenCalled();
  });

  it('should like song and update action message when user exists', () => {
    (component as any).currentUserId = 1;

    component.toggleSongLike({ songId: 9 });

    expect(likesServiceSpy.likeSong).toHaveBeenCalledWith(9);
    expect(component.actionMessage).toBe('Added to liked songs.');
  });

  it('should resolve simple image file names through API image endpoint', () => {
    artistServiceSpy.resolveImageUrl.and.returnValue('');

    const result = component.resolveImage('cover-art.png');

    expect(result).toContain('/files/images/cover-art.png');
  });

  it('should compute hasResults getter from grouped lists', () => {
    component.groupedResults = {
      songs: [],
      artists: [],
      albums: [],
      podcasts: [],
      playlists: []
    };
    expect(component.hasResults).toBe(false);

    component.groupedResults.songs = [{ songId: 1 }];
    expect(component.hasResults).toBe(true);
  });

  it('should provide default no-results message when query is empty', () => {
    component.searchQuery = '   ';
    expect(component.noResultsMessage).toBe('No results found.');
  });

  it('should move to previous page and trigger fetch when page is above zero', () => {
    const fetchSpy = spyOn(component, 'fetchSearchResults');
    component.pagination.page = 2;

    component.previousPage();

    expect(component.pagination.page).toBe(1);
    expect(fetchSpy).toHaveBeenCalled();
  });

  it('should not move next page when current page is last page', () => {
    const fetchSpy = spyOn(component, 'fetchSearchResults');
    component.pagination.page = 2;
    component.pagination.totalPages = 3;

    component.nextPage();

    expect(component.pagination.page).toBe(2);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('should apply artist thumbnail fallback image', () => {
    const image = document.createElement('img');
    image.src = 'http://localhost/current-artist.png';

    component.onArtistThumbError({ target: image } as any);

    expect(image.src).not.toContain('current-artist.png');
  });

  it('should ignore song thumb error when target is missing', () => {
    expect(() => component.onSongThumbError({ target: null } as any)).not.toThrow();
  });

  it('should resolve image branches for direct data and blocked placeholders', () => {
    expect(component.resolveImage('data:image/png;base64,abc')).toContain('data:image/png;base64,abc');
    expect(component.resolveImage('/files/images')).toBe('');
  });

  it('should resolve api-prefixed and absolute image urls', () => {
    artistServiceSpy.resolveImageUrl.and.returnValue('');

    const apiRelative = component.resolveImage('/api/v1/files/images/demo.png');
    const absolute = component.resolveImage('https://cdn.example.com/pic.jpg');

    expect(apiRelative).toContain('/api/v1/files/images/demo.png');
    expect(absolute).toBe('https://cdn.example.com/pic.jpg');
  });

  it('should use artist service image resolver when available', () => {
    artistServiceSpy.resolveImageUrl.and.returnValue('/resolved/from-artist-service.jpg');

    const result = component.resolveImage('profile.jpg');

    expect(result).toBe('/resolved/from-artist-service.jpg');
  });

  it('should extract content arrays from multiple API response shapes', () => {
    expect((component as any).extractContentArray([{ id: 1 }]).length).toBe(1);
    expect((component as any).extractContentArray({ content: [{ id: 2 }] }).length).toBe(1);
    expect((component as any).extractContentArray({ data: { content: [{ id: 3 }] } }).length).toBe(1);
    expect((component as any).extractContentArray({ items: [{ id: 4 }] }).length).toBe(1);
    expect((component as any).extractContentArray(null).length).toBe(0);
  });

  it('should evaluate basic helper methods for ids, playability and smoke names', () => {
    expect((component as any).getSongId({ songId: 22 })).toBe(22);
    expect((component as any).isUnplayableSong({ isActive: false })).toBe(true);
    expect((component as any).isUnplayableSong({ availabilityStatus: 'UNAVAILABLE' })).toBe(true);
    expect((component as any).isSmokeTestContent('endpoint smoke check')).toBe(true);
    expect((component as any).isSmokeTestContent('normal song')).toBe(false);
  });

  it('should sanitize file names and build stream/file urls', () => {
    expect((component as any).sanitizeFileName('  Hello World!  ')).toBe('hello-world');
    expect((component as any).sanitizeFileName('')).toBe('song');
    expect((component as any).isLikelyImageFile('cover.jpeg')).toBe(true);
    expect((component as any).isLikelyImageFile('audio.mp3')).toBe(false);
    expect((component as any).buildSongStreamUrl(5)).toContain('/songs/5/stream');
    expect((component as any).buildSongFileUrl('demo track.mp3')).toContain('/files/songs/');
  });

  it('should merge and dedupe candidate songs by song id', () => {
    const merged = (component as any).mergeSongCandidates(
      [{ songId: 1, title: 'A' }],
      [{ id: 1, title: 'A2' }, { songId: 2, title: 'B' }]
    );

    expect(merged.length).toBe(2);
    expect(Number(merged[0].songId ?? merged[0].id)).toBe(1);
    expect(Number(merged[1].songId ?? merged[1].id)).toBe(2);
  });

  it('should trust only allowed cached audio url formats', () => {
    expect((component as any).resolveTrustedCachedAudioUrl('https://cdn.example.com/a.mp3')).toContain('https://');
    expect((component as any).resolveTrustedCachedAudioUrl('/files/songs/a.mp3')).toContain('/files/songs/a.mp3');
    expect((component as any).resolveTrustedCachedAudioUrl('random-file.mp3')).toBe('');
  });

  it('should derive unique artists from recent uploads', () => {
    const artists = (component as any).deriveArtistsFromRecentUploads([
      { artistName: 'Arijit' },
      { artistName: 'Arijit' },
      { artistName: 'Shreya' }
    ]);

    expect(artists.length).toBe(2);
    expect(artists[0].type).toBe('ARTIST');
  });

  it('should parse stored user safely and resolve current user id fallback', () => {
    const authService = TestBed.inject(AuthService) as any;
    authService.getCurrentUserSnapshot.and.returnValue(null);
    localStorage.setItem('revplay_user', JSON.stringify({ userId: 33 }));

    expect((component as any).getStoredUser()).toEqual(jasmine.objectContaining({ userId: 33 }));
    expect((component as any).resolveCurrentUserId()).toBe(33);

    localStorage.setItem('revplay_user', '{bad-json');
    expect((component as any).getStoredUser()).toBeNull();
  });

  it('should no-op playSong when song has no id or playable reference', () => {
    playerServiceSpy.playTrack.calls.reset();

    component.playSong({});

    expect(playerServiceSpy.playTrack).not.toHaveBeenCalled();
  });

  it('should support unlike flow when song is already liked with cached like id', () => {
    (component as any).currentUserId = 1;
    (component as any).likedSongIds.add(22);
    (component as any).likeIdBySongId.set(22, 3);

    component.toggleSongLike({ songId: 22 });

    expect(likesServiceSpy.unlikeByLikeId).toHaveBeenCalledWith(3);
  });

  it('should fallback to getSongLikeId for unlike when cache is missing', () => {
    (component as any).currentUserId = 1;
    (component as any).likedSongIds.add(24);
    (component as any).likeIdBySongId.delete(24);
    likesServiceSpy.getSongLikeId.and.returnValue(of(0));

    component.toggleSongLike({ songId: 24 });

    expect(likesServiceSpy.getSongLikeId).toHaveBeenCalledWith(1, 24);
    expect(component.actionMessage).toBe('Removed from liked songs.');
  });

  it('should set error when getSongLikeId verification fails', () => {
    (component as any).currentUserId = 1;
    (component as any).likedSongIds.add(25);
    likesServiceSpy.getSongLikeId.and.returnValue(throwError(() => new Error('failed')));

    component.toggleSongLike({ songId: 25 });

    expect(component.error).toBe('Failed to verify liked songs state.');
  });

  it('should download song only for premium users with active session', () => {
    const premiumService = TestBed.inject(PremiumService) as any;
    premiumService.isPremiumUser = false;
    (component as any).currentUserId = 7;

    component.downloadSong({ songId: 99, title: 'Song' });
    expect(component.error).toContain('Premium users');

    premiumService.isPremiumUser = true;
    component.downloadSong({ songId: 99, title: 'Song' });
    const req = httpMock.expectOne((request) => request.url.includes('/download/song/99'));
    expect(req.request.method).toBe('GET');
    req.flush(new Blob(['x'], { type: 'audio/mpeg' }));
    expect(component.actionMessage).toBe('Download started.');
  });

  it('should set download error when song download API fails', () => {
    const premiumService = TestBed.inject(PremiumService) as any;
    premiumService.isPremiumUser = true;
    (component as any).currentUserId = 7;

    component.downloadSong({ songId: 109, title: 'Song' });
    const req = httpMock.expectOne((request) => request.url.includes('/download/song/109'));
    req.flush(new Blob(['error'], { type: 'text/plain' }), { status: 500, statusText: 'Server Error' });

    expect(component.error).toBe('Unable to download this song right now.');
  });

  it('should resolve album and artist using fallback song details', () => {
    const browseService = TestBed.inject(BrowseService) as any;
    browseService.getSongById.and.returnValue(of({ albumId: 42, artistName: 'Fallback Artist' }));

    component.goToAlbum({ songId: 9 });
    component.goToArtist({ songId: 9 });

    expect(routerSpy.navigate).toHaveBeenCalledWith(['/search'], {
      queryParams: { type: 'ALBUM', albumId: 42 }
    });
    expect(routerSpy.navigate).toHaveBeenCalledWith(['/search'], {
      queryParams: { q: 'Fallback Artist', type: 'ARTIST' }
    });
  });

  it('should detect forbidden API errors and mark search endpoint blocked', () => {
    expect((component as any).isForbiddenError({ status: 401 })).toBe(true);
    expect((component as any).isForbiddenError({ status: 403 })).toBe(true);
    expect((component as any).isForbiddenError({ status: 500 })).toBe(false);

    let payload: any;
    (component as any).handleSearchEndpointError({ status: 403 }, 0, 10).subscribe((response: any) => {
      payload = response;
    });

    expect((component as any).searchApiBlocked).toBe(true);
    expect(payload).toEqual(jasmine.objectContaining({ content: [] }));
  });

  it('should build grouped result buckets from normalized items', () => {
    const grouped = (component as any).buildGroupedResults([
      { type: 'SONG', contentId: 1, title: 'Song A' },
      { type: 'ALBUM', contentId: 2, title: 'Album B' },
      { type: 'ARTIST', contentId: 3, title: 'Artist C' },
      { type: 'PODCAST', contentId: 4, title: 'Podcast D' }
    ], [{ id: 5, name: 'Playlist E' }], 'a');

    expect(grouped.songs.length).toBe(1);
    expect(grouped.albums.length).toBe(1);
    expect(grouped.artists.length).toBe(1);
    expect(grouped.podcasts.length).toBe(1);
    expect(grouped.playlists.length).toBe(1);
  });

  it('should merge duplicate search items by type and id', () => {
    const merged = (component as any).mergeSearchItems([
      { type: 'SONG', contentId: 11, title: 'First', subtitle: 'A' },
      { type: 'SONG', contentId: 11, title: '', subtitle: 'B', imageUrl: '/img.jpg' },
      { type: 'ARTIST', contentId: 21, title: 'Artist 1' }
    ]);

    expect(merged.length).toBe(2);
    expect(merged[0].title).toBeTruthy();
  });

  it('should prefer better artist results by score', () => {
    const weak = { title: 'Artist', subtitle: '', artistId: 999999999 };
    const strong = { title: 'Arijit', subtitle: 'artist', artistId: 21, coverArtUrl: '/img.jpg' };
    const preferred = (component as any).pickPreferredArtistResult(weak, strong);

    expect(preferred.title).toBe('Arijit');
    expect((component as any).getArtistResultScore(strong)).toBeGreaterThan((component as any).getArtistResultScore(weak));
  });

  it('should evaluate artist result helper keys', () => {
    expect((component as any).isGenericArtistResultTitle('artist')).toBe(true);
    expect((component as any).isGenericArtistResultTitle('Known Artist')).toBe(false);
    expect((component as any).getArtistResultNameKey({ title: 'Known Artist' })).toBe('known artist');
    expect((component as any).getArtistResultImageKey({ coverArtUrl: '/a.jpg' })).toContain('/a.jpg');
  });

  it('should map browse songs, artists and podcasts as search items', () => {
    const songs = (component as any).mapBrowseSongsAsSearchItems([{ songId: 1, title: 'Song A' }]);
    const artists = (component as any).mapTopArtistsAsSearchItems([{ artistId: 2, displayName: 'Artist B' }]);
    const podcasts = (component as any).mapPodcastsAsSearchItems([{ podcastId: 3, title: 'Podcast C' }]);

    expect(songs[0].type).toBe('SONG');
    expect(artists[0].type).toBe('ARTIST');
    expect(podcasts[0].type).toBe('PODCAST');
  });

  it('should resolve search image candidate from nested object values', () => {
    const resolved = (component as any).resolveSearchImageCandidate({ fileName: 'artist-avatar.png' });

    expect(String(resolved)).toContain('/files/images/artist-avatar.png');
  });

  it('should resolve search artist card image from current artist match', () => {
    const authService = TestBed.inject(AuthService) as any;
    authService.getCurrentUserSnapshot.and.returnValue({ username: 'demo', profileImageUrl: '/demo.jpg' });
    (component as any).currentArtistProfileImageUrl = '/cached-artist.jpg';

    const image = (component as any).resolveSearchArtistCardImage({ title: 'demo' }, 'demo');

    expect(image).toContain('/cached-artist.jpg');
  });

  it('should merge song candidates with unique ids', () => {
    const merged = (component as any).mergeSongCandidates(
      [{ songId: 1, title: 'A' }],
      [{ id: 1, title: 'A2' }, { songId: 2, title: 'B' }]
    );

    expect(merged.length).toBe(2);
  });

  it('should build empty playlist grouped results helper', () => {
    (component as any).setEmptyPlaylistResults();

    expect(component.groupedResults.playlists).toEqual([]);
  });

  it('should evaluate listener backend access helper for roles', () => {
    expect((component as any).canUseListenerBackend({ role: 'LISTENER', roles: ['LISTENER'] })).toBe(true);
    expect((component as any).canUseListenerBackend({ role: 'ADMIN', roles: ['ADMIN'] })).toBe(true);
    expect((component as any).canUseListenerBackend({ role: 'GUEST', roles: ['GUEST'] })).toBe(false);
  });

  it('should resolve search item type/id/subtitle helpers', () => {
    const songType = (component as any).resolveSearchItemType({ type: 'song' });
    const artistType = (component as any).resolveSearchItemType({ artistId: 7 });
    const songId = (component as any).resolveSearchItemId({ songId: 9 }, 'SONG');
    const artistId = (component as any).resolveSearchItemId({ artistId: 6 }, 'ARTIST');
    const subtitle = (component as any).resolveSearchItemSubtitle({ artistName: 'X' }, 'SONG');

    expect(songType).toBe('SONG');
    expect(artistType).toBe('ARTIST');
    expect(songId).toBe(9);
    expect(artistId).toBe(6);
    expect(typeof subtitle).toBe('string');
  });

  it('should map playlists and follow states safely', () => {
    const mapped = (component as any).mapPlaylists([
      { id: 4, name: 'Road Trip', description: 'desc' }
    ]);

    expect(mapped.length).toBe(1);
    expect(mapped[0].id).toBe(4);
  });

  it('should resolve follow state helper branches', () => {
    expect((component as any).resolveFollowState('ARTIST', 5)).toBe(false);
    expect((component as any).resolveFollowState('PODCAST', 8)).toBe(false);
    expect((component as any).resolveFollowState('UNKNOWN', 1)).toBe(false);
  });

  it('should reset selected album and results state helpers', () => {
    component.selectedAlbum = { id: 1 } as any;
    component.selectedAlbumSongs = [{ id: 2 }] as any;
    component.groupedResults = {
      songs: [{ id: 1 }],
      artists: [{ id: 2 }],
      albums: [{ id: 3 }],
      podcasts: [{ id: 4 }],
      playlists: [{ id: 5 }]
    };

    (component as any).resetSelectedAlbumState();
    (component as any).resetResults();

    expect(component.selectedAlbum).toBeNull();
    expect(component.selectedAlbumSongs).toEqual([]);
    expect(component.groupedResults.songs).toEqual([]);
    expect(component.groupedResults.artists).toEqual([]);
  });

  it('should evaluate playable reference helpers', () => {
    expect((component as any).hasPlayableSongReference({ fileName: 'x.mp3' })).toBe(true);
    expect((component as any).hasPlayableSongReference({})).toBe(false);
    expect((component as any).hasPlayablePodcastReference({ streamUrl: '/x.mp3' })).toBe(true);
    expect((component as any).hasPlayablePodcastReference({})).toBe(false);
  });

  it('should resolve album id and album payload unwrap helpers', () => {
    expect((component as any).getAlbumId({ albumId: 9 })).toBe(9);
    expect((component as any).getAlbumId({ id: 0 })).toBe(0);
    expect((component as any).unwrapAlbumPayload({ data: { id: 5 } })).toEqual({ id: 5 });
    expect((component as any).unwrapAlbumPayload({ id: 6 })).toEqual({ id: 6 });
  });

  it('should extract album songs from multiple payload shapes', () => {
    expect((component as any).extractAlbumSongs({ songs: [{ id: 1 }] }).length).toBe(1);
    expect((component as any).extractAlbumSongs({ content: [{ id: 2 }] }).length).toBe(1);
    expect((component as any).extractAlbumSongs({ data: { songs: [{ id: 3 }] } }).length).toBe(1);
    expect((component as any).extractAlbumSongs({})).toEqual([]);
  });

  it('should normalize podcast card and episode defaults', () => {
    const podcast = (component as any).normalizePodcastCard({ id: 8, title: 'P1' });
    const episodes = (component as any).normalizePodcastEpisodes([{ id: 1, title: '' }]);

    expect(podcast.id).toBe(8);
    expect(episodes.length).toBe(1);
    expect(typeof episodes[0].title).toBe('string');
  });

  it('should format podcast duration helper', () => {
    expect(component.podcastEpisodeMeta({ durationSeconds: 61 })).toContain('1:01');
  });

  it('should evaluate file/image helpers and fallback song removal', () => {
    expect((component as any).extractAudioFileName({ fileUrl: '/files/songs/demo.mp3' })).toBe('demo.mp3');
    expect((component as any).buildSongStreamUrl(10)).toContain('/songs/10/stream');
    expect((component as any).buildSongFileUrl('demo.mp3')).toContain('/files/songs/');
    expect((component as any).isLikelyImageFile('x.webp')).toBe(true);
    expect((component as any).isLikelyImageFile('x.mp3')).toBe(false);
    expect((component as any).sanitizeFileName(' Demo Track ')).toBe('demo-track');
    expect((component as any).sanitizeFileName('')).toBe('song');

    component.groupedResults.songs = [{ songId: 1 }, { songId: 2 }] as any;
    (component as any).removeSongFromResults(1);
    expect(component.groupedResults.songs.length).toBe(1);
  });

  it('should resolve current user id helper from local storage fallback', () => {
    const authService = TestBed.inject(AuthService) as any;
    authService.getCurrentUserSnapshot.and.returnValue(null);
    localStorage.setItem('revplay_user', JSON.stringify({ userId: 66 }));

    expect((component as any).resolveCurrentUserId()).toBe(66);
  });
});



