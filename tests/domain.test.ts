import { describe, it, expect } from 'vitest';
import {
  canAddEvidence,
  canResolveDispute,
  assertCanAddEvidence,
  assertCanResolve,
  canUserRaiseDispute,
  canUserViewDispute,
  canUserAddEvidence,
  canUserResolveDispute,
  DisputeNotOpenError,
} from '../src/domain.js';
import {
  buildCanonicalEventString,
  computeEventHash,
  computeSha256,
  verifyChain,
  GENESIS_PREV_HASH,
} from '../src/audit.js';

describe('Domain Rules (Pure Functions)', () => {
  describe('Dispute Lifecycle & State Machine', () => {
    it('allows evidence and resolution on OPEN dispute', () => {
      expect(canAddEvidence('OPEN')).toBe(true);
      expect(canResolveDispute('OPEN')).toBe(true);
      expect(() => assertCanAddEvidence('OPEN')).not.toThrow();
      expect(() => assertCanResolve('OPEN')).not.toThrow();
    });

    it('rejects evidence and resolution on RESOLVED dispute', () => {
      expect(canAddEvidence('RESOLVED')).toBe(false);
      expect(canResolveDispute('RESOLVED')).toBe(false);
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
      expect(canUserRaiseDispute('partner')).toBe(true);
      expect(canUserRaiseDispute('arbiter')).toBe(false);
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

  describe('Hash Chain & Tamper Evidence', () => {
    it('produces a known digest for known input', () => {
      const event1 = {
        id: 1,
        disputeId: 'disp-1',
        type: 'DISPUTE_RAISED',
        actorId: 'u-sam',
        occurredAt: '2026-09-09T19:36:10.000Z',
        payload: {
          orderReference: 'PO-8834',
          description: '5 pallets damaged',
          respondentId: 'u-dana',
        },
      };

      const canonical = buildCanonicalEventString(event1);
      expect(canonical).toBe(
        '{"id":1,"disputeId":"disp-1","type":"DISPUTE_RAISED","actorId":"u-sam","occurredAt":"2026-09-09T19:36:10.000Z","payload":{"orderReference":"PO-8834","description":"5 pallets damaged","respondentId":"u-dana"}}'
      );

      const hash = computeEventHash(GENESIS_PREV_HASH, event1);
      const expectedDigest = computeSha256(GENESIS_PREV_HASH + '\n' + canonical);
      expect(hash).toBe(expectedDigest);
    });

    function createValidChain() {
      const e1Input = {
        id: 1,
        disputeId: 'd-1',
        type: 'DISPUTE_RAISED',
        actorId: 'u-sam',
        occurredAt: '2026-09-09T10:00:00.000Z',
        payload: { orderReference: 'PO-1', description: 'desc', respondentId: 'u-dana' },
      };
      const e1Hash = computeEventHash(GENESIS_PREV_HASH, e1Input);
      const e1 = { ...e1Input, prevHash: GENESIS_PREV_HASH, hash: e1Hash };

      const e2Input = {
        id: 2,
        disputeId: 'd-1',
        type: 'EVIDENCE_ADDED',
        actorId: 'u-sam',
        occurredAt: '2026-09-09T10:05:00.000Z',
        payload: { evidenceId: 'ev-1', notes: 'note 1' },
      };
      const e2Hash = computeEventHash(e1.hash, e2Input);
      const e2 = { ...e2Input, prevHash: e1.hash, hash: e2Hash };

      const e3Input = {
        id: 3,
        disputeId: 'd-1',
        type: 'DISPUTE_RESOLVED',
        actorId: 'u-ari',
        occurredAt: '2026-09-09T10:10:00.000Z',
        payload: { resolutionNote: 'ruled' },
      };
      const e3Hash = computeEventHash(e2.hash, e3Input);
      const e3 = { ...e3Input, prevHash: e2.hash, hash: e3Hash };

      return [e1, e2, e3];
    }

    it('verifies a valid chain successfully', () => {
      const chain = createValidChain();
      const res = verifyChain(chain);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.eventsChecked).toBe(3);
      }
    });

    it('catches a mutated payload', () => {
      const chain = createValidChain();
      // Mutate payload of event 2
      chain[1].payload = { evidenceId: 'ev-1', notes: 'tampered notes' };
      const res = verifyChain(chain);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.firstBadEventId).toBe(2);
      }
    });

    it('catches a swapped pair of events', () => {
      const chain = createValidChain();
      // Swap event 2 and event 3
      const temp = chain[1];
      chain[1] = chain[2];
      chain[2] = temp;

      const res = verifyChain(chain);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.firstBadEventId).toBe(3);
      }
    });

    it('catches a deleted row in the middle of the chain', () => {
      const chain = createValidChain();
      // Remove event 2
      const brokenChain = [chain[0], chain[2]];
      const res = verifyChain(brokenChain);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.firstBadEventId).toBe(3);
      }
    });
  });
});
