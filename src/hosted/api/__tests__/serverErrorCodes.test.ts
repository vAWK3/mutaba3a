import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '../../../../server/src/errors.js';
import { SERVER_ERROR_CODES } from '../serverErrorCodes';

describe("the portal's copy of the server's error codes", () => {
  it('lists exactly the server ERROR_CODES', () => {
    expect([...SERVER_ERROR_CODES].sort()).toEqual(Object.keys(ERROR_CODES).sort());
  });
});
