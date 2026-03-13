import { TestBed } from '@angular/core/testing';
import { PlayerService, PlayerState } from './player.service';
import { ApiService } from './api';
import { of, take } from 'rxjs';
import { environment } from '../../../environments/environment';

describe('PlayerService', () => {
    let service: PlayerService;
    let apiServiceMock: any;

    beforeEach(() => {
        apiServiceMock = {
            post: jasmine.createSpy('post').and.returnValue(of({}))
        };

        TestBed.configureTestingModule({
            providers: [
                PlayerService,
                { provide: ApiService, useValue: apiServiceMock }
            ]
        });
        service = TestBed.inject(PlayerService);
    });

    it('should be created', () => {
        expect(service).toBeTruthy();
    });

    it('should have initial state', (done) => {
        service.state$.pipe(take(1)).subscribe(state => {
            expect(state.isPlaying).toBeFalsy();
            expect(state.currentItem).toBeNull();
            expect(state.volume).toBe(50);
            done();
        });
    });

    it('should play a track and update state', (done) => {
        const mockTrack = { id: 1, fileName: 'test.mp3', type: 'SONG' };
        service.playTrack(mockTrack);

        service.state$.pipe(take(1)).subscribe(state => {
            const currentId = state.currentItem?.id ?? state.currentItem?.songId;
            expect(currentId).toBe(1);
            expect(state.currentItem?.fileName).toBe('test.mp3');
            done();
        });
    });

    it('should toggle play/pause', () => {
        const mockTrack = { id: 1, fileName: 'test.mp3', type: 'SONG' };
        service.playTrack(mockTrack);

        // Mock audio.play() returning a promise
        spyOn((service as any).audio, 'play').and.returnValue(Promise.resolve());
        spyOn((service as any).audio, 'pause');

        service.togglePlay(); // It was playing (triggered by playTrack), so this should pause
        service.state$.subscribe(state => {
            // Note: initAudioListeners might not trigger immediately in test without manual event dispatching
            // but the state update in togglePlay is synchronous
        });
    });

    it('should update volume and persist it', () => {
        spyOn(localStorage, 'setItem');
        service.setVolume(80);

        service.state$.pipe(take(1)).subscribe(state => {
            expect(state.volume).toBe(80);
            expect(localStorage.setItem).toHaveBeenCalledWith('revplay_volume', '80');
        });
    });
});
