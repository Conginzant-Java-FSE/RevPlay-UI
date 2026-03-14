declare const jasmine: any;
declare const spyOn: any;
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { ManageUsersComponent } from './manage-users.component';
import { AdminService } from '../../core/services/admin.service';
import { ApiService } from '../../core/services/api';

describe('ManageUsersComponent', () => {
  let component: ManageUsersComponent;
  let fixture: ComponentFixture<ManageUsersComponent>;
  let adminServiceSpy: any;
  let apiServiceSpy: any;

  beforeEach(async () => {
    adminServiceSpy = jasmine.createSpyObj('AdminService', [
      'getUsersPage',
      'updateUserStatus',
      'updateUserRole',
      'deleteUser',
      'getUserLikes',
      'deleteLike',
      'clearUserPlayHistory'
    ]);
    adminServiceSpy.getUsersPage.and.returnValue(of({
      content: [{ id: 1, username: 'alice', email: 'alice@example.com' }],
      totalElements: 1,
      totalPages: 1,
      page: 0,
      size: 20
    }));
    adminServiceSpy.updateUserStatus.and.returnValue(of({}));
    adminServiceSpy.updateUserRole.and.returnValue(of({}));
    adminServiceSpy.deleteUser.and.returnValue(of({}));
    adminServiceSpy.getUserLikes.and.returnValue(of([]));
    adminServiceSpy.deleteLike.and.returnValue(of({}));
    adminServiceSpy.clearUserPlayHistory.and.returnValue(of({}));
    apiServiceSpy = jasmine.createSpyObj('ApiService', ['get']);
    apiServiceSpy.get.and.returnValue(of({}));

    await TestBed.configureTestingModule({
      imports: [ManageUsersComponent],
      providers: [
        { provide: AdminService, useValue: adminServiceSpy },
        { provide: ApiService, useValue: apiServiceSpy }
      ]
    })
      .overrideComponent(ManageUsersComponent, {
        set: { template: '' }
      })
      .compileComponents();

    fixture = TestBed.createComponent(ManageUsersComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => {
    fixture.destroy();
    localStorage.clear();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should call setup methods in ngOnInit lifecycle', () => {
    const loadUsersSpy = spyOn(component, 'loadUsers');
    const startRefreshSpy = spyOn(component, 'startAutoRefresh');

    component.ngOnInit();

    expect(loadUsersSpy).toHaveBeenCalled();
    expect(startRefreshSpy).toHaveBeenCalled();
  });

  it('should load users via admin service', () => {
    component.loadUsers();

    expect(adminServiceSpy.getUsersPage).toHaveBeenCalledWith(0, 20, '');
  });

  it('should evaluate usable username values', () => {
    expect(component.hasUsableUsername('artist_name')).toBe(true);
    expect(component.hasUsableUsername('12345')).toBe(false);
    expect(component.hasUsableUsername('name@example.com')).toBe(false);
  });

  it('should reset current selection', () => {
    component.targetUserId = 10;
    component.selectedUserLabel = 'User #10';
    component.selectedUserEmail = 'user10@mail.com';

    component.clearSelection();

    expect(component.targetUserId).toBeNull();
    expect(component.selectedUserLabel).toBe('');
    expect(component.selectedUserEmail).toBe('');
  });

  it('should call updateUserStatus with selected user', () => {
    component.targetUserId = 1;
    component.targetIsActive = false;
    component.selectedUserLabel = 'alice';

    component.updateUserStatus();

    expect(adminServiceSpy.updateUserStatus).toHaveBeenCalledWith(1, false);
    expect(component.statusMessage).toContain('updated successfully');
  });

  it('should call updateUserRole with normalized role', () => {
    component.targetUserId = 1;
    component.targetRole = 'artist';
    component.selectedUserLabel = 'alice';

    component.updateUserRole();

    expect(adminServiceSpy.updateUserRole).toHaveBeenCalledWith(1, 'ARTIST');
    expect(component.statusMessage).toContain('ARTIST');
  });

  it('should not call updateUserStatus when target user is missing', () => {
    component.targetUserId = null;

    component.updateUserStatus();

    expect(adminServiceSpy.updateUserStatus).not.toHaveBeenCalled();
  });

  it('should return stable trackBy id', () => {
    const id = component.trackUserById(0, {
      userId: 99,
      label: 'Test',
      email: 't@t.com',
      username: 'test'
    } as any);

    expect(id).toBe(99);
  });

  it('should filter users by search query', () => {
    component.users = [
      { userId: 1, label: 'Alice', email: 'alice@mail.com', username: 'alice' },
      { userId: 2, label: 'Bob', email: 'bob@mail.com', username: 'bob' }
    ];
    component.userSearch = 'ali';

    expect(component.filteredUsers.length).toBe(1);
    expect(component.filteredUsers[0].userId).toBe(1);
  });

  it('should clear selection labels when user id is empty', () => {
    component.targetUserId = null;
    component.selectedUserLabel = 'x';
    component.selectedUserEmail = 'y';

    component.onUserIdChange();

    expect(component.selectedUserLabel).toBe('');
    expect(component.selectedUserEmail).toBe('');
  });

  it('should enrich selected user label and email from profile API', () => {
    component.users = [{ userId: 1, label: 'User #1', email: '', username: '' } as any];
    component.targetUserId = 1;
    apiServiceSpy.get.and.returnValue(of({
      fullName: 'Alice Cooper',
      email: 'alice@demo.com',
      username: 'alice'
    }));

    component.onUserIdChange();

    expect(component.selectedUserLabel).toBe('Alice Cooper');
    expect(component.selectedUserEmail).toBe('alice@demo.com');
  });

  it('should debounce directory search only for 2+ chars', () => {
    const timeoutSpy = spyOn(window, 'setTimeout').and.callFake((fn: any) => {
      fn();
      return 1 as any;
    });
    const loadSpy = spyOn(component as any, 'loadUsersFromDirectory');

    component.onUserSearchChange('a');
    expect(timeoutSpy).not.toHaveBeenCalled();

    component.onUserSearchChange('alice');
    expect(timeoutSpy).toHaveBeenCalled();
    expect(loadSpy).toHaveBeenCalledWith('alice');
  });

  it('should set error when updateUserStatus API fails', () => {
    adminServiceSpy.updateUserStatus.and.returnValue(throwError(() => new Error('fail')));
    component.targetUserId = 1;
    component.targetIsActive = false;

    component.updateUserStatus();

    expect(component.error).toBe('Failed to update user status.');
  });

  it('should set error when updateUserRole API fails', () => {
    adminServiceSpy.updateUserRole.and.returnValue(throwError(() => new Error('fail')));
    component.targetUserId = 1;
    component.targetRole = 'ADMIN';

    component.updateUserRole();

    expect(component.error).toBe('Failed to update user role.');
  });

  it('should skip delete when user cancels confirmation', () => {
    component.targetUserId = 1;
    component.selectedUserLabel = 'alice';
    spyOn(window, 'confirm').and.returnValue(false);

    component.deleteSelectedUser();

    expect(adminServiceSpy.deleteUser).not.toHaveBeenCalled();
  });

  it('should delete selected user and remove from suggestions', () => {
    component.users = [
      { userId: 1, label: 'alice', email: 'alice@mail.com', username: 'alice' } as any,
      { userId: 2, label: 'bob', email: 'bob@mail.com', username: 'bob' } as any
    ];
    component.targetUserId = 1;
    component.selectedUserLabel = 'alice';
    spyOn(window, 'confirm').and.returnValue(true);
    adminServiceSpy.deleteUser.and.returnValue(of({}));

    component.deleteSelectedUser();

    expect(adminServiceSpy.deleteUser).toHaveBeenCalledWith(1);
    expect(component.users.length).toBe(1);
    expect(component.users[0].userId).toBe(2);
    expect(component.statusMessage ?? '').toContain('deleted successfully');
  });

  it('should resolve page indexes for both small and large page counts', () => {
    const small = (component as any).resolvePageIndexes(5);
    const large = (component as any).resolvePageIndexes(200);

    expect(small).toEqual([0, 1, 2, 3, 4]);
    expect(large.length).toBeGreaterThan(100);
    expect(large[0]).toBe(0);
  });

  it('should build merged user suggestions from directory payload', () => {
    const suggestions = (component as any).buildSuggestionsFromUserDirectory([
      { id: 8, fullName: 'A User', email: 'a@demo.com', username: 'auser' },
      { id: 8, fullName: 'A User', email: 'a@demo.com', username: 'auser' },
      { id: 9, username: 'buser' }
    ]);

    expect(suggestions.length).toBe(2);
    expect(suggestions[0].userId).toBe(8);
  });

  it('should merge suggestions preferring stronger label and email values', () => {
    const merged = (component as any).mergeSuggestions(
      [{ userId: 1, label: 'User #1', email: '', username: '' }],
      [{ userId: 1, label: 'Alice', email: 'alice@demo.com', username: 'alice' }]
    );

    expect(merged.length).toBe(1);
    expect(merged[0].label).toBe('Alice');
    expect(merged[0].email).toBe('alice@demo.com');
    expect(merged[0].username).toBe('alice');
  });

  it('should return deleted-user fallback for 404 profile lookup', () => {
    apiServiceSpy.get.and.returnValue(throwError(() => ({ status: 404 })));
    let result: any = null;

    (component as any).fetchUserDetails(404).subscribe((value: any) => {
      result = value;
    });

    expect(result).toEqual(jasmine.objectContaining({ username: 'Deleted User' }));
  });

  it('should extract user id from multiple log patterns', () => {
    expect((component as any).extractUserId({ entityType: 'USER', entityId: 44 })).toBe(44);
    expect((component as any).extractUserId({ performedBy: 55 })).toBe(55);
    expect((component as any).extractUserId({ details: 'user id: 66' })).toBe(66);
    expect((component as any).extractUserId({ details: 'User #77 updated' })).toBe(77);
  });

  it('should extract user label and email from logs and fallback safely', () => {
    const label = (component as any).extractUserLabel(
      { actorName: 'Alice', details: 'updated' },
      10
    );
    expect(label).toBe('Alice');

    const email = (component as any).extractUserEmail({
      actorEmail: '',
      details: 'contact: demo.user@example.com'
    });
    expect(email).toBe('demo.user@example.com');

    const fallback = (component as any).extractUserLabel({ actorName: '12345' }, 99);
    expect(fallback).toBe('User #99');
  });

  it('should extract profile fields from nested user payloads', () => {
    const payload = {
      user: {
        fullName: 'Nested Name',
        email: 'nested@example.com',
        username: 'nested-user'
      }
    };

    expect((component as any).extractProfileName(payload)).toBe('Nested Name');
    expect((component as any).extractProfileEmail(payload)).toBe('nested@example.com');
    expect((component as any).extractProfileUsername(payload)).toBe('nested-user');
  });

  it('should resolve best label/email/username values', () => {
    expect((component as any).resolveBestLabel('User #7', 'Alice', 7)).toBe('Alice');
    expect((component as any).resolveBestLabel('Alice', 'User #7', 7)).toBe('Alice');

    expect((component as any).resolveBestEmail('', 'alice@example.com', 7)).toBe('alice@example.com');
    expect((component as any).resolveBestUsername('', 'alice_user')).toBe('alice_user');
  });

  it('should parse text-based name/username patterns', () => {
    expect((component as any).extractNameFromText('full name: Alice Wonderland')).toBe('Alice Wonderland');
    expect((component as any).extractUsernameFromText('username: alice_123')).toBe('alice_123');
    expect((component as any).extractUsernameFromText('username: mail@example.com')).toBe('mail');
  });

  it('should merge unique logs by generated key', () => {
    const merged = (component as any).mergeUniqueLogs([
      { id: 1, action: 'A' },
      { id: 1, action: 'A' },
      { id: 2, action: 'B' }
    ]);

    expect(merged.length).toBe(2);
  });

  it('should detect weak labels and suspicious test values', () => {
    expect((component as any).isWeakUserLabel('User #10')).toBe(true);
    expect((component as any).isWeakUserLabel('alice')).toBe(false);

    expect((component as any).isSuspiciousTestData('smoke account')).toBe(true);
    expect((component as any).isSuspiciousTestData('real user')).toBe(false);
  });
});



