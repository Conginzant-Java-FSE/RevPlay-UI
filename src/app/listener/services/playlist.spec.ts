import { TestBed } from '@angular/core/testing';

import { Playlist } from './playlist';

describe('Playlist', () => {
  let service: Playlist;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(Playlist);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
