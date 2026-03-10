import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ManageAlbums } from './manage-albums';

describe('ManageAlbums', () => {
  let component: ManageAlbums;
  let fixture: ComponentFixture<ManageAlbums>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ManageAlbums],
    }).compileComponents();

    fixture = TestBed.createComponent(ManageAlbums);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
