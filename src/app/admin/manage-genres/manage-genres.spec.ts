declare const jasmine: any;
declare const spyOn: any;
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { ManageGenresComponent } from './manage-genres.component';
import { AdminService } from '../../core/services/admin.service';
import { GenreService } from '../../core/services/genre.service';

describe('ManageGenresComponent', () => {
  let component: ManageGenresComponent;
  let fixture: ComponentFixture<ManageGenresComponent>;
  let adminServiceSpy: any;
  let genreServiceSpy: any;

  beforeEach(async () => {
    adminServiceSpy = jasmine.createSpyObj('AdminService', ['createGenre', 'updateGenre', 'deleteGenre']);
    genreServiceSpy = jasmine.createSpyObj('GenreService', ['getAllGenres', 'clearCache']);

    genreServiceSpy.getAllGenres.and.returnValue(of([{ id: 1, name: 'Rock' }]));
    adminServiceSpy.createGenre.and.returnValue(of({ id: 2, name: 'Pop' }));
    adminServiceSpy.updateGenre.and.returnValue(of({}));
    adminServiceSpy.deleteGenre.and.returnValue(of({}));

    await TestBed.configureTestingModule({
      imports: [ManageGenresComponent],
      providers: [
        { provide: AdminService, useValue: adminServiceSpy },
        { provide: GenreService, useValue: genreServiceSpy }
      ]
    })
      .overrideComponent(ManageGenresComponent, {
        set: { template: '' }
      })
      .compileComponents();

    fixture = TestBed.createComponent(ManageGenresComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => {
    fixture.destroy();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should call loadGenres during ngOnInit lifecycle', () => {
    const loadSpy = spyOn(component, 'loadGenres');

    component.ngOnInit();

    expect(loadSpy).toHaveBeenCalled();
  });

  it('should load genres from GenreService', () => {
    component.loadGenres();

    expect(genreServiceSpy.getAllGenres).toHaveBeenCalled();
    expect(component.genres.length).toBe(1);
  });

  it('should create a new genre via AdminService', () => {
    component.newGenreName = 'Pop';

    component.addGenre();

    expect(adminServiceSpy.createGenre).toHaveBeenCalledWith({ name: 'Pop' });
    expect(genreServiceSpy.clearCache).toHaveBeenCalled();
  });

  it('should skip genre creation for empty names', () => {
    component.newGenreName = '   ';

    component.addGenre();

    expect(adminServiceSpy.createGenre).not.toHaveBeenCalled();
  });

  it('should set create-genre error when API fails', () => {
    adminServiceSpy.createGenre.and.returnValue(throwError(() => new Error('failed')));
    component.newGenreName = 'Jazz';

    component.addGenre();

    expect(component.errorMessage).toBe('Failed to create genre.');
  });

  it('should start and cancel genre edit mode', () => {
    component.startEditGenre({ id: 8, name: 'Rock' });
    expect(component.editingGenreId).toBe(8);
    expect(component.editGenreName).toBe('Rock');

    component.cancelEditGenre();
    expect(component.editingGenreId).toBeNull();
    expect(component.editGenreName).toBe('');
  });

  it('should update genre via admin service', () => {
    component.editingGenreId = 1;
    component.editGenreName = 'Alt Rock';

    component.saveGenreUpdate();

    expect(adminServiceSpy.updateGenre).toHaveBeenCalledWith(1, { name: 'Alt Rock' });
    expect(component.successMessage).toBe('Genre updated successfully.');
  });

  it('should set update-genre error when API fails', () => {
    adminServiceSpy.updateGenre.and.returnValue(throwError(() => new Error('failed')));
    component.editingGenreId = 1;
    component.editGenreName = 'Alt Rock';

    component.saveGenreUpdate();

    expect(component.errorMessage).toBe('Failed to update genre.');
  });

  it('should delete genre only when confirmed', () => {
    spyOn(window, 'confirm').and.returnValue(false);
    component.deleteGenre(3);
    expect(adminServiceSpy.deleteGenre).not.toHaveBeenCalled();

    (window.confirm as any).and.returnValue(true);
    component.deleteGenre(3);
    expect(adminServiceSpy.deleteGenre).toHaveBeenCalledWith(3);
    expect(component.successMessage).toBe('Genre deleted successfully.');
  });

  it('should set delete-genre error when API fails', () => {
    spyOn(window, 'confirm').and.returnValue(true);
    adminServiceSpy.deleteGenre.and.returnValue(throwError(() => new Error('failed')));

    component.deleteGenre(4);

    expect(component.errorMessage).toBe('Failed to delete genre.');
  });
});



