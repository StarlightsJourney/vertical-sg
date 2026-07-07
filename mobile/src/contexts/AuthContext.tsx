import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '../config/supabase';
import { migrateLocalClimbs, syncQueuedClimbs } from '../services/climbs';

interface AuthState {
  session: Session | null;
  user: User | null;
  loading: boolean;
  isAnonymous: boolean;
}

interface AuthContextValue extends AuthState {
  signUpWithEmail: (email: string, password: string) => Promise<{ error?: string; needsConfirmation?: boolean }>;
  signInWithEmail: (email: string, password: string) => Promise<{ error?: string }>;
  signOut: () => Promise<void>;
  refreshAuth: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    session: null,
    user: null,
    loading: true,
    isAnonymous: false,
  });
  const wasAnonymous = useRef(false);

  // Bootstrap: check for existing session, sign in anonymously if none
  useEffect(() => {
    let mounted = true;

    async function bootstrap() {
      try {
        const { data: { session } } = await supabase.auth.getSession();

        if (!mounted) return;

        if (session) {
          setState({
            session,
            user: session.user,
            loading: false,
            isAnonymous: session.user.is_anonymous ?? false,
          });
        } else {
          // No existing session — create anonymous account
          const { data, error } = await supabase.auth.signInAnonymously();
          if (!mounted) return;

          if (error) {
            console.error('Anonymous sign-in failed:', error.message);
            setState((prev) => ({ ...prev, loading: false }));
          } else if (data.session) {
            setState({
              session: data.session,
              user: data.session.user,
              loading: false,
              isAnonymous: true,
            });
          }
        }
      } catch (err) {
        if (!mounted) return;
        console.error('Auth bootstrap error:', err);
        setState((prev) => ({ ...prev, loading: false }));
      }
    }

    bootstrap();

    // Listen for auth state changes (sign-out on other device, token refresh, etc.)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (!mounted) return;

      if (event === 'SIGNED_OUT') {
        wasAnonymous.current = true;
        // Sign back in anonymously so map browsing continues to work
        try {
          const { data } = await supabase.auth.signInAnonymously();
          if (data.session) {
            setState({
              session: data.session,
              user: data.session.user,
              loading: false,
              isAnonymous: true,
            });
          }
        } catch {
          setState({ session: null, user: null, loading: false, isAnonymous: false });
        }
      } else if (session) {
        const isAnon = session.user.is_anonymous ?? false;
        const prevWasAnon = wasAnonymous.current;

        setState({
          session,
          user: session.user,
          loading: false,
          isAnonymous: isAnon,
        });

        // Trigger climb migration when user upgrades from anonymous to authenticated
        if (!isAnon && prevWasAnon && session.user) {
          migrateLocalClimbs(session.user.id).then((count) => {
            if (count > 0) {
              console.log(`Migrated ${count} local climbs to cloud.`);
            }
          });
          // Sync any queued climbs
          syncQueuedClimbs(session.user.id);
        }

        wasAnonymous.current = isAnon;
      } else {
        setState({ session: null, user: null, loading: false, isAnonymous: false });
        wasAnonymous.current = false;
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  /**
   * Sign up with email/password.
   *
   * If the current session is anonymous, upgrade it in place via updateUser —
   * this keeps the same user id, so climbs already logged under the anonymous
   * session stay attached automatically (no migration needed). If Supabase's
   * "Confirm email" setting is on, the account isn't fully active until the
   * confirmation link is clicked; we surface that via needsConfirmation.
   */
  const signUpWithEmail = useCallback(async (email: string, password: string): Promise<{ error?: string; needsConfirmation?: boolean }> => {
    try {
      if (state.isAnonymous) {
        const { data, error } = await supabase.auth.updateUser({ email, password });
        if (error) return { error: error.message };

        // Force a fresh token so `is_anonymous` flips to false and the
        // onAuthStateChange listener below picks up the transition.
        await supabase.auth.refreshSession();

        const needsConfirmation = !!data.user?.new_email || !data.user?.email_confirmed_at;
        return { needsConfirmation };
      }

      const { error } = await supabase.auth.signUp({ email, password });
      if (error) return { error: error.message };
      return { needsConfirmation: true };
    } catch (err) {
      return { error: err instanceof Error ? err.message : 'Sign-up failed.' };
    }
  }, [state.isAnonymous]);

  /** Sign in to an existing account with email/password. */
  const signInWithEmail = useCallback(async (email: string, password: string): Promise<{ error?: string }> => {
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) return { error: error.message };
      return {};
    } catch (err) {
      return { error: err instanceof Error ? err.message : 'Sign-in failed.' };
    }
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    // onAuthStateChange handler will sign back in anonymously
  }, []);

  const refreshAuth = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
      setState({
        session,
        user: session.user,
        loading: false,
        isAnonymous: session.user.is_anonymous ?? false,
      });
    }
  }, []);

  return (
    <AuthContext.Provider
      value={{
        ...state,
        signUpWithEmail,
        signInWithEmail,
        signOut,
        refreshAuth,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}
