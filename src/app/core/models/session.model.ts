import { User } from '@supabase/supabase-js';
import { Profile } from './profile.model';

export interface SessionState {
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  initialized: boolean;
}