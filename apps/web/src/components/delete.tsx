'use client';
import { useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { ConfirmModal } from './ui';
import { useToast } from './toast';

/**
 * A Delete button that only a Super Administrator sees. It asks first, says what goes with the record, and shows the
 * server's reason if the record is part of the official record (certificates, finalised results, payments) and is refused.
 */
export function DeleteButton({ path, what, goes, label = 'Delete', size = 'sm', onDone }: {
  path: string; what: string; goes?: React.ReactNode; label?: string; size?: 'sm' | ''; onDone: () => void;
}) {
  const { me } = useAuth();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  if (me.role !== 'super_admin') return null;
  return (
    <>
      <button className={`btn danger ${size}`} onClick={() => setOpen(true)}>{label}</button>
      {open && (
        <ConfirmModal title={`Delete ${what}?`} danger confirmLabel="Delete" onClose={() => setOpen(false)}
          message={<>This cannot be undone. {goes} Certificates, finalised results and recorded payments are never deleted, so if any of those depend on this the delete is refused and nothing changes. A copy of what was removed is kept in the audit log.</>}
          onConfirm={async () => { await api.del(path); toast('Deleted'); onDone(); }} />
      )}
    </>
  );
}
