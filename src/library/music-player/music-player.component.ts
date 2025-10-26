import { Component, ChangeDetectionStrategy, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Music } from '../../services/supabase.service';

@Component({
  selector: 'app-music-player',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './music-player.component.html',
  styleUrls: ['./music-player.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MusicPlayerComponent {
  music = input.required<Music>();
  close = output<void>();

  closePlayer(): void {
    this.close.emit();
  }

  // Prevent click propagation from the modal content to the backdrop
  onContentClick(event: MouseEvent): void {
    event.stopPropagation();
  }

  async downloadMusic(): Promise<void> {
    if (!this.music().audio_url) return;
    try {
      // Using a proxy or server-side fetch might be needed if CORS is an issue.
      // For now, we attempt a direct download.
      const response = await fetch(this.music().audio_url);
      if (!response.ok) {
        throw new Error(`Network response was not ok, status: ${response.status}`);
      }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = url;
      a.download = `${this.music().title.replace(/[^a-zA-Z0-9 ]/g, '') || 'mureka-song'}.mp3`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      a.remove();
    } catch (error) {
      console.error('Download failed:', error);
      // Fallback for when direct fetch fails (e.g., CORS)
      alert('O download direto falhou. Tentando abrir em uma nova aba. Por favor, salve a partir daí.');
      window.open(this.music().audio_url, '_blank');
    }
  }

  async shareMusic(): Promise<void> {
    const shareData = {
      title: `Mureka AI Music: ${this.music().title}`,
      text: `Ouça "${this.music().title}", uma música que criei com Mureka AI!`,
      url: window.location.origin, // Shares the main app URL
    };
    try {
      if (navigator.share) {
        await navigator.share(shareData);
      } else {
        // Fallback for browsers that don't support Web Share API
        await navigator.clipboard.writeText(`${shareData.text} Crie a sua: ${shareData.url}`);
        alert('Link da música copiado para a área de transferência!');
      }
    } catch (error) {
      console.error('Sharing failed:', error);
      alert('Falha ao compartilhar.');
    }
  }
}
