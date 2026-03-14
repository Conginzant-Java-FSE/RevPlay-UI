import { TestBed } from '@angular/core/testing';
import { Browse } from './browse';

describe('Browse', () => {
  let service: Browse;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(Browse);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});


