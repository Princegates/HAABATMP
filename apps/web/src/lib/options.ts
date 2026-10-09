'use client';
import { useMemo } from 'react';
import { useApi } from './api';

type Opt = { value: string; label: string };
function useList(path: string | null, map: (r: any) => Opt): Opt[] {
  const { data } = useApi<{ data: any[] }>(path);
  return useMemo(() => (data?.data ?? []).map(map), [data]); // eslint-disable-line react-hooks/exhaustive-deps
}
export const useOrgOptions = (enabled = true) => useList(enabled ? '/organizations?limit=200' : null, (o) => ({ value: o.id, label: o.name }));
export const useCourseOptions = () => useList('/courses?limit=200', (c) => ({ value: c.id, label: `${c.code} · ${c.title}` }));
export const useInstructorOptions = () => useList('/users?role=instructor&limit=200', (u) => ({ value: u.id, label: u.full_name }));
export const useTraineeOptions = (orgId?: string) => useList(`/users?role=trainee&limit=200${orgId ? `&organization_id=${orgId}` : ''}`, (u) => ({ value: u.id, label: `${u.full_name} (${u.email})` }));
export function useCategoryOptions() {
  const { data } = useApi<any[]>('/course-categories');
  return useMemo(() => (data ?? []).map((c) => ({ value: c.id, label: `${c.code} · ${c.name}` })), [data]);
}
export function useClassroomOptions() {
  const { data } = useApi<any[]>('/classrooms');
  return useMemo(() => (data ?? []).filter((c) => c.active).map((c) => ({ value: c.id, label: `${c.name} (${c.capacity})` })), [data]);
}
