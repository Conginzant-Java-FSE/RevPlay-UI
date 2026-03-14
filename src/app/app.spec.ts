declare const jasmine: any;
declare const spyOn: any;
import { TestBed } from '@angular/core/testing';
import { App } from './app';
import { ThemeService } from './core/services/theme.service';

describe('App', () => {
  let themeServiceSpy: any;

  beforeEach(async () => {
    themeServiceSpy = jasmine.createSpyObj('ThemeService', ['setTheme'], {
      theme: 'dark'
    });

    await TestBed.configureTestingModule({
      imports: [App],
      providers: [{ provide: ThemeService, useValue: themeServiceSpy }]
    })
      .overrideComponent(App, {
        set: { template: '' }
      })
      .compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('should apply persisted theme in constructor', () => {
    TestBed.createComponent(App);
    expect(themeServiceSpy.setTheme).toHaveBeenCalledWith('dark');
  });

  it('should expose the default title signal', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance as any;
    expect(app.title()).toBe('revplay-frontend');
  });
});



