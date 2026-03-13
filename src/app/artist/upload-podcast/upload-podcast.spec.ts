import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { ActivatedRoute } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';

import { UploadPodcastComponent } from './upload-podcast.component';

import { HttpClientTestingModule } from '@angular/common/http/testing';
import { AuthService } from '../../core/services/auth';
import { ArtistService } from '../../core/services/artist.service';
import { StateService } from '../../core/services/state.service';

describe('UploadPodcastComponent', () => {
  let component: UploadPodcastComponent;
  let fixture: ComponentFixture<UploadPodcastComponent>;

  beforeEach(async () => {
    const authSpy = jasmine.createSpyObj('AuthService', ['any']);
    authSpy.currentUser$ = of(null);

    const artistSpy = jasmine.createSpyObj('ArtistService', ['getPodcastCategories', 'findArtistByUsername', 'getArtistPodcasts', 'getPodcastEpisodes']);
    artistSpy.getPodcastCategories.and.returnValue(of([]));
    artistSpy.findArtistByUsername.and.returnValue(of({ content: [] }));
    artistSpy.getArtistPodcasts.and.returnValue(of({ content: [] }));
    artistSpy.getPodcastEpisodes.and.returnValue(of({ content: [] }));

    const stateSpy = jasmine.createSpyObj('StateService', ['getArtistIdForUser', 'setArtistId', 'setArtistIdForUser']);
    stateSpy.artistId = null;

    await TestBed.configureTestingModule({
      imports: [UploadPodcastComponent, RouterTestingModule, HttpClientTestingModule],
      providers: [
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: { get: () => null }, paramMap: { get: () => null }, data: {} }, queryParamMap: of({ get: () => null }), paramMap: of({ get: () => null }), queryParams: of({}), params: of({}), data: of({}) } },
        { provide: AuthService, useValue: authSpy },
        { provide: ArtistService, useValue: artistSpy },
        { provide: StateService, useValue: stateSpy }
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(UploadPodcastComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});











