import { Injectable, OnDestroy, computed, inject, signal } from '@angular/core';
import { Profile, UserRole } from '../models/profile.model';
import { SessionState } from '../models/session.model';
import { SupabaseService } from './supabase.service';

@Injectable({ providedIn: 'root' })
export class SessionService implements OnDestroy {
  private supabase = inject(SupabaseService);

  private _state = signal<SessionState>({
    user:        null,
    profile:     null,
    loading:     true,
    initialized: false,
  });

  readonly state       = this._state.asReadonly();
  readonly user        = computed(() => this._state().user);
  readonly profile     = computed(() => this._state().profile);
  readonly role        = computed(() => this._state().profile?.role ?? null);
  readonly isLoading   = computed(() => this._state().loading);
  readonly isLoggedIn  = computed(() => !!this._state().user);
  readonly initialized = computed(() => this._state().initialized);

  readonly isUser     = computed(() => this.role() === 'user');
  readonly isAdmin    = computed(() => this.role() === 'admin');

  private authSubscription: { unsubscribe: () => void } | null = null;

  constructor() {
    this.init();
  }

  private init(): void {
    const { data } = this.supabase.auth.onAuthStateChange((event, session) => {

      // TOKEN_REFRESHED ocurre automáticamente durante operaciones
      // de storage y db. Si el perfil ya está cargado, no hacer nada
      // — solo actualizar el user con el nuevo token.
      if (event === 'TOKEN_REFRESHED') {
        const current = this._state();
        if (current.initialized) {
          this._state.set({ ...current, user: session?.user ?? null });
          return;
        }
      }

      // SIGNED_OUT: limpiar todo
      if (!session?.user) {
        this._state.set({
          user:        null,
          profile:     null,
          loading:     false,
          initialized: true,
        });
        return;
      }

      // SIGNED_IN / INITIAL_SESSION: cargar perfil solo si
      // no lo tenemos aún o si cambió el usuario
      const current = this._state();
      const sameUser = current.user?.id === session.user.id;

      if (sameUser && current.initialized) {
        // Mismo usuario, perfil ya cargado — solo actualizar token
        this._state.set({ ...current, user: session.user });
        return;
      }

      // Usuario nuevo o primera carga — cargar perfil
      const user = session.user;
      this.fetchProfile(user.id).then(profile => {
        this._state.set({
          user,
          profile,
          loading:     false,
          initialized: true,
        });
      });
    });

    this.authSubscription = data.subscription;
  }

  private async fetchProfile(userId: string): Promise<Profile | null> {
    const { data, error } = await this.supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();

    if (!error) return data as Profile;

    // PGRST116 = no rows — usuario OAuth nuevo sin perfil aún
    if (error.code === 'PGRST116') {
      return this.createOAuthProfile(userId);
    }

    console.error('Error al cargar perfil:', error.message);
    return null;
  }

  private async createOAuthProfile(userId: string): Promise<Profile | null> {
    const { data: userData } = await this.supabase.auth.getUser();
    const meta = userData.user?.user_metadata ?? {};

    const newProfile = {
      id:        userId,
      full_name: (meta['full_name'] ?? meta['name'] ?? userData.user?.email?.split('@')[0] ?? '') as string,
      role:      'user' as UserRole,
    };

    const { data, error } = await this.supabase
      .from('profiles')
      .insert(newProfile)
      .select()
      .single();

    if (error) {
      console.error('Error al crear perfil OAuth:', error.message);
      return null;
    }

    return data as Profile;
  }

  // Actualiza el perfil en memoria sin volver a consultar Supabase.
  // Llamar después de cualquier UPDATE exitoso en profiles o storage.
  updateProfileLocally(partial: Partial<Profile>): void {
    const current = this._state();
    if (!current.profile) return;
    this._state.set({
      ...current,
      profile: { ...current.profile, ...partial },
    });
  }

  hasRole(role: UserRole): boolean {
    return this.role() === role;
  }

  hasAnyRole(roles: UserRole[]): boolean {
    const current = this.role();
    return current ? roles.includes(current) : false;
  }

  ngOnDestroy(): void {
    this.authSubscription?.unsubscribe();
  }
}