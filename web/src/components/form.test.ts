import { describe, expect, it } from 'vitest';

import { type FieldSpec, toBody, toLocalInput, toValues } from './form';

const fields: FieldSpec[] = [
  { name: 'name', label: 'Name', type: 'text' },
  { name: 'mileage', label: 'Mileage', type: 'number' },
  { name: 'station', label: 'Station', type: 'relation', endpoint: '/x/', optionLabel: () => '' },
  { name: 'invitees', label: 'Invitees', type: 'relation', endpoint: '/x/', optionLabel: () => '', multiple: true },
  { name: 'active', label: 'Active', type: 'checkbox' },
  { name: 'due', label: 'Due', type: 'date' },
  { name: 'starts_at', label: 'Starts', type: 'datetime' },
];

describe('form value conversion', () => {
  it('turns empty inputs into nulls the API accepts', () => {
    const body = toBody(fields, {
      name: '',
      mileage: '',
      station: '',
      invitees: [],
      active: false,
      due: '',
      starts_at: '',
    });
    expect(body).toEqual({
      name: '',
      mileage: null,
      station: null,
      invitees: [],
      active: false,
      due: null,
      starts_at: null,
    });
  });

  it('converts numbers and relations', () => {
    const body = toBody(fields, { name: 'E1', mileage: '41250', station: '3', invitees: ['4', '7'], active: true });
    expect(body).toMatchObject({ name: 'E1', mileage: 41250, station: 3, invitees: [4, 7], active: true });
  });

  it('round-trips a timestamp through the local datetime input', () => {
    const iso = '2026-11-05T18:30:00.000Z';
    const values = toValues(fields, { starts_at: iso });
    expect(values.starts_at).toBe(toLocalInput(iso));
    expect(toBody(fields, values).starts_at).toBe(iso);
  });

  it('loads records into string inputs', () => {
    const values = toValues(fields, { name: 'E1', mileage: 0, station: null, invitees: [2], active: true });
    expect(values).toMatchObject({ name: 'E1', mileage: '0', station: '', invitees: ['2'], active: true });
  });
});
