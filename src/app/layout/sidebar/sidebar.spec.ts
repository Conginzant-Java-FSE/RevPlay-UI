import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BehaviorSubject } from 'rxjs';
import { SidebarComponent } from './sidebar.component';
import { AuthService } from '../../core/services/auth';

describe('SidebarComponent', () => {
  let component: SidebarComponent;
  let fixture: ComponentFixture<SidebarComponent>;
  let currentUserSubject: BehaviorSubject<any>;

  beforeEach(async () => {
    currentUserSubject = new BehaviorSubject<any>(null);

    await TestBed.configureTestingModule({
      imports: [SidebarComponent],
      providers: [
        {
          provide: AuthService,
          useValue: {
            currentUser$: currentUserSubject.asObservable()
          }
        }
      ]
    })
      .overrideComponent(SidebarComponent, {
        set: { template: '' }
      })
      .compileComponents();

    fixture = TestBed.createComponent(SidebarComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => {
    fixture.destroy();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should update user on ngOnInit subscription', () => {
    component.ngOnInit();
    const user = { role: 'ARTIST', roles: ['ARTIST'] };
    currentUserSubject.next(user);

    expect(component.user).toEqual(user);
  });

  it('should resolve role helpers from user state', () => {
    component.user = { role: 'LISTENER', roles: ['LISTENER'] };
    expect(component.isListener).toBe(true);
    expect(component.isArtist).toBe(false);

    component.user = { role: 'ARTIST', roles: ['ARTIST'] };
    expect(component.isArtist).toBe(true);
  });

  it('should resolve admin role and profile link', () => {
    component.user = { role: 'ADMIN', roles: ['ADMIN'] };
    expect(component.isAdmin).toBe(true);
    expect(component.profileLink).toBe('/profile');

    component.user = { role: 'ARTIST', roles: ['ARTIST'] };
    expect(component.profileLink).toBe('/creator-studio/profile');
  });

  it('should return false role flags when user is null', () => {
    component.user = null;
    expect(component.isArtist).toBe(false);
    expect(component.isListener).toBe(false);
    expect(component.isAdmin).toBe(false);
  });
});


