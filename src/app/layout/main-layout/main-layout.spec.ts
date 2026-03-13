import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { ActivatedRoute } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';

import { MainLayoutComponent } from './main-layout.component';

import { HttpClientTestingModule } from '@angular/common/http/testing';
import { RecentlyPlayedService } from '../../services/recently-played.service';
import { AutoplayService } from '../../services/autoplay.service';
import { AuthService } from '../../core/services/auth';
import { PremiumService } from '../../core/services/premium.service';
import { StateService } from '../../core/services/state.service';

describe('MainLayoutComponent', () => {
  let component: MainLayoutComponent;
  let fixture: ComponentFixture<MainLayoutComponent>;

  beforeEach(async () => {
    const authSpy = jasmine.createSpyObj('AuthService', ['getCurrentUserSnapshot']);
    authSpy.currentUser$ = of(null);

    const premiumSpy = jasmine.createSpyObj('PremiumService', ['any']);
    premiumSpy.status$ = of(null);

    const stateSpy = jasmine.createSpyObj('StateService', ['any']);
    stateSpy.artistId$ = of(null);

    await TestBed.configureTestingModule({
      imports: [MainLayoutComponent, RouterTestingModule, HttpClientTestingModule],
      providers: [
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: { get: () => null }, paramMap: { get: () => null }, data: {} }, queryParamMap: of({ get: () => null }), paramMap: of({ get: () => null }), queryParams: of({}), params: of({}), data: of({}) } },
        { provide: RecentlyPlayedService, useValue: jasmine.createSpyObj('RecentlyPlayedService', ['any']) },
        { provide: AutoplayService, useValue: jasmine.createSpyObj('AutoplayService', ['any']) },
        { provide: AuthService, useValue: authSpy },
        { provide: PremiumService, useValue: premiumSpy },
        { provide: StateService, useValue: stateSpy }
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(MainLayoutComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});











