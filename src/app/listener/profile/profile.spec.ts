declare const jasmine: any;
declare const spyOn: any;
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { BehaviorSubject, of, throwError } from 'rxjs';
import { ProfileComponent } from './profile.component';
import { AuthService } from '../../core/services/auth';
import { ApiService } from '../../core/services/api';
import { ListeningHistoryService } from '../../core/services/listening-history.service';
import { LikesService } from '../../core/services/likes.service';
import { BrowseService } from '../services/browse.service';
import { ArtistService } from '../../core/services/artist.service';

describe('ProfileComponent', () => {
  let component: ProfileComponent;
  let fixture: ComponentFixture<ProfileComponent>;
  let authServiceMock: {
    currentUser$: any;
    updateCurrentUser: any;
  };
  let apiServiceSpy: any;

  beforeEach(async () => {
    const currentUser$ = new BehaviorSubject<any>(null);

    authServiceMock = {
      currentUser$: currentUser$.asObservable(),
      updateCurrentUser: jasmine.createSpy('updateCurrentUser')
    };

    apiServiceSpy = jasmine.createSpyObj('ApiService', ['get', 'put', 'postMultipart']);
    apiServiceSpy.get.and.returnValue(of({}));
    apiServiceSpy.put.and.returnValue(of({ fullName: 'Updated Name', profilePictureUrl: '/img.jpg' }));
    apiServiceSpy.postMultipart.and.returnValue(of({}));

    await TestBed.configureTestingModule({
      imports: [ProfileComponent],
      providers: [
        { provide: AuthService, useValue: authServiceMock },
        { provide: ApiService, useValue: apiServiceSpy },
        {
          provide: ListeningHistoryService,
          useValue: {
            getRecentlyPlayed: jasmine.createSpy('getRecentlyPlayed').and.returnValue(of([])),
            getPlayHistory: jasmine.createSpy('getPlayHistory').and.returnValue(of([])),
            clearPlayHistory: jasmine.createSpy('clearPlayHistory').and.returnValue(of({}))
          }
        },
        {
          provide: LikesService,
          useValue: {
            getUserLikes: jasmine.createSpy('getUserLikes').and.returnValue(of([])),
            unlikeByLikeId: jasmine.createSpy('unlikeByLikeId').and.returnValue(of({})),
            likeSong: jasmine.createSpy('likeSong').and.returnValue(of({ id: 1 }))
          }
        },
        {
          provide: BrowseService,
          useValue: {
            getSongById: jasmine.createSpy('getSongById').and.returnValue(of(null))
          }
        },
        {
          provide: ArtistService,
          useValue: {
            getPodcast: jasmine.createSpy('getPodcast').and.returnValue(of(null)),
            getPodcastEpisode: jasmine.createSpy('getPodcastEpisode').and.returnValue(of(null))
          }
        },
        { provide: Router, useValue: jasmine.createSpyObj('Router', ['navigate']) }
      ]
    })
      .overrideComponent(ProfileComponent, {
        set: { template: '' }
      })
      .compileComponents();

    fixture = TestBed.createComponent(ProfileComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => {
    fixture.destroy();
    localStorage.clear();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should return profile image URL using API image endpoint for file names', () => {
    component.profile.profilePictureUrl = 'avatar.png';

    const imageUrl = component.getProfileImageUrl();

    expect(imageUrl).toContain('/files/images/avatar.png');
  });

  it('should save profile via ApiService and update auth snapshot', () => {
    component.user = { userId: 7 };
    component.profile.fullName = 'New Name';
    component.profile.profilePictureUrl = '/img.jpg';

    component.saveProfile();

    expect(apiServiceSpy.put).toHaveBeenCalledWith('/profile/7', jasmine.objectContaining({
      fullName: 'New Name',
      profilePictureUrl: '/img.jpg'
    }));
    expect(authServiceMock.updateCurrentUser).toHaveBeenCalledWith(jasmine.objectContaining({
      fullName: 'Updated Name',
      profilePictureUrl: '/img.jpg'
    }));
    expect(component.successMessage).toBe('Profile updated successfully.');
  });

  it('should call cleanup in ngOnDestroy lifecycle', () => {
    const clearPreviewSpy = spyOn(component, 'clearLocalPreview');

    component.ngOnDestroy();

    expect(clearPreviewSpy).toHaveBeenCalled();
  });

  it('should not save profile when full name is empty', () => {
    component.user = { userId: 7 };
    component.profile.fullName = '';

    component.saveProfile();

    expect(apiServiceSpy.put).not.toHaveBeenCalled();
  });

  it('should mark image load error state', () => {
    component.onProfileImageLoadError();

    expect(component.imageLoadError).toBe(true);
  });

  it('should return false for hasProfileImage when profile image is missing', () => {
    component.profile.profilePictureUrl = '';
    component.localPreviewUrl = '';
    component.imageLoadError = false;

    expect(component.hasProfileImage()).toBe(false);
  });

  it('should set error state when save profile API fails', () => {
    apiServiceSpy.put.and.returnValue(throwError(() => new Error('save failed')));
    component.user = { userId: 7 };
    component.profile.fullName = 'Updated Name';

    component.saveProfile();

    expect(apiServiceSpy.put).toHaveBeenCalled();
    expect(component.error).toBe('Failed to update profile.');
  });

  it('should prefer local preview image when available', () => {
    component.localPreviewUrl = 'blob:http://localhost/demo-image';
    component.imageLoadError = false;

    const imageUrl = component.getProfileImageUrl();

    expect(imageUrl).toContain('blob:http://localhost/demo-image');
  });
});



