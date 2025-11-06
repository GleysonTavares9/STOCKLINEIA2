import { Component, ChangeDetectionStrategy, signal, inject, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { GeminiService } from '../services/gemini.service';
import { StocklineAiService } from '../services/mureka.service';
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
  private readonly stocklineAiService: StocklineAiService = inject(StocklineAiService);
  private readonly supabaseService: SupabaseService = inject(SupabaseService);
  private readonly router: Router = inject(Router);

  readonly currentUser = this.supabaseService.currentUser;
  readonly currentUserProfile = this.supabaseService.currentUserProfile;
  readonly isLoadingProfile = this.supabaseService.isLoadingProfile;

  // Config signals
  readonly isGeminiConfigured = this.geminiService.isConfigured;
  readonly isAiMusicConfigured = this.stocklineAiService.isConfigured;
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
    'Acústico', 'Ambiente', 'Axé', 'Blues', 'Bossa Nova', 'Choro', 
    'Clássico', 'Country', 'Disco', 'Eletrônica', 'Folk', 'Forró', 
    'Funk', 'Gospel', 'Hip Hop', 'Indie', 'Jazz', 'Lo-Fi', 'Metal', 
    'MPB', 'Pagode', 'Pop', 'Punk', 'R&B', 'Reggae', 'Rock', 'Samba', 
    'Sertanejo', 'Soul'
  ];

  // AI Lyrics generation state
  generatingLyrics = signal(false);
  lyricsError = signal<string | null>(null);
  lyricsCost = signal(1);

  // Music generation state (unified for all creation types)
  isGeneratingMusic = signal(false);
  generationError = signal<string | null>(null);

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
    // This is an example, you might base this on subscription tier
    const profile = this.currentUserProfile();
    if (!profile) return false;
    // For this app, let's assume having a stripe_customer_id means they are a paid user
    // with access to advanced features.
    return !!profile.stripe_customer_id;
  });
  
  // New state for a generation happening in the background, derived with computed
  backgroundGeneration = computed(() => {
    if (this.isGeneratingMusic()) {
        return null; // Don't show the banner if we are actively generating on this page
    }
    // Find if there's any other song being processed
    return this.stocklineAiService.userMusic().find(m => m.status === 'processing') || null;
  });

  canGenerateLyrics = computed(() => {
    if (!this.isGeminiConfigured() || this.generatingLyrics() || !this.lyricsDescription().trim()) {
      return false;
    }
    const profile = this.currentUserProfile();
    return !!profile && profile.credits >= this.lyricsCost();
  });

  canGenerateMusic = computed(() => {
    if (this.generatingLyrics() || this.isGeneratingMusic()) return false;
    if (!this.isAiMusicConfigured() || !this.currentUserProfile() || this.currentUserProfile()!.credits <= 0) return false;

    const hasStyle = this.selectedStyles().size > 0 || this.customStyle().trim().length > 0;
    const hasTitle = this.songTitle().trim().length > 0;
    if (!hasStyle || !hasTitle) return false;

    if (this.isInstrumental()) return true;

    const hasLyrics = this.lyrics().trim().length > 0 && !this.isLyricsTooLong();
    return hasLyrics;
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
    // Constructor is now empty as the effect was replaced by a computed signal.
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

    try {
      const musicRecord = await generationFn();
      
      this.router.navigate(['/library'], { queryParams: { highlight: musicRecord.id } });
      
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
      const currentLyrics = this.lyrics().trim();
      const currentVocalGender = this.vocalGender();
      const isPublicFlag = this.isPublic();

      if (this.isInstrumental()) {
        return this.stocklineAiService.generateInstrumental(title, finalStyle, isPublicFlag);
      } else {
        const aiPrompt = `${finalStyle}, com vocais ${currentVocalGender === 'male' ? 'masculinos' : 'femininos'}`;
        return this.stocklineAiService.generateMusic(title, finalStyle, aiPrompt, currentLyrics, isPublicFlag);
      }
    });
  }
  
  handleAudioUpload(): void {
    if (!this.canUploadAudio()) return;
    this.executeGeneration(() => 
      this.stocklineAiService.uploadAudio(this.uploadedFile()!, this.advancedTitle())
    );
  }
  
  handleYouTubeProcess(): void {
    if (!this.canProcessYouTube()) return;
    this.executeGeneration(() => 
      this.stocklineAiService.processYouTubeVideo(this.youtubeUrl(), this.advancedTitle(), this.isPublic())
    );
  }
  
  handleVoiceClone(): void {
    if (!this.canCloneVoice()) return;
    this.executeGeneration(() => 
      this.stocklineAiService.cloneVoice(
        this.uploadedFile()!,
        this.advancedTitle(),
        this.cloneLyrics(),
        this.cloneStyle(),
        true
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
    this.uploadedFile.set(null);
    this.youtubeUrl.set('');
    this.advancedTitle.set('');
    this.cloneLyrics.set('');
    this.cloneStyle.set('');
    this.generationError.set(null);
  }
}