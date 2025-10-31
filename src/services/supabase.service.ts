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
  // FIX: Broaden metadata type to support arbitrary properties beyond just 'error'.
  // This allows storing additional information like 'file_id' or 'youtube_url'.
  metadata?: { [key: string]: any };
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

    // --- Polling for profile ---
    // The database trigger 'on_auth_user_created' should create the profile.
    // We poll to allow for replication delay.
    let attempts = 0;
    const maxAttempts = 5;
    const delay = 300;

    while (attempts < maxAttempts) {
        await this.fetchUserProfile(user.id);
        if (this.currentUserProfile()) {
            console.log(`handleUserSession: Profile found for user ${user.id} after ${attempts + 1} attempt(s).`);
            this.loadNotifications(user.id);
            return; // Success, profile found.
        }
        attempts++;
        console.warn(`handleUserSession: Profile for ${user.id} not found, attempt ${attempts}. Retrying in ${delay * attempts}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay * attempts));
    }

    // --- Fallback: Create profile from client ---
    // If polling fails, the trigger might be missing, broken, or severely delayed.
    // We create the profile as a fallback to ensure the user can log in.
    if (!this.currentUserProfile()) {
        console.warn(`handleUserSession: DB trigger failed or timed out. Attempting to create profile for user ${user.id} from the client as a fallback.`);
        try {
            const { data: newProfile, error: insertError } = await this.supabase
                .from('profiles')
                .insert({
                    id: user.id,
                    email: user.email,
                    display_name: user.user_metadata?.full_name || '',
                    credits: 10 // Default starting credits
                })
                .select()
                .single();

            if (insertError) {
                // If the insert fails with a unique constraint violation, it means the trigger
                // finally ran and created the profile between our last poll and our insert attempt.
                // This is a race condition we can recover from.
                if (insertError.code === '23505') { // 'unique_violation'
                    console.log('handleUserSession: Fallback insert failed (unique_violation), likely due to a race condition. Refetching the now-existing profile.');
                    await this.fetchUserProfile(user.id);
                    if (this.currentUserProfile()) {
                         this.loadNotifications(user.id);
                    } else {
                        // This is a more critical state - insert failed and refetch failed.
                         console.error(`handleUserSession: CRITICAL - Fallback failed to create profile and could not refetch it for user ${user.id}.`, insertError);
                    }
                } else {
                    // Another, more serious error occurred during insert.
                    console.error(`handleUserSession: Fallback failed to create profile for user ${user.id}.`, insertError);
                }
            } else {
                console.log(`handleUserSession: Fallback successfully created profile for user ${user.id}.`);
                this.currentUserProfile.set(newProfile as Profile);
                this.loadNotifications(user.id); // Load notifications for the new profile
            }
        } catch (e) {
            console.error(`handleUserSession: Unhandled exception in profile creation fallback for user ${user.id}.`, e);
        }
    }
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

  async signUp(email: string, password: string, fullName: string): Promise<{ user: User | null; error: AuthError | null }> {
    if (!this.supabase) {
        console.error('signUp: Supabase client not initialized.');
        return { user: null, error: { name: 'InitializationError', message: 'Supabase client not initialized.' } as AuthError };
    }
    console.log('signUp: Attempting to sign up with email:', email);

    const { data, error } = await this.supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: fullName
          }
        }
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
        // FIX: Alterado de `window.location.origin` para `window.location.href`.
        // `href` inclui o caminho completo e o fragmento de hash, o que é essencial para o roteamento
        // baseado em hash, garantindo que o usuário retorne ao estado correto do aplicativo após a autenticação OAuth.
        // `origin` fornece apenas o protocolo, hostname e porta, perdendo o contexto da rota atual do app.
        redirectTo: window.location.href,
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
      return;
    }
    this.notifications.set(data as Notification[]);
  }

  async markNotificationAsRead(notificationId: string): Promise<void> {
    if (!this.supabase) {
      console.error('markNotificationAsRead: Supabase client not initialized.');
      return;
    }
    
    // Optimistic update: mark as read immediately in the UI
    this.notifications.update(current => 
      current.map(n => n.id === notificationId ? { ...n, read: true } : n)
    );

    const { error } = await this.supabase
      .from('notifications')
      .update({ read: true })
      .eq('id', notificationId);

    if (error) {
      console.error('markNotificationAsRead: Error updating notification:', error.message);
      // Revert if API call fails
      this.notifications.update(current => 
        current.map(n => n.id === notificationId ? { ...n, read: false } : n)
      );
    }
  }
  
  // A wrapper for invoking functions to standardize error handling a bit
  async invokeFunction(functionName: string, options: { body: { [key: string]: any } }) {
    if (!this.supabase) {
      throw new Error('Supabase client not initialized.');
    }
    return this.supabase.functions.invoke(functionName, options);
  }

  async updateUserCredits(userId: string, newCreditAmount: number): Promise<void> {
    if (!this.supabase) {
        console.error('updateUserCredits: Supabase client not initialized.');
        return;
    }
    // Update local profile signal first for immediate UI feedback (optimistic update)
    this.currentUserProfile.update(profile => {
        if (profile) {
            return { ...profile, credits: newCreditAmount };
        }
        return null;
    });

    const { error } = await this.supabase
        .from('profiles')
        .update({ credits: newCreditAmount })
        .eq('id', userId);

    if (error) {
        console.error('updateUserCredits: Error updating credits in DB:', error.message);
        // If the DB update fails, re-fetch the profile from the server to revert the optimistic update
        // and ensure UI consistency with the backend state.
        await this.fetchUserProfile(userId);
    }
  }

  async addMusic(
    musicData: { 
      title: string; 
      style: string; 
      lyrics: string; 
      status: 'processing' | 'succeeded' | 'failed'; 
      error?: string; 
      is_public?: boolean;
      mureka_id?: string;
      metadata?: { [key: string]: any };
    }
  ): Promise<Music | null> {
      if (!this.supabase) return null;
      const user = this.currentUser();
      if (!user) return null;
  
      const { data, error } = await this.supabase
          .from('musics')
          .insert({
              user_id: user.id,
              title: musicData.title,
              style: musicData.style,
              description: musicData.lyrics, // Mapeia 'lyrics' para a coluna 'description'
              status: musicData.status,
              task_id: musicData.mureka_id, // Mapeia 'mureka_id' para a coluna 'task_id'
              metadata: { ...musicData.metadata, error: musicData.error },
              is_public: musicData.is_public ?? false,
          })
          .select()
          .single();
  
      if (error) {
          console.error('addMusic: Error inserting music:', error.message);
          return null;
      }
      return data as Music;
  }
  
  async updateMusic(
    musicId: string, 
    updates: { 
      status?: 'processing' | 'succeeded' | 'failed'; 
      audio_url?: string; 
      error?: string; 
      mureka_id?: string;
      metadata?: { [key: string]: any };
      description?: string;
    }
  ): Promise<Music | null> {
      if (!this.supabase) return null;
      
      const updateData: { [key: string]: any } = {};
      if (updates.status) updateData.status = updates.status;
      if (updates.audio_url) updateData.audio_url = updates.audio_url;
      if (updates.mureka_id) updateData.task_id = updates.mureka_id;
      if (updates.description) updateData.description = updates.description;

      // Merge metadata instead of overwriting
      if (updates.metadata || updates.error) {
        const { data: existingMusic } = await this.supabase.from('musics').select('metadata').eq('id', musicId).single();
        const existingMetadata = existingMusic?.metadata || {};
        updateData.metadata = { ...existingMetadata, ...updates.metadata, error: updates.error };
      }
      
      const { data, error } = await this.supabase
          .from('musics')
          .update(updateData)
          .eq('id', musicId)
          .select()
          .single();
  
      if (error) {
          console.error(`updateMusic: Error updating music ID ${musicId}:`, error.message);
          return null;
      }
      return data as Music;
  }
  
  async getMusicForUser(userId: string): Promise<Music[]> {
      if (!this.supabase) return [];
      const { data, error } = await this.supabase
          .from('musics')
          .select('*')
          .eq('user_id', userId)
          .order('created_at', { ascending: false });
      if (error) {
          console.error('getMusicForUser: Error fetching music:', error.message);
          return [];
      }
      return (data as Music[]) || [];
  }
  
  async getAllPublicMusic(): Promise<Music[]> {
      if (!this.supabase) return [];
      const { data, error } = await this.supabase
          .from('musics')
          .select('*, profiles(email, display_name)')
          .eq('is_public', true)
          .eq('status', 'succeeded')
          .order('created_at', { ascending: false })
          .limit(50);
      
      if (error) {
          console.error('getAllPublicMusic: Error fetching public music:', error.message);
          return [];
      }
      
      // Mapeia os dados para incluir 'user_email' no objeto Music
      const formattedData = data.map((item: any) => ({
          ...item,
          user_email: item.profiles?.email || null,
      }));

      return formattedData as Music[];
  }

  async getPlans(): Promise<Plan[]> {
    if (!this.supabase) return [];
    const { data, error } = await this.supabase
      .from('plans')
      .select('*')
      .eq('is_active', true)
      .order('price', { ascending: true });
    
    if (error) {
      console.error('getPlans: Error fetching plans:', error.message);
      return [];
    }
    return data as Plan[];
  }

  async deleteMusic(musicId: string) {
    if (!this.supabase) throw new Error("Supabase client not initialized.");
    return this.supabase.from('musics').delete().eq('id', musicId);
  }

  async deleteFailedMusicForUser(userId: string) {
    if (!this.supabase) throw new Error("Supabase client not initialized.");
    return this.supabase.from('musics').delete().eq('user_id', userId).eq('status', 'failed');
  }

  async updateMusicVisibility(musicId: string, isPublic: boolean): Promise<Music | null> {
    if (!this.supabase) return null;
    const { data, error } = await this.supabase
        .from('musics')
        .update({ is_public: isPublic })
        .eq('id', musicId)
        .select()
        .single();
    if (error) {
        console.error('updateMusicVisibility: Error updating visibility:', error.message);
        return null;
    }
    return data as Music;
  }
}
