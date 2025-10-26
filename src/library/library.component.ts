import { Component, ChangeDetectionStrategy, inject, effect, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MurekaService } from '../create/mureka.service';
import { SupabaseService } from '../services/supabase.service';
import { Router } from '@angular/router';

@Component({
  selector: 'app-library',
  standalone: true,
  imports: [CommonModule],
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

  constructor() {
    effect(() => {
      // If user logs out, redirect to auth page.
      if (!this.currentUser()) {
        this.router.navigate(['/auth']);
      }
    });
  }

  deleteMusic(musicId: string): void {
    if (confirm('Tem certeza de que deseja apagar esta música permanentemente?')) {
      this.murekaService.deleteMusic(musicId);
    }
  }

  clearFailedMusic(): void {
    if (confirm('Tem certeza de que deseja apagar TODAS as músicas com falha? Esta ação não pode ser desfeita.')) {
      this.murekaService.clearFailedMusic();
    }
  }
}