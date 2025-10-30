import { Component, ChangeDetectionStrategy, inject, signal, computed, OnDestroy, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MurekaService } from '../services/mureka.service';
import { SupabaseService, type Music } from '../services/supabase.service';
import { MusicPlayerService } from '../services/music-player.service';
import { Router, ActivatedRoute } from '@angular/router';

@Component({
  selector: 'app-library',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './library.component.html',
  styleUrls: ['./library.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LibraryComponent implements OnDestroy {
  private readonly murekaService = inject(MurekaService);
  private readonly playerService = inject(MusicPlayerService);
  private readonly supabase = inject(SupabaseService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  private pollInterval: any = null;

  userMusic = this.murekaService.userMusic;
  deleteError = signal<string | null>(null);
  clearError = signal<string | null>(null);
  isDeleting = signal<string | null>(null); // store id of music being deleted
  isClearing = signal(false);

  purchaseStatus = signal<'success' | 'cancelled' | 'error' | null>(null);
  purchaseStatusMessage = signal<string | null>(null);

  playlist = computed(() => this.userMusic().filter(m => m.status === 'succeeded' && m.audio_url));

  hasFailedMusic = computed(() => this.userMusic().some(m => m.status === 'failed'));

  constructor() {
    this.handlePurchaseRedirect();

    effect(() => {
      const processingMusic = this.userMusic().filter(m => m.status === 'processing' && m.task_id);
      
      // Eagerly check status once when the component loads or music list changes
      processingMusic.forEach(music => this.checkMusicStatus(music));

      if (processingMusic.length > 0) {
        this.startPolling();
      } else {
        this.stopPolling();
      }
    });
  }

  private handlePurchaseRedirect(): void {
    this.route.queryParams.subscribe(async params => {
        const status = params['status'];
        const sessionId = params['session_id'];

        if (status === 'success' && sessionId) {
            this.purchaseStatus.set('success');
            this.purchaseStatusMessage.set('Processando sua compra... por favor, aguarde.');

            const { error } = await this.supabase.handlePurchaseSuccess(sessionId);
            
            if (error) {
                this.purchaseStatus.set('error');
                this.purchaseStatusMessage.set(`Erro ao finalizar a compra: ${error}`);
            } else {
                this.purchaseStatusMessage.set('Compra concluída com sucesso! Sua assinatura está ativa.');
            }
            
            // Clean URL
            this.router.navigate([], {
                relativeTo: this.route,
                queryParams: { status: null, session_id: null },
                queryParamsHandling: 'merge', // remove only the handled params
                replaceUrl: true
            });
        } else if (status === 'cancelled') {
            this.purchaseStatus.set('cancelled');
            this.purchaseStatusMessage.set('Sua compra foi cancelada. Você pode tentar novamente a qualquer momento.');
            // Clean URL
            this.router.navigate([], {
                relativeTo: this.route,
                queryParams: { status: null },
                queryParamsHandling: 'merge',
                replaceUrl: true
            });
        }
    });
  }

  ngOnDestroy(): void {
    this.stopPolling();
  }

  startPolling(): void {
    if (this.pollInterval) return; // Already polling
    console.log('Starting polling for processing music...');
    this.pollInterval = setInterval(() => {
      const processingMusic = this.userMusic().filter(m => m.status === 'processing' && m.task_id);
      if(processingMusic.length === 0) {
        this.stopPolling();
        return;
      }
      console.log(`Polling for status of ${processingMusic.length} song(s).`);
      processingMusic.forEach(music => this.checkMusicStatus(music));
    }, 10000); // Poll every 10 seconds
  }

  stopPolling(): void {
    if (this.pollInterval) {
      console.log('Stopping polling.');
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  async checkMusicStatus(music: Music): Promise<void> {
    if (!music.task_id) return;

    const result = await this.murekaService.queryMusicStatus(music.task_id);
    
    // If status is final, update DB and local state
    if (['succeeded', 'failed', 'timeouted', 'cancelled'].includes(result.status)) {
      if (result.status === 'succeeded') {
        const audio_url = result.choices?.[0]?.url;
        if (audio_url) {
          const updatedMusic = await this.supabase.updateMusic(music.id, { status: 'succeeded', audio_url: audio_url });
          if (updatedMusic) {
            this.userMusic.update(musics => musics.map(m => m.id === music.id ? updatedMusic : m));
          }
        } else {
          const error = 'Geração bem-sucedida, mas a Mureka não forneceu um URL de áudio.';
          const updatedMusic = await this.supabase.updateMusic(music.id, { status: 'failed', error: error });
            if (updatedMusic) {
            this.userMusic.update(musics => musics.map(m => m.id === music.id ? updatedMusic : m));
          }
        }
      } else { // failed, timeouted, cancelled
        const reason = result.failed_reason || `Geração falhou com status: ${result.status}`;
        const updatedMusic = await this.supabase.updateMusic(music.id, { status: 'failed', error: reason });
        if (updatedMusic) {
          this.userMusic.update(musics => musics.map(m => m.id === music.id ? updatedMusic : m));
        }
      }
    }
  }

  selectMusic(music: Music): void {
    if (music.status === 'succeeded' && music.audio_url) {
      this.playerService.selectMusicAndPlaylist(music, this.playlist());
    }
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