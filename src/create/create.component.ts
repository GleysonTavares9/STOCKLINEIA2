import { Component, ChangeDetectionStrategy, signal, inject, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { GeminiService } from '../services/gemini.service';
import { MurekaService } from '../services/mureka.service';
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
  readonly supabaseInitError = this.supabaseService.supabaseInitError; // Expose the error

  // Form signals
  songTitle = signal<string>('');
  selectedStyles = signal(new Set<string>());
  customStyle = signal<string>('');
  lyrics = signal<string>('');
  lyricsDescription = signal<string>(''); // For AI lyrics prompt
  vocalGender = signal<'male' | 'female'>('female');
  isInstrumental = signal<boolean>(false);

  // Style options
  readonly musicStyles = [
    'Pop', 'Rock', 'Sertanejo', 'Eletrônica', 'Hip Hop', 'Funk',
    'Acústico', 'Ambiente', 'Clássico', 'MPB', 'Samba', 'Forró',
    'R&B', 'Reggae', 'Lo-Fi', 'Jazz', 'Blues', 'Gospel', 'Folk', 'Country'
  ];

  // AI Lyrics generation state
  generatingLyrics = signal(false);
  lyricsError = signal<string | null>(null);
  lyricsCost = signal(1); // Cost for generating lyrics with AI

  // Music generation state
  isGeneratingMusic = signal(false);
  generationError = signal<string | null>(null);

  // Lyrics character limit
  readonly lyricsCharLimit = 1000;
  lyricsCharCount = computed(() => this.lyrics().length);
  isLyricsTooLong = computed(() => this.lyricsCharCount() > this.lyricsCharLimit);

  // Computed signal to enable/disable the "Gerar Letra com IA" button
  canGenerateLyrics = computed(() => {
    // If Gemini is not configured, disable
    if (!this.isGeminiConfigured()) {
      return false;
    }
    // If no user profile or insufficient credits, disable
    if (!this.currentUserProfile() || this.currentUserProfile()!.credits < this.lyricsCost()) {
      return false;
    }
    // If currently generating lyrics, disable
    if (this.generatingLyrics()) {
      return false;
    }
    // If lyrics description is empty, disable
    if (!this.lyricsDescription().trim()) {
      return false;
    }
    return true;
  });

  // Computed signal to enable/disable the "Criar" button
  canGenerateMusic = computed(() => {
    // If Supabase/Mureka is not configured, disable
    if (!this.isMurekaConfigured() || !this.currentUserProfile()) {
      return false;
    }
    // If there are no credits, disable
    if (this.currentUserProfile()!.credits <= 0) {
      return false;
    }
    // If generating lyrics or music, disable
    if (this.generatingLyrics() || this.isGeneratingMusic()) {
      return false;
    }
    // If instrumental, only require style and title
    if (this.isInstrumental()) {
      const hasStyle = this.selectedStyles().size > 0 || this.customStyle().trim().length > 0;
      return hasStyle && this.songTitle().trim().length > 0;
    }
    // If with vocals, require lyrics or description, style, and title
    const hasLyrics = this.lyrics().trim().length > 0 && !this.isLyricsTooLong();
    const hasLyricsDesc = this.lyricsDescription().trim().length > 0;
    const hasStyle = this.selectedStyles().size > 0 || this.customStyle().trim().length > 0;
    const hasTitle = this.songTitle().trim().length > 0;

    return (hasLyrics || hasLyricsDesc) && hasStyle && hasTitle;
  });

  constructor() {
    // Redirection logic is handled globally by AppComponent.
  }

  toggleStyle(style: string): void {
    this.selectedStyles.update(currentStyles => {
      const newStyles = new Set(currentStyles);
      if (newStyles.has(style)) {
        newStyles.delete(style);
      } else {
        newStyles.add(style);
      }
      return newStyles;
    });
  }

  async generateLyrics(): Promise<void> {
    const description = this.lyricsDescription().trim();
    if (!this.canGenerateLyrics()) { // Use the new computed signal
      let errorMessage = 'Você não pode gerar letras no momento.';
      if (!this.isGeminiConfigured()) {
        errorMessage = 'O serviço Gemini não está configurado. Verifique a configuração da IA.';
      } else if (!this.currentUserProfile() || this.currentUserProfile()!.credits < this.lyricsCost()) {
        errorMessage = `Créditos insuficientes para gerar letras. Custa ${this.lyricsCost()} crédito.`;
      } else if (this.generatingLyrics()) {
        errorMessage = 'A geração de letras já está em andamento.';
      } else if (!description) {
        errorMessage = 'Por favor, descreva a ideia para gerar a letra.';
      }
      this.lyricsError.set(errorMessage);
      return;
    }

    this.generatingLyrics.set(true);
    this.lyricsError.set(null);

    try {
      const generatedText = await this.geminiService.generateLyrics(description);
      this.lyrics.set(generatedText);

      // Decrement credits only after successful generation
      const currentCredits = this.currentUserProfile()!.credits;
      await this.supabaseService.updateUserCredits(this.currentUser()!.id, currentCredits - this.lyricsCost());

    } catch (error: any) {
      console.error('Erro ao gerar letras:', error);
      this.lyricsError.set(error.message || 'Falha ao gerar letras. Tente novamente.');
    } finally {
      this.generatingLyrics.set(false);
    }
  }

  async startMusicGenerationWorkflow(): Promise<void> {
    if (!this.canGenerateMusic() || this.isGeneratingMusic()) {
      return;
    }

    this.isGeneratingMusic.set(true);
    this.generationError.set(null);

    try {
      // Construct the style string
      const stylesArray = Array.from(this.selectedStyles());
      const finalStyle = stylesArray.length > 0 ? stylesArray.join(', ') : this.customStyle().trim();

      const title = this.songTitle().trim();
      const currentLyrics = this.lyrics().trim();
      const currentVocalGender = this.vocalGender();
      const isInstrumentalMode = this.isInstrumental();

      if (!finalStyle) {
        throw new Error('Por favor, selecione ou descreva um estilo para a música.');
      }
      if (!title) {
        throw new Error('Por favor, digite um título para a música.');
      }
      if (!isInstrumentalMode && !currentLyrics) {
        throw new Error('Por favor, insira a letra da música ou gere com IA.');
      }

      if (isInstrumentalMode) {
        await this.murekaService.generateInstrumental(title, finalStyle);
      } else {
        await this.murekaService.generateMusic(title, `${finalStyle}, ${currentVocalGender} vocals`, currentLyrics);
      }

      // Decrement credits
      const currentCredits = this.currentUserProfile()!.credits;
      await this.supabaseService.updateUserCredits(this.currentUser()!.id, currentCredits - 1); // Assuming 1 credit for music generation

      // Clear form after successful generation request
      this.songTitle.set('');
      this.selectedStyles.set(new Set<string>());
      this.customStyle.set('');
      this.lyrics.set('');
      this.lyricsDescription.set('');
      this.isInstrumental.set(false);
      
      this.router.navigate(['/library']); // Redirect to library to see processing song

    } catch (error: any) {
      console.error('Erro ao iniciar geração de música:', error);
      this.generationError.set(error.message || 'Falha ao gerar a música. Tente novamente.');
    } finally {
      this.isGeneratingMusic.set(false);
    }
  }
}