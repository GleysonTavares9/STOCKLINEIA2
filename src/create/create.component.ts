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

  // Config signals
  readonly isGeminiConfigured = this.geminiService.isConfigured;
  readonly isMurekaConfigured = this.murekaService.isConfigured;

  // Form signals
  songTitle = signal<string>('');
  selectedStyles = signal(new Set<string>());
  lyrics = signal<string>('');
  vocalGender = signal<'male' | 'female'>('female');
  isInstrumental = signal<boolean>(false);

  // Style options
  readonly musicStyles = ['Pop', 'Rock', 'Sertanejo', 'Eletrônica', 'Hip Hop', 'Funk', 'Acústico', 'Ambiente', 'Clássico', 'MPB', 'Samba', 'Forró', 'R&B', 'Reggae', 'Lo-fi'];

  // Lyrics generation state
  lyricsDescription = signal<string>('');
  generatingLyrics = signal<boolean>(false);
  lyricsError = signal<string | null>(null);

  isGeneratingMusic = signal<boolean>(false);

  canGenerateMusic = computed(() => {
    const profile = this.currentUserProfile();
    return (
      this.isMurekaConfigured() &&
      profile != null && profile.credits > 0 &&
      this.songTitle().trim().length > 0 &&
      this.selectedStyles().size > 0 &&
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

  toggleStyle(style: string): void {
    this.selectedStyles.update(styles => {
      if (styles.has(style)) {
        styles.delete(style);
      } else {
        styles.add(style);
      }
      return new Set(styles);
    });
  }

  async generateLyrics(): Promise<void> {
    if (!this.lyricsDescription() || this.generatingLyrics() || !this.isGeminiConfigured()) {
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

        const styleParts = Array.from(this.selectedStyles());
        let lyricsToUse = this.lyrics();

        if (this.isInstrumental()) {
          lyricsToUse = ''; // Instrumental tracks should have empty lyrics
          styleParts.push('Instrumental'); // Add 'Instrumental' as a style tag
        } else {
          styleParts.push(`${this.vocalGender()} vocal`);
        }
        const fullStyle = styleParts.join(', ');

        await this.murekaService.generateMusic(this.songTitle(), fullStyle, lyricsToUse);

        this.router.navigate(['/library']);
        
        setTimeout(() => {
          this.songTitle.set('');
          this.selectedStyles.set(new Set());
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
