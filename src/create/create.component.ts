import { Component, ChangeDetectionStrategy, signal, inject, computed, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { GeminiService } from '../services/gemini.service';
import { MurekaService } from '../services/mureka.service';
import { SupabaseService, type Music } from '../services/supabase.service';
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
  private readonly geminiService: GeminiService = inject(GeminiService);
  private readonly murekaService: MurekaService = inject(MurekaService);
  private readonly supabaseService: SupabaseService = inject(SupabaseService);
  private readonly router: Router = inject(Router);

  readonly currentUser = this.supabaseService.currentUser;
  readonly currentUserProfile = this.supabaseService.currentUserProfile;
  readonly isLoadingProfile = this.supabaseService.isLoadingProfile;

  // Config signals
  readonly isGeminiConfigured = this.geminiService.isConfigured;
  readonly isMurekaConfigured = this.murekaService.isConfigured;
  readonly supabaseInitError = this.supabaseService.supabaseInitError;

  // Form signals
  songTitle = signal<string>('');
  selectedStyles = signal(new Set<string>());
  customStyle = signal<string>('');
  lyrics = signal<string>('');
  lyricsDescription = signal<string>(''); // For AI lyrics prompt
  vocalGender = signal<'male' | 'female'>('female');
  isInstrumental = signal<boolean>(false);
  isPublic = signal<boolean>(true);

  // Style options
  readonly musicStyles = [
    'Pop', 'Rock', 'Sertanejo', 'Eletrônica', 'Hip Hop', 'Funk',
    'Acústico', 'Ambiente', 'Clássico', 'MPB', 'Samba', 'Forró',
    'R&B', 'Reggae', 'Lo-Fi', 'Jazz', 'Blues', 'Gospel', 'Folk', 'Country'
  ];

  // AI Lyrics generation state
  generatingLyrics = signal(false);
  lyricsError = signal<string | null>(null);
  lyricsCost = signal(1);

  // Music generation state (unified for all creation types)
  isGeneratingMusic = signal(false);
  generationError = signal<string | null>(null);
  musicGenerationProgress = signal(0);
  musicGenerationStatusMessage = signal('Iniciando...');

  // New state for a generation happening in the background
  backgroundGeneration = signal<Music | null>(null);

  // Advanced audio creation state
  audioCreationMode = signal<'upload' | 'youtube' | 'clone'>('upload'); // Default to 'upload' for advanced section
  uploadedFile = signal<File | null>(null);
  youtubeUrl = signal<string>('');
  advancedTitle = signal<string>(''); // Title for advanced creation modes

  // Voice cloning state
  cloneLyrics = signal<string>('');
  cloneStyle = signal<string>('');

  // Character limits
  readonly lyricsCharLimit = 3000;
  lyricsCharCount = computed(() => this.lyrics().length);
  isLyricsTooLong = computed(() => this.lyricsCharCount() > this.lyricsCharLimit);

  // Computed property to check for advanced features based on user profile
  hasAdvancedFeatures = computed(() => {
    // Para simplificar, vamos assumir que qualquer usuário com ID de cliente Stripe
    // (ou seja, que já interagiu com o faturamento) tem acesso.
    // Você pode refinar isso com base em uma coluna 'plan_id' no perfil, por exemplo.
    return !!this.currentUserProfile()?.stripe_customer_id;
  });

  canGenerateLyrics = computed(() => {
    if (!this.isGeminiConfigured() || this.generatingLyrics() || !this.lyricsDescription().trim()) {
      return false;
    }
    const profile = this.currentUserProfile();
    return !!profile && profile.credits >= this.lyricsCost();
  });

  canGenerateMusic = computed(() => {
    // Disable if any generation is in progress (lyrics or music)
    if (this.generatingLyrics() || this.isGeneratingMusic()) {
      return false;
    }
    // Disable if Mureka/Supabase is not configured or user has no credits
    if (!this.isMurekaConfigured() || !this.currentUserProfile() || this.currentUserProfile()!.credits <= 0) {
      return false;
    }

    const hasStyle = this.selectedStyles().size > 0 || this.customStyle().trim().length > 0;
    const hasTitle = this.songTitle().trim().length > 0;
    if (!hasStyle || !hasTitle) return false;

    if (this.isInstrumental()) {
      return true; // Only style and title needed for instrumental
    }

    // For non-instrumental, lyrics are required (either entered or AI generated description)
    const hasLyrics = this.lyrics().trim().length > 0 && !this.isLyricsTooLong();
    const hasLyricsDesc = this.lyricsDescription().trim().length > 0; // If description is present, user expects AI to generate.

    return hasLyrics || hasLyricsDesc;
  });

  canUploadAudio = computed(() => {
    const profile = this.currentUserProfile();
    return this.uploadedFile() !== null && 
           this.advancedTitle().trim().length > 0 && 
           !this.isGeneratingMusic() &&
           !!profile && profile.credits > 0;
  });

  canProcessYouTube = computed(() => {
    const url = this.youtubeUrl().trim();
    const isYouTubeLink = url.includes('youtube.com/') || url.includes('youtu.be/');
    const profile = this.currentUserProfile();
    return isYouTubeLink && 
           this.advancedTitle().trim().length > 0 && 
           !this.isGeneratingMusic() &&
           !!profile && profile.credits > 0;
  });

  canCloneVoice = computed(() => {
    const profile = this.currentUserProfile();
    return this.uploadedFile() !== null &&
           this.advancedTitle().trim().length > 0 && 
           this.cloneLyrics().trim().length > 0 &&
           this.cloneStyle().trim().length > 0 &&
           !this.isGeneratingMusic() &&
           !!profile && profile.credits > 0;
  });

  constructor() {
    effect(() => {
      // Only show the background processing banner if we are not actively generating a song on this page.
      if (!this.isGeneratingMusic()) {
        const userMusic = this.murekaService.userMusic();
        const backgroundMusic = userMusic.find(m => m.status === 'processing');
        this.backgroundGeneration.set(backgroundMusic || null);
      } else {
        // If we are generating, don't show the banner for another song
        this.backgroundGeneration.set(null);
      }
    }, { allowSignalWrites: true });
  }

  toggleStyle(style: string): void {
    this.selectedStyles.update(currentStyles => {
      const newStyles = new Set(currentStyles);
      newStyles.has(style) ? newStyles.delete(style) : newStyles.add(style);
      return newStyles;
    });
  }

  async generateLyrics(): Promise<void> {
    if (!this.canGenerateLyrics()) return;

    this.generatingLyrics.set(true);
    this.lyricsError.set(null);

    try {
      const generatedText = await this.geminiService.generateLyrics(this.lyricsDescription().trim(), this.lyricsCost());
      this.lyrics.set(generatedText);
    } catch (error: any) {
      console.error('Erro ao gerar letras:', error);
      this.lyricsError.set(error.message || 'Falha ao gerar letras. Tente novamente.');
    } finally {
      this.generatingLyrics.set(false);
    }
  }

  private async executeGeneration(generationFn: () => Promise<Music>): Promise<void> {
    this.isGeneratingMusic.set(true);
    this.generationError.set(null);
    this.backgroundGeneration.set(null); // Hide banner if starting a new one

    try {
      const musicRecord = await generationFn();
      
      // Navigate to library and highlight the new song
      this.router.navigate(['/library'], { queryParams: { highlight: musicRecord.id } });
      
      // Clear the relevant form after successful submission
      if (this.audioCreationMode() === 'upload' || this.audioCreationMode() === 'youtube' || this.audioCreationMode() === 'clone') {
          this.resetAdvancedForm();
      } else {
          this.resetMainForm();
      }

    } catch (error: any) {
      console.error('Erro ao iniciar geração de música:', error);
      this.generationError.set(error.message || 'Falha ao iniciar a geração. Tente novamente.');
    } finally {
      this.isGeneratingMusic.set(false);
    }
  }

  startMusicGenerationWorkflow(): void {
    if (!this.canGenerateMusic()) return;
  
    this.executeGeneration(async () => {
      const stylesArray = Array.from(this.selectedStyles());
      const finalStyle = stylesArray.length > 0 ? stylesArray.join(', ') : this.customStyle().trim();
      const title = this.songTitle().trim();
  
      if (this.isInstrumental()) {
        return this.murekaService.generateInstrumental(title, finalStyle, this.isPublic());
      } else {
        const displayStyle = finalStyle;
        const vocalPrompt = `com vocais ${this.vocalGender() === 'male' ? 'masculinos' : 'femininos'} expressivos que combinam com o estilo musical`;
        const murekaPrompt = `${finalStyle}, ${vocalPrompt}`;
        return this.murekaService.generateMusic(title, displayStyle, murekaPrompt, this.lyrics().trim(), this.isPublic());
      }
    });
  }
  
  handleAudioUpload(): void {
    if (!this.canUploadAudio()) return;
    this.executeGeneration(() => 
      this.murekaService.uploadAudio(this.uploadedFile()!, this.advancedTitle())
    );
  }
  
  handleYouTubeProcess(): void {
    if (!this.canProcessYouTube()) return;
    this.executeGeneration(() => 
      this.murekaService.processYouTubeVideo(this.youtubeUrl(), this.advancedTitle(), this.isPublic())
    );
  }
  
  handleVoiceClone(): void {
    if (!this.canCloneVoice()) return;
    this.executeGeneration(() => 
      this.murekaService.cloneVoice(
        this.uploadedFile()!,
        this.advancedTitle(),
        this.cloneLyrics(),
        this.cloneStyle(),
        true // Default to public for now
      )
    );
  }

  setAudioMode(mode: 'upload' | 'youtube' | 'clone') {
    if (this.audioCreationMode() === mode) return;

    if (!this.hasAdvancedFeatures()) {
      this.generationError.set('Recursos avançados requerem um plano superior. Por favor, assine para acessá-los.');
      return; 
    }

    this.audioCreationMode.set(mode);
    this.resetAdvancedForm();
    this.generationError.set(null);
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.uploadedFile.set(input.files?.[0] || null);
  }
  
  private resetMainForm(): void {
    this.songTitle.set('');
    this.selectedStyles.set(new Set<string>());
    this.customStyle.set('');
    this.lyrics.set('');
    this.lyricsDescription.set('');
    this.vocalGender.set('female');
    this.isInstrumental.set(false);
    this.isPublic.set(true);
  }

  private resetAdvancedForm(): void {
    // Reset specific advanced form fields
    this.uploadedFile.set(null);
    this.youtubeUrl.set('');
    this.advancedTitle.set('');
    this.cloneLyrics.set('');
    this.cloneStyle.set('');
    this.generationError.set(null);
  }
}