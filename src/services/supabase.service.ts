import { Injectable, signal } from '@angular/core';
// FIX: Use `type` for type-only imports from supabase-js to align with modern library versions.
import { createClient, SupabaseClient, type User, type AuthError, type Session } from '@supabase/supabase-js';
import { environment } from '../auth/config';

// Define the structure of a Music object, matching the 'musics' table
export interface Music {
  id: string; // UUID from DB
  task_id?: string; // Mureka Task ID, from 'task_id' column
  user_id: string;
  user_email?: string; // Populated from a join with profiles
  title: string;
  style: string;
  description: string; // The 'lyrics' are stored in this column
  status: 'processing' | 'succeeded' | 'failed';
  audio_url: string; // This is NOT NULL in the DB
  metadata?: { error?: string };
  created_at: string; // ISO string
}

export interface Profile {
  id: string; // Corresponds to user_id
  email?: string;
  credits: number;
}

export interface Plan {
  id: string;
  name: string;
  description: string | null;
  price: number;
  credits: number;
  features: string[]; // JSONB in DB, assuming array of strings
  is_active: boolean;
  is_credit_pack: boolean;
  is_popular: boolean;
  price_id: string | null;
  valid_days: number | null;
}


@Injectable({
  providedIn: 'root',
})
export class SupabaseService {
  private supabase: SupabaseClient | null = null;
  
  readonly isConfigured = signal<boolean>(true);
  readonly authReady = signal<boolean>(false);
  currentUser = signal<User | null>(null);
  currentUserProfile = signal<Profile | null>(null);

  constructor() {
    const supabaseUrl = environment.supabaseUrl;
    const supabaseKey = environment.supabaseKey;

    const isUrlMissing = !supabaseUrl || supabaseUrl.trim() === '' || supabaseUrl.includes('dummy-project-url');
    const isKeyMissing = !supabaseKey || supabaseKey.trim() === '' || supabaseKey.includes('dummy-anon-key');

    if (isUrlMissing || isKeyMissing) {
      this.isConfigured.set(false);
      this.authReady.set(true); // Ready to show the config error
      return;
    }
    
    this.supabase = createClient(supabaseUrl, supabaseKey);

    this.supabase.auth.onAuthStateChange(async (event, session) => {
      const user = session?.user ?? null;
      this.currentUser.set(user);
      if (user) {
        await this.fetchUserProfile(user.id);
      } else {
        this.currentUserProfile.set(null);
      }
      this.authReady.set(true);
    });
  }

  async getSession(): Promise<Session | null> {
    if (!this.supabase) return null;
    const { data, error } = await this.supabase.auth.getSession();
    if (error) {
      console.error('Error getting session:', error.message);
      return null;
    }
    return data.session;
  }

  async fetchUserProfile(userId: string): Promise<void> {
    if (!this.supabase) return;
    const { data, error } = await this.supabase
      .from('profiles')
      .select('id, email, credits')
      .eq('id', userId)
      .single();
    
    if (error) {
      console.error('Error fetching user profile:', error.message);
      this.currentUserProfile.set(null);
    } else {
      this.currentUserProfile.set(data as Profile);
    }
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
    if (data.user) {
      await this.createProfileForUser(data.user);
    }
    return { user: data.user, error };
  }
  
  async createProfileForUser(user: User): Promise<void> {
    if (!this.supabase || !user.email) return;

    const { error } = await this.supabase
      .from('profiles')
      .insert({
        id: user.id,
        email: user.email,
        credits: 2 // Start with 2 free credits
      });
    
    if (error) {
      console.error('Error creating profile for new user:', error.message);
    } else {
      await this.fetchUserProfile(user.id);
    }
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
  
  async addMusic(musicData: { title: string, style: string, lyrics: string, status: 'processing' | 'succeeded' | 'failed', error?: string }): Promise<Music | null> {
    const user = this.currentUser();
    if (!this.supabase || !user) return null;

    const { data, error } = await this.supabase
      .from('musics')
      .insert({
        title: musicData.title,
        style: musicData.style,
        description: musicData.lyrics,
        status: musicData.status,
        user_id: user.id,
        audio_url: '', // Satisfy NOT NULL constraint on creation
        metadata: musicData.error ? { error: musicData.error } : {},
      })
      .select()
      .single();

    if (error) {
      console.error('Error adding music:', error.message);
      return null;
    }
    return data as Music;
  }

  async updateMusic(musicId: string, updates: { mureka_id?: string, status?: 'processing' | 'succeeded' | 'failed', audio_url?: string, error?: string }): Promise<Music | null> {
    if (!this.supabase) return null;

    const { mureka_id, error, ...rest } = updates;
    const dbUpdates: { [key: string]: any } = { ...rest };

    if (mureka_id) {
        dbUpdates.task_id = mureka_id;
    }
    if (error) {
        dbUpdates.metadata = { error };
    }
    
    const { data, error: updateError } = await this.supabase
      .from('musics')
      .update(dbUpdates)
      .eq('id', musicId)
      .select()
      .single();
    
    if (updateError) {
      console.error('Error updating music:', updateError.message);
      return null;
    }
    return data as Music;
  }

  async updateUserCredits(userId: string, newCreditCount: number): Promise<Profile | null> {
    if (!this.supabase) return null;
    
    const { data, error } = await this.supabase
      .from('profiles')
      .update({ credits: newCreditCount })
      .eq('id', userId)
      .select()
      .single();
      
    if (error) {
      console.error('Error updating user credits:', error.message);
      return null;
    }
    
    this.currentUserProfile.set(data as Profile);
    return data as Profile;
  }

  async getMusicForUser(userId: string): Promise<Music[]> {
    if (!this.supabase) return [];
    
    const { data, error } = await this.supabase
      .from('musics')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching user music:', error.message);
      return [];
    }
    return (data as Music[]) || [];
  }

  async deleteMusic(musicId: string): Promise<{ error: any }> {
    if (!this.supabase) return { error: { message: 'Supabase client not initialized.' } };
    
    const user = this.currentUser();
    if (!user) return { error: { message: 'User not authenticated.' } };

    const { error, count } = await this.supabase
        .from('musics')
        .delete({ count: 'exact' })
        .match({ id: musicId, user_id: user.id });

    console.log(`Attempted to delete music ID ${musicId}. Rows affected: ${count}`);
    return { error };
  }

  async deleteFailedMusicForUser(userId: string): Promise<{ error: any }> {
      if (!this.supabase) return { error: { message: 'Supabase client not initialized.' } };
      
      const { error, count } = await this.supabase
          .from('musics')
          .delete({ count: 'exact' })
          .match({ user_id: userId, status: 'failed' });
  
      console.log(`Attempted to clear failed music for user ${userId}. Rows affected: ${count}`);
      return { error };
  }
  
  async getAllPublicMusic(): Promise<Music[]> {
    if (!this.supabase) return [];
    
    // 1. Fetch public music
    const { data: musicData, error: musicError } = await this.supabase
      .from('musics')
      .select('*')
      .eq('status', 'succeeded')
      .order('created_at', { ascending: false })
      .limit(50);

    if (musicError) {
      console.error('Error fetching public music:', musicError.message);
      return [];
    }

    if (!musicData || musicData.length === 0) {
      return [];
    }

    // 2. Extract unique user IDs
    const userIds = [...new Set(musicData.map(m => m.user_id).filter(id => !!id))];

    if (userIds.length === 0) {
      return musicData as Music[];
    }
    
    // 3. Fetch corresponding profiles
    const { data: profilesData, error: profilesError } = await this.supabase
      .from('profiles')
      .select('id, email')
      .in('id', userIds);

    if (profilesError) {
      console.error('Error fetching profiles:', profilesError.message);
      // Return music data without emails if profiles can't be fetched
      return musicData as Music[];
    }

    // 4. Create a map for efficient lookup
    const emailMap = new Map(profilesData.map(p => [p.id, p.email]));

    // 5. Combine music data with user emails
    return musicData.map((item: any) => ({
        ...item,
        user_email: emailMap.get(item.user_id),
    })) as Music[];
  }

  async getPlans(): Promise<Plan[]> {
    const supabaseUrl = environment.supabaseUrl;
    const supabaseKey = environment.supabaseKey;

    if (!this.isConfigured()) {
        console.warn('Supabase not configured, cannot fetch plans.');
        return [];
    }
    
    // Use a dedicated anonymous client to fetch public plans.
    // This avoids RLS issues if the user is logged in and the policy only allows 'anon' role.
    const anonClient = createClient(supabaseUrl, supabaseKey);
    
    const { data, error } = await anonClient
      .from('plans')
      .select('*')
      .eq('is_active', true)
      .neq('id', 'free') // Exclude the free plan from purchasable plans
      .order('price', { ascending: true });

    if (error) {
      console.error('Error fetching plans:', error.message);
      return [];
    }
    
    if (!data) {
      return [];
    }

    // Defensively parse 'features' which is stored as a JSON string or is already an array.
    return (data as any[]).map(plan => {
      let parsedFeatures: string[] = [];
      if (typeof plan.features === 'string') {
        try {
          const parsed = JSON.parse(plan.features);
          if (Array.isArray(parsed)) {
            parsedFeatures = parsed;
          }
        } catch (e) {
          console.error(`Failed to parse features for plan ${plan.id}:`, plan.features);
        }
      } else if (Array.isArray(plan.features)) {
        parsedFeatures = plan.features;
      }
      
      return { ...plan, features: parsedFeatures };
    }) as Plan[];
  }
}