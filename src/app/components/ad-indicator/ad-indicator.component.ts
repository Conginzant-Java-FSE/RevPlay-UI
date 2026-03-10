import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
    selector: 'app-ad-indicator',
    standalone: true,
    imports: [CommonModule],
    templateUrl: './ad-indicator.component.html',
    styleUrls: ['./ad-indicator.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class AdIndicatorComponent {
    @Input() remainingSeconds = 0;

    get countdownLabel(): string {
        const remaining = Math.max(0, Math.ceil(Number(this.remainingSeconds ?? 0)));
        return `Ad ends in ${remaining}s`;
    }
}
