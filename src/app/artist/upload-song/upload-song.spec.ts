import { ComponentFixture, TestBed } from '@angular/core/testing';

import { UploadSong } from './upload-song';

describe('UploadSong', () => {
  let component: UploadSong;
  let fixture: ComponentFixture<UploadSong>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [UploadSong],
    }).compileComponents();

    fixture = TestBed.createComponent(UploadSong);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
