import { useQuery } from '@tanstack/react-query';

import { api, unwrap } from '@/api/client';

/** NERIS choice lists. They only change with a FireFirst release, so cache them for good (and offline). */
export function useValueSets() {
  return useQuery({
    queryKey: ['neris-value-sets'],
    queryFn: () => unwrap(api().GET('/api/v1/neris/value-sets/')),
    staleTime: Infinity,
    gcTime: Infinity,
  });
}

export const isFire = (types: string[]) => types.some((t) => t.startsWith('FIRE||'));
export const isStructureFire = (types: string[]) => types.some((t) => t.startsWith('FIRE||STRUCTURE_FIRE'));
export const isOutsideFire = (types: string[]) => types.some((t) => t.startsWith('FIRE||OUTSIDE_FIRE'));
export const isMedical = (types: string[]) => types.some((t) => t.startsWith('MEDICAL||'));

/** "Fire › Structure Fire › Room and Contents Fire" → "Room and Contents Fire". */
export const shortLabel = (label: string) => label.split(' › ').at(-1) ?? label;
