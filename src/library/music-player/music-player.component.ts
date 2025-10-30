import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
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
})
export class MusicPlayerComponent {
  private readonly playerService = inject(MusicPlayerService);

  // Get all state from the service
  music = this.playerService.currentMusic;
  isPlaying = this.playerService.isPlaying;
  duration = this.playerService.duration;
  currentTime = this.playerService.currentTime;
  isSeeking = this.playerService.isSeeking;
  canPlayNext = this.playerService.canPlayNext;
  canPlayPrev = this.playerService.canPlayPrev;

  // Delegate actions to the service
  close() {
    this.playerService.closePlayer();
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
  
  formatTime(seconds: number): string {
    const minutes = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  }
  
  getCoverArt(title: string | undefined): string {
    if (!title) return `https://picsum.photos/seed/art-unknown/100/100`;
    return `https://picsum.photos/seed/art-${title}/100/100`;
  }
}