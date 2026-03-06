import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ManageGenres } from './manage-genres';

describe('ManageGenres', () => {
  let component: ManageGenres;
  let fixture: ComponentFixture<ManageGenres>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ManageGenres],
    }).compileComponents();

    fixture = TestBed.createComponent(ManageGenres);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
