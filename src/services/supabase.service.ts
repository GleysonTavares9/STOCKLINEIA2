import { Injectable, signal } from '@angular/core';
import { createClient, SupabaseClient, User, AuthError } from '@supabase/supabase-js';
import { environment } from '../config';

// Define the structure of a Song object, matching the database table
export interface Song {
  id: string; // UUID from DB
  mureka_id?: string; // Mureka Task ID
  user_id: string;
  user_email?: string;
  title: string;
  style: string;
  lyrics: string;
  status: 'processing' | 'succeeded' | 'failed';
  audio_url?: string;
  error?: string;
  created_at: string; // ISO string
}

@Injectable({
  providedIn: 'root',
})
export class SupabaseService {
  private supabase: SupabaseClient | null = null;
  
  readonly isConfigured = signal<boolean>(true);
  currentUser = signal<User | null>(null);

  constructor() {
    const supabaseUrl = environment.supabaseUrl;
    const supabaseKey = environment.supabaseKey;

    if (!supabaseUrl || supabaseUrl === 'YOUR_SUPABASE_URL' || !supabaseKey || supabaseKey === 'YOUR_SUPABASE_ANON_KEY') {
      this.isConfigured.set(false);
      console.error(`
      --------------------------------------------------
      ERRO DE CONFIGURAÇÃO DO SUPABASE
      --------------------------------------------------
      A URL e a Chave do Supabase não foram configuradas.
      Por favor, edite o arquivo 'src/config.ts' e
      substitua 'YOUR_SUPABASE_URL' e 'YOUR_SUPABASE_ANON_KEY'
      pelos seus dados reais do projeto Supabase.
      O aplicativo não funcionará corretamente até que
      isso seja feito.
      --------------------------------------------------
      `);
      return;
    }
    
    this.supabase = createClient(supabaseUrl, supabaseKey);

    this.supabase.auth.onAuthStateChange((event, session) => {
      this.currentUser.set(session?.user ?? null);
    });
    
    // Check for session on startup
    this.supabase.auth.getSession().then(({ data }) => {
        this.currentUser.set(data.session?.user ?? null);
    });
  }

  async signUp(email: string, password: string): Promise<{ user: User | null; error: AuthError | null }> {
    if (!this.supabase) return { user: null, error: new AuthError('Supabase client not initialized. Check configuration in src/config.ts') };
    const { data, error } = await this.supabase.auth.signUp({ email, password });
    return { user: data.user, error };
  }

  async signInWithEmail(email: string, password: string): Promise<{ user: User | null; error: AuthError | null }> {
    if (!this.supabase) return { user: null, error: new AuthError('Supabase client not initialized. Check configuration in src/config.ts') };
    const { data, error } = await this.supabase.auth.signInWithPassword({ email, password });
    return { user: data.user, error };
  }

  async signOut(): Promise<{ error: AuthError | null }> {
    if (!this.supabase) return { error: new AuthError('Supabase client not initialized. Check configuration in src/config.ts') };
    return this.supabase.auth.signOut();
  }

  // Database Methods

  async addSong(songData: Pick<Song, 'title' | 'style' | 'lyrics' | 'status' | 'error'>): Promise<Song | null> {
    if (!this.supabase) return null;
    const user = this.currentUser();
    if (!user) return null;

    const { data, error } = await this.supabase
      .from('songs')
      .insert({
        ...songData,
        user_id: user.id,
        user_email: user.email,
      })
      .select()
      .single();

    if (error) {
      console.error('Error adding song:', error);
      return null;
    }
    return data as Song;
  }

  async updateSong(id: string, updates: Partial<Song>): Promise<Song | null> {
    if (!this.supabase) return null;
    const { data, error } = await this.supabase
      .from('songs')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('Error updating song:', error);
      return null;
    }
    return data as Song;
  }

  async getSongsForUser(userId: string): Promise<Song[]> {
    if (!this.supabase) return [];
    const { data, error } = await this.supabase
      .from('songs')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching user songs:', error);
      return [];
    }
    return data as Song[];
  }

  async getAllPublicSongs(): Promise<Song[]> {
    if (!this.supabase) return [];
    const { data, error } = await this.supabase
      .from('songs')
      .select('*')
      // Only show completed songs in the public feed
      .eq('status', 'succeeded')
      .order('created_at', { ascending: false })
      .limit(50); // Limit to latest 50 songs for performance

    if (error) {
      console.error('Error fetching public songs:', error);
      return [];
    }
    return data as Song[];
  }
}