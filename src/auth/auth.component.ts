import { Component, ChangeDetectionStrategy, signal, inject, effect, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, ActivatedRoute } from '@angular/router';
import { SupabaseService } from '../services/supabase.service';

@Component({
  selector: 'app-auth',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './auth.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AuthComponent {
  private readonly supabase = inject(SupabaseService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  
  readonly isSupabaseConfigured = this.supabase.isConfigured;

  authMode = signal<'signIn' | 'signUp'>('signIn');
  email = signal('');
  password = signal('');
  confirmPassword = signal('');
  loading = signal(false);
  errorMessage = signal<string | null>(null);
  infoMessage = signal<string | null>(null);

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
      return this.passwordsMatch() && !!this.confirmPassword();
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

  toggleMode(): void {
    this.authMode.update(mode => (mode === 'signIn' ? 'signUp' : 'signIn'));
    this.errorMessage.set(null);
    this.infoMessage.set(null);
    this.email.set('');
    this.password.set('');
    this.confirmPassword.set('');
  }

  async handleGoogleSignIn(): Promise<void> {
    this.loading.set(true);
    this.errorMessage.set(null);
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

    try {
      const { user, error } = this.authMode() === 'signIn'
        ? await this.supabase.signInWithEmail(this.email(), this.password())
        : await this.supabase.signUp(this.email(), this.password());
      
      if (error) {
        this.errorMessage.set(this.translateAuthError(error.message));
      } else if (user) {
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

  private translateAuthError(message: string): string {
    if (message.includes('Supabase client not initialized')) {
        return 'A configuração do Supabase está ausente. Verifique o arquivo `src/config.ts`.';
    }
    if (message.includes('Invalid login credentials')) {
        return 'E-mail ou senha inválidos.';
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
    return 'Ocorreu um erro durante a autenticação. Verifique suas credenciais.';
  }
}
