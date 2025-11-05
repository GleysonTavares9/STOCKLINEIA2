import { Component, ChangeDetectionStrategy, inject, signal, computed, OnDestroy, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MurekaService } from '../services/mureka.service';
import { SupabaseService, type Music } from '../services/supabase.service';
import { MusicPlayerService } from '../services/music-player.service';
import { Router, ActivatedRoute } from '@angular/router';
import { Subscription } from 'rxjs';

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
  private readonly route: ActivatedRoute = inject(ActivatedRoute);
  private readonly router: Router = inject(Router);
  private queryParamsSubscription: Subscription;

  userMusic = this.murekaService.userMusic;
  deleteError = signal<string | null>(null);
  clearError = signal<string | null>(null);
  visibilityError = signal<string | null>(null);
  isDeleting = signal<string | null>(null);
  isClearing = signal(false);
  isTogglingVisibility = signal<string | null>(null);
  musicPendingDeletion = signal<string | null>(null);

  purchaseStatus = signal<'success' | 'cancelled' | 'error' | null>(null);
  purchaseStatusMessage = signal<string | null>(null);
  expandedStyles = signal(new Set<string>());
  expandedLyricsId = signal<string | null>(null);

  musicToExtend = signal<Music | null>(null);
  extendDuration = signal<number>(30);
  isExtending = signal(false);
  extendError = signal<string | null>(null);

  musicToEdit = signal<Music | null>(null);
  isEditing = signal(false);
  editError = signal<string | null>(null);
  
  searchTerm = signal<string>('');
  highlightedMusicId = signal<string | null>(null);
  
  playlist = computed(() => this.userMusic().filter(m => m.status === 'succeeded' && m.audio_url));
  hasFailedMusic = computed(() => this.userMusic().some(m => m.status === 'failed'));
  
  filteredMusic = computed(() => {
    const term = this.searchTerm().toLowerCase().trim();
    if (!term) return this.userMusic();
    return this.userMusic().filter(music => 
        music.title.toLowerCase().includes(term) ||
        music.style.toLowerCase().includes(term)
    );
  });

  groupedMusic = computed(() => {
    const music = this.filteredMusic();
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
    const profile = this.supabase.currentUserProfile();
    return !this.isExtending() && duration > 0 && duration <= 60 && !!profile && profile.credits > 0;
  });

  constructor() {
    this.handlePurchaseRedirect();
    
    this.queryParamsSubscription = this.route.queryParams.subscribe(params => {
      const highlightId = params['highlight'];
      if (highlightId) {
        // Fix: Corrected typo from `highlightMusicId` to `highlightedMusicId`.
        this.highlightedMusicId.set(highlightId);
        // Use a timeout to ensure the element is rendered before scrolling
        setTimeout(() => this.scrollToHighlightedMusic(), 100);
      }
    });
  }

  ngOnDestroy(): void {
    this.queryParamsSubscription.unsubscribe();
  }

  private scrollToHighlightedMusic(): void {
    const id = this.highlightedMusicId();
    if (!id) return;
    
    const element = document.getElementById(`music-card-${id}`);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // The highlight class is applied via signal, but we remove the signal after the animation
      setTimeout(() => {
        this.highlightedMusicId.set(null);
        // Clean the URL
        this.router.navigate([], {
          relativeTo: this.route,
          queryParams: { highlight: null },
          queryParamsHandling: 'merge',
          replaceUrl: true
        });
      }, 4000); // Animation is 2s * 2 iterations = 4s
    }
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
                this.purchaseStatusMessage.set('Compra concluída com sucesso! Seus créditos foram adicionados.');
            }
            
            this.router.navigate([], {
                relativeTo: this.route,
                queryParams: { status: null, session_id: null },
                queryParamsHandling: 'merge',
                replaceUrl: true
            });
        } else if (status === 'cancelled') {
            this.purchaseStatus.set('cancelled');
            this.purchaseStatusMessage.set('Sua compra foi cancelada. Você pode tentar novamente a qualquer momento.');
            this.router.navigate([], {
                relativeTo: this.route,
                queryParams: { status: null },
                queryParamsHandling: 'merge',
                replaceUrl: true
            });
        }
    });
  }

  selectMusic(music: Music): void {
    if (music.status === 'succeeded' && music.audio_url) {
      this.playerService.selectMusicAndPlaylist(music, this.playlist());
    }
  }
  
  toggleStyleExpansion(style: string): void {
    this.expandedStyles.update(currentSet => {
      const newSet = new Set(currentSet);
      if (newSet.has(style)) newSet.delete(style);
      else newSet.add(style);
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
    try {
      await this.murekaService.updateMusicVisibility(music, !music.is_public);
    } catch (error: any) {
      this.visibilityError.set(error.message || 'Falha ao atualizar visibilidade.');
    } finally {
      this.isTogglingVisibility.set(null);
    }
  }

  requestDelete(musicId: string): void {
    this.musicPendingDeletion.set(musicId);
  }

  cancelDelete(): void {
    this.musicPendingDeletion.set(null);
  }

  async confirmDelete(musicId: string): Promise<void> {
    this.isDeleting.set(musicId);
    this.deleteError.set(null);
    try {
      await this.murekaService.deleteMusic(musicId);
      this.musicPendingDeletion.set(null);
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
        this.closeExtendModal();
    } catch (error: any) {
        this.extendError.set(error.message || 'Falha ao estender a música.');
    } finally {
        this.isExtending.set(false);
    }
  }
  
  openEditModal(music: Music): void {
    this.musicToEdit.set(JSON.parse(JSON.stringify(music)));
    this.editError.set(null);
  }

  closeEditModal(): void {
    this.musicToEdit.set(null);
  }

  onEditInput(field: 'title' | 'description', event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.musicToEdit.update(music => {
        if (music) return { ...music, [field]: value };
        return null;
    });
  }

  async handleUpdateMusic(event: Event): Promise<void> {
      event.preventDefault();
      const music = this.musicToEdit();
      if (!music || !music.title.trim()) {
          this.editError.set('O título não pode estar vazio.');
          return;
      }

      this.isEditing.set(true);
      this.editError.set(null);

      try {
          const updatedMusic = await this.supabase.updateMusic(music.id, {
              title: music.title.trim(),
              description: music.description.trim()
          });
          this.murekaService.updateLocalMusic(updatedMusic);
          this.closeEditModal();
      } catch (error: any) {
          this.editError.set(error.message || 'Falha ao atualizar a música.');
      } finally {
          this.isEditing.set(false);
      }
  }
}
