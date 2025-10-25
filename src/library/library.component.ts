import { Component, ChangeDetectionStrategy, inject, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MurekaService } from '../create/mureka.service';
import { SupabaseService } from '../services/supabase.service';
import { Router } from '@angular/router';

@Component({
  selector: 'app-library',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './library.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LibraryComponent {
  private readonly murekaService = inject(MurekaService);
  private readonly supabaseService = inject(SupabaseService);
  private readonly router = inject(Router);
  
  history = this.murekaService.userMusic;
  currentUser = this.supabaseService.currentUser;

  constructor() {
    effect(() => {
      // If user logs out, redirect to auth page.
      if (!this.currentUser()) {
        this.router.navigate(['/auth']);
      }
    });
  }
}