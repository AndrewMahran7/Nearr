import { useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useLocale } from '../hooks/useLocale';
import { supabase } from '../lib/supabase';

/** Mounted only after local eligibility. Locale remains usable offline;
 * account sync controls server push language and never grants processing. */
export function LocaleAccountSync() {
  const { session, loading } = useAuth();
  const { locale } = useLocale();
  useEffect(() => {
    if (loading || !session?.user.id || !session.access_token || session.access_token.endsWith('no-token')) return;
    void supabase.rpc('set_my_ui_locale', { p_locale: locale }).then(() => undefined, () => undefined);
  }, [loading, session?.user.id, session?.access_token, locale]);
  return null;
}
