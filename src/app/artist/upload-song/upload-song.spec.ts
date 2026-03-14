declare const jasmine: any;
declare const spyOn: any;
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BehaviorSubject, of } from 'rxjs';
import { UploadSongComponent } from './upload-song.component';
import { ArtistService } from '../../core/services/artist.service';
import { GenreService } from '../../core/services/genre.service';
import { StateService } from '../../core/services/state.service';
import { AuthService } from '../../core/services/auth';

describe('UploadSongComponent', () => {
  let component: UploadSongComponent;
  let fixture: ComponentFixture<UploadSongComponent>;
  let genreServiceSpy: any;
  let artistServiceSpy: any;

  beforeEach(async () => {
    artistServiceSpy = jasmine.createSpyObj('ArtistService', [
      'uploadImage',
      'createAlbum',
      'uploadSong',
      'replaceSongAudio',
      'getArtistAlbums',
      'getArtistSongs',
      'findArtistByUsername',
      'resolveUploadedImageUrl',
      'resolveUploadedSongPayload',
      'addSongGenres',
      'cacheSongImage',
      'getArtistProfile'
    ]);
    artistServiceSpy.uploadImage.and.returnValue(of({}));
    artistServiceSpy.createAlbum.and.returnValue(of({ albumId: 1 }));
    artistServiceSpy.uploadSong.and.returnValue(of({}));
    artistServiceSpy.replaceSongAudio.and.returnValue(of({}));
    artistServiceSpy.getArtistAlbums.and.returnValue(of({ content: [] }));
    artistServiceSpy.getArtistSongs.and.returnValue(of({ content: [] }));
    artistServiceSpy.findArtistByUsername.and.returnValue(of({ artistId: 1 }));
    artistServiceSpy.resolveUploadedImageUrl.and.returnValue('/img.jpg');
    artistServiceSpy.resolveUploadedSongPayload.and.returnValue({ songId: 1 });
    artistServiceSpy.addSongGenres.and.returnValue(of({}));
    artistServiceSpy.cacheSongImage.and.stub();
    artistServiceSpy.getArtistProfile.and.returnValue(of({ displayName: 'Artist' }));

    genreServiceSpy = jasmine.createSpyObj('GenreService', ['getAllGenres']);
    genreServiceSpy.getAllGenres.and.returnValue(of([{ id: 1, name: 'Pop' }]));

    const artistId$ = new BehaviorSubject<number | null>(null);

    await TestBed.configureTestingModule({
      imports: [UploadSongComponent],
      providers: [
        { provide: ArtistService, useValue: artistServiceSpy },
        { provide: GenreService, useValue: genreServiceSpy },
        {
          provide: StateService,
          useValue: {
            artistId: null,
            artistId$: artistId$.asObservable(),
            getArtistIdForUser: jasmine.createSpy('getArtistIdForUser').and.returnValue(null),
            setArtistId: jasmine.createSpy('setArtistId')
          }
        },
        {
          provide: AuthService,
          useValue: {
            getCurrentUserSnapshot: jasmine.createSpy('getCurrentUserSnapshot').and.returnValue(null),
            currentUser$: of(null)
          }
        }
      ]
    })
      .overrideComponent(UploadSongComponent, {
        set: { template: '' }
      })
      .compileComponents();

    fixture = TestBed.createComponent(UploadSongComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should run lifecycle setup on ngOnInit', () => {
    const loadGenresSpy = spyOn(component, 'loadGenres');
    const bootstrapSpy = spyOn(component, 'bootstrapArtistContext');

    component.ngOnInit();

    expect(loadGenresSpy).toHaveBeenCalled();
    expect(bootstrapSpy).toHaveBeenCalled();
  });

  it('should load genres from GenreService', () => {
    (component as any).loadGenres();

    expect(genreServiceSpy.getAllGenres).toHaveBeenCalled();
    expect(component.genres.length).toBe(1);
  });

  it('should enable replacement only with valid song target and audio file', () => {
    component.replaceTargetSongId = '12';
    component.replaceAudioFile = new File(['audio'], 'track.mp3', { type: 'audio/mpeg' });

    expect(component.canReplaceAudio).toBe(true);
  });

  it('should reject unsupported cover image file types', () => {
    const invalidImage = new File(['x'], 'cover.gif', { type: 'image/gif' });

    (component as any).setCoverImageFile(invalidImage);

    expect(component.error).toContain('Only JPG, JPEG, or PNG images are supported.');
  });

  it('should reject oversized cover image files', () => {
    const bigImage = new File([new ArrayBuffer(11 * 1024 * 1024)], 'cover.png', { type: 'image/png' });

    (component as any).setCoverImageFile(bigImage);

    expect(component.error).toContain('under 10 MB');
  });

  it('should reject invalid audio files', () => {
    const invalidAudio = new File(['x'], 'doc.txt', { type: 'text/plain' });

    (component as any).setAudioFile(invalidAudio);

    expect(component.error).toContain('valid audio file');
  });

  it('should validate required upload fields before submit', () => {
    component.songForm.title = '';
    component.uploadSong();
    expect(component.error).toBe('Song title is required.');

    component.songForm.title = 'Track';
    component.uploadSong();
    expect(component.error).toBe('Cover image is required.');

    component.coverImageFile = new File(['img'], 'cover.png', { type: 'image/png' });
    component.uploadSong();
    expect(component.error).toBe('Audio file is required.');

    component.audioFile = new File(['audio'], 'song.mp3', { type: 'audio/mpeg' });
    component.uploadSong();
    expect(component.error).toContain('Artist profile is still syncing');
  });

  it('should validate replace-audio prerequisites', () => {
    component.replaceTargetSongId = '';
    component.audioFile = null;
    component.replaceAudioFile = null;

    component.replaceAudio();
    expect(component.error).toBe('Please select a song.');

    component.replaceTargetSongId = '12';
    component.replaceAudio();
    expect(component.error).toBe('Select a replacement audio file first.');
  });

  it('should parse upload error fallback messages', () => {
    expect((component as any).extractUploadErrorMessage({ error: { message: 'From backend' } }, 'fallback'))
      .toBe('From backend');
    expect((component as any).extractUploadErrorMessage({ status: 400 }, 'fallback'))
      .toContain('Invalid image file');
    expect((component as any).extractUploadErrorMessage({ status: 413 }, 'fallback'))
      .toContain('too large');
    expect((component as any).extractUploadErrorMessage({}, 'fallback')).toBe('fallback');
  });

  it('should read cached recent uploads for stored user', () => {
    localStorage.setItem('revplay_user', JSON.stringify({ userId: 7 }));
    localStorage.setItem('revplay_artist_recent_uploads_cache', JSON.stringify({
      '7': [{ songId: 3, title: 'Cached Song' }]
    }));

    const cached = (component as any).getCachedRecentUploads();

    expect(cached.length).toBe(1);
    expect(cached[0].songId).toBe(3);
  });

  it('should cache recent uploads after successful song save', () => {
    localStorage.setItem('revplay_user', JSON.stringify({ userId: 7 }));
    component.songForm.title = 'Uploaded Song';
    component.artistDisplayName = 'Demo Artist';

    (component as any).cacheRecentUpload(11, { title: 'Uploaded Song', artistName: 'Demo Artist' });

    const raw = localStorage.getItem('revplay_artist_recent_uploads_cache') ?? '{}';
    const parsed = JSON.parse(raw);
    expect(Array.isArray(parsed['7'])).toBeTrue();
    expect(parsed['7'][0].songId).toBe(11);
  });

  it('should reject invalid replacement audio input', () => {
    const invalid = new File(['x'], 'doc.txt', { type: 'text/plain' });
    const input = document.createElement('input');
    Object.defineProperty(input, 'files', { value: [invalid] });

    component.onReplaceAudioFileSelected({ target: input } as any);

    expect(component.error).toContain('valid replacement audio file');
  });

  it('should resolve user display and artist id helpers', () => {
    expect((component as any).resolveUserDisplayName({ fullName: 'Demo User' })).toBe('Demo User');
    expect((component as any).getArtistIdFromUserLike({ artist: { artistId: 22 } })).toBe(22);
    expect((component as any).getArtistIdFromUserLike({})).toBeNull();
  });

  it('should skip loading replace songs when artistId is missing', () => {
    component.artistId = null;
    component.replaceSongOptions = [{ id: 1 }];

    (component as any).loadSongsForReplace();

    expect(component.replaceSongOptions).toEqual([]);
  });

  it('should clear form after successful upload reset helper', () => {
    component.songForm = {
      title: 'A',
      artist: 'B',
      albumId: '1',
      genreId: '2',
      visibility: 'UNLISTED' as any,
      description: 'D'
    };
    component.coverImageFile = new File(['x'], 'c.png', { type: 'image/png' });
    component.audioFile = new File(['x'], 'a.mp3', { type: 'audio/mpeg' });
    component.coverImagePreview = 'blob:demo';
    component.audioFileName = 'a.mp3';

    (component as any).resetUploadFormAfterSuccess();

    expect(component.songForm.title).toBe('');
    expect(component.songForm.visibility).toBe('PUBLIC');
    expect(component.coverImageFile).toBeNull();
    expect(component.audioFile).toBeNull();
    expect(component.coverImagePreview).toBeNull();
  });

  it('should parse stored user safely from localStorage', () => {
    localStorage.setItem('revplay_user', JSON.stringify({ userId: 99, username: 'demo' }));
    expect((component as any).getStoredUser()).toEqual(jasmine.objectContaining({ userId: 99 }));

    localStorage.setItem('revplay_user', '{bad-json');
    expect((component as any).getStoredUser()).toBeNull();
  });
});



