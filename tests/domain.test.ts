import { describe, it, expect } from 'vitest';
import {
  assertCanAddEvidence,
  assertCanResolve,
  assertUserCanRaiseDispute,
  canUserViewDispute,
  canUserAddEvidence,
  canUserResolveDispute,
  DisputeNotOpenError,
  ForbiddenError,
} from '../src/domain.js';

describe('Domain Rules (Pure Functions)', () => {
  describe('Dispute Lifecycle & State Machine', () => {
    it('allows evidence and resolution on OPEN dispute', () => {
      expect(() => assertCanAddEvidence('OPEN')).not.toThrow();
      expect(() => assertCanResolve('OPEN')).not.toThrow();
    });

    it('rejects evidence and resolution on RESOLVED dispute', () => {
      expect(() => assertCanAddEvidence('RESOLVED')).toThrow(DisputeNotOpenError);
      expect(() => assertCanResolve('RESOLVED')).toThrow(DisputeNotOpenError);
    });
  });

  describe('Authorisation & Access Rules', () => {
    const claimant = { id: 'u-sam', role: 'partner' as const };
    const respondent = { id: 'u-dana', role: 'partner' as const };
    const uninvolvedPartner = { id: 'u-chris', role: 'partner' as const };
    const arbiter = { id: 'u-ari', role: 'arbiter' as const };

    const dispute = { claimantId: 'u-sam', respondentId: 'u-dana' };

    it('raising disputes: only partners may raise', () => {
      expect(() => assertUserCanRaiseDispute('partner')).not.toThrow();
      expect(() => assertUserCanRaiseDispute('arbiter')).toThrow(ForbiddenError);
    });

    it('viewing disputes: claimant, respondent, and arbiter can view; uninvolved partner cannot', () => {
      expect(canUserViewDispute(claimant, dispute)).toBe(true);
      expect(canUserViewDispute(respondent, dispute)).toBe(true);
      expect(canUserViewDispute(arbiter, dispute)).toBe(true);
      expect(canUserViewDispute(uninvolvedPartner, dispute)).toBe(false);
    });

    it('adding evidence: only claimant and respondent can add evidence', () => {
      expect(canUserAddEvidence(claimant, dispute)).toBe(true);
      expect(canUserAddEvidence(respondent, dispute)).toBe(true);
      expect(canUserAddEvidence(uninvolvedPartner, dispute)).toBe(false);
      expect(canUserAddEvidence(arbiter, dispute)).toBe(false);
    });

    it('resolving disputes: only arbiters may resolve', () => {
      expect(canUserResolveDispute(arbiter)).toBe(true);
      expect(canUserResolveDispute(claimant)).toBe(false);
      expect(canUserResolveDispute(respondent)).toBe(false);
      expect(canUserResolveDispute(uninvolvedPartner)).toBe(false);
    });
  });
});
