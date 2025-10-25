import { Injectable, signal, inject, effect, untracked } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../config';
import { SupabaseService, Song } from '../services/supabase.service';

interface MurekaGenerateResponse {
  id: string;
  //... other properties
}

interface MurekaQueryResponse {
  status: 'preparing' | 'queued' | 'running' | 'streaming' | 'succeeded' | 'failed' | 'timeouted' | 'cancelled';
  failed_reason?: string;
  choices?: any[]; 
}

@Injectable({
  providedIn: 'root',
})
export class MurekaService {
  private readonly http = inject(HttpClient);
  private readonly supabase = inject(SupabaseService);
  private readonly MUREKA_API_BASE_URL = 'https://api.mureka.ai/v1';
  private readonly apiKey: string | undefined;

  userSongs = signal<Song[]>([]);

  constructor() {
    this.apiKey = process.env.MUREKA_API_KEY || environment.murekaApiKey;

    if (!this.apiKey) {
      console.error('Chave da API da Mureka não encontrada. Configure MUREKA_API_KEY no ambiente ou em src/config.ts.');
    }

    // Load user songs when auth state changes
    effect(() => {
      const user = this.supabase.currentUser();
      if (user) {
        untracked(async () => {
          const songs = await this.supabase.getSongsForUser(user.id);
          this.userSongs.set(songs);
        });
      } else {
        this.userSongs.set([]);
      }
    });
  }

  private getApiErrorMessage(error: any, defaultMessage: string): string {
    if (error?.error?.detail) return `Erro da API: ${error.error.detail}`;
    if (error?.error?.message) return `Erro da API: ${error.error.message}`;
    if (typeof error?.error === 'string' && error.error.length > 0) return `Erro da API: ${error.error}`;
    if (error?.message) return `Erro de comunicação: ${error.message}`;
    return defaultMessage;
  }

  async generateMusic(title: string, style: string, lyrics: string): Promise<void> {
    const user = this.supabase.currentUser();
    if (!user) {
      console.error("Usuário não autenticado. Impossível gerar música.");
      return;
    }

    if (!this.apiKey) {
      const errorMsg = 'O serviço Mureka não foi inicializado. Verifique a chave da API (MUREKA_API_KEY).';
      console.error(errorMsg);
      const newSong = await this.supabase.addSong({ title, style, lyrics, status: 'failed', error: errorMsg });
      if(newSong) this.userSongs.update(current => [newSong, ...current]);
      return;
    }

    // Add to DB first with 'processing' state
    let newSong = await this.supabase.addSong({ title, style, lyrics, status: 'processing' });
    if (!newSong) {
      console.error("Falha ao criar registro da música no banco de dados.");
      return; // Early exit if DB operation fails
    }
    
    this.userSongs.update(current => [newSong!, ...current]);
    const dbSongId = newSong.id;

    try {
      const headers = new HttpHeaders({
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      });
      
      const body = { title, lyrics, style };

      const response = await firstValueFrom(
        this.http.post<MurekaGenerateResponse>(`${this.MUREKA_API_BASE_URL}/song/generate`, body, { headers })
      );

      const taskId = response.id;
      await this.supabase.updateSong(dbSongId, { mureka_id: taskId });
      
      this.pollForStatus(dbSongId, taskId);

    } catch (error) {
      console.error('Failed to start music generation:', error);
      const errorMessage = this.getApiErrorMessage(error, 'Falha ao iniciar a geração da música na API Mureka.');
      const updatedSong = await this.supabase.updateSong(dbSongId, { status: 'failed', error: errorMessage });
      if(updatedSong) this.updateLocalSong(updatedSong);
    }
  }

  private findUrlInResponse(data: any): string | null {
     if (!data || typeof data !== 'object') return null;
      if (Array.isArray(data.choices) && data.choices.length > 0) {
        const choice = data.choices[0];
        if (choice?.audio?.url) {
            return choice.audio.url;
        }
      }
      return null;
  }

  private updateLocalSong(updatedSong: Song): void {
    this.userSongs.update(current => 
        current.map(item => item.id === updatedSong.id ? { ...item, ...updatedSong } : item)
    );
  }

  private async pollForStatus(dbSongId: string, taskId: string, attempts = 0): Promise<void> {
    const MAX_POLL_ATTEMPTS = 48; // Timeout after 48 * 5s = 4 minutes
    if (attempts >= MAX_POLL_ATTEMPTS) {
       const updatedSong = await this.supabase.updateSong(dbSongId, { 
          status: 'failed', 
          error: 'O processo demorou mais que o esperado e foi interrompido.' 
        });
       if (updatedSong) this.updateLocalSong(updatedSong);
      return;
    }
    
    setTimeout(async () => {
      if (!this.apiKey) {
        const updatedSong = await this.supabase.updateSong(dbSongId, { 
            status: 'failed', 
            error: 'A chave da API não pôde ser lida durante a verificação.' 
        });
        if (updatedSong) this.updateLocalSong(updatedSong);
        return;
      }

      try {
        const headers = new HttpHeaders({ 'Authorization': `Bearer ${this.apiKey}` });
        const res = await firstValueFrom(
          this.http.get<MurekaQueryResponse>(`${this.MUREKA_API_BASE_URL}/song/query/${taskId}`, { headers })
        );
        
        console.log(`Mureka poll response for task ${taskId}:`, res);

        const audioUrl = this.findUrlInResponse(res);
        const apiStatus = res?.status;

        if (audioUrl) {
            const updatedSong = await this.supabase.updateSong(dbSongId, { status: 'succeeded', audio_url: audioUrl });
            if (updatedSong) this.updateLocalSong(updatedSong);
            return; // Stop polling
        }
  
        if (apiStatus === 'succeeded' && !audioUrl) {
            const updatedSong = await this.supabase.updateSong(dbSongId, {
                status: 'failed',
                error: 'Música gerada, mas o link do áudio não foi encontrado na resposta.'
            });
            if (updatedSong) this.updateLocalSong(updatedSong);
            return;
        }
  
        if (['failed', 'timeouted', 'cancelled'].includes(apiStatus)) {
            const errorReason = res.failed_reason || `Falha com o status: ${apiStatus}.`;
            const updatedSong = await this.supabase.updateSong(dbSongId, {
                status: 'failed',
                error: errorReason
            });
            if (updatedSong) this.updateLocalSong(updatedSong);
            return;
        }

        // Still processing, poll again.
        this.pollForStatus(dbSongId, taskId, attempts + 1);

      } catch (error) {
        console.error(`Error polling for task ${taskId}:`, error);
        const errorMessage = this.getApiErrorMessage(error, 'Erro de comunicação ao verificar o status.');
        const updatedSong = await this.supabase.updateSong(dbSongId, { 
            status: 'failed', 
            error: errorMessage
        });
        if (updatedSong) this.updateLocalSong(updatedSong);
      }
    }, 5000); // Poll every 5 seconds
  }
}