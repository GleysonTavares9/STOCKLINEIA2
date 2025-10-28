import { Component, ChangeDetectionStrategy, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MurekaService } from '../services/mureka.service';
import { type Music } from '../services/supabase.service';
import { MusicPlayerComponent } from './music-player/music-player.component';

@Component({
  selector: 'app-library',
  standalone: true,
  imports: [CommonModule, MusicPlayerComponent],
  templateUrl: './library.component.html',
  styleUrls: ['./library.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LibraryComponent {
  private readonly murekaService = inject(MurekaService);

  userMusic = this.murekaService.userMusic;
  selectedMusic = signal<Music | null>(null);
  deleteError = signal<string | null>(null);
  clearError = signal<string | null>(null);
  isDeleting = signal<string | null>(null); // store id of music being deleted
  isClearing = signal(false);

  playlist = computed(() => this.userMusic().filter(m => m.status === 'succeeded' && m.audio_url));

  hasFailedMusic = computed(() => this.userMusic().some(m => m.status === 'failed'));

  selectMusic(music: Music): void {
    if (music.status === 'succeeded' && music.audio_url) {
      this.selectedMusic.set(music);
    }
  }

  closePlayer(): void {
    this.selectedMusic.set(null);
  }

  async deleteMusic(musicId: string): Promise<void> {
    this.isDeleting.set(musicId);
    this.deleteError.set(null);
    try {
      await this.murekaService.deleteMusic(musicId);
    } catch (error: any) {
      this.deleteError.set(error.message || 'Falha ao apagar a música.');
    } finally {
      this.isDeleting.set(null);
    }
  }

  async clearFailedMusic(): Promise<void> {
    this.isClearing.set(true);
    this.clearError.set(null);
    try {
      await this.murekaService.clearFailedMusic();
    } catch (error: any) {
      this.clearError.set(error.message || 'Falha ao limpar as músicas com falha.');
    } finally {
      this.isClearing.set(false);
    }
  }

  getCoverArt(title: string): string {
    return `https://picsum.photos/seed/art-${title}/400/400`;
  }
}
