import { Component, ElementRef, HostListener, ViewChild, OnDestroy, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NavigationEnd, Router, RouterModule } from '@angular/router';
import { SidebarComponent } from '../sidebar/sidebar.component';
import { NavbarComponent } from '../navbar/navbar.component';
import { PlayerComponent } from '../player/player.component';
import { RecentlyPlayedService } from '../../services/recently-played.service';
import { AutoplayService } from '../../services/autoplay.service';
import { Subject } from 'rxjs';
import { filter, takeUntil } from 'rxjs/operators';

@Component({
  selector: 'app-main-layout',
  templateUrl: './main-layout.component.html',
  styleUrls: ['./main-layout.component.scss'],
  standalone: true,
  imports: [CommonModule, RouterModule, SidebarComponent, NavbarComponent, PlayerComponent]
})
export class MainLayoutComponent implements AfterViewInit, OnDestroy {
  @ViewChild('mainScroll') mainScroll?: ElementRef<HTMLDivElement>;
  @ViewChild('mainScrollbar') mainScrollbar?: ElementRef<HTMLDivElement>;

  mainScrollWidth = 0;
  isSidebarCollapsed = false;
  private syncingScroll = false;
  private readonly destroy$ = new Subject<void>();

  constructor(
    private readonly recentlyPlayedService: RecentlyPlayedService,
    private readonly autoplayService: AutoplayService,
    private readonly router: Router
  ) {
    void this.recentlyPlayedService;
    void this.autoplayService;
  }

  ngAfterViewInit(): void {
    this.scheduleMainScrollbarUpdate();

    this.router.events
      .pipe(
        filter(event => event instanceof NavigationEnd),
        takeUntil(this.destroy$)
      )
      .subscribe(() => this.scheduleMainScrollbarUpdate());
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  @HostListener('window:resize')
  onWindowResize(): void {
    this.scheduleMainScrollbarUpdate();
  }

  onMainScroll(): void {
    if (this.syncingScroll) {
      return;
    }
    const scrollEl = this.mainScroll?.nativeElement;
    const barEl = this.mainScrollbar?.nativeElement;
    if (!scrollEl || !barEl) {
      return;
    }
    this.syncingScroll = true;
    this.mainScrollWidth = scrollEl.scrollWidth;
    barEl.scrollLeft = scrollEl.scrollLeft;
    this.syncingScroll = false;
  }

  onScrollbarScroll(): void {
    if (this.syncingScroll) {
      return;
    }
    const scrollEl = this.mainScroll?.nativeElement;
    const barEl = this.mainScrollbar?.nativeElement;
    if (!scrollEl || !barEl) {
      return;
    }
    this.syncingScroll = true;
    scrollEl.scrollLeft = barEl.scrollLeft;
    this.syncingScroll = false;
  }

  toggleSidebar(): void {
    this.isSidebarCollapsed = !this.isSidebarCollapsed;
    this.scheduleMainScrollbarUpdate();
  }

  private scheduleMainScrollbarUpdate(): void {
    setTimeout(() => this.updateMainScrollbar(), 0);
  }

  private updateMainScrollbar(): void {
    const scrollEl = this.mainScroll?.nativeElement;
    const barEl = this.mainScrollbar?.nativeElement;
    if (!scrollEl) {
      return;
    }
    this.mainScrollWidth = scrollEl.scrollWidth;
    if (barEl) {
      barEl.scrollLeft = scrollEl.scrollLeft;
    }
  }
}
