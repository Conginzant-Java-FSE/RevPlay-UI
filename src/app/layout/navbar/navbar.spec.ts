declare const jasmine: any;
declare const spyOn: any;
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { BehaviorSubject, of } from 'rxjs';
import { NavbarComponent } from './navbar.component';
import { AuthService } from '../../core/services/auth';
import { PremiumService } from '../../core/services/premium.service';
import { ArtistService } from '../../core/services/artist.service';
import { ApiService } from '../../core/services/api';
import { StateService } from '../../core/services/state.service';

describe('NavbarComponent', () => {
  let component: NavbarComponent;
  let fixture: ComponentFixture<NavbarComponent>;
  let authServiceSpy: any;
  let routerSpy: any;
  let currentUser$: BehaviorSubject<any>;
  let premiumStatus$: BehaviorSubject<any>;
  let artistId$: BehaviorSubject<number | null>;
  let artistServiceSpy: any;
  let apiServiceSpy: any;

  beforeEach(async () => {
    currentUser$ = new BehaviorSubject<any>(null);
    premiumStatus$ = new BehaviorSubject<any>({ isPremium: false });
    artistId$ = new BehaviorSubject<number | null>(null);

    authServiceSpy = jasmine.createSpyObj('AuthService', ['logout', 'updateCurrentUser'], {
      currentUser$: currentUser$.asObservable()
    });
    authServiceSpy.logout.and.returnValue(of({ success: true }));

    routerSpy = jasmine.createSpyObj('Router', ['navigate']);

    artistServiceSpy = jasmine.createSpyObj('ArtistService', ['getArtistById', 'getArtistProfile', 'resolveImageUrl']);
    artistServiceSpy.getArtistById.and.returnValue(of(null));
    artistServiceSpy.getArtistProfile.and.returnValue(of({ profileImageUrl: '/artist.jpg' }));
    artistServiceSpy.resolveImageUrl.and.callFake((value: string) => value || '');

    apiServiceSpy = jasmine.createSpyObj('ApiService', ['get']);
    apiServiceSpy.get.and.returnValue(of({ profileImageUrl: '/profile.jpg' }));

    await TestBed.configureTestingModule({
      imports: [NavbarComponent],
      providers: [
        { provide: AuthService, useValue: authServiceSpy },
        { provide: Router, useValue: routerSpy },
        {
          provide: PremiumService,
          useValue: {
            status$: premiumStatus$.asObservable()
          }
        },
        { provide: ArtistService, useValue: artistServiceSpy },
        { provide: ApiService, useValue: apiServiceSpy },
        {
          provide: StateService,
          useValue: {
            artistId$: artistId$.asObservable(),
            artistId: null,
            getArtistIdForUser: jasmine.createSpy('getArtistIdForUser').and.returnValue(null)
          }
        }
      ]
    })
      .overrideComponent(NavbarComponent, {
        set: { template: '' }
      })
      .compileComponents();

    fixture = TestBed.createComponent(NavbarComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => {
    fixture.destroy();
    localStorage.clear();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should emit sidebar toggle event', () => {
    spyOn(component.toggleSidebar, 'emit');

    component.onToggleSidebar();

    expect(component.toggleSidebar.emit).toHaveBeenCalled();
  });

  it('should navigate to search when query is present', () => {
    component.searchQuery = 'lofi';

    component.submitSearch();

    expect(routerSpy.navigate).toHaveBeenCalledWith(['/search'], {
      queryParams: { q: 'lofi', type: 'ALL' }
    });
  });

  it('should call logout through AuthService', () => {
    component.logout();
    expect(authServiceSpy.logout).toHaveBeenCalled();
  });

  it('should unsubscribe on destroy lifecycle', () => {
    expect(() => component.ngOnDestroy()).not.toThrow();
  });

  it('should not navigate search when query is empty', () => {
    component.searchQuery = '   ';
    component.submitSearch();
    expect(routerSpy.navigate).not.toHaveBeenCalled();
  });

  it('should compute display name precedence', () => {
    component.user = { displayName: 'Display Name', fullName: 'Full Name', username: 'user1' };
    expect(component.displayName).toBe('Display Name');

    component.user = { displayName: '', fullName: 'Full Name', username: 'user1' };
    expect(component.displayName).toBe('Full Name');

    component.user = { username: 'user1' };
    expect(component.displayName).toBe('user1');
  });

  it('should compute profile link by role', () => {
    component.user = { role: 'ARTIST', roles: ['ARTIST'] };
    expect(component.profileLink).toBe('/creator-studio/profile');

    component.user = { role: 'LISTENER', roles: ['LISTENER'] };
    expect(component.profileLink).toBe('/profile');
  });

  it('should clear avatar on load error', () => {
    component.profileImageUrl = '/img.jpg';
    component.onAvatarLoadError();
    expect(component.profileImageUrl).toBe('');
  });

  it('should resolve protected-file helper and caching helpers', () => {
    expect((component as any).isProtectedFileUrl('/api/v1/files/images/a.png')).toBe(true);
    expect((component as any).isProtectedFileUrl('data:image/png;base64,abc')).toBe(false);

    (component as any).cacheProfileImage(10, '/public-image.jpg');
    expect((component as any).getCachedProfileImage(10)).toBe('/public-image.jpg');
  });

  it('should avoid caching protected file urls', () => {
    expect((component as any).getCachedProfileImage(10)).toBe('');
    (component as any).cacheProfileImage(10, '/files/images/private.png');
    expect((component as any).getCachedProfileImage(10)).toBe('');
  });

  it('should resolve profile image using artist service resolver', () => {
    artistServiceSpy.resolveImageUrl.and.returnValue('/resolved.jpg');
    expect((component as any).resolveProfileImage('/raw.jpg')).toBe('/resolved.jpg');
  });

  it('should refresh profile image to empty when user is missing', () => {
    component.user = null;
    (component as any).refreshProfileImage();
    expect(component.profileImageUrl).toBe('');
  });

  it('should use direct resolvable profile image and cache it', () => {
    artistServiceSpy.resolveImageUrl.and.callFake((value: string) => value || '');
    component.user = { userId: 21, profilePictureUrl: '/avatar-direct.jpg', role: 'LISTENER', roles: ['LISTENER'] };

    (component as any).refreshProfileImage();

    expect(component.profileImageUrl).toBe('/avatar-direct.jpg');
    expect((component as any).getCachedProfileImage(21)).toBe('/avatar-direct.jpg');
  });

  it('should skip direct protected file image for artist user', () => {
    component.user = { userId: 30, role: 'ARTIST', roles: ['ARTIST'], profilePictureUrl: '/files/images/private.png' };
    artistServiceSpy.resolveImageUrl.and.returnValue('/files/images/private.png');

    (component as any).refreshProfileImage();

    expect(component.profileImageUrl).toBe('');
  });

  it('should read profile image from cache when available', () => {
    localStorage.setItem('revplay_artist_profile_image_cache_v1', JSON.stringify({ '31': '/cached.jpg' }));
    component.user = { userId: 31, role: 'LISTENER', roles: ['LISTENER'] };
    artistServiceSpy.resolveImageUrl.and.returnValue('');

    (component as any).refreshProfileImage();

    expect(component.profileImageUrl).toBe('/cached.jpg');
  });

  it('should fetch listener profile image and update auth snapshot', () => {
    component.user = { userId: 41, role: 'LISTENER', roles: ['LISTENER'] };
    artistServiceSpy.resolveImageUrl.and.callFake((value: string) => value || '');
    apiServiceSpy.get.and.returnValue(of({ profilePictureUrl: '/listener-profile.jpg' }));

    (component as any).refreshProfileImage();

    expect(apiServiceSpy.get).toHaveBeenCalledWith('/profile/41');
    expect(component.profileImageUrl).toBe('/listener-profile.jpg');
    expect(authServiceSpy.updateCurrentUser).toHaveBeenCalledWith({ profilePictureUrl: '/listener-profile.jpg' });
  });

  it('should fallback to artist profile image when listener profile is empty', () => {
    const stateService = TestBed.inject(StateService) as any;
    stateService.getArtistIdForUser.and.returnValue(91);
    component.user = { userId: 51, role: 'LISTENER', roles: ['LISTENER'] };
    artistServiceSpy.resolveImageUrl.and.callFake((value: string) => value || '');
    apiServiceSpy.get.and.returnValue(of({ profilePictureUrl: '' }));
    artistServiceSpy.getArtistProfile.and.returnValue(of({ profilePictureUrl: '/artist-fallback.jpg' }));

    (component as any).refreshProfileImage();

    expect(artistServiceSpy.getArtistProfile).toHaveBeenCalledWith(91);
    expect(component.profileImageUrl).toBe('/artist-fallback.jpg');
    expect(authServiceSpy.updateCurrentUser).toHaveBeenCalledWith(jasmine.objectContaining({
      profilePictureUrl: '/artist-fallback.jpg',
      artistId: 91
    }));
  });

  it('should keep empty profile image when all lookups fail', () => {
    component.user = { userId: 61, role: 'LISTENER', roles: ['LISTENER'] };
    artistServiceSpy.resolveImageUrl.and.returnValue('');
    apiServiceSpy.get.and.returnValue(of(null));
    artistServiceSpy.getArtistProfile.and.returnValue(of(null));

    (component as any).refreshProfileImage();

    expect(component.profileImageUrl).toBe('');
  });
});



