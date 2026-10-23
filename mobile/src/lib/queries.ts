/**
 * Queries shared between screens. They're shaped so the data a crew needs on
 * the apparatus floor (rigs, checklists) is cached once and available offline.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { api, type Schemas, unwrap } from '@/api/client';

type Page<T> = { results: T[] };

export const rigsQuery = {
  queryKey: ['apparatus'],
  queryFn: () => unwrap(api().GET('/api/v1/apparatus/', { params: { query: { page_size: 200 } } })),
};

/** Every active checklist in one request, so any rig can be checked offline. */
export const checklistsQuery = {
  queryKey: ['checklists'],
  queryFn: async () =>
    (await unwrap(api().GET('/api/v1/checklists/', { params: { query: { is_active: true, page_size: 200 } } })))
      .results,
};

export function useChecklists() {
  return useQuery(checklistsQuery);
}

export function checklistsFor(templates: Schemas['ChecklistTemplate'][], rig: Schemas['Apparatus'] | undefined) {
  if (!rig) return [];
  return templates.filter((t) => !t.apparatus_type || t.apparatus_type === rig.apparatus_type);
}

/** One rig, starting from the fleet list if we have it (instant, and works offline). */
export function useRig(id: number) {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: ['apparatus', id],
    queryFn: () => unwrap(api().GET('/api/v1/apparatus/{id}/', { params: { path: { id } } })),
    placeholderData: () =>
      queryClient.getQueryData<Page<Schemas['Apparatus']>>(rigsQuery.queryKey)?.results.find((r) => r.id === id),
  });
}
