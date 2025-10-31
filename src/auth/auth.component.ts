import { Component, ChangeDetectionStrategy, signal, inject, effect, computed, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, ActivatedRoute } from '@angular/router';
import { SupabaseService, Music } from '../services/supabase.service';
import { MusicPlayerService } from '../services/music-player.service';

@Component({
  selector: 'app-auth',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './auth.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AuthComponent implements OnInit {
  private readonly supabase = inject(SupabaseService);
  private readonly playerService = inject(MusicPlayerService);
  // Fix: Explicitly type the injected Router and ActivatedRoute to resolve type inference issues.
  private readonly router: Router = inject(Router);
  private readonly route: ActivatedRoute = inject(ActivatedRoute);
  
  readonly isSupabaseConfigured = this.supabase.isConfigured;

  authMode = signal<'signIn' | 'signUp'>('signIn');
  fullName = signal('');
  email = signal('');
  password = signal('');
  confirmPassword = signal('');
  loading = signal(false);
  errorMessage = signal<string | null>(null);
  infoMessage = signal<string | null>(null);
  isInvalidCredentialsError = signal(false);

  publicMusic = signal<Music[]>([]);

  playlist = computed(() => this.publicMusic().filter(m => m.status === 'succeeded' && m.audio_url));

  passwordsMatch = computed(() => {
    if (this.authMode() === 'signUp') {
      return this.password() === this.confirmPassword();
    }
    return true;
  });

  canSubmit = computed(() => {
    if (this.loading()) return false;
    if (!this.email()) return false;
    if (!this.password()) return false;

    if (this.authMode() === 'signUp') {
      return this.passwordsMatch() && !!this.confirmPassword() && !!this.fullName();
    }
    return true;
  });


  constructor() {
    // Redirection logic is now handled globally in AppComponent to prevent race conditions.
    // This component no longer needs to manage redirection.

    // Display message from query params (e.g., after redirect)
    this.route.queryParams.subscribe(params => {
        if (params['message']) {
            this.infoMessage.set(params['message']);
        }
    });
  }

  ngOnInit(): void {
    this.supabase.getAllPublicMusic().then(songs => {
      this.publicMusic.set(songs.slice(0, 4)); // Show the 4 most recent public songs
    });
  }

  selectMusic(music: Music): void {
    if (music.status === 'succeeded' && music.audio_url) {
      this.playerService.selectMusicAndPlaylist(music, this.playlist());
    }
  }

  scrollToSignUp(): void {
    const el = document.getElementById('auth-form-container');
    if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        this.authMode.set('signUp');
    }
  }

  toggleMode(): void {
    this.authMode.update(mode => (mode === 'signIn' ? 'signUp' : 'signIn'));
    this.errorMessage.set(null);
    this.infoMessage.set(null);
    this.isInvalidCredentialsError.set(false);
    this.fullName.set('');
    this.email.set('');
    this.password.set('');
    this.confirmPassword.set('');
  }

  async handleGoogleSignIn(): Promise<void> {
    this.loading.set(true);
    this.errorMessage.set(null);
    this.isInvalidCredentialsError.set(false);
    const { error } = await this.supabase.signInWithGoogle();
    if (error) {
      this.errorMessage.set(this.translateAuthError(error.message));
    }
    // On success, Supabase handles the redirect. On failure, stop loading.
    this.loading.set(false);
  }

  async handleAuth(event: Event): Promise<void> {
    event.preventDefault();
    if (this.authMode() === 'signUp' && !this.passwordsMatch()) {
        this.errorMessage.set('As senhas não coincidem.');
        return;
    }

    this.loading.set(true);
    this.errorMessage.set(null);
    this.infoMessage.set(null);
    this.isInvalidCredentialsError.set(false);

    try {
      const { user, error } = this.authMode() === 'signIn'
        ? await this.supabase.signInWithEmail(this.email(), this.password())
        : await this.supabase.signUp(this.email(), this.password(), this.fullName());
      
      if (error) {
        this.errorMessage.set(this.translateAuthError(error.message));
        this.isInvalidCredentialsError.set(error.message.includes('Invalid login credentials'));
      } else if (user) {
        this.isInvalidCredentialsError.set(false);
        if (this.authMode() === 'signUp') {
            this.infoMessage.set('Cadastro realizado! Por favor, verifique seu e-mail para confirmar sua conta.');
            this.authMode.set('signIn'); // Switch to sign in view
            this.password.set('');
            this.confirmPassword.set('');
        } else {
            // Successful sign in, the global effect in AppComponent will redirect.
        }
      }
    } catch (e) {
      this.errorMessage.set('Ocorreu um erro inesperado.');
    } finally {
      this.loading.set(false);
    }
  }

  async resendConfirmation(): Promise<void> {
    const emailToResend = this.email();
    if (!emailToResend) {
        this.errorMessage.set('Por favor, insira seu e-mail no campo acima para reenviar a confirmação.');
        this.isInvalidCredentialsError.set(false);
        return;
    }
    this.loading.set(true);
    this.errorMessage.set(null);
    this.infoMessage.set(null);
    this.isInvalidCredentialsError.set(false);

    const { error } = await this.supabase.resendConfirmationEmail(emailToResend);

    if (error) {
        console.error('Error resending confirmation:', error.message);
    }
    
    // Always show a generic message to prevent leaking information.
    this.infoMessage.set('Se uma conta para este e-mail existir e precisar de confirmação, um novo link foi enviado.');
    this.loading.set(false);
  }

  async forgotPassword(): Promise<void> {
      const emailToReset = this.email();
      if (!emailToReset) {
          this.errorMessage.set('Por favor, insira seu e-mail no campo acima para redefinir a senha.');
          this.isInvalidCredentialsError.set(false);
          return;
      }
      this.loading.set(true);
      this.errorMessage.set(null);
      this.infoMessage.set(null);
      this.isInvalidCredentialsError.set(false);

      const { error } = await this.supabase.sendPasswordResetEmail(emailToReset);
      
      if (error) {
          console.error('Error sending password reset:', error.message);
      }
      
      // Always show a generic message to prevent leaking information about which emails are registered.
      this.infoMessage.set('Se existir uma conta para este e-mail, um link para redefinir a senha foi enviado.');
      this.loading.set(false);
  }

  private translateAuthError(message: string): string {
    if (message.includes('Supabase client not initialized')) {
        return 'A configuração do Supabase está ausente. Verifique o arquivo `src/config.ts`.';
    }
    if (message.includes('Invalid login credentials')) {
        return 'E-mail ou senha inválidos. Se você se cadastrou recentemente, pode ser necessário confirmar seu e-mail primeiro.';
    }
    if (message.includes('User already registered')) {
        return 'Este e-mail já está cadastrado. Tente fazer login.';
    }
    if (message.includes('Password should be at least 6 characters')) {
        return 'A senha deve ter no mínimo 6 caracteres.';
    }
    if (message.includes('Unable to validate email address')) {
        return 'Formato de e-mail inválido.';
    }
    if (message.includes('Display name cannot be empty')) {
        return 'O nome completo não pode estar vazio.';
    }
    return 'Ocorreu um erro durante a autenticação. Verifique suas credenciais.';
  }
}