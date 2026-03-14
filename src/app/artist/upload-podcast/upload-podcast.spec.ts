declare const jasmine: any;
declare const spyOn: any;
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { BehaviorSubject, of } from 'rxjs';
import { UploadPodcastComponent } from './upload-podcast.component';
import { ArtistService } from '../../core/services/artist.service';
import { StateService } from '../../core/services/state.service';
import { AuthService } from '../../core/services/auth';

describe('UploadPodcastComponent', () => {
  let component: UploadPodcastComponent;
  let fixture: ComponentFixture<UploadPodcastComponent>;
  let artistServiceSpy: any;

  beforeEach(async () => {
    artistServiceSpy = jasmine.createSpyObj('ArtistService', [
      'getPodcastCategories',
      'getArtistPodcasts',
      'findArtistByUsername',
      'uploadImage',
      'createPodcast',
      'getPodcastEpisodes',
      'createPodcastCategory',
      'updatePodcast',
      'deletePodcast',
      'createPodcastEpisode',
      'updatePodcastEpisode',
      'deletePodcastEpisode',
      'replacePodcastEpisodeAudio',
      'resolveUploadedImageUrl',
      'getPodcast',
      'getPodcastEpisode',
      'getPodcastStreamUrl',
      'resolveImageUrl'
    ]);

    artistServiceSpy.getPodcastCategories.and.returnValue(of([]));
    artistServiceSpy.getArtistPodcasts.and.returnValue(of({ content: [] }));
    artistServiceSpy.findArtistByUsername.and.returnValue(of({ artistId: 1 }));
    artistServiceSpy.uploadImage.and.returnValue(of({}));
    artistServiceSpy.createPodcast.and.returnValue(of({ podcastId: 1 }));
    artistServiceSpy.getPodcastEpisodes.and.returnValue(of({ content: [] }));
    artistServiceSpy.createPodcastCategory.and.returnValue(of({}));
    artistServiceSpy.updatePodcast.and.returnValue(of({}));
    artistServiceSpy.deletePodcast.and.returnValue(of({}));
    artistServiceSpy.createPodcastEpisode.and.returnValue(of({}));
    artistServiceSpy.updatePodcastEpisode.and.returnValue(of({}));
    artistServiceSpy.deletePodcastEpisode.and.returnValue(of({}));
    artistServiceSpy.replacePodcastEpisodeAudio.and.returnValue(of({}));
    artistServiceSpy.resolveUploadedImageUrl.and.returnValue('/img.jpg');
    artistServiceSpy.getPodcast.and.returnValue(of({ podcastId: 1, title: 'Podcast 1', categoryId: 1 }));
    artistServiceSpy.getPodcastEpisode.and.returnValue(of({ episodeId: 2, title: 'Episode 2' }));
    artistServiceSpy.getPodcastStreamUrl.and.callFake((fileName: string) => `/stream/${fileName}`);
    artistServiceSpy.resolveImageUrl.and.callFake((raw: string) => raw || '');

    const artistId$ = new BehaviorSubject<number | null>(null);

    await TestBed.configureTestingModule({
      imports: [UploadPodcastComponent, HttpClientTestingModule],
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
        }
      ]
    })
      .overrideComponent(UploadPodcastComponent, {
        set: { template: '' }
      })
      .compileComponents();

    fixture = TestBed.createComponent(UploadPodcastComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should run initialization lifecycle setup', () => {
    const loadCategoriesSpy = spyOn(component, 'loadCategories');
    const bootstrapSpy = spyOn(component, 'bootstrapArtistContext');

    component.ngOnInit();

    expect(loadCategoriesSpy).toHaveBeenCalled();
    expect(bootstrapSpy).toHaveBeenCalled();
  });

  it('should load categories from ArtistService', () => {
    (component as any).loadCategories();

    expect(artistServiceSpy.getPodcastCategories).toHaveBeenCalled();
  });

  it('should validate image file type on selection', () => {
    const nonImageFile = new File(['data'], 'doc.txt', { type: 'text/plain' });
    const input = document.createElement('input');
    Object.defineProperty(input, 'files', {
      value: [nonImageFile]
    });

    component.onImageSelected({ target: input } as any);

    expect(component.error).toContain('valid image file');
  });

  it('should validate podcast creation prerequisites', () => {
    component.podcastData.title = '';
    component.podcastData.categoryId = '';

    component.createPodcastWithFirstEpisode();
    expect(component.error).toContain('title and category are required');

    component.podcastData.title = 'Demo Podcast';
    component.podcastData.categoryId = '1';
    component.imageFile = null;
    component.audioFile = null;
    component.createPodcastWithFirstEpisode();
    expect(component.error).toContain('select both cover image and episode audio file');
  });

  it('should validate podcast creation without episode image requirement', () => {
    component.podcastData.title = 'Demo Podcast';
    component.podcastData.categoryId = '1';
    component.imageFile = null;

    component.createPodcastWithoutEpisode();

    expect(component.error).toBe('Podcast cover image is required.');
  });

  it('should skip podcast selection when id is invalid', () => {
    component.selectPodcast({ id: 0 });

    expect(artistServiceSpy.getPodcast).not.toHaveBeenCalled();
  });

  it('should select podcast and load episode list', () => {
    artistServiceSpy.getPodcast.and.returnValue(of({
      podcastId: 10,
      title: 'My Podcast',
      categoryId: 2,
      description: 'desc',
      visibility: 'PUBLIC',
      coverImageUrl: '/img.jpg'
    }));
    artistServiceSpy.getPodcastEpisodes.and.returnValue(of({ content: [{ episodeId: 100, title: 'E1' }] }));

    component.selectPodcast({ podcastId: 10 });

    expect(artistServiceSpy.getPodcast).toHaveBeenCalledWith(10);
    expect(component.selectedPodcast?.podcastId ?? component.selectedPodcast?.id).toBe(10);
    expect(component.episodes.length).toBe(1);
  });

  it('should validate create/update/delete episode prerequisites', () => {
    component.selectedPodcast = { podcastId: 11 };
    component.episodeCreate.title = '';
    component.newEpisodeAudioFile = null;
    component.createEpisode();
    expect(component.error).toContain('Episode title and audio file are required.');

    component.selectedEpisode = { episodeId: 22 };
    component.replaceAudioFile = null;
    component.replaceEpisodeAudio();
    expect(component.error).toContain('Select an episode and replacement audio file.');
  });

  it('should skip createCategory when category name is empty', () => {
    component.newCategory.name = '   ';

    component.createCategory();

    expect(artistServiceSpy.createPodcastCategory).not.toHaveBeenCalled();
  });

  it('should resolve episode stream url variants', () => {
    const invalid = component.getEpisodeStreamUrl({});
    expect(invalid).toBe('');

    const direct = component.getEpisodeStreamUrl({ episodeId: 5, audioUrl: 'https://cdn.demo/audio.mp3' });
    expect(direct).toBe('https://cdn.demo/audio.mp3');

    const viaFile = component.getEpisodeStreamUrl({ episodeId: 6, audioUrl: '/media/podcast/file.mp3' });
    expect(viaFile).toBe('/stream/file.mp3');
  });

  it('should delegate image resolution through artist service', () => {
    artistServiceSpy.resolveImageUrl.and.returnValue('/resolved.jpg');

    const resolved = component.resolveImage('/raw.jpg');

    expect(resolved).toBe('/resolved.jpg');
  });

  it('should evaluate preview protection helper and file-name extraction', () => {
    expect((component as any).extractFileName('/files/podcasts/ep.mp3?x=1')).toBe('ep.mp3');
    expect((component as any).requiresAuthenticatedPreviewFetch('/api/v1/files/podcasts/ep.mp3')).toBe(true);
    expect((component as any).requiresAuthenticatedPreviewFetch('https://cdn.example/ep.mp3')).toBe(false);
  });

  it('should skip update and delete operations when selected ids are invalid', () => {
    component.selectedPodcast = null;
    component.selectedEpisode = null;
    component.updatePodcast();
    component.deletePodcast();
    component.updateEpisode();
    component.deleteEpisode();

    expect(artistServiceSpy.updatePodcast).not.toHaveBeenCalled();
    expect(artistServiceSpy.deletePodcast).not.toHaveBeenCalled();
    expect(artistServiceSpy.updatePodcastEpisode).not.toHaveBeenCalled();
    expect(artistServiceSpy.deletePodcastEpisode).not.toHaveBeenCalled();
  });

  it('should create category and append it to local categories', () => {
    component.categories = [];
    component.newCategory = { name: 'Tech', description: 'Talks' };
    artistServiceSpy.createPodcastCategory.and.returnValue(of({ id: 99, name: 'Tech' }));

    component.createCategory();

    expect(artistServiceSpy.createPodcastCategory).toHaveBeenCalled();
    expect(component.categories.length).toBe(1);
    expect(component.successMessage).toContain('created successfully');
  });

  it('should set bootstrap error when artist username is unavailable', () => {
    const authService = TestBed.inject(AuthService) as any;
    authService.currentUser$ = of({ userId: 1, username: '' });

    (component as any).bootstrapArtistContext();

    expect(component.error).toBe('Artist identity not found.');
  });

  it('should prune stale episode preview sources', () => {
    (component as any).episodePreviewSources.set(10, 'blob:old');
    (component as any).episodePreviewSources.set(11, '/keep');

    (component as any).pruneEpisodePreviewSources([{ episodeId: 11 }]);

    expect((component as any).episodePreviewSources.has(10)).toBe(false);
    expect((component as any).episodePreviewSources.has(11)).toBe(true);
  });

  it('should clear preview source caches on destroy', () => {
    (component as any).episodePreviewSources.set(1, '/a');
    (component as any).episodePreviewLoading.add(1);

    component.ngOnDestroy();

    expect((component as any).episodePreviewSources.size).toBe(0);
    expect((component as any).episodePreviewLoading.size).toBe(0);
  });
});



