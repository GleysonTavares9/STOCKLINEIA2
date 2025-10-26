import { Component, ChangeDetectionStrategy, inject, effect, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MurekaService } from '../create/mureka.service';
import { SupabaseService, Music } from '../services/supabase.service';
import { Router } from '@angular/router';
import { MusicPlayerComponent } from './music-player/music-player.component';

@Component({
  selector: 'app-library',
  standalone: true,
  imports: [CommonModule, MusicPlayerComponent],
  templateUrl: './library.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LibraryComponent {
  private readonly murekaService = inject(MurekaService);
  private readonly supabaseService = inject(SupabaseService);
  private readonly router = inject(Router);
  
  history = this.murekaService.userMusic;
  currentUser = this.supabaseService.currentUser;
  
  hasFailedMusic = computed(() => this.history().some(item => item.status === 'failed'));
  
  // Filter out any songs that shouldn't be in the playlist (e.g. still processing)
  playlist = computed(() => this.history().filter(m => m.status === 'succeeded' && m.audio_url));

  selectedMusic = signal<Music | null>(null);

  constructor() {
    effect(() => {
      // If user logs out, redirect to auth page.
      if (!this.currentUser()) {
        this.router.navigate(['/auth']);
      }
    });
  }

  selectMusic(music: Music): void {
    if (music.status === 'succeeded' && music.audio_url) {
      this.selectedMusic.set(music);
    }
  }

  closePlayer(): void {
    this.selectedMusic.set(null);
  }

  async deleteMusic(musicId: string): Promise<void> {
    if (window.confirm('Tem certeza de que deseja apagar esta música permanentemente?')) {
      try {
        await this.murekaService.deleteMusic(musicId);
      } catch (error) {
        console.error('Falha ao apagar música:', error);
        const errorMessage = (error instanceof Error) ? error.message : 'Ocorreu um erro desconhecido.';
        alert(`Não foi possível apagar a música: ${errorMessage}`);
      }
    }
  }

  async clearFailedMusic(): Promise<void> {
    if (window.confirm('Tem certeza de que deseja apagar TODAS as músicas com falha? Esta ação não pode ser desfeita.')) {
      try {
        await this.murekaService.clearFailedMusic();
      } catch (error) {
        console.error('Falha ao limpar músicas com falha:', error);
        const errorMessage = (error instanceof Error) ? error.message : 'Ocorreu um erro desconhecido.';
        alert(`Não foi possível limpar as músicas com falha: ${errorMessage}`);
      }
    }
  }
}