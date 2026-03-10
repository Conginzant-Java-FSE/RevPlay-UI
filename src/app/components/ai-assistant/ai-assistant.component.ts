import { CommonModule } from '@angular/common';
import { Component, ElementRef, ViewChild, effect, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { finalize } from 'rxjs/operators';
import { AiService } from '../../services/ai.service';

type ChatSender = 'user' | 'ai';

interface ChatMessage {
  sender: ChatSender;
  text: string;
}

@Component({
  selector: 'app-ai-assistant',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './ai-assistant.component.html',
  styleUrl: './ai-assistant.component.css'
})
export class AiAssistantComponent {
  @ViewChild('messagesContainer') private messagesContainer?: ElementRef<HTMLDivElement>;

  readonly isOpen = signal(false);
  readonly isSending = signal(false);
  readonly draft = signal('');
  readonly messages = signal<ChatMessage[]>([
    {
      sender: 'ai',
      text: 'Hello! How can I help you with RevPlay today?'
    }
  ]);

  constructor(private readonly aiService: AiService) {
    effect(() => {
      this.messages();
      queueMicrotask(() => this.scrollToBottom());
    });
  }

  toggle(): void {
    this.isOpen.update((value) => !value);
  }

  close(): void {
    this.isOpen.set(false);
  }

  send(): void {
    const prompt = this.draft().trim();
    if (!prompt || this.isSending()) {
      return;
    }

    this.messages.update((messages) => [...messages, { sender: 'user', text: prompt }]);
    this.draft.set('');
    this.isSending.set(true);

    this.aiService.sendMessage(prompt).pipe(
      finalize(() => this.isSending.set(false))
    ).subscribe({
      next: (response) => {
        this.messages.update((messages) => [
          ...messages,
          {
            sender: 'ai',
            text: response || 'AI assistant is currently unavailable.'
          }
        ]);
      },
      error: () => {
        this.messages.update((messages) => [
          ...messages,
          {
            sender: 'ai',
            text: 'AI assistant is currently unavailable.'
          }
        ]);
      }
    });
  }

  handleEnter(event: Event): void {
    const keyboardEvent = event as KeyboardEvent;
    if (keyboardEvent.key !== 'Enter' || keyboardEvent.shiftKey) {
      return;
    }

    keyboardEvent.preventDefault();
    this.send();
  }

  trackByIndex(index: number): number {
    return index;
  }

  private scrollToBottom(): void {
    const container = this.messagesContainer?.nativeElement;
    if (!container) {
      return;
    }

    container.scrollTop = container.scrollHeight;
  }
}
