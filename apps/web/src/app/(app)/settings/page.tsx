'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useApi } from '@/lib/api';
import { settingsHref } from '@/lib/settings-links';

/** Opens the first settings page this person is allowed to see (finance, for example, starts at Payment Methods). */
export default function SettingsIndex() {
  const router = useRouter();
  const { data } = useApi<{ key: string }[]>('/settings/pages');
  useEffect(() => { if (data?.[0]) router.replace(settingsHref(data[0].key)); }, [data, router]);
  return null;
}
