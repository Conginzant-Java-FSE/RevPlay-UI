import { TestBed } from '@angular/core/testing';

import { Artist } from './artist';

describe('Artist', () => {
  let service: Artist;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(Artist);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
