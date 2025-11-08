import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

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
export class AuthCallbackComponent {
  // This component provides a loading screen while Supabase processes the OAuth callback.
  // The `onAuthStateChange` listener in `SupabaseService` will detect the new session,
  // and the global `effect` in `AppComponent` will handle redirecting the user to the correct page.
  constructor() {
    console.log('AuthCallbackComponent: Componente de callback de autenticação carregado.');
  }
}