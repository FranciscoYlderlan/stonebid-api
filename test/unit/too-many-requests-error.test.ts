import { describe, expect, it } from 'vitest';
import {
  retryAfterSeconds,
  TooManyRequestsError,
} from '../../src/infra/http/errors/too-many-requests-error.ts';

describe('TooManyRequestsError: mensagem do 429 em português (T5k)', () => {
  it('plural: "Tente de novo em 48 segundos."', () => {
    const error = new TooManyRequestsError(48);
    expect(error.code).toBe('TOO_MANY_REQUESTS');
    expect(error.message).toBe('Muitas requisições. Tente de novo em 48 segundos.');
  });

  it('singular: "Tente de novo em 1 segundo."', () => {
    const error = new TooManyRequestsError(1);
    expect(error.code).toBe('TOO_MANY_REQUESTS');
    expect(error.message).toBe('Muitas requisições. Tente de novo em 1 segundo.');
  });

  it('segundos a partir do ttl em ms, arredondados para cima como o retry-after', () => {
    expect(retryAfterSeconds(47_001)).toBe(48);
    expect(retryAfterSeconds(48_000)).toBe(48);
    expect(retryAfterSeconds(1_000)).toBe(1);
    expect(retryAfterSeconds(999)).toBe(1);
    expect(retryAfterSeconds(0)).toBe(1);
  });
});
