import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { validateId, validateText, errorHandler } from '../server.js';
import { JWT_SECRET, requireAuth } from '../fabric.js';

describe('Backend Server Utilities & Middleware', () => {
  describe('validateId', () => {
    test('accepts valid alphanumeric, dash, and underscore IDs', () => {
      assert.equal(validateId('D-101'), 'D-101');
      assert.equal(validateId('PO_5542_v2'), 'PO_5542_v2');
      assert.equal(validateId(' supplier1 '), 'supplier1');
    });

    test('rejects empty or whitespace-only IDs', () => {
      assert.throws(() => validateId(''), /VALIDATION: ID is required and must be a string/);
      assert.throws(() => validateId('   '), /VALIDATION: ID must be between 1 and 100 characters/);
    });

    test('rejects non-string inputs', () => {
      assert.throws(() => validateId(null), /VALIDATION: ID is required and must be a string/);
      assert.throws(() => validateId(undefined), /VALIDATION: ID is required and must be a string/);
      assert.throws(() => validateId(123), /VALIDATION: ID is required and must be a string/);
    });

    test('rejects IDs longer than 100 characters', () => {
      assert.throws(
        () => validateId('a'.repeat(101)),
        /VALIDATION: ID must be between 1 and 100 characters/
      );
    });

    test('rejects IDs containing special characters', () => {
      assert.throws(
        () => validateId('D 101'),
        /VALIDATION: ID can only contain alphanumeric characters/
      );
      assert.throws(
        () => validateId('D@101!'),
        /VALIDATION: ID can only contain alphanumeric characters/
      );
      assert.throws(
        () => validateId('dispute/1'),
        /VALIDATION: ID can only contain alphanumeric characters/
      );
    });
  });

  describe('validateText', () => {
    test('accepts and trims valid text', () => {
      assert.equal(validateText(' Damaged pallet '), 'Damaged pallet');
    });

    test('rejects empty or whitespace-only text', () => {
      assert.throws(() => validateText(''), /VALIDATION: Text is required and must be a string/);
      assert.throws(() => validateText('   '), /VALIDATION: Text cannot be empty/);
    });

    test('rejects non-string inputs', () => {
      assert.throws(() => validateText(null), /VALIDATION: Text is required and must be a string/);
      assert.throws(() => validateText({}), /VALIDATION: Text is required and must be a string/);
    });

    test('rejects text exceeding max length', () => {
      assert.throws(
        () => validateText('a'.repeat(1001), 'Description', 1000),
        /VALIDATION: Description must not exceed 1000 characters/
      );
    });
  });

  describe('requireAuth Middleware', () => {
    test('rejects request with missing authorization header', () => {
      const req = { headers: {} };
      let statusCode = null;
      let jsonPayload = null;
      const res = {
        status: (code) => {
          statusCode = code;
          return {
            json: (data) => {
              jsonPayload = data;
            },
          };
        },
      };
      let nextCalled = false;

      requireAuth(req, res, () => {
        nextCalled = true;
      });
      assert.equal(statusCode, 401);
      assert.match(jsonPayload.error, /Missing or invalid Authorization header/);
      assert.equal(nextCalled, false);
    });

    test('rejects request with malformed authorization header', () => {
      const req = { headers: { authorization: 'Basic 12345' } };
      let statusCode = null;
      const res = {
        status: (code) => {
          statusCode = code;
          return { json: () => {} };
        },
      };
      let nextCalled = false;

      requireAuth(req, res, () => {
        nextCalled = true;
      });
      assert.equal(statusCode, 401);
      assert.equal(nextCalled, false);
    });

    test('rejects request with invalid token', () => {
      const req = { headers: { authorization: 'Bearer invalid.token.here' } };
      let statusCode = null;
      let jsonPayload = null;
      const res = {
        status: (code) => {
          statusCode = code;
          return {
            json: (data) => {
              jsonPayload = data;
            },
          };
        },
      };
      let nextCalled = false;

      requireAuth(req, res, () => {
        nextCalled = true;
      });
      assert.equal(statusCode, 401);
      assert.match(jsonPayload.error, /Invalid or expired token/);
      assert.equal(nextCalled, false);
    });

    test('populates req.user and calls next() for valid token', () => {
      const token = jwt.sign({ sub: 'supplier1' }, JWT_SECRET, { expiresIn: '1h' });
      const req = { headers: { authorization: `Bearer ${token}` } };
      let nextCalled = false;
      const res = {};

      requireAuth(req, res, () => {
        nextCalled = true;
      });
      assert.equal(nextCalled, true);
      assert.equal(req.user, 'supplier1');
    });
  });

  describe('errorHandler Mapping', () => {
    const mockRes = () => {
      const res = {
        statusCode: null,
        data: null,
        status(code) {
          this.statusCode = code;
          return this;
        },
        json(payload) {
          this.data = payload;
          return this;
        },
      };
      return res;
    };

    test('maps ACCESS_DENIED to 403', () => {
      const res = mockRes();
      errorHandler(new Error('ACCESS_DENIED: only partners allowed'), {}, res, () => {});
      assert.equal(res.statusCode, 403);
      assert.match(res.data.error, /ACCESS_DENIED/);
    });

    test('maps CONFLICT to 400', () => {
      const res = mockRes();
      errorHandler(new Error('CONFLICT: Dispute already exists'), {}, res, () => {});
      assert.equal(res.statusCode, 400);
      assert.match(res.data.error, /CONFLICT/);
    });

    test('maps VALIDATION to 400', () => {
      const res = mockRes();
      errorHandler(new Error('VALIDATION: ID is required'), {}, res, () => {});
      assert.equal(res.statusCode, 400);
      assert.match(res.data.error, /VALIDATION/);
    });

    test('maps NOT_FOUND to 404', () => {
      const res = mockRes();
      errorHandler(new Error('NOT_FOUND: The dispute D-101 does not exist'), {}, res, () => {});
      assert.equal(res.statusCode, 404);
      assert.match(res.data.error, /NOT_FOUND/);
    });

    test('maps network UNAVAILABLE or connection failures to 503', () => {
      const res = mockRes();
      const err = new Error('14 UNAVAILABLE: failed to connect to all addresses');
      err.code = 14;
      errorHandler(err, {}, res, () => {});
      assert.equal(res.statusCode, 503);
      assert.match(res.data.error, /Ledger network is unavailable/);
    });

    test('maps DEADLINE_EXCEEDED to 504', () => {
      const res = mockRes();
      const err = new Error('4 DEADLINE_EXCEEDED: timed out');
      err.code = 4;
      errorHandler(err, {}, res, () => {});
      assert.equal(res.statusCode, 504);
      assert.match(res.data.error, /Ledger operation timed out/);
    });
  });
});
