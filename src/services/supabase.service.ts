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

    if (!supabaseUrl || supabaseKey === 'YOUR_SUPABASE_ANON_KEY') {
      this.isConfigured.set(false);
      console.error("Supabase URL or Key not configured. Please check src/config.ts");
      return;
    }
    
    this.supabase = createClient(supabaseUrl, supabaseKey);

    this.supabase.auth.onAuthStateChange((event, session) => {
      this.currentUser.set(session?.user ?? null);
    });
  }

  async signOut(): Promise<void> {
    if (!this.supabase) return;
    await this.supabase.auth.signOut();
    this.currentUser.set(null);
  }

  async signInWithEmail(email: string, password: string): Promise<{ user: User | null, error: AuthError | null }> {
    if (!this.supabase) {
      return { user: null, error: { name: 'InitializationError', message: 'Supabase client not initialized.' } as AuthError };
    }
    const { data, error } = await this.supabase.auth.signInWithPassword({ email, password });
    return { user: data.user, error };
  }

  async signUp(email: string, password: string): Promise<{ user: User | null, error: AuthError | null }> {
    if (!this.supabase) {
      return { user: null, error: { name: 'InitializationError', message: 'Supabase client not initialized.' } as AuthError };
    }
    const { data, error } = await this.supabase.auth.signUp({ email, password });
    return { user: data.user, error };
  }

  async signInWithGoogle(): Promise<{ error: AuthError | null }> {
    if (!this.supabase) {
      console.error('Supabase client not initialized.');
      return { error: { name: 'InitializationError', message: 'Supabase client not initialized.' } as AuthError };
    }
    const { error } = await this.supabase.auth.signInWithOAuth({
      provider: 'google',
    });
    return { error };
  }

  // == Database Methods ==
  
  async addSong(songData: Omit<Song, 'id' | 'user_id' | 'user_email' | 'created_at'>): Promise<Song | null> {
    const user = this.currentUser();
    if (!this.supabase || !user) return null;

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

  async updateSong(songId: string, updates: Partial<Song>): Promise<Song | null> {
    if (!this.supabase) return null;

    const { data, error } = await this.supabase
      .from('songs')
      .update(updates)
      .eq('id', songId)
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
      .eq('status', 'succeeded') // Only show completed songs
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) {
      console.error('Error fetching public songs:', error);
      return [];
    }
    return data as Song[];
  }
}
