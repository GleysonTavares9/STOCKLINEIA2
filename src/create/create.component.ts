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
  // Fix: Explicitly type the injected services to resolve 'Property does not exist on type unknown' errors.
  private readonly geminiService: GeminiService = inject(GeminiService);
  private readonly murekaService: MurekaService = inject(MurekaService);
  private readonly supabaseService: SupabaseService = inject(SupabaseService);
  // Fix: Explicitly type the injected Router to resolve type inference issues.
  private readonly router: Router = inject(Router);

  // Fix: Access currentUser from the explicitly typed supabaseService.
  readonly currentUser = this.supabaseService.currentUser;
  // Fix: Access currentUserProfile from the explicitly typed supabaseService.
  readonly currentUserProfile = this.supabaseService.currentUserProfile;

  // Config signals
  // Fix: Access isConfigured from the explicitly typed geminiService.
  readonly isGeminiConfigured = this.geminiService.isConfigured;
  // Fix: Access isConfigured from the explicitly typed murekaService.
  readonly isMurekaConfigured = this.murekaService.isConfigured;
  // Fix: Access supabaseInitError from the explicitly typed supabaseService.
  readonly supabaseInitError = this.supabaseService.supabaseInitError; // Expose the error

  // Form signals
  songTitle = signal<string>('');
  selectedStyles = signal(new Set<string>());
  customStyle = signal<string>('');
  lyrics = signal<string>('');
  lyricsDescription = signal<string>(''); // For AI lyrics prompt
  vocalGender = signal<'male' | 'female'>('female');
  isInstrumental = signal<boolean>(false);
  isPublic = signal<boolean>(true); // New signal for public visibility

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

  // New state for audio creation
  audioCreationMode = signal<'upload' | 'youtube' | 'clone'>('upload');
  uploadedFile = signal<File | null>(null);
  youtubeUrl = signal<string>('');
  audioTitle = signal<string>('');
  isUploading = signal(false);
  uploadError = signal<string | null>(null);

  // New signals for voice cloning
  cloneLyrics = signal<string>('');
  cloneStyle = signal<string>('');

  // Lyrics character limit
  readonly lyricsCharLimit = 3000;
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
  
  canUploadAudio = computed(() => {
    return this.uploadedFile() !== null && 
           this.audioTitle().trim().length > 0 && 
           !this.isUploading() &&
           this.currentUserProfile() && this.currentUserProfile()!.credits > 0;
  });

  canProcessYouTube = computed(() => {
    const url = this.youtubeUrl().trim();
    const isYouTubeLink = url.includes('youtube.com/') || url.includes('youtu.be/');
    return isYouTubeLink && 
           this.audioTitle().trim().length > 0 && 
           !this.isUploading() &&
           this.currentUserProfile() && this.currentUserProfile()!.credits > 0;
  });

  canCloneVoice = computed(() => {
    return this.uploadedFile() !== null &&
           this.audioTitle().trim().length > 0 &&
           this.cloneLyrics().trim().length > 0 &&
           this.cloneStyle().trim().length > 0 &&
           !this.isUploading() &&
           this.currentUserProfile() && this.currentUserProfile()!.credits > 0;
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
      // The Gemini service now handles credit consumption.
      const generatedText = await this.geminiService.generateLyrics(description, this.lyricsCost());
      this.lyrics.set(generatedText);

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
      const isPublicFlag = this.isPublic();

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
        // The service now handles credit consumption.
        await this.murekaService.generateInstrumental(title, finalStyle, isPublicFlag);
      } else {
        // The service now handles credit consumption.
        await this.murekaService.generateMusic(title, `${finalStyle}, ${currentVocalGender} vocals`, currentLyrics, isPublicFlag);
      }
      
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
  
  setAudioMode(mode: 'upload' | 'youtube' | 'clone') {
    if (this.audioCreationMode() === mode) return;

    this.audioCreationMode.set(mode);
    // Reset shared state to avoid confusion between tabs
    this.uploadedFile.set(null);
    this.youtubeUrl.set('');
    this.audioTitle.set('');
    this.uploadError.set(null);
    this.cloneLyrics.set('');
    this.cloneStyle.set('');
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      this.uploadedFile.set(input.files[0]);
    } else {
      this.uploadedFile.set(null);
    }
  }

  async handleAudioUpload(): Promise<void> {
    if (!this.canUploadAudio()) return;

    this.isUploading.set(true);
    this.uploadError.set(null);

    try {
        // The service now handles credit consumption.
        await this.murekaService.uploadAudio(this.uploadedFile()!, this.audioTitle());
        
        this.audioTitle.set('');
        this.uploadedFile.set(null);
        
        this.router.navigate(['/library']);
    } catch (error: any) {
        console.error('Erro ao fazer upload do áudio:', error);
        this.uploadError.set(error.message || 'Falha ao enviar o arquivo. Tente novamente.');
    } finally {
        this.isUploading.set(false);
    }
  }
  
  async handleYouTubeProcess(): Promise<void> {
    if (!this.canProcessYouTube()) return;

    this.isUploading.set(true);
    this.uploadError.set(null);
    
    try {
        // The service now handles credit consumption.
        await this.murekaService.processYouTubeVideo(this.youtubeUrl(), this.audioTitle());

        this.audioTitle.set('');
        this.youtubeUrl.set('');

        this.router.navigate(['/library']);
    } catch (error: any) {
        console.error('Erro ao processar vídeo do YouTube:', error);
        this.uploadError.set(error.message || 'Falha ao processar o vídeo. Verifique o link e tente novamente.');
    } finally {
        this.isUploading.set(false);
    }
  }
  
  async handleVoiceClone(): Promise<void> {
    if (!this.canCloneVoice()) return;

    this.isUploading.set(true);
    this.uploadError.set(null);

    try {
        // The service now handles credit consumption.
        await this.murekaService.cloneVoice(
          this.uploadedFile()!,
          this.audioTitle(),
          this.cloneLyrics(),
          this.cloneStyle(),
          true // Default to public for now
        );
        
        // Clear form
        this.audioTitle.set('');
        this.uploadedFile.set(null);
        this.cloneLyrics.set('');
        this.cloneStyle.set('');
        
        this.router.navigate(['/library']);
    } catch (error: any) {
        console.error('Erro ao clonar voz:', error);
        this.uploadError.set(error.message || 'Falha ao clonar a voz. Tente novamente.');
    } finally {
        this.isUploading.set(false);
    }
  }
}