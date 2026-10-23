import { describe, expect, it } from 'vitest';

import { errorMessage, withQuery } from './http';

describe('errorMessage', () => {
  it('reads DRF detail and field errors', () => {
    expect(errorMessage({ detail: 'Not found.' })).toBe('Not found.');
    expect(errorMessage({ unit_number: ['This field is required.'] })).toBe('Unit number: This field is required.');
    expect(errorMessage({ non_field_errors: ['Nope.'] })).toBe('Nope.');
  });
});

describe('withQuery', () => {
  it('drops empty parameters', () => {
    expect(withQuery('/api/x/', { a: 1, b: '', c: undefined, d: false })).toBe('/api/x/?a=1&d=false');
    expect(withQuery('/api/x/', {})).toBe('/api/x/');
  });
});
