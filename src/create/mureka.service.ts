import { Injectable, signal, inject, effect, untracked } from '@angular/core';
import { HttpClient, HttpHeaders, HttpErrorResponse } from '@angular/common/http';
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
  choices?: { audio_url: string }[];
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
    // This is checking for Angular's specific error object for HTTP requests
    if (error instanceof HttpErrorResponse) {
      // Status 0 usually means a network error (CORS, DNS, offline, etc.)
      if (error.status === 0) {
        return 'Falha de rede ao contatar a API Mureka. Isso pode ser um problema de CORS ou de conectividade.';
      }
      
      const apiError = error.error;
      if (typeof apiError === 'string' && apiError.length > 0) return `Erro da API (${error.status}): ${apiError}`;
      if (apiError?.detail) return `Erro da API (${error.status}): ${apiError.detail}`;
      if (apiError?.message) return `Erro da API (${error.status}): ${apiError.message}`;
      
      // Fallback for other HTTP errors
      return `Erro na requisição: ${error.status} - ${error.statusText}`;
    }

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

    let songRecord: Song | null = null;
    try {
      // 1. Create a record in our DB to track the job
      songRecord = await this.supabase.addSong({
        title,
        style,
        lyrics,
        status: 'processing',
      });

      if (!songRecord) {
        throw new Error('Falha ao criar o registro da música no banco de dados.');
      }

      // 2. Immediately update the local state to show the user it's processing
      const finalSongRecord = songRecord;
      this.userSongs.update(current => [finalSongRecord, ...current]);

      // 3. Make the API call to Mureka
      const headers = new HttpHeaders({
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      });

      const body = {
        title,
        tags: style,
        lyrics,
        model_version: 'v2'
      };

      const generateResponse = await firstValueFrom(
        this.http.post<MurekaGenerateResponse>(`${this.MUREKA_API_BASE_URL}/generate/music`, body, { headers })
      );

      const taskId = generateResponse.id;

      // 4. Update our song record with the Mureka task ID
      await this.supabase.updateSong(finalSongRecord.id, { mureka_id: taskId });
      
      // 5. Start polling for the result in the background.
      this.pollForResult(finalSongRecord.id, taskId);

    } catch (error) {
      console.error('Erro ao iniciar a geração da música:', error);
      const errorMessage = this.getApiErrorMessage(error, 'Ocorreu um erro desconhecido ao iniciar a geração.');

      if (songRecord) {
        const updatedSong = await this.supabase.updateSong(songRecord.id, { status: 'failed', error: errorMessage });
        if (updatedSong) {
            this.userSongs.update(songs => songs.map(s => s.id === updatedSong.id ? updatedSong : s));
        }
      } else {
         const newFailedSong = await this.supabase.addSong({ title, style, lyrics, status: 'failed', error: errorMessage });
         if (newFailedSong) {
            this.userSongs.update(current => [newFailedSong, ...current]);
         }
      }
    }
  }

  private async pollForResult(songId: string, taskId: string): Promise<void> {
    const poll = async (retries: number): Promise<void> => {
      if (retries <= 0) {
        console.error(`Polling timeout for task ${taskId}`);
        const errorMsg = 'O tempo para gerar a música esgotou.';
        const updatedSong = await this.supabase.updateSong(songId, { status: 'failed', error: errorMsg });
        if (updatedSong) {
            this.userSongs.update(songs => songs.map(s => s.id === updatedSong.id ? updatedSong : s));
        }
        return;
      }

      try {
        // Wait before the next poll to avoid spamming the API
        await new Promise(resolve => setTimeout(resolve, 10000)); 

        const headers = new HttpHeaders({ 'Authorization': `Bearer ${this.apiKey}` });
        
        const queryResponse = await firstValueFrom(
          this.http.get<MurekaQueryResponse>(`${this.MUREKA_API_BASE_URL}/task/${taskId}`, { headers })
        );

        const status = queryResponse.status;
        
        if (status === 'succeeded') {
          const audioUrl = queryResponse.choices?.[0]?.audio_url;
          if (!audioUrl) {
            throw new Error('API retornou sucesso, mas a URL do áudio não foi encontrada.');
          }
          const updatedSong = await this.supabase.updateSong(songId, { status: 'succeeded', audio_url: audioUrl });
           if (updatedSong) {
            this.userSongs.update(songs => songs.map(s => s.id === updatedSong.id ? updatedSong : s));
          }
        } else if (status === 'failed' || status === 'timeouted' || status === 'cancelled') {
          const reason = queryResponse.failed_reason || 'A geração falhou por um motivo desconhecido.';
          const updatedSong = await this.supabase.updateSong(songId, { status: 'failed', error: reason });
           if (updatedSong) {
            this.userSongs.update(songs => songs.map(s => s.id === updatedSong.id ? updatedSong : s));
          }
        } else {
          // 'preparing', 'queued', 'running', 'streaming' -> continue polling
          poll(retries - 1);
        }

      } catch (error) {
        console.error(`Error polling for task ${taskId}:`, error);
         const errorMessage = this.getApiErrorMessage(error, 'Erro ao verificar o status da música.');
         const updatedSong = await this.supabase.updateSong(songId, { status: 'failed', error: errorMessage });
          if (updatedSong) {
            this.userSongs.update(songs => songs.map(s => s.id === updatedSong.id ? updatedSong : s));
          }
      }
    };

    // Start polling with 30 retries (approx 5 minutes).
    poll(30);
  }
}