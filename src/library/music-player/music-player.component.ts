import { Component, ChangeDetectionStrategy, inject, signal, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Music } from '../../services/supabase.service';
import { MusicPlayerService } from '../../services/music-player.service';

@Component({
  selector: 'app-music-player',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './music-player.component.html',
  styleUrls: ['./music-player.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(window:mousemove)': 'onDrag($event)',
    '(window:mouseup)': 'onDragEnd()',
    '(window:mouseleave)': 'onDragEnd()',
  }
})
export class MusicPlayerComponent {
  private readonly playerService = inject(MusicPlayerService);
  private elementRef = inject(ElementRef);

  // Get all state from the service
  music = this.playerService.currentMusic;
  isPlaying = this.playerService.isPlaying;
  duration = this.playerService.duration;
  currentTime = this.playerService.currentTime;
  isSeeking = this.playerService.isSeeking;
  canPlayNext = this.playerService.canPlayNext;
  canPlayPrev = this.playerService.canPlayPrev;

  // New state for advanced controls
  volume = this.playerService.volume;
  isMuted = this.playerService.isMuted;
  repeatMode = this.playerService.repeatMode;

  // Draggable state
  isDragging = signal(false);
  wasDragged = signal(false);
  position = signal({ x: 0, y: 0 });
  dragOffset = signal({ x: 0, y: 0 });
  playerSize = signal<{ width: number; height: number; } | null>(null);

  onDragStart(event: MouseEvent) {
    // Não arrastar ao interagir com os controles
    if ((event.target as HTMLElement).closest('input, button, a')) {
      return;
    }
    event.preventDefault();
    this.isDragging.set(true);

    const playerElement = this.elementRef.nativeElement.querySelector('.music-player-wrapper');
    if (!playerElement) return;
    const rect = playerElement.getBoundingClientRect();

    const currentPos = this.wasDragged() ? this.position() : { x: rect.left, y: rect.top };

    if (!this.wasDragged()) {
      this.position.set(currentPos);
      this.playerSize.set({ width: rect.width, height: rect.height });
      this.wasDragged.set(true);
    }
    
    this.dragOffset.set({
      x: event.clientX - currentPos.x,
      y: event.clientY - currentPos.y
    });
  }

  onDrag(event: MouseEvent) {
    if (this.isDragging() && this.playerSize()) {
      let newX = event.clientX - this.dragOffset().x;
      let newY = event.clientY - this.dragOffset().y;

      const { width, height } = this.playerSize()!;
      // Mantém o player dentro dos limites da tela
      newX = Math.max(0, Math.min(newX, window.innerWidth - width));
      newY = Math.max(0, Math.min(newY, window.innerHeight - height));

      this.position.set({ x: newX, y: newY });
    }
  }
  
  onDragEnd() {
    this.isDragging.set(false);
  }

  // Delegate actions to the service
  close() {
    this.playerService.closePlayer();
    // Reseta o estado de arrasto ao fechar
    this.wasDragged.set(false);
    this.playerSize.set(null);
  }

  togglePlayPause() {
    this.playerService.togglePlayPause();
  }
  
  playNext() {
    this.playerService.playNext();
  }

  playPrev() {
    this.playerService.playPrev();
  }

  onSeek(event: Event) {
    const input = event.target as HTMLInputElement;
    this.playerService.seek(Number(input.value));
  }
  
  onVolumeChange(event: Event) {
    const input = event.target as HTMLInputElement;
    this.playerService.setVolume(Number(input.value));
  }

  toggleMute() {
    this.playerService.toggleMute();
  }

  toggleRepeat() {
    this.playerService.toggleRepeatMode();
  }
  
  formatTime(seconds: number): string {
    if (isNaN(seconds) || !isFinite(seconds)) {
      return '0:00';
    }
    const minutes = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  }
  
  getCoverArt(title: string | undefined): string {
    if (!title) return `https://picsum.photos/seed/art-unknown/100/100`;
    return `https://picsum.photos/seed/art-${title}/100/100`;
  }
}