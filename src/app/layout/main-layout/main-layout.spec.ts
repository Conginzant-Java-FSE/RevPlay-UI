import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NavigationEnd, Router } from '@angular/router';
import { Subject } from 'rxjs';
import { MainLayoutComponent } from './main-layout.component';
import { RecentlyPlayedService } from '../../services/recently-played.service';
import { AutoplayService } from '../../services/autoplay.service';

describe('MainLayoutComponent', () => {
  let component: MainLayoutComponent;
  let fixture: ComponentFixture<MainLayoutComponent>;
  let events$: Subject<any>;

  beforeEach(async () => {
    events$ = new Subject<any>();

    await TestBed.configureTestingModule({
      imports: [MainLayoutComponent],
      providers: [
        { provide: RecentlyPlayedService, useValue: {} },
        { provide: AutoplayService, useValue: {} },
        {
          provide: Router,
          useValue: {
            events: events$.asObservable()
          }
        }
      ]
    })
      .overrideComponent(MainLayoutComponent, {
        set: { template: '' }
      })
      .compileComponents();

    fixture = TestBed.createComponent(MainLayoutComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => {
    fixture.destroy();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should run ngAfterViewInit and reschedule on navigation end', () => {
    const original = (component as any).scheduleMainScrollbarUpdate.bind(component);
    let callCount = 0;
    (component as any).scheduleMainScrollbarUpdate = () => {
      callCount += 1;
      return original();
    };

    component.ngAfterViewInit();
    events$.next(new NavigationEnd(1, '/from', '/to'));

    expect(callCount).toBeGreaterThan(0);
  });

  it('should toggle sidebar state', () => {
    expect(component.isSidebarCollapsed).toBe(false);

    component.toggleSidebar();

    expect(component.isSidebarCollapsed).toBe(true);
  });

  it('should sync custom scrollbar from main scroll', () => {
    const mainEl = { scrollWidth: 1400, scrollLeft: 120 } as HTMLDivElement;
    const barEl = { scrollLeft: 0 } as HTMLDivElement;

    component.mainScroll = { nativeElement: mainEl } as any;
    component.mainScrollbar = { nativeElement: barEl } as any;

    component.onMainScroll();

    expect(component.mainScrollWidth).toBe(1400);
    expect(barEl.scrollLeft).toBe(120);
  });

  it('should sync main scroll from scrollbar movement', () => {
    const mainEl = { scrollLeft: 0 } as HTMLDivElement;
    const barEl = { scrollLeft: 220 } as HTMLDivElement;

    component.mainScroll = { nativeElement: mainEl } as any;
    component.mainScrollbar = { nativeElement: barEl } as any;

    component.onScrollbarScroll();

    expect(mainEl.scrollLeft).toBe(220);
  });

  it('should no-op scroll sync methods when refs are missing', () => {
    component.mainScroll = undefined as any;
    component.mainScrollbar = undefined as any;

    expect(() => component.onMainScroll()).not.toThrow();
    expect(() => component.onScrollbarScroll()).not.toThrow();
  });

  it('should avoid recursive sync when already syncing', () => {
    const mainEl = { scrollWidth: 1200, scrollLeft: 80 } as HTMLDivElement;
    const barEl = { scrollLeft: 0 } as HTMLDivElement;
    component.mainScroll = { nativeElement: mainEl } as any;
    component.mainScrollbar = { nativeElement: barEl } as any;
    (component as any).syncingScroll = true;

    component.onMainScroll();
    component.onScrollbarScroll();

    expect(component.mainScrollWidth).toBe(0);
    expect(barEl.scrollLeft).toBe(0);
  });

  it('should trigger schedule update on window resize', () => {
    const scheduleSpy = spyOn<any>(component, 'scheduleMainScrollbarUpdate');

    component.onWindowResize();

    expect(scheduleSpy).toHaveBeenCalled();
  });

  it('should update scrollbar width and position through private updater', () => {
    const mainEl = { scrollWidth: 1600, scrollLeft: 95 } as HTMLDivElement;
    const barEl = { scrollLeft: 0 } as HTMLDivElement;
    component.mainScroll = { nativeElement: mainEl } as any;
    component.mainScrollbar = { nativeElement: barEl } as any;

    (component as any).updateMainScrollbar();

    expect(component.mainScrollWidth).toBe(1600);
    expect(barEl.scrollLeft).toBe(95);
  });

  it('should safely skip private update when main scroll ref is missing', () => {
    component.mainScroll = undefined as any;

    expect(() => (component as any).updateMainScrollbar()).not.toThrow();
  });

  it('should complete destroy stream on ngOnDestroy', () => {
    const nextSpy = spyOn((component as any).destroy$, 'next').and.callThrough();
    const completeSpy = spyOn((component as any).destroy$, 'complete').and.callThrough();

    component.ngOnDestroy();

    expect(nextSpy).toHaveBeenCalled();
    expect(completeSpy).toHaveBeenCalled();
  });
});


