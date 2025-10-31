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
  // Fix: Explicitly type the injected ActivatedRoute and Router to resolve type inference issues.
  private readonly route: ActivatedRoute = inject(ActivatedRoute);
  private readonly router: Router = inject(Router);

  private pollInterval: any = null;

  userMusic = this.murekaService.userMusic;
  deleteError = signal<string | null>(null);
  clearError = signal<string | null>(null);
  visibilityError = signal<string | null>(null);
  isDeleting = signal<string | null>(null); // store id of music being deleted
  isClearing = signal(false);
  isTogglingVisibility = signal<string | null>(null); // For visibility toggle loading state

  purchaseStatus = signal<'success' | 'cancelled' | 'error' | null>(null);
  purchaseStatusMessage = signal<string | null>(null);
  expandedStyles = signal(new Set<string>());
  expandedLyricsId = signal<string | null>(null);

  // New state for extending music
  musicToExtend = signal<Music | null>(null);
  extendDuration = signal<number>(30);
  isExtending = signal(false);
  extendError = signal<string | null>(null);
  
  playlist = computed(() => this.userMusic().filter(m => m.status === 'succeeded' && m.audio_url));

  hasFailedMusic = computed(() => this.userMusic().some(m => m.status === 'failed'));

  groupedMusic = computed(() => {
    const music = this.userMusic();
    if (!music.length) return [];
    
    const groups: { [style: string]: Music[] } = {};
    const styleOrder: string[] = [];

    music.forEach(song => {
      const mainStyleRaw = (song.style || 'Sem Categoria').split(',')[0].trim();
      const capitalizedStyle = mainStyleRaw.charAt(0).toUpperCase() + mainStyleRaw.slice(1);
      
      if (!groups[capitalizedStyle]) {
        groups[capitalizedStyle] = [];
        styleOrder.push(capitalizedStyle);
      }
      groups[capitalizedStyle].push(song);
    });
    
    styleOrder.sort((a, b) => a.localeCompare(b));
    
    return styleOrder.map(style => ({ style, songs: groups[style] }));
  });

  canExtendMusic = computed(() => {
    const duration = this.extendDuration();
    return !this.isExtending() && duration > 0 && duration <= 60 && this.supabase.currentUserProfile()!.credits > 0;
  });

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

    // FIX: Retrieve the correct query path from music metadata. Default to 'song/query' for backward compatibility.
    const queryPath = (music.metadata?.queryPath as 'song/query' | 'instrumental/query' | 'voice_clone/query') || 'song/query';
    
    try {
      // FIX: Pass the correct queryPath to the status check.
      const result = await this.murekaService.queryMusicStatus(music.task_id, queryPath);
    
      // If status is final, update DB and local state
      if (['succeeded', 'failed', 'timeouted', 'cancelled'].includes(result.status)) {
        if (result.status === 'succeeded') {
          const audio_url = result.choices?.[0]?.url;
          const fileId = result.file_id;
          if (audio_url) {
            let finalUrl = audio_url;
            if (fileId) {
              // FIX: Construct permanent URL for generated audio, consistent with mureka.service.ts
              finalUrl = `https://api.mureka.ai/v1/files/${fileId}/download`;
            }
            // FIX: Preserve existing metadata when updating the music record.
            const updatedMusic = await this.supabase.updateMusic(music.id, { 
              status: 'succeeded', 
              audio_url: finalUrl,
              metadata: { ...music.metadata, file_id: fileId }
            });
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
    } catch (error: any) {
        console.error(`Library: Failed to check status for task ${music.task_id}`, error);
        // Se a consulta falhar, atualiza a música para o status 'failed' para interromper futuras tentativas.
        const updatedMusic = await this.supabase.updateMusic(music.id, { status: 'failed', error: error.message || 'Falha ao buscar atualização.' });
        if (updatedMusic) {
            this.userMusic.update(musics => musics.map(m => m.id === music.id ? updatedMusic : m));
        }
    }
  }

  selectMusic(music: Music): void {
    if (music.status === 'succeeded' && music.audio_url) {
      this.playerService.selectMusicAndPlaylist(music, this.playlist());
    }
  }
  
  toggleStyleExpansion(style: string): void {
    this.expandedStyles.update(currentSet => {
      const newSet = new Set(currentSet);
      if (newSet.has(style)) {
        newSet.delete(style);
      } else {
        newSet.add(style);
      }
      return newSet;
    });
  }
  
  toggleLyrics(musicId: string): void {
    this.expandedLyricsId.update(currentId => currentId === musicId ? null : musicId);
  }

  formatLyrics(lyrics: string | undefined): string {
    if (!lyrics) return '';
    return lyrics.replace(/\n/g, '<br>');
  }

  async toggleVisibility(music: Music): Promise<void> {
    this.isTogglingVisibility.set(music.id);
    this.visibilityError.set(null);
    const newVisibility = !music.is_public;
    try {
      await this.murekaService.updateMusicVisibility(music, newVisibility);
    } catch (error: any) {
      this.visibilityError.set(error.message || 'Falha ao atualizar visibilidade.');
      // Revert optimistic update on failure by re-fetching
      const user = this.supabase.currentUser();
      if(user) {
        this.murekaService.userMusic.set(await this.supabase.getMusicForUser(user.id));
      }
    } finally {
      this.isTogglingVisibility.set(null);
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

  openExtendModal(music: Music): void {
    this.musicToExtend.set(music);
    this.extendDuration.set(30);
    this.extendError.set(null);
  }

  closeExtendModal(): void {
    this.musicToExtend.set(null);
  }

  async handleExtendMusic(): Promise<void> {
    if (!this.canExtendMusic()) return;
    
    this.isExtending.set(true);
    this.extendError.set(null);
    const music = this.musicToExtend();

    try {
        if (!music) throw new Error("Música não selecionada.");
        await this.murekaService.extendMusic(music.id, this.extendDuration());
        
        const currentCredits = this.supabase.currentUserProfile()!.credits;
        await this.supabase.updateUserCredits(this.supabase.currentUser()!.id, currentCredits - 1);

        this.closeExtendModal();

    } catch (error: any) {
        this.extendError.set(error.message || 'Falha ao estender a música.');
    } finally {
        this.isExtending.set(false);
    }
  }
}
