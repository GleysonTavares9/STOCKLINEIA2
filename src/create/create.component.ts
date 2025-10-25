import { Component, ChangeDetectionStrategy, signal, inject, computed, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { GeminiService } from '../services/gemini.service';
import { MurekaService } from './mureka.service';
import { SupabaseService } from '../services/supabase.service';
import { Router, RouterLink } from '@angular/router';


@Component({
  selector: 'app-create',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './create.component.html',
  styleUrls: ['./create.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CreateComponent {
  private readonly geminiService = inject(GeminiService);
  private readonly murekaService = inject(MurekaService);
  private readonly supabaseService = inject(SupabaseService);
  private readonly router = inject(Router);

  readonly currentUser = this.supabaseService.currentUser;
  readonly currentUserProfile = this.supabaseService.currentUserProfile;

  // Form signals
  songTitle = signal<string>('');
  songStyle = signal<string>('');
  lyrics = signal<string>('');
  vocalGender = signal<'male' | 'female'>('female');
  isInstrumental = signal<boolean>(false);

  // Lyrics generation state
  lyricsDescription = signal<string>('');
  generatingLyrics = signal<boolean>(false);
  lyricsError = signal<string | null>(null);

  isGeneratingMusic = signal<boolean>(false);

  canGenerateMusic = computed(() => {
    const profile = this.currentUserProfile();
    return (
      profile != null && profile.credits > 0 &&
      this.songTitle().trim().length > 0 &&
      this.songStyle().trim().length > 0 &&
      (this.lyrics().trim().length > 0 || this.isInstrumental()) &&
      !this.isGeneratingMusic()
    );
  });

  constructor() {
    effect(() => {
      if (!this.currentUser()) {
        this.router.navigate(['/auth'], { queryParams: { message: 'Faça login para criar músicas.' } });
      }
    });
  }

  async generateLyrics(): Promise<void> {
    if (!this.lyricsDescription() || this.generatingLyrics()) {
      return;
    }

    this.generatingLyrics.set(true);
    this.lyrics.set('');
    this.lyricsError.set(null);

    try {
      const result = await this.geminiService.generateLyrics(this.lyricsDescription());
      this.lyrics.set(result);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Ocorreu um erro desconhecido. Por favor, tente novamente.';
      this.lyricsError.set(message);
      console.error(e);
    } finally {
      this.generatingLyrics.set(false);
    }
  }

  async startMusicGenerationWorkflow(): Promise<void> {
    const profile = this.currentUserProfile();
    if (!this.canGenerateMusic() || !profile) {
      return;
    }
    
    this.isGeneratingMusic.set(true);

    try {
        const newCreditCount = profile.credits - 1;
        await this.supabaseService.updateUserCredits(profile.id, newCreditCount);

        const lyricsToUse = this.isInstrumental() ? 'Instrumental' : this.lyrics();
        const fullStyle = `${this.songStyle()}, ${this.vocalGender()} vocal`;

        await this.murekaService.generateMusic(this.songTitle(), fullStyle, lyricsToUse);

        this.router.navigate(['/library']);
        
        setTimeout(() => {
          this.songTitle.set('');
          this.songStyle.set('');
          this.lyrics.set('');
          this.isInstrumental.set(false);
          this.lyricsDescription.set('');
          this.isGeneratingMusic.set(false);
        }, 500);
    } catch (error) {
        console.error("Failed to generate music or update credits", error);
        this.isGeneratingMusic.set(false);
    }
  }
}
