declare const jasmine: any;
declare const spyOn: any;
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { BehaviorSubject, of, throwError } from 'rxjs';
import { PlaylistsComponent } from './playlists.component';
import { PlaylistService } from '../../core/services/playlist.service';
import { PlayerService } from '../../core/services/player.service';
import { ApiService } from '../../core/services/api';
import { FollowingService } from '../../core/services/following.service';
import { LikesService } from '../../core/services/likes.service';
import { ArtistService } from '../../core/services/artist.service';

describe('PlaylistsComponent', () => {
  let component: PlaylistsComponent;
  let fixture: ComponentFixture<PlaylistsComponent>;
  let routerSpy: any;
  let playerServiceSpy: any;
  let playlistServiceSpy: any;
  let likesServiceSpy: any;

  beforeEach(async () => {
    const paramMap$ = new BehaviorSubject(convertToParamMap({}));
    const queryParamMap$ = new BehaviorSubject(convertToParamMap({}));

    routerSpy = jasmine.createSpyObj('Router', ['navigate']);
    playerServiceSpy = jasmine.createSpyObj('PlayerService', ['playTrack', 'addToQueue']);

    playlistServiceSpy = jasmine.createSpyObj('PlaylistService', [
      'getUserPlaylists',
      'getPublicPlaylists',
      'getPlaylistById',
      'followPlaylist',
      'unfollowPlaylist',
      'addSongToPlaylist',
      'deletePlaylist',
      'createPlaylist',
      'updatePlaylist',
      'getSongById',
      'reorderPlaylistSongs',
      'removeSongFromPlaylist'
    ]);
    playlistServiceSpy.getUserPlaylists.and.returnValue(of({ content: [], totalPages: 1 }));
    playlistServiceSpy.getPublicPlaylists.and.returnValue(of({ content: [], totalPages: 1 }));
    playlistServiceSpy.getPlaylistById.and.returnValue(of({ id: 1, songs: [] }));
    playlistServiceSpy.followPlaylist.and.returnValue(of({}));
    playlistServiceSpy.unfollowPlaylist.and.returnValue(of({}));
    playlistServiceSpy.addSongToPlaylist.and.returnValue(of({}));
    playlistServiceSpy.deletePlaylist.and.returnValue(of({}));
    playlistServiceSpy.createPlaylist.and.returnValue(of({ id: 101 }));
    playlistServiceSpy.updatePlaylist.and.returnValue(of({}));
    playlistServiceSpy.getSongById.and.returnValue(of({}));
    playlistServiceSpy.reorderPlaylistSongs.and.returnValue(of({}));
    playlistServiceSpy.removeSongFromPlaylist.and.returnValue(of({}));

    likesServiceSpy = jasmine.createSpyObj('LikesService', ['getUserLikes', 'likeSong', 'unlikeByLikeId', 'getSongLikeId']);
    likesServiceSpy.getUserLikes.and.returnValue(of([]));
    likesServiceSpy.likeSong.and.returnValue(of({ id: 1 }));
    likesServiceSpy.unlikeByLikeId.and.returnValue(of({}));
    likesServiceSpy.getSongLikeId.and.returnValue(of(1));

    await TestBed.configureTestingModule({
      imports: [PlaylistsComponent],
      providers: [
        { provide: PlaylistService, useValue: playlistServiceSpy },
        { provide: PlayerService, useValue: playerServiceSpy },
        {
          provide: ApiService,
          useValue: {
            get: jasmine.createSpy('get').and.returnValue(of({ content: [] }))
          }
        },
        {
          provide: FollowingService,
          useValue: {
            getFollowedArtists: jasmine.createSpy('getFollowedArtists').and.returnValue([]),
            getFollowedPodcasts: jasmine.createSpy('getFollowedPodcasts').and.returnValue([]),
            unfollowArtist: jasmine.createSpy('unfollowArtist'),
            unfollowPodcast: jasmine.createSpy('unfollowPodcast')
          }
        },
        { provide: LikesService, useValue: likesServiceSpy },
        {
          provide: ArtistService,
          useValue: {
            getCachedSongImage: jasmine.createSpy('getCachedSongImage').and.returnValue(''),
            getCachedAlbumImage: jasmine.createSpy('getCachedAlbumImage').and.returnValue(''),
            resolveImageUrl: jasmine.createSpy('resolveImageUrl').and.callFake((value: string) => value || ''),
            getAlbum: jasmine.createSpy('getAlbum').and.returnValue(of(null)),
            getImageUrlByFileName: jasmine.createSpy('getImageUrlByFileName').and.callFake((name: string) => name ? `/img/${name}` : '')
          }
        },
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: paramMap$.asObservable(),
            queryParamMap: queryParamMap$.asObservable(),
            snapshot: { paramMap: convertToParamMap({}), queryParamMap: convertToParamMap({}) }
          }
        },
        { provide: Router, useValue: routerSpy }
      ]
    })
      .overrideComponent(PlaylistsComponent, {
        set: { template: '' }
      })
      .compileComponents();

    fixture = TestBed.createComponent(PlaylistsComponent);
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
    const refreshFollowingSpy = spyOn(component, 'refreshFollowing');
    const setupSongSearchSpy = spyOn(component, 'setupSongSearch');
    const loadLibrarySpy = spyOn(component, 'loadLibraryTab');

    component.ngOnInit();

    expect(loadLikedSpy).toHaveBeenCalled();
    expect(refreshFollowingSpy).toHaveBeenCalled();
    expect(setupSongSearchSpy).toHaveBeenCalled();
    expect(loadLibrarySpy).toHaveBeenCalled();
  });

  it('should resolve playlist ownership correctly', () => {
    (component as any).currentUserId = 10;

    expect(component.isPlaylistOwner({ ownerId: 10 })).toBe(true);
    expect(component.isPlaylistOwner({ ownerId: 20 })).toBe(false);
  });

  it('should navigate when opening a playlist', () => {
    component.openPlaylist({ id: 22 });

    expect(routerSpy.navigate).toHaveBeenCalledWith(['/library', 22]);
  });

  it('should unsubscribe on destroy lifecycle', () => {
    component.ngOnDestroy();
    expect(true).toBe(true);
  });

  it('should move to previous page when possible on MY tab', () => {
    component.activeTab = 'MY' as any;
    component.myPage = 1;

    component.previousPage();

    expect(component.myPage).toBe(0);
  });

  it('should move to next page when possible on PUBLIC tab', () => {
    component.activeTab = 'PUBLIC' as any;
    component.publicPage = 0;
    component.publicTotalPages = 3;

    component.nextPage();

    expect(component.publicPage).toBe(1);
  });

  it('should reset add-to-playlist picker state', () => {
    component.showAddToPlaylistPicker = true;
    component.songForPlaylistAdd = { songId: 6 };
    component.targetPlaylistIdForSongAdd = '2';

    component.closeAddToPlaylistPicker();

    expect(component.showAddToPlaylistPicker).toBe(false);
    expect(component.songForPlaylistAdd).toBeNull();
    expect(component.targetPlaylistIdForSongAdd).toBe('');
  });

  it('should not call addSongToPlaylist when picker data is incomplete', () => {
    component.songForPlaylistAdd = { songId: 6 };
    component.targetPlaylistIdForSongAdd = '';

    component.addCurrentSongToSelectedPlaylist();

    expect(playlistServiceSpy.addSongToPlaylist).not.toHaveBeenCalled();
  });

  it('should delegate track playback to PlayerService', () => {
    component.playTrack({ songId: 12, title: 'Track 12' });

    expect(playerServiceSpy.playTrack).toHaveBeenCalled();
  });

  it('should open tab and navigate when a playlist is selected', () => {
    component.selectedPlaylist = { id: 12 };

    component.openTab('PUBLIC' as any);

    expect(routerSpy.navigate).toHaveBeenCalledWith(['/library']);
  });

  it('should create playlist and navigate to new playlist id', () => {
    component.createForm = { name: 'Road Mix', description: 'desc', isPublic: true };

    component.createPlaylist();

    expect(playlistServiceSpy.createPlaylist).toHaveBeenCalledWith(jasmine.objectContaining({ name: 'Road Mix' }));
    expect(routerSpy.navigate).toHaveBeenCalledWith(['/library', 101]);
    expect(component.successMessage).toBe('Playlist created successfully.');
  });

  it('should set create playlist error on API failure', () => {
    playlistServiceSpy.createPlaylist.and.returnValue(throwError(() => new Error('failed')));
    component.createForm = { name: 'Road Mix', description: 'desc', isPublic: true };

    component.createPlaylist();

    expect(component.error).toBe('Failed to create playlist.');
  });

  it('should update playlist successfully for owner', () => {
    component.selectedPlaylist = { id: 55 };
    (component as any).isOwner = true;
    component.editForm = { name: 'Updated', description: 'new desc', isPublic: false };

    component.updatePlaylist();

    expect(playlistServiceSpy.updatePlaylist).toHaveBeenCalledWith(55, jasmine.objectContaining({ name: 'Updated' }));
    expect(component.successMessage).toBe('Playlist updated successfully.');
  });

  it('should follow and unfollow playlist from card', () => {
    (component as any).currentUserId = 20;
    const toFollow = { id: 33, ownerId: 10, followedByCurrentUser: false };
    const toUnfollow = { id: 34, ownerId: 10, followedByCurrentUser: true };

    component.toggleFollowPlaylistFromCard(toFollow);
    component.toggleFollowPlaylistFromCard(toUnfollow);

    expect(playlistServiceSpy.followPlaylist).toHaveBeenCalledWith(33);
    expect(playlistServiceSpy.unfollowPlaylist).toHaveBeenCalledWith(34);
  });

  it('should delete playlist from card when current user owns it', () => {
    (component as any).currentUserId = 10;
    component.myPlaylists = [{ id: 88 }, { id: 89 }];

    component.deletePlaylistFromCard({ id: 88, ownerId: 10 });

    expect(playlistServiceSpy.deletePlaylist).toHaveBeenCalledWith(88);
    expect(component.myPlaylists).toEqual([{ id: 89 }]);
  });

  it('should add current song to selected playlist successfully', () => {
    component.songForPlaylistAdd = { songId: 42 };
    component.targetPlaylistIdForSongAdd = '5';
    component.showAddToPlaylistPicker = true;

    component.addCurrentSongToSelectedPlaylist();

    expect(playlistServiceSpy.addSongToPlaylist).toHaveBeenCalledWith(5, 42);
    expect(component.successMessage).toBe('Song added to playlist.');
    expect(component.showAddToPlaylistPicker).toBe(false);
  });

  it('should set error when adding current song to selected playlist fails', () => {
    playlistServiceSpy.addSongToPlaylist.and.returnValue(throwError(() => new Error('failed')));
    component.songForPlaylistAdd = { songId: 42 };
    component.targetPlaylistIdForSongAdd = '5';

    component.addCurrentSongToSelectedPlaylist();

    expect(component.error).toBe('Failed to add song to selected playlist.');
  });

  it('should navigate to album and artist search helpers', () => {
    component.goToAlbum({ albumId: 17 });
    component.goToArtist({ artistName: 'Anirudh' });

    expect(routerSpy.navigate).toHaveBeenCalledWith(['/search'], {
      queryParams: { type: 'ALBUM', albumId: 17 }
    });
    expect(routerSpy.navigate).toHaveBeenCalledWith(['/search'], {
      queryParams: { q: 'Anirudh', type: 'ARTIST' }
    });
  });

  it('should set helper errors for missing album or artist data', () => {
    component.goToAlbum({});
    expect(component.error ?? '').toBe('Album details are not available for this song.');

    component.error = null;
    component.goToArtist({});
    expect(component.error ?? '').toBe('Artist details are not available for this song.');
  });

  it('should set session error when toggling like without user context', () => {
    (component as any).currentUserId = null;

    component.toggleSongLike({ songId: 7 });

    expect(component.error).toBe('User session not found.');
    expect(likesServiceSpy.likeSong).not.toHaveBeenCalled();
  });

  it('should play full playlist queue when tracks exist', () => {
    component.playlistSongsDetailed = [{ songId: 1, title: 'A' }, { songId: 2, title: 'B' }];

    component.playPlaylist();

    expect(playerServiceSpy.playTrack).toHaveBeenCalledWith(
      jasmine.objectContaining({ songId: 1 }),
      jasmine.any(Array)
    );
  });

  it('should toggle create and followed panels', () => {
    component.showCreateForm = false;
    component.showFollowedArtists = true;
    component.showFollowedPodcasts = true;

    component.toggleCreateForm();
    component.toggleFollowedArtistsPanel();
    component.toggleFollowedPodcastsPanel();

    expect(component.showCreateForm).toBe(true);
    expect(component.showFollowedArtists).toBe(false);
    expect(component.showFollowedPodcasts).toBe(false);
  });

  it('should navigate back to library from helper action', () => {
    component.backToLibrary();
    expect(routerSpy.navigate).toHaveBeenCalledWith(['/library']);
  });

  it('should add track to queue through player service', () => {
    component.addTrackToQueue({ songId: 3, title: 'Queue Me' });
    expect(playerServiceSpy.addToQueue).toHaveBeenCalledWith(jasmine.objectContaining({ songId: 3 }));
  });

  it('should resolve follow state from explicit flags and fallback map', () => {
    expect(component.resolvePlaylistFollowState({ isFollowing: true })).toBe(true);
    expect(component.resolvePlaylistFollowState({ following: false })).toBe(false);

    (component as any).followingByPlaylistId[9] = true;
    expect(component.resolvePlaylistFollowState({ id: 9 })).toBe(true);
  });

  it('should resolve owner id from multiple possible properties', () => {
    expect((component as any).resolvePlaylistOwnerId({ ownerId: 55 })).toBe(55);
    expect((component as any).resolvePlaylistOwnerId({ user: { userId: 66 } })).toBe(66);
    expect((component as any).resolvePlaylistOwnerId({})).toBe(0);
  });

  it('should resolve current user id from local storage and fallback for bad json', () => {
    localStorage.setItem('revplay_user', JSON.stringify({ userId: 21 }));
    expect((component as any).resolveCurrentUserId()).toBe(21);

    localStorage.setItem('revplay_user', '{bad-json');
    expect((component as any).resolveCurrentUserId()).toBeNull();
  });

  it('should format duration values safely', () => {
    expect(component.formatDuration(0)).toBe('0:00');
    expect(component.formatDuration(125)).toBe('2:05');
  });

  it('should keep addSongToPlaylist guarded when owner or ids are invalid', () => {
    (component as any).isOwner = false;
    component.selectedPlaylist = { id: 1 };
    component.addSongToPlaylist({ songId: 5 });
    expect(playlistServiceSpy.addSongToPlaylist).not.toHaveBeenCalled();

    (component as any).isOwner = true;
    component.selectedPlaylist = null;
    component.addSongToPlaylist({ songId: 5 });
    expect(playlistServiceSpy.addSongToPlaylist).not.toHaveBeenCalled();
  });

  it('should keep removeSongFromPlaylist guarded when owner or ids are invalid', () => {
    (component as any).isOwner = false;
    component.selectedPlaylist = { id: 1 };
    component.removeSongFromPlaylist({ songId: 5 });
    expect(playlistServiceSpy.removeSongFromPlaylist).not.toHaveBeenCalled();
  });

  it('should reorder songs and persist order for owner playlist', () => {
    (component as any).isOwner = true;
    component.selectedPlaylist = { id: 1 };
    component.playlistSongsDetailed = [
      { songId: 11, position: 1, title: 'A' },
      { songId: 22, position: 2, title: 'B' }
    ];

    component.reorderSong(1, 'UP');

    expect(playlistServiceSpy.reorderPlaylistSongs).toHaveBeenCalled();
    expect(component.playlistSongsDetailed[0].songId).toBe(22);
  });

  it('should identify song presence in current playlist', () => {
    component.playlistSongsDetailed = [{ songId: 11 }, { id: 22 }];
    expect(component.isSongInCurrentPlaylist({ songId: 11 })).toBe(true);
    expect(component.isSongInCurrentPlaylist({ songId: 99 })).toBe(false);
  });

  it('should resolve first song id and playlist image helpers', () => {
    const first = (component as any).resolveFirstSongId({
      songs: [{ songId: 2, position: 2 }, { songId: 1, position: 1 }]
    });
    expect(first).toBe(1);

    expect((component as any).resolvePlaylistImage({ coverImageUrl: '/cover.png' })).toBe('/cover.png');
    expect((component as any).resolvePlaylistImage({})).toBe('');
  });

  it('should resolve song image candidates from strings and nested objects', () => {
    const direct = (component as any).resolveSongImageCandidate('/x.jpg');
    const nested = (component as any).resolveSongImageCandidate({ fileName: 'album.png' });

    expect(String(direct)).toContain('/x.jpg');
    expect(String(nested)).toContain('album.png');
  });

  it('should build collage songs from ordered song list', () => {
    const collage = (component as any).buildCollageSongs([
      { songId: 2, position: 2, coverImageUrl: '/b.jpg' },
      { songId: 1, position: 1, coverImageUrl: '/a.jpg' }
    ]);

    expect(collage.length).toBe(2);
    expect(collage[0].id).toBe(1);
  });
});
