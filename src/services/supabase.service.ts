import { Injectable, signal, computed } from '@angular/core';
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
  is_public?: boolean; // Controls visibility in the public feed
  metadata?: { error?: string };
  created_at: string; // ISO string
}

export interface Profile {
  id: string; // Corresponds to user_id
  email?: string;
  display_name?: string;
  credits: number;
  stripe_customer_id?: string | null;
}

export interface Plan {
  id:string;
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

export interface CreditTransaction {
  id: string;
  created_at: string;
  amount: number;
  type: 'purchase' | 'generation' | 'refund' | 'initial' | 'bonus';
  description: string;
  metadata: { [key: string]: any };
}

export interface Notification {
  id: string;
  created_at: string;
  title: string;
  message: string;
  read: boolean;
  type: 'info' | 'success' | 'warning' | 'error';
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

  // Centralized notifications state
  notifications = signal<Notification[]>([]);
  unreadNotificationsCount = computed(() => this.notifications().filter(n => !n.read).length);


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
        // Handle user session, which includes ensuring a profile exists for new users (e.g., from OAuth).
        // This is not awaited to keep the event handler responsive.
        this.handleUserSession(user);
      } else {
        // If no user, clear the profile. This handles SIGNED_OUT and INITIAL_SESSION with no user.
        console.log('SupabaseService: No user session. Clearing profile and notifications.');
        this.currentUserProfile.set(null);
        this.notifications.set([]);
      }
    });
  }
  
  private async handleUserSession(user: User): Promise<void> {
    if (!this.supabase) {
        console.error('handleUserSession: Supabase client not initialized.');
        return;
    }
    
    console.log('SupabaseService: Handling user session for ID:', user.id);

    // The database trigger 'on_auth_user_created' is now responsible for creating the profile.
    // We will poll for the profile to appear, as there can be a slight delay.
    let attempts = 0;
    const maxAttempts = 5;
    const delay = 300; // ms

    const pollForProfile = async () => {
      while (attempts < maxAttempts) {
        await this.fetchUserProfile(user.id);
        const profile = this.currentUserProfile();
        if (profile) {
          console.log(`handleUserSession: Profile found for user ${user.id} after ${attempts + 1} attempt(s).`);
          this.loadNotifications(user.id);
          return;
        }
        attempts++;
        console.warn(`handleUserSession: Profile for ${user.id} not found, attempt ${attempts}. Retrying in ${delay * attempts}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay * attempts)); // increase delay
      }
      console.error(`handleUserSession: Critical error - Profile for user ${user.id} not found after ${maxAttempts} attempts. The 'on_auth_user_created' trigger might be missing or failing.`);
    };

    await pollForProfile();
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
    this.isLoadingProfile.set(true);
    try {
      // FIX: Replaced .single() with .maybeSingle() to gracefully handle cases where a user profile
      // might not exist yet (e.g., right after sign-up) without throwing an error.
      const { data, error } = await this.supabase
        .from('profiles')
        .select('id, email, credits, stripe_customer_id, display_name')
        .eq('id', userId)
        .maybeSingle();
  
      if (error) {
        // An error here indicates a real DB or network issue, not just "no rows found".
        console.error('fetchUserProfile: Error fetching user profile:', error.message);
        this.currentUserProfile.set(null);
      } else {
        // data can be a profile object or null if not found. This is now handled correctly.
        this.currentUserProfile.set(data as Profile | null);
        if (data) {
          console.log('fetchUserProfile: User profile fetched successfully for ID:', userId);
        } else {
          console.warn(`fetchUserProfile: No profile found for user ID ${userId}. This can happen temporarily after signup.`);
        }
      }
    } finally {
      this.isLoadingProfile.set(false);
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

  async signUp(email: string, password: string): Promise<{ user: User | null; error: AuthError | null }> {
    if (!this.supabase) {
        console.error('signUp: Supabase client not initialized.');
        return { user: null, error: { name: 'InitializationError', message: 'Supabase client not initialized.' } as AuthError };
    }
    console.log('signUp: Attempting to sign up with email:', email);

    // This data is passed to the auth.users table and can be used by the trigger
    // to pre-populate the profile with a better display name than one derived from the email.
    const emailPrefix = email.split('@')[0];
    const defaultUsername = `${emailPrefix.toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 15)}${Math.random().toString(36).substring(2, 8)}`;
    let nameBase = emailPrefix.replace(/[._-]/g, ' ').replace(/[^a-zA-Z\s]/g, '').trim().replace(/\s+/g, ' ');
    if (nameBase.length === 0) nameBase = 'Music Lover';
    const defaultFullName = nameBase.split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(' ');

    const { data, error } = await this.supabase.auth.signUp({
        email,
        password,
        options: {
            data: {
                display_name: defaultFullName,
                full_name: defaultFullName,
                avatar_url: `https://picsum.photos/seed/${defaultUsername}/200`,
            },
        },
    });

    if (error) {
        console.error('signUp: Error during sign up:', error.message);
    }
    if (data.user) {
        console.log('signUp: User signed up successfully:', data.user.id, '. The DB trigger will create the profile.');
        // The onAuthStateChange handler will call handleUserSession, which will then fetch the profile.
        // No need to manually create/ensure profile here anymore.
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
      options: {
        // Definindo explicitamente a URL de redirecionamento para a origem da página atual.
        // Isso garante que o usuário seja redirecionado de volta ao aplicativo após a autenticação com o Google.
        // IMPORTANTE: Para que isso funcione, você deve adicionar esta URL (por exemplo, o domínio do seu aplicativo
        // ou http://localhost:4200 para desenvolvimento local) à lista de "Additional Redirect URLs"
        // nas configurações de autenticação do seu projeto Supabase.
        redirectTo: window.location.origin,
      }
    });
    if (error) {
      console.error('signInWithGoogle: Error during Google sign in:', error.message);
    }
    return { error };
  }

  async resendConfirmationEmail(email: string): Promise<{ error: AuthError | null }> {
    if (!this.supabase) {
      console.error('resendConfirmationEmail: Supabase client not initialized.');
      return { error: { name: 'InitializationError', message: 'Supabase client not initialized.' } as AuthError };
    }
    const { data, error } = await this.supabase.auth.resend({ type: 'signup', email });
    if (error) {
      console.error('resendConfirmationEmail: Error resending confirmation:', error.message);
    }
    return { error };
  }

  async sendPasswordResetEmail(email: string): Promise<{ error: AuthError | null }> {
      if (!this.supabase) {
        console.error('sendPasswordResetEmail: Supabase client not initialized.');
        return { error: { name: 'InitializationError', message: 'Supabase client not initialized.' } as AuthError };
      }
      const { data, error } = await this.supabase.auth.resetPasswordForEmail(email);
      if (error) {
        console.error('sendPasswordResetEmail: Error sending password reset email:', error.message);
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

  async handlePurchaseSuccess(sessionId: string): Promise<{ error: string | null }> {
    const user = this.currentUser();
    if (!user) {
        return { error: 'Usuário não autenticado.' };
    }

    try {
        if (!this.supabase) {
            throw new Error('Cliente Supabase não inicializado.');
        }

        const { data: sessionData, error: funcError } = await this.invokeFunction('dynamic-api', {
            body: { action: 'get_checkout_session', sessionId: sessionId }
        });

        if (funcError || sessionData?.error) {
            throw new Error(funcError?.message || sessionData?.error || 'Falha ao obter detalhes da compra.');
        }

        const customerId = sessionData?.customer;
        const priceId = sessionData?.priceId;

        if (!customerId || !priceId) {
            throw new Error('Detalhes da compra (ID do cliente ou do plano) não encontrados na sessão de checkout.');
        }

        const { data: plan, error: planError } = await this.supabase
            .from('plans')
            .select('credits, name')
            .eq('price_id', priceId)
            .single();

        if (planError || !plan) {
            throw new Error(planError?.message || `Plano com price_id ${priceId} não encontrado no banco de dados.`);
        }

        const creditsPurchased = plan.credits;
        const planName = plan.name;

        const currentProfile = this.currentUserProfile();
        if (!currentProfile) {
            throw new Error('Perfil do usuário não encontrado. Não é possível adicionar créditos.');
        }
        const newTotalCredits = (currentProfile.credits || 0) + creditsPurchased;

        const { error: profileUpdateError } = await this.supabase
            .from('profiles')
            .update({
                stripe_customer_id: customerId,
                credits: newTotalCredits
            })
            .eq('id', user.id);

        if (profileUpdateError) {
            throw new Error(`Falha ao atualizar o perfil com novos créditos: ${profileUpdateError.message}`);
        }

        const { error: transactionError } = await this.supabase
            .from('credit_transactions')
            .insert({
                user_id: user.id,
                amount: creditsPurchased,
                type: 'purchase',
                description: `Compra do pacote "${planName}"`,
                metadata: { sessionId, priceId }
            });

        if (transactionError) {
            console.error('handlePurchaseSuccess: Falha ao registrar a transação de crédito:', transactionError.message);
        }

        await this.fetchUserProfile(user.id);

        return { error: null };

    } catch (e: any) {
        console.error('handlePurchaseSuccess: Erro ao processar o sucesso da compra:', e);
        return { error: e.message || 'Ocorreu um erro ao processar seu pagamento.' };
    }
  }

  async getCreditTransactionsForUser(userId: string): Promise<CreditTransaction[]> {
    if (!this.supabase) {
      console.error('getCreditTransactionsForUser: Supabase client not initialized.');
      return [];
    }
    const { data, error } = await this.supabase
      .from('credit_transactions')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('getCreditTransactionsForUser: Error fetching transactions:', error.message);
      return [];
    }
    return (data as CreditTransaction[]) || [];
  }

  async loadNotifications(userId: string): Promise<void> {
    if (!this.supabase) {
      console.error('loadNotifications: Supabase client not initialized.');
      return;
    }
    const { data, error } = await this.supabase
      .from('notifications')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('loadNotifications: Error fetching notifications:', error.message);
      this.notifications.set([]);
    } else {
      this.notifications.set((data as Notification[]) || []);
    }
  }

  async markNotificationAsRead(notificationId: string): Promise<Notification | null> {
    if (!this.supabase) {
        console.error('markNotificationAsRead: Supabase client not initialized.');
        return null;
    }
    const { data, error } = await this.supabase
        .from('notifications')
        .update({ read: true, read_at: new Date().toISOString() })
        .eq('id', notificationId)
        .select()
        .single();

    if (error) {
        console.error('markNotificationAsRead: Error updating notification:', error.message);
        return null;
    }
    
    // Update local state for immediate UI feedback
    this.notifications.update(list => 
      list.map(n => n.id === notificationId ? { ...n, read: true } : n)
    );

    return data as Notification;
  }

  // == Database Methods ==
  
  async addMusic(musicData: { title: string, style: string, lyrics: string, status: 'processing' | 'succeeded' | 'failed', error?: string, is_public?: boolean }): Promise<Music | null> {
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
        is_public: musicData.is_public ?? true, // Default to public
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
  
  async updateMusicVisibility(musicId: string, isPublic: boolean): Promise<Music | null> {
    if (!this.supabase) {
      console.error('updateMusicVisibility: Supabase client not initialized.');
      return null;
    }

    const { data, error } = await this.supabase
      .from('musics')
      .update({ is_public: isPublic })
      .eq('id', musicId)
      .select()
      .single();

    if (error) {
      console.error('updateMusicVisibility: Error updating music visibility:', error.message);
      return null;
    }
    console.log(`updateMusicVisibility: Music ${musicId} visibility set to ${isPublic}`);
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
        console.warn('getAllPublicMusic: Supabase not configured, cannot fetch public music.');
        return [];
    }

    // Use a database function (RPC) to securely fetch public music.
    // This function runs with SECURITY DEFINER, bypassing the calling user's RLS policies,
    // which solves the issue of logged-in users only seeing their own music in the public feed.
    const { data, error } = await this.supabase.rpc('get_public_feed');

    if (error) {
      console.error('getAllPublicMusic: Error calling get_public_feed RPC:', error.message);
      return [];
    }
    
    console.log(`getAllPublicMusic: Fetched ${data.length} public music records via RPC.`);
    return (data as Music[]) || [];
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