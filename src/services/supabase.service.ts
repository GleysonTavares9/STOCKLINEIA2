import { Injectable, signal } from '@angular/core';
// Fix: Corrected import statement for Supabase types to resolve module errors.
import { createClient, type SupabaseClient, type User, type AuthError, type Session } from '@supabase/supabase-js';
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
  stripe_customer_id?: string | null;
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
  // Nova propriedade para indicar explicitamente o ciclo de cobrança
  billing_cycle: 'monthly' | 'annual' | 'one-time';
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
  readonly isLoadingProfile = signal<boolean>(false); // Novo sinal para o estado de carregamento do perfil
  readonly supabaseInitError = signal<string | null>(null); // Novo sinal para erros de inicialização

  constructor() {
    const supabaseUrl = environment.supabaseUrl;
    const supabaseKey = environment.supabaseKey;

    // Check if configuration placeholders are still present.
    // If they are, it means the developer hasn't set up their Supabase project yet.
    const isUrlMissing = !supabaseUrl || supabaseUrl.includes('YOUR_SUPABASE_URL');
    const isKeyMissing = !supabaseKey || supabaseKey.includes('YOUR_SUPABASE_ANON_KEY');

    if (isUrlMissing) {
      const msg = 'Supabase URL não configurada. Por favor, preencha `supabaseUrl` em `src/auth/config.ts` ou configure a variável de ambiente `SUPABASE_URL`.';
      console.error('SupabaseService:', msg);
      this.isConfigured.set(false);
      this.supabaseInitError.set(msg);
      this.authReady.set(true); 
      return;
    }
    if (isKeyMissing) {
      const msg = 'Supabase Anon Key não configurada. Por favor, preencha `supabaseKey` em `src/auth/config.ts` ou configure a variável de ambiente `SUPABASE_ANON_KEY`.';
      console.error('SupabaseService:', msg);
      this.isConfigured.set(false);
      this.supabaseInitError.set(msg);
      this.authReady.set(true); 
      return;
    }
    
    try {
      this.supabase = createClient(supabaseUrl, supabaseKey);
      this.isConfigured.set(true);
      console.log('SupabaseService: Supabase client initialized successfully.');
    } catch (e: any) { // Catch as any to handle potential non-Error objects
      const msg = `Erro ao inicializar o cliente Supabase: ${e.message || e.toString()}. Verifique se a URL e a chave anônima são válidas e se há conexão com a internet.`;
      console.error('SupabaseService:', msg);
      this.isConfigured.set(false);
      this.supabaseInitError.set(msg);
      this.authReady.set(true); 
      return;
    }

    // The onAuthStateChange listener is now the single source of truth for auth state.
    // It fires with an 'INITIAL_SESSION' event on page load, which we use to
    // set authReady to true, removing the loading screen. This is more robust
    // than a separate getSession() call and avoids potential race conditions.
    this.supabase.auth.onAuthStateChange(async (event, session) => {
      console.log('SupabaseService: Auth state change detected:', event);

      // On initial load, the 'INITIAL_SESSION' event is fired.
      // This is the signal that Supabase has checked for a session and we can proceed.
      // This event fires whether a session is found or not.
      if (event === 'INITIAL_SESSION') {
        this.authReady.set(true);
        console.log('SupabaseService: Initial session processed. Auth is ready.');
      }

      const user = session?.user ?? null;
      this.currentUser.set(user); // Set currentUser immediately

      if (user) {
        // If the user state changes (e.g., SIGNED_IN), fetch their profile.
        // This also runs for INITIAL_SESSION if a user is already logged in.
        console.log('SupabaseService: User found, initiating profile fetch for ID:', user.id);
        // DO NOT AWAIT HERE. This allows the event handler to complete quickly.
        // The fetchUserProfile method will update currentUserProfile signal asynchronously.
        this.fetchUserProfile(user.id); 
      } else {
        // If no user, clear the profile. This handles SIGNED_OUT and INITIAL_SESSION with no user.
        console.log('SupabaseService: No user session. Clearing profile.');
        this.currentUserProfile.set(null);
      }
    });
  }

  async getSession(): Promise<Session | null> {
    if (!this.supabase) {
      console.error('getSession: Supabase client not initialized.');
      return null;
    }
    const { data, error } = await this.supabase.auth.getSession();
    if (error) {
      console.error('getSession: Error getting session:', error.message);
      return null;
    }
    console.log('getSession: Session data received.');
    return data.session;
  }

  async fetchUserProfile(userId: string): Promise<void> {
    if (!this.supabase) {
      console.error('fetchUserProfile: Supabase client not initialized.');
      return;
    }
    this.isLoadingProfile.set(true); // Set loading true
    try {
      const { data, error } = await this.supabase
        .from('profiles')
        .select('id, email, credits, stripe_customer_id')
        .eq('id', userId)
        .single();
      
      if (error) {
        console.error('fetchUserProfile: Error fetching user profile:', error.message);
        this.currentUserProfile.set(null);
      } else {
        console.log('fetchUserProfile: User profile fetched successfully for ID:', userId);
        this.currentUserProfile.set(data as Profile);
      }
    } finally {
      this.isLoadingProfile.set(false); // Set loading false
    }
  }

  async signOut(): Promise<void> {
    if (!this.supabase) {
      console.error('signOut: Supabase client not initialized.');
      return;
    }
    console.log('SupabaseService: Initiating Supabase auth.signOut()');
    const { error } = await this.supabase.auth.signOut();
    if (error) {
      console.error('SupabaseService: Error during auth.signOut():', error.message);
      // Even if there's an error, try to clear client-side state
    }

    // Explicitly clear Supabase related items from local storage as a safety measure.
    // This helps in scenarios where the Supabase client might not fully clear all state
    // in specific browser environments or due to race conditions.
    console.log('SupabaseService: Attempting to clear Supabase related local storage and session storage items.');
    const storageKeys = [];
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('sb:') && key.includes('-auth-')) { // Supabase keys usually start with 'sb:'
            storageKeys.push({ type: 'localStorage', key: key });
        }
    }
    for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        if (key && key.startsWith('sb:') && key.includes('-auth-')) { // Supabase keys usually start with 'sb:'
            storageKeys.push({ type: 'sessionStorage', key: key });
        }
    }

    if (storageKeys.length > 0) {
      console.log(`SupabaseService: Found ${storageKeys.length} items to clear.`);
      for (const item of storageKeys) {
        if (item.type === 'localStorage') {
          localStorage.removeItem(item.key);
          console.log(`SupabaseService: Removed localStorage item: ${item.key}`);
        } else {
          sessionStorage.removeItem(item.key);
          console.log(`SupabaseService: Removed sessionStorage item: ${item.key}`);
        }
      }
    } else {
      console.log('SupabaseService: No Supabase-related items found in storage to clear manually.');
    }

    // Reset signals
    this.currentUser.set(null);
    this.currentUserProfile.set(null);
    console.log('SupabaseService: Client-side currentUser and currentUserProfile signals set to null.');
  }

  async signInWithEmail(email: string, password: string): Promise<{ user: User | null, error: AuthError | null }> {
    if (!this.supabase) {
      console.error('signInWithEmail: Supabase client not initialized.');
      return { user: null, error: { name: 'InitializationError', message: 'Supabase client not initialized.' } as AuthError };
    }
    console.log('signInWithEmail: Attempting to sign in with email:', email);
    const { data, error } = await this.supabase.auth.signInWithPassword({ email, password });
    if (error) {
      console.error('signInWithEmail: Error during sign in:', error.message);
    } else if (data.user) {
      console.log('signInWithEmail: User signed in successfully:', data.user.id);
    }
    return { user: data.user, error };
  }

  async signUp(email: string, password: string): Promise<{ user: User | null, error: AuthError | null }> {
    if (!this.supabase) {
      console.error('signUp: Supabase client not initialized.');
      return { user: null, error: { name: 'InitializationError', message: 'Supabase client not initialized.' } as AuthError };
    }
    console.log('signUp: Attempting to sign up with email:', email);

    const emailPrefix = email.split('@')[0];
    const uniqueSuffix = Math.random().toString(36).substring(2, 8);

    // Sanitize for username (alphanumeric)
    const sanitizedEmailPrefix = emailPrefix.toLowerCase().replace(/[^a-z0-9]/g, '');
    const baseUsername = sanitizedEmailPrefix.length > 0 ? sanitizedEmailPrefix.substring(0, 15) : 'user';
    const defaultUsername = `${baseUsername}${uniqueSuffix}`;

    // Create a more "name-like" string for full_name and display_name, avoiding numbers
    // that might violate a CHECK constraint on the profiles table.
    const namePart = (emailPrefix.match(/^[a-zA-Z]+/) || ['user'])[0];
    const defaultFullName = namePart.charAt(0).toUpperCase() + namePart.slice(1);

    const { data, error } = await this.supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          username: defaultUsername,
          display_name: defaultFullName,
          full_name: defaultFullName,
          credits: 10, // Provide initial credits to prevent NOT NULL violation in profile creation trigger.
          avatar_url: `https://picsum.photos/seed/${defaultUsername}/200`,
        },
      },
    });

    if (data.user) {
      console.log('signUp: User signed up successfully (email verification might be required):', data.user.id);
      // The client-side profile creation has been removed to prevent a race condition with the
      // server-side trigger, which was the likely cause of the "Database error saving new user" error.
      // The `onAuthStateChange` listener will now handle fetching the profile created by the trigger.
    } else if (error) {
      console.error('signUp: Error during sign up:', error.message);
    }
    return { user: data.user, error };
  }

  async signInWithGoogle(): Promise<{ error: AuthError | null }> {
    if (!this.supabase) {
      console.error('signInWithGoogle: Supabase client not initialized.');
      return { error: { name: 'InitializationError', message: 'Supabase client not initialized.' } as AuthError };
    }
    console.log('signInWithGoogle: Attempting to sign in with Google OAuth.');
    const { error } = await this.supabase.auth.signInWithOAuth({
      provider: 'google',
    });
    if (error) {
      console.error('signInWithGoogle: Error during Google sign in:', error.message);
    }
    return { error };
  }

  async createBillingPortalSession(): Promise<{ url: string | null, error: string | null }> {
    const profile = this.currentUserProfile();
    if (!profile?.stripe_customer_id) {
      return { url: null, error: 'Nenhum cliente de faturamento encontrado para este usuário.' };
    }
  
    const { data, error } = await this.invokeFunction('dynamic-api', {
      body: {
        action: 'create_billing_portal_session',
        customerId: profile.stripe_customer_id
      }
    });
  
    if (error) {
      // Assuming getPurchaseErrorMessage can handle these generic errors too
      // If not, a simpler message is better.
      return { url: null, error: `Falha ao comunicar com o servidor de faturamento: ${error.message}` };
    }
  
    if (data?.error) {
      return { url: null, error: data.error };
    }
    
    if (!data?.url) {
      return { url: null, error: 'O servidor de faturamento não retornou um URL válido.' };
    }
  
    return { url: data.url, error: null };
  }

  // == Database Methods ==
  
  async addMusic(musicData: { title: string, style: string, lyrics: string, status: 'processing' | 'succeeded' | 'failed', error?: string }): Promise<Music | null> {
    const user = this.currentUser();
    if (!this.supabase || !user) {
      console.error('addMusic: Supabase client not initialized or user not authenticated.');
      return null;
    }

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
      console.error('addMusic: Error adding music:', error.message);
      return null;
    }
    console.log('addMusic: Music record added successfully with ID:', data.id);
    return data as Music;
  }

  async updateMusic(musicId: string, updates: { mureka_id?: string, status?: 'processing' | 'succeeded' | 'failed', audio_url?: string, error?: string }): Promise<Music | null> {
    if (!this.supabase) {
      console.error('updateMusic: Supabase client not initialized.');
      return null;
    }

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
      console.error('updateMusic: Error updating music:', updateError.message);
      return null;
    }
    console.log('updateMusic: Music record updated successfully for ID:', musicId);
    return data as Music;
  }

  async updateUserProfile(userId: string, updates: Partial<Profile>): Promise<Profile | null> {
    if (!this.supabase) {
      console.error('updateUserProfile: Supabase client not initialized.');
      return null;
    }
    
    const { data, error } = await this.supabase
      .from('profiles')
      .update(updates)
      .eq('id', userId)
      .select()
      .single();
      
    if (error) {
      console.error('updateUserProfile: Error updating user profile:', error.message);
      return null;
    }
    
    console.log('updateUserProfile: User profile updated for ID:', userId, 'with', updates);
    // Update the local signal with the new profile data, merging with existing data
    this.currentUserProfile.update(currentProfile => {
        if (currentProfile && currentProfile.id === userId) {
            return { ...currentProfile, ...data };
        }
        return data as Profile; // Fallback in case there was no profile
    });
    return data as Profile;
  }

  async updateUserCredits(userId: string, newCreditCount: number): Promise<Profile | null> {
    return this.updateUserProfile(userId, { credits: newCreditCount });
  }

  async handlePurchaseSuccess(sessionId: string): Promise<{ error: string | null }> {
    const user = this.currentUser();
    if (!user) {
      return { error: 'Usuário não autenticado.' };
    }

    try {
        // 1. Chame a função de borda para obter os detalhes da sessão do Stripe
        const { data: sessionData, error: funcError } = await this.invokeFunction('dynamic-api', {
            body: {
                action: 'get_checkout_session',
                sessionId: sessionId
            }
        });

        if (funcError || sessionData?.error) {
            throw new Error(funcError?.message || sessionData?.error || 'Falha ao obter detalhes da compra.');
        }

        const customerId = sessionData?.customer;
        if (!customerId) {
            throw new Error('ID de cliente não encontrado na sessão de checkout.');
        }
        
        // 2. Atualize o perfil do usuário com o stripe_customer_id
        const profile = await this.updateUserProfile(user.id, { stripe_customer_id: customerId });

        if (!profile) {
            throw new Error('Falha ao salvar informações da assinatura no seu perfil.');
        }
        
        // 3. (Opcional, mas recomendado) Atualize o perfil para garantir que todos os dados (como créditos) estejam atualizados
        await this.fetchUserProfile(user.id);
        
        return { error: null };

    } catch (e: any) {
        console.error('handlePurchaseSuccess: Erro ao processar o sucesso da compra:', e);
        return { error: e.message || 'Ocorreu um erro ao processar seu pagamento.' };
    }
  }

  async getMusicForUser(userId: string): Promise<Music[]> {
    if (!this.supabase) {
      console.error('getMusicForUser: Supabase client not initialized.');
      return [];
    }
    
    const { data, error } = await this.supabase
      .from('musics')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('getMusicForUser: Error fetching user music:', error.message);
      return [];
    }
    console.log('getMusicForUser: Fetched music for user ID:', userId);
    return (data as Music[]) || [];
  }

  async deleteMusic(musicId: string): Promise<{ error: any; count: number | null }> {
    if (!this.supabase) {
      console.error('deleteMusic: Supabase client not initialized.');
      return { error: { message: 'Supabase client not initialized.' }, count: null };
    }
    
    const user = this.currentUser();
    if (!user) {
      console.error('deleteMusic: User not authenticated.');
      return { error: { message: 'User not authenticated.' }, count: null };
    }

    const { error, count } = await this.supabase
        .from('musics')
        .delete({ count: 'exact' })
        .match({ id: musicId, user_id: user.id });

    console.log(`deleteMusic: Attempted to delete music ID ${musicId}. Rows affected: ${count}`);
    if (error) {
      console.error('deleteMusic: Error deleting music:', error.message);
    }
    return { error, count };
  }

  async deleteFailedMusicForUser(userId: string): Promise<{ error: any; count: number | null }> {
      if (!this.supabase) {
        console.error('deleteFailedMusicForUser: Supabase client not initialized.');
        return { error: { message: 'Supabase client not initialized.' }, count: null };
      }
      
      const { error, count } = await this.supabase
          .from('musics')
          .delete({ count: 'exact' })
          .match({ user_id: userId, status: 'failed' });
  
      console.log(`deleteFailedMusicForUser: Attempted to clear failed music for user ${userId}. Rows affected: ${count}`);
      if (error) {
        console.error('deleteFailedMusicForUser: Error deleting failed music:', error.message);
      }
      return { error, count };
  }
  
  async getAllPublicMusic(): Promise<Music[]> {
    if (!this.supabase) {
      console.error('getAllPublicMusic: Supabase client not initialized.');
      return [];
    }
    
    // 1. Fetch public music
    const { data: musicData, error: musicError } = await this.supabase
      .from('musics')
      .select('*')
      .eq('status', 'succeeded')
      .order('created_at', { ascending: false })
      .limit(50);

    if (musicError) {
      console.error('getAllPublicMusic: Error fetching public music:', musicError.message);
      return [];
    }

    if (!musicData || musicData.length === 0) {
      console.log('getAllPublicMusic: No public music found.');
      return [];
    }
    console.log(`getAllPublicMusic: Fetched ${musicData.length} public music records.`);

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
      console.error('getAllPublicMusic: Error fetching profiles:', profilesError.message);
      // Return music data without emails if profiles can't be fetched
      return musicData as Music[];
    }
    console.log(`getAllPublicMusic: Fetched ${profilesData.length} profiles.`);

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
        console.warn('getPlans: Supabase not configured, cannot fetch plans.');
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
      console.error('getPlans: Error fetching plans:', error.message);
      return [];
    }
    
    if (!data) {
      console.log('getPlans: No plan data received.');
      return [];
    }
    console.log(`getPlans: Fetched ${data.length} plans.`);

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
          console.error(`getPlans: Failed to parse features for plan ${plan.id}:`, plan.features);
        }
      } else if (Array.isArray(plan.features)) {
        parsedFeatures = plan.features;
      }
      
      let inferredBillingCycle: 'monthly' | 'annual' | 'one-time' = 'monthly'; // Padrão para mensal
      if (plan.is_credit_pack) {
        inferredBillingCycle = 'one-time';
      }
      // TODO: Para que o filtro Anual vs Mensal funcione corretamente com base nos seus dados do banco,
      // você DEVE adicionar uma coluna 'billing_cycle' (ex: 'monthly', 'annual') na sua tabela 'plans' no Supabase.
      // Atualmente, sem essa coluna, todos os planos de assinatura são inferidos como 'monthly'.
      // Exemplo de como você poderia usar a coluna:
      // if (plan.billing_cycle_from_db === 'annual') { inferredBillingCycle = 'annual'; }

      return { ...plan, features: parsedFeatures, billing_cycle: inferredBillingCycle };
    }) as Plan[];
  }

  // #region Fix: Added public method to invoke Supabase Edge Functions.
  // This safely exposes the functionality without making the entire Supabase client public.
  async invokeFunction(functionName: string, options: { body: any }): Promise<{ data: any | null, error: any }> {
    if (!this.supabase) {
        console.error(`invokeFunction: Supabase client not initialized for function ${functionName}.`);
        return { data: null, error: { message: 'Supabase client not initialized.' } };
    }
    console.log(`invokeFunction: Invoking Supabase Edge Function: ${functionName}`);
    const { data, error } = await this.supabase.functions.invoke(functionName, options);
    if (error) {
      console.error(`invokeFunction: Error invoking function ${functionName}:`, error.message);
    } else {
      console.log(`invokeFunction: Function ${functionName} invoked successfully.`);
    }
    return { data, error };
  }
  // #endregion
}