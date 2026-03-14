declare const jasmine: any;
declare const spyOn: any;
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BehaviorSubject, of } from 'rxjs';
import { ManageAlbumsComponent } from './manage-albums.component';
import { ArtistService } from '../../core/services/artist.service';
import { StateService } from '../../core/services/state.service';
import { AuthService } from '../../core/services/auth';
import { PlayerService } from '../../core/services/player.service';

describe('ManageAlbumsComponent', () => {
  let component: ManageAlbumsComponent;
  let fixture: ComponentFixture<ManageAlbumsComponent>;
  let playerServiceSpy: any;

  beforeEach(async () => {
    const artistServiceSpy = jasmine.createSpyObj('ArtistService', [
      'getAlbum',
      'getArtistAlbums',
      'getArtistSongs',
      'resolveImageUrl',
      'getCachedAlbumImage',
      'getCachedSongImage'
    ]);
    artistServiceSpy.getAlbum.and.returnValue(of({}));
    artistServiceSpy.getArtistAlbums.and.returnValue(of({ content: [] }));
    artistServiceSpy.getArtistSongs.and.returnValue(of({ content: [] }));
    artistServiceSpy.resolveImageUrl.and.returnValue('');
    artistServiceSpy.getCachedAlbumImage.and.returnValue('');
    artistServiceSpy.getCachedSongImage.and.returnValue('');

    playerServiceSpy = jasmine.createSpyObj('PlayerService', ['playTrack']);

    const artistId$ = new BehaviorSubject<number | null>(null);

    await TestBed.configureTestingModule({
      imports: [ManageAlbumsComponent],
      providers: [
        { provide: ArtistService, useValue: artistServiceSpy },
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
        },
        { provide: PlayerService, useValue: playerServiceSpy }
      ]
    })
      .overrideComponent(ManageAlbumsComponent, {
        set: { template: '' }
      })
      .compileComponents();

    fixture = TestBed.createComponent(ManageAlbumsComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => {
    fixture.destroy();
    localStorage.clear();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should call bootstrap logic in ngOnInit lifecycle', () => {
    const bootstrapSpy = spyOn(component, 'bootstrapArtistContext');

    component.ngOnInit();

    expect(bootstrapSpy).toHaveBeenCalled();
  });

  it('should play selected album song via PlayerService', () => {
    const song = {
      songId: 11,
      title: 'Track A',
      artistName: 'Artist',
      fileName: 'track-a.mp3',
      durationSeconds: 180
    };

    component.playAlbumSong(song);

    expect(playerServiceSpy.playTrack).toHaveBeenCalled();
  });

  it('should ignore invalid album songs for playback', () => {
    component.playAlbumSong({ songId: 0 });

    expect(playerServiceSpy.playTrack).not.toHaveBeenCalled();
  });

  it('should return empty string for empty image source', () => {
    const result = component.resolveImage('');

    expect(result).toBe('');
  });

  it('should resolve image file name via API image path fallback', () => {
    const result = component.resolveImage('cover.png');

    expect(result).toBe('');
  });
});



