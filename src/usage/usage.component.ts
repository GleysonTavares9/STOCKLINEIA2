import { Component, ChangeDetectionStrategy, inject, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { SupabaseService } from '../services/supabase.service';
import { MurekaService } from '../services/mureka.service';

@Component({
  selector: 'app-usage',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './usage.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UsageComponent {
  private readonly supabase = inject(SupabaseService);
  private readonly murekaService = inject(MurekaService);

  currentUser = this.supabase.currentUser;
  currentUserProfile = this.supabase.currentUserProfile;
  userMusic = this.murekaService.userMusic;

  accountCreationDate = computed(() => {
    const createdAt = this.currentUser()?.created_at;
    if (!createdAt) return 'Não disponível';
    return new Date(createdAt).toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: 'long',
      year: 'numeric'
    });
  });
}