import { useQuery } from '@tanstack/react-query';

import { http, type Schemas } from '@/api/http';

export type ValueSets = Schemas['NerisValueSets'];
export type NerisValue = Schemas['NerisValue'];

/** NERIS choice lists. They only change with a FireFirst release, so fetch once. */
export function useValueSets() {
  return useQuery({
    queryKey: ['/api/v1/neris/value-sets/'],
    queryFn: () => http.get<ValueSets>('/api/v1/neris/value-sets/'),
    staleTime: Infinity,
  });
}

export const isFire = (types: string[]) => types.some((t) => t.startsWith('FIRE||'));
export const isStructureFire = (types: string[]) => types.some((t) => t.startsWith('FIRE||STRUCTURE_FIRE'));
export const isOutsideFire = (types: string[]) => types.some((t) => t.startsWith('FIRE||OUTSIDE_FIRE'));
export const isMedical = (types: string[]) => types.some((t) => t.startsWith('MEDICAL||'));

/** Group hierarchical options ("Fire › Structure Fire › Room and Contents") by their first two levels. */
export function grouped(options: NerisValue[]) {
  const groups = new Map<string, { value: string; label: string }[]>();
  for (const option of options) {
    const parts = option.label.split(' › ');
    const group = parts.length > 1 ? parts.slice(0, -1).join(' › ') : 'Other';
    groups.set(group, [...(groups.get(group) ?? []), { value: option.value, label: parts[parts.length - 1] }]);
  }
  return [...groups.entries()];
}

export function labelOf(options: NerisValue[] | undefined, value: string | null | undefined) {
  if (!value) return '';
  return options?.find((o) => o.value === value)?.label ?? value;
}

/** The last part of a hierarchical label: "Fire › Structure Fire › Room and Contents" → "Room and Contents". */
export const shortLabel = (label: string) => label.split(' › ').at(-1) ?? label;
