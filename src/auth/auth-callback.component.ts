import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { SupabaseService } from '../services/supabase.service';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

@Component({
  selector: 'app-auth-callback',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="fixed inset-0 flex items-center justify-center bg-black">
      <svg class="animate-spin h-12 w-12 text-teal-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
      </svg>
    </div>
  `,
})
export class AuthCallbackComponent implements OnInit {
  private readonly supabaseService = inject(SupabaseService);
  private readonly router = inject(Router);

  constructor() {
    console.log('AuthCallbackComponent: Componente de callback de autenticação carregado.');
  }

  ngOnInit(): void {
    // We observe authReady and currentUser to ensure the Supabase client
    // has processed the OAuth callback and updated the auth state.
    // The effect in AppComponent will then handle the final redirection,
    // but this component ensures we wait for auth to be truly ready.
    this.supabaseService.authReady.pipe(takeUntilDestroyed()).subscribe(async ready => {
      if (ready) {
        // Give a very small delay to ensure all auth state is propagated.
        // This can prevent race conditions where currentUser might not be set immediately.
        await new Promise(resolve => setTimeout(resolve, 50)); 
        const user = this.supabaseService.currentUser();
        if (user) {
          console.log('AuthCallbackComponent: Usuário autenticado, redirecionando para /feed.');
          this.router.navigate(['/feed'], { replaceUrl: true });
        } else {
          console.log('AuthCallbackComponent: Autenticação falhou ou usuário não logado, redirecionando para /.');
          this.router.navigate(['/'], { replaceUrl: true });
        }
      }
    });
  }
}