declare const jasmine: any;
declare const spyOn: any;
import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { of } from 'rxjs';
import { PlayerService, PlayerState } from './player.service';
import { ApiService } from './api';
import { PremiumService } from './premium.service';
import { ArtistService } from './artist.service';
import { AdService } from './ad.service';
import { AdAnalyticsService } from './ad-analytics.service';

describe('PlayerService', () => {
  let service: PlayerService;
  let apiServiceSpy: any;
  let artistServiceSpy: any;
  let premiumServiceMock: any;

  beforeEach(() => {
    localStorage.clear();

    apiServiceSpy = jasmine.createSpyObj('ApiService', ['post', 'get', 'put', 'delete']);
    apiServiceSpy.post.and.returnValue(of({ queueId: 11 }));
    apiServiceSpy.get.and.returnValue(of([]));
    apiServiceSpy.put.and.returnValue(of([]));
    apiServiceSpy.delete.and.returnValue(of({}));

    premiumServiceMock = {
      isPremiumUser: false,
      status$: of({ isPremium: false })
    };

    artistServiceSpy = jasmine.createSpyObj('ArtistService', ['getCachedSongImage', 'getCachedAlbumImage', 'resolveImageUrl']);
    artistServiceSpy.getCachedSongImage.and.returnValue('');
    artistServiceSpy.getCachedAlbumImage.and.returnValue('');
    artistServiceSpy.resolveImageUrl.and.returnValue('');

    const adServiceSpy = jasmine.createSpyObj('AdService', ['getNextAd']);
    adServiceSpy.getNextAd.and.returnValue(of(null));

    const adAnalyticsServiceSpy = jasmine.createSpyObj('AdAnalyticsService', ['trackEvent']);

    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [
        PlayerService,
        { provide: ApiService, useValue: apiServiceSpy },
        { provide: PremiumService, useValue: premiumServiceMock },
        { provide: ArtistService, useValue: artistServiceSpy },
        { provide: AdService, useValue: adServiceSpy },
        { provide: AdAnalyticsService, useValue: adAnalyticsServiceSpy }
      ]
    });

    service = TestBed.inject(PlayerService);
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should start with default player state', () => {
    let snapshot: PlayerState | undefined;
    const sub = service.state$.subscribe((state) => {
      snapshot = state;
    });
    sub.unsubscribe();

    expect(snapshot?.isPlaying).toBe(false);
    expect(snapshot?.currentItem).toBeNull();
    expect(snapshot?.repeatMode).toBe('OFF');
  });

  it('should clamp and store volume updates', () => {
    service.setVolume(120);

    let snapshot: PlayerState | undefined;
    const sub = service.state$.subscribe((state) => {
      snapshot = state;
    });
    sub.unsubscribe();

    expect(snapshot?.volume).toBe(100);
    expect(localStorage.getItem('revplay_volume')).toBe('100');
  });

  it('should cycle repeat mode', () => {
    service.toggleRepeat();
    service.toggleRepeat();

    let snapshot: PlayerState | undefined;
    const sub = service.state$.subscribe((state) => {
      snapshot = state;
    });
    sub.unsubscribe();

    expect(snapshot?.repeatMode).toBe('ONE');
  });

  it('should call queue API when adding a track for an authenticated user', () => {
    localStorage.setItem('revplay_user', JSON.stringify({
      userId: 1,
      role: 'LISTENER',
      roles: ['LISTENER']
    }));

    apiServiceSpy.post.calls.reset();

    service.addToQueue({
      id: 7,
      title: 'Test Song',
      type: 'SONG',
      fileName: 'test.mp3'
    });

    expect(apiServiceSpy.post).toHaveBeenCalledWith('/queue', jasmine.objectContaining({ userId: 1 }));
  });

  it('should toggle mute and restore previous volume', () => {
    service.setVolume(35);
    service.toggleMute();

    let snapshot: PlayerState | undefined;
    const sub1 = service.state$.subscribe((state) => {
      snapshot = state;
    });
    sub1.unsubscribe();
    expect(snapshot?.volume).toBe(0);

    service.toggleMute();

    const sub2 = service.state$.subscribe((state) => {
      snapshot = state;
    });
    sub2.unsubscribe();
    expect(snapshot?.volume).toBe(35);
  });

  it('should add queue item locally when user is not authenticated', () => {
    localStorage.removeItem('revplay_user');
    apiServiceSpy.post.calls.reset();

    service.addToQueue({
      id: 9,
      title: 'Local Queue Song',
      type: 'SONG',
      fileName: 'local-song.mp3'
    });

    let snapshot: PlayerState | undefined;
    const sub = service.state$.subscribe((state) => {
      snapshot = state;
    });
    sub.unsubscribe();

    expect(snapshot?.queue.length).toBeGreaterThan(0);
    expect(apiServiceSpy.post).not.toHaveBeenCalled();
  });

  it('should clear queue state', () => {
    service.addToQueue({
      id: 5,
      title: 'Queued',
      type: 'SONG',
      fileName: 'queued.mp3'
    });

    service.clearQueue();

    let snapshot: PlayerState | undefined;
    const sub = service.state$.subscribe((state) => {
      snapshot = state;
    });
    sub.unsubscribe();

    expect(snapshot?.queue).toEqual([]);
    expect(snapshot?.currentIndex).toBe(-1);
  });

  it('should ignore removeFromQueue for invalid queue id', () => {
    apiServiceSpy.delete.calls.reset();

    service.removeFromQueue(0);

    expect(apiServiceSpy.delete).not.toHaveBeenCalled();
  });

  it('should toggle autoplay flag', () => {
    let before: PlayerState | undefined;
    const sub1 = service.state$.subscribe((state) => {
      before = state;
    });
    sub1.unsubscribe();

    service.toggleAutoplay();

    let after: PlayerState | undefined;
    const sub2 = service.state$.subscribe((state) => {
      after = state;
    });
    sub2.unsubscribe();

    expect(after?.autoplayEnabled).toBe(!before?.autoplayEnabled);
  });

  it('should toggle shuffle mode', () => {
    service.toggleShuffle();

    let snapshot: PlayerState | undefined;
    const sub = service.state$.subscribe((state) => {
      snapshot = state;
    });
    sub.unsubscribe();

    expect(snapshot?.isShuffle).toBe(true);
  });

  it('should resolve helpers for track type, ids and filenames', () => {
    expect((service as any).resolveTrackType({ type: 'podcast' })).toBe('PODCAST');
    expect((service as any).resolveTrackType({ episodeId: 5 })).toBe('PODCAST');
    expect((service as any).resolveTrackType({})).toBe('SONG');

    expect((service as any).getTrackId({ songId: 99 })).toBe(99);
    expect((service as any).getTrackId({ id: 0 })).toBeNull();

    expect((service as any).isLikelyAudioFile('track.mp3')).toBe(true);
    expect((service as any).isLikelyAudioFile('cover.png')).toBe(false);
    expect((service as any).isLikelyImageFile('cover.png')).toBe(true);
    expect((service as any).isLikelyImageFile('track.mp3')).toBe(false);
    expect((service as any).extractFileName('/files/songs/demo.mp3?x=1')).toBe('demo.mp3');
  });

  it('should detect inactive tracks and filter them', () => {
    const inactive = { type: 'SONG', songId: 1, isActive: false };
    const active = { type: 'SONG', songId: 2, isActive: true };

    expect((service as any).isInactiveTrack(inactive)).toBe(true);
    expect((service as any).isInactiveTrack(active)).toBe(false);
    expect((service as any).filterInactiveTracks([inactive, active]).length).toBe(1);
  });

  it('should generate local queue ids and append local queue entries', () => {
    const firstId = (service as any).generateLocalQueueId();
    const secondId = (service as any).generateLocalQueueId();
    expect(firstId).toBeLessThan(0);
    expect(secondId).toBeLessThan(firstId);

    (service as any).appendToLocalQueue({ id: 77, title: 'Local Song', type: 'SONG', fileName: 'a.mp3' });

    let snapshot: PlayerState | undefined;
    const sub = service.state$.subscribe((state) => {
      snapshot = state;
    });
    sub.unsubscribe();

    expect(snapshot?.queue.length).toBeGreaterThan(0);
    expect(Number(snapshot?.queue[0]?.queueId ?? 0)).toBeLessThan(0);
  });

  it('should resolve user and role helpers from localStorage', () => {
    localStorage.setItem('revplay_user', JSON.stringify({
      userId: 5,
      role: 'LISTENER',
      roles: ['LISTENER']
    }));

    expect((service as any).getCurrentUserId()).toBe(5);
    expect((service as any).isQueueEnabledForCurrentRole()).toBe(true);
    expect((service as any).isAutoplayEnabledForCurrentRole()).toBe(true);
  });

  it('should return null user id for malformed localStorage user', () => {
    localStorage.setItem('revplay_user', '{not-valid-json');

    expect((service as any).getCurrentUserId()).toBeNull();
    expect((service as any).isQueueEnabledForCurrentRole()).toBe(false);
  });

  it('should resolve playback storage key and known duration', () => {
    expect((service as any).resolvePlaybackStorageKey(9)).toContain(':9');
    expect((service as any).resolvePlaybackStorageKey(0)).toBe('revplay_last_song');

    expect((service as any).resolveKnownDuration({ durationSeconds: 180 })).toBe(180);
    expect((service as any).resolveKnownDuration({ duration: 18000 })).toBe(18);
  });

  it('should resolve stream URL and auth-fetch checks', () => {
    const songUrl = (service as any).getStreamUrlByFileName('x.mp3', 'SONG');
    const podcastUrl = (service as any).getStreamUrlByFileName('x.mp3', 'PODCAST');
    expect(songUrl).toContain('/files/songs/');
    expect(podcastUrl).toContain('/files/podcasts/');

    expect((service as any).requiresAuthenticatedFetch('/api/v1/files/songs/x.mp3')).toBe(true);
    expect((service as any).requiresAuthenticatedFetch('/api/v1/songs/1/stream')).toBe(true);
    expect((service as any).requiresAuthenticatedFetch('https://cdn.example.com/x.mp3')).toBe(false);
  });

  it('should merge track data preferring primary track values', () => {
    const merged = (service as any).mergeTrackData(
      { id: 10, songId: 10, title: 'Primary', fileUrl: '/a.mp3' },
      { id: 10, songId: 10, title: 'Fallback', fileUrl: '/b.mp3', imageUrl: '/img.png' }
    );

    expect(merged.title).toBe('Primary');
    expect(merged.fileUrl).toBe('/a.mp3');
    expect(String(merged.imageUrl)).toContain('/img.png');
  });

  it('should detect queue API forbidden errors by status code', () => {
    expect((service as any).isQueueApiForbidden({ status: 401 })).toBe(true);
    expect((service as any).isQueueApiForbidden({ status: 403 })).toBe(true);
    expect((service as any).isQueueApiForbidden({ status: 500 })).toBe(false);
  });

  it('should resolve direct playable references from track payload', () => {
    expect((service as any).hasDirectPlayableReference({ fileUrl: '/song.mp3' })).toBe(true);
    expect((service as any).hasDirectPlayableReference({ audioUrl: '/song.mp3' })).toBe(true);
    expect((service as any).hasDirectPlayableReference({ streamUrl: '/song.mp3' })).toBe(true);
    expect((service as any).hasDirectPlayableReference({ fileName: 'song.mp3' })).toBe(true);
    expect((service as any).hasDirectPlayableReference({})).toBe(false);
  });

  it('should return null queue user id when queue is blocked', () => {
    localStorage.setItem('revplay_user', JSON.stringify({
      userId: 5,
      role: 'LISTENER',
      roles: ['LISTENER']
    }));
    (service as any).queueApiBlocked = true;

    expect((service as any).getCurrentQueueUserId()).toBeNull();
  });

  it('should apply queue removal and clear current item when queue becomes empty', () => {
    (service as any).updateState({
      queue: [{ queueId: 10, songId: 1, title: 'A' }],
      currentItem: { queueId: 10, songId: 1, title: 'A' },
      currentIndex: 0,
      isPlaying: true
    });

    (service as any).applyQueueRemoval(10);

    let snapshot: PlayerState | undefined;
    const sub = service.state$.subscribe((state) => {
      snapshot = state;
    });
    sub.unsubscribe();

    expect(snapshot?.queue).toEqual([]);
    expect(snapshot?.currentItem).toBeNull();
    expect(snapshot?.currentIndex).toBe(-1);
    expect(snapshot?.isPlaying).toBe(false);
  });

  it('should remove non-current queue item without stopping playback', () => {
    (service as any).updateState({
      queue: [
        { queueId: 11, songId: 1, title: 'A' },
        { queueId: 12, songId: 2, title: 'B' }
      ],
      currentItem: { queueId: 11, songId: 1, title: 'A' },
      currentIndex: 0,
      isPlaying: true
    });

    (service as any).applyQueueRemoval(12);

    let snapshot: PlayerState | undefined;
    const sub = service.state$.subscribe((state) => {
      snapshot = state;
    });
    sub.unsubscribe();

    expect(snapshot?.queue.length).toBe(1);
    expect(Number(snapshot?.queue[0]?.queueId ?? 0)).toBe(11);
    expect(snapshot?.currentIndex).toBe(0);
  });

  it('should no-op reorder when queue item is missing or bounds are invalid', () => {
    (service as any).updateState({
      queue: [{ queueId: 21, songId: 1 }, { queueId: 22, songId: 2 }],
      currentItem: { queueId: 21, songId: 1 },
      currentIndex: 0
    });

    service.reorderQueue(999, 'UP');
    service.reorderQueue(21, 'UP');
    service.reorderQueue(22, 'DOWN');

    let snapshot: PlayerState | undefined;
    const sub = service.state$.subscribe((state) => {
      snapshot = state;
    });
    sub.unsubscribe();

    expect(snapshot?.queue.length).toBe(2);
    expect(Number(snapshot?.queue[0]?.queueId ?? 0)).toBe(21);
  });

  it('should return 0 buffered percent when duration is unavailable', () => {
    expect((service as any).getBufferedPercent()).toBe(0);
  });

  it('should create non-empty storage key for playback by user', () => {
    expect((service as any).resolvePlaybackStorageKey(123)).toBe('revplay_last_song:123');
    expect((service as any).resolvePlaybackStorageKey(null)).toBe('revplay_last_song');
  });

  it('should build queue add payload for song and podcast episode', () => {
    expect((service as any).buildQueueAddBody({ songId: 5 }, 10)).toEqual({ userId: 10, songId: 5 });
    expect((service as any).buildQueueAddBody({ episodeId: 8 }, 10)).toEqual({ userId: 10, episodeId: 8 });
    expect((service as any).buildQueueAddBody({}, 10)).toBeNull();
  });

  it('should normalize tracks for songs and podcast episodes', () => {
    const song = (service as any).normalizeTrack({ id: 1, songId: 1, title: 'Song', fileUrl: '/a.mp3' });
    const episode = (service as any).normalizeTrack({ id: 2, episodeId: 2, podcastId: 3, type: 'PODCAST', fileUrl: '/b.mp3' });

    expect(song.type).toBe('SONG');
    expect(song.songId).toBe(1);
    expect(episode.type).toBe('PODCAST');
    expect(episode.episodeId).toBe(2);
    expect(episode.podcastId).toBe(3);
  });

  it('should resolve track artist name with candidate fallbacks', () => {
    expect((service as any).resolveTrackArtistName({ artistName: 'Singer A' })).toBe('Singer A');
    expect((service as any).resolveTrackArtistName({ createdBy: { fullName: 'Singer B' } })).toBe('Singer B');
    expect((service as any).resolveTrackArtistName({})).toBe('Artist');
  });

  it('should validate autoplay playable-song checks', () => {
    expect((service as any).hasPlayableAutoplaySong({ songId: 11 })).toBe(true);
    expect((service as any).hasPlayableAutoplaySong({ fileUrl: '/song.mp3' })).toBe(true);
    expect((service as any).hasPlayableAutoplaySong({})).toBe(false);
  });

  it('should validate ad payload and resolve ad media URL formats', () => {
    expect((service as any).isValidAd(null)).toBe(false);
    expect((service as any).isValidAd({ mediaUrl: '' })).toBe(false);
    expect((service as any).isValidAd({ mediaUrl: '/ads/demo.mp3' })).toBe(true);

    const absolute = (service as any).resolveAdMediaUrl('https://cdn.example.com/ad.mp3');
    const apiRelative = (service as any).resolveAdMediaUrl('/api/v1/files/ads/ad.mp3');
    const rootRelative = (service as any).resolveAdMediaUrl('/files/ads/ad.mp3');
    const plain = (service as any).resolveAdMediaUrl('files/ads/ad.mp3');

    expect(absolute).toContain('https://cdn.example.com/ad.mp3');
    expect(String(apiRelative)).toContain('/api/v1/files/ads/ad.mp3');
    expect(String(rootRelative)).toContain('/files/ads/ad.mp3');
    expect(String(plain)).toContain('/files/ads/ad.mp3');
  });

  it('should increase song count only for playable song tracks', () => {
    expect((service as any).shouldIncreaseSongsPlayedCount({ type: 'PODCAST', songId: 1 })).toBe(false);
    expect((service as any).shouldIncreaseSongsPlayedCount({ type: 'AD', songId: 1 })).toBe(false);
    expect((service as any).shouldIncreaseSongsPlayedCount({ type: 'SONG', songId: 1 })).toBe(true);
    expect((service as any).shouldIncreaseSongsPlayedCount({ type: 'SONG', songId: 0 })).toBe(false);
  });

  it('should resolve track image URLs from raw values and cache fallbacks', () => {
    artistServiceSpy.getCachedSongImage.and.returnValue('/cached-song.jpg');
    artistServiceSpy.getCachedAlbumImage.and.returnValue('/cached-album.jpg');

    expect((service as any).resolveTrackImageUrl({ imageUrl: 'cover.png' })).toContain('/files/images/cover.png');
    expect((service as any).resolveTrackImageUrl({ songId: 15 })).toBe('/cached-song.jpg');
    expect((service as any).resolveTrackImageUrl({ albumId: 22 })).toBe('/cached-album.jpg');
  });

  it('should resolve playable source directly when auth fetch is not required', () => {
    let resolved = '';
    (service as any).resolvePlayableSource('https://cdn.example.com/song.mp3').subscribe((value: string) => {
      resolved = value;
    });

    expect(resolved).toBe('https://cdn.example.com/song.mp3');
  });

  it('should return null track audio fallback when no candidates exist', () => {
    let resolved: any = 'not-null';
    (service as any).resolveTrackAudioFallback({}, '/failed.mp3').subscribe((value: any) => {
      resolved = value;
    });

    expect(resolved).toBeNull();
  });

  it('should generate ad checkpoints based on random interval branch', () => {
    spyOn(Math, 'random').and.returnValue(0.2);
    expect((service as any).generateNextAdSongCheckpoint(5)).toBe(7);

    (Math.random as any).and.returnValue(0.9);
    expect((service as any).generateNextAdSongCheckpoint(5)).toBe(8);
  });

  it('should reflect premium status helper', () => {
    premiumServiceMock.isPremiumUser = false;
    expect((service as any).isPremiumUser()).toBe(false);

    premiumServiceMock.isPremiumUser = true;
    expect((service as any).isPremiumUser()).toBe(true);
  });

  it('should resolve track image URLs for api and relative paths', () => {
    expect(String((service as any).resolveTrackImageUrl({ imageUrl: '/api/v1/files/images/a.png' }))).toContain('/api/v1/files/images/a.png');
    expect(String((service as any).resolveTrackImageUrl({ imageUrl: '/files/images/a.png' }))).toContain('/files/images/a.png');
    expect(String((service as any).resolveTrackImageUrl({ imageUrl: 'cover.png' }))).toContain('/files/images/cover.png');
  });

  it('should skip audio-like paths while resolving track images', () => {
    artistServiceSpy.getCachedSongImage.and.returnValue('/cached-song.jpg');
    const resolved = (service as any).resolveTrackImageUrl({
      imageUrl: '/files/songs/song.mp3',
      songId: 1
    });

    expect(resolved).toBe('/cached-song.jpg');
  });

  it('should resolve playable source fallback as null without candidates', () => {
    let result: any = 'x';
    (service as any).resolveTrackAudioFallback({ type: 'SONG' }, '/failed.mp3').subscribe((value: any) => {
      result = value;
    });
    expect(result).toBeNull();
  });

  it('should evaluate requiresAuthenticatedFetch for multiple URL forms', () => {
    expect((service as any).requiresAuthenticatedFetch('/files/songs/a.mp3')).toBe(true);
    expect((service as any).requiresAuthenticatedFetch('/api/v1/podcasts/1/episodes/1/stream')).toBe(true);
    expect((service as any).requiresAuthenticatedFetch('/api/v1/songs/1/audio')).toBe(true);
    expect((service as any).requiresAuthenticatedFetch('https://cdn.example.com/a.mp3')).toBe(false);
    expect((service as any).requiresAuthenticatedFetch('')).toBe(false);
  });

  it('should resolve track type helper for podcast variants', () => {
    expect((service as any).resolveTrackType({ episodeId: 1 })).toBe('PODCAST');
    expect((service as any).resolveTrackType({ podcastEpisodeId: 2 })).toBe('PODCAST');
    expect((service as any).resolveTrackType({ type: 'ad' })).toBe('AD');
  });

  it('should extract autoplay track payload from common response shapes', () => {
    expect((service as any).extractAutoplayTrack({ item: { id: 1 } })).toEqual({ item: { id: 1 } });
    expect((service as any).extractAutoplayTrack({ data: { song: { id: 2 } } })).toEqual({ song: { id: 2 } });
    expect((service as any).extractAutoplayTrack({ song: { id: 3 } })).toEqual({ song: { id: 3 } });
    expect((service as any).extractAutoplayTrack({})).toEqual({});
  });

  it('should merge autoplay cycle tracks without duplicate song ids', () => {
    const first = { songId: 1, title: 'A', fileName: 'a.mp3' };
    const second = { songId: 2, title: 'B', fileName: 'b.mp3' };
    const duplicateFirst = { songId: 1, title: 'A2', fileName: 'a2.mp3' };

    const merged = (service as any).mergeAutoplayCycleTrack(first, []);
    const mergedTwice = (service as any).mergeAutoplayCycleTrack(second, merged);
    const mergedWithDuplicate = (service as any).mergeAutoplayCycleTrack(duplicateFirst, mergedTwice);

    expect(mergedWithDuplicate.length).toBe(2);
  });

  it('should return null current queue user id when no local user exists', () => {
    localStorage.removeItem('revplay_user');
    (service as any).queueApiBlocked = false;

    expect((service as any).getCurrentQueueUserId()).toBeNull();
  });

  it('should no-op applyQueueRemoval when queue id is not present', () => {
    (service as any).updateState({
      queue: [{ queueId: 11, songId: 1 }],
      currentItem: { queueId: 11, songId: 1 },
      currentIndex: 0
    });

    (service as any).applyQueueRemoval(99);

    let snapshot: any;
    service.state$.subscribe((s) => snapshot = s).unsubscribe();
    expect(snapshot.queue.length).toBe(1);
    expect(snapshot.currentIndex).toBe(0);
  });

  it('should ensure ad checkpoint minimum threshold', () => {
    spyOn(Math, 'random').and.returnValue(0.1);
    expect((service as any).generateNextAdSongCheckpoint(0)).toBeGreaterThanOrEqual(2);
  });
});



