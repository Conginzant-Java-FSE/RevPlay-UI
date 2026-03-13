import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { ActivatedRoute } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';

import { DashboardComponent } from './dashboard.component';

import { HttpClientTestingModule } from '@angular/common/http/testing';
import { AdminService } from '../../core/services/admin.service';
import { ApiService } from '../../core/services/api';

describe('DashboardComponent', () => {
  let component: DashboardComponent;
  let fixture: ComponentFixture<DashboardComponent>;

  beforeEach(async () => {
    const adminSpy = jasmine.createSpyObj('AdminService', ['getDashboardMetrics', 'getTopArtists', 'getTopContent', 'getAuditLogs', 'getUsersPage']);
    adminSpy.getDashboardMetrics.and.returnValue(of({}));
    adminSpy.getTopArtists.and.returnValue(of([]));
    adminSpy.getTopContent.and.returnValue(of([]));
    adminSpy.getAuditLogs.and.returnValue(of({ content: [] }));
    adminSpy.getUsersPage.and.returnValue(of({ content: [] }));

    const apiSpy = jasmine.createSpyObj('ApiService', ['get', 'post']);
    apiSpy.get.and.returnValue(of({}));

    await TestBed.configureTestingModule({
      imports: [DashboardComponent, HttpClientTestingModule],
      providers: [
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: { get: () => null }, paramMap: { get: () => null }, data: {} }, queryParamMap: of({ get: () => null }), paramMap: of({ get: () => null }), queryParams: of({}), params: of({}), data: of({}) } }
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(DashboardComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  afterEach(() => {
    if (component['autoRefreshTimer'] !== null) {
      window.clearInterval(component['autoRefreshTimer']);
    }
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});











