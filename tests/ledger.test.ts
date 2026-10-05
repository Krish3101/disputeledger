import { createHmac } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import {
  buildCanonicalEventString,
  buildCanonicalPayload,
  computeEventHash,
  getGenesisHash,
  keyIdFor,
  verifyChain,
  type StoredEventRow,
} from '../src/ledger/chain.js';

const KEY = 'test-key';
const ledgerId = 'test-ledger-id';
const genesisHash = getGenesisHash(ledgerId);

const raised = {
  id: 1,
  disputeId: 'disp-1',
  type: 'DISPUTE_RAISED',
  actorId: 'u-sam',
  occurredAt: '2026-09-09T10:00:00.000Z',
  payload: { orderReference: 'PO-100', description: 'broken parts', respondentId: 'u-dana' },
};

function buildChain(): StoredEventRow[] {
  const inputs = [
    { ...raised, payload: JSON.stringify(raised.payload) },
    {
      id: 2,
      disputeId: 'disp-1',
      type: 'EVIDENCE_ADDED',
      actorId: 'u-sam',
      occurredAt: '2026-09-09T10:05:00.000Z',
      payload: JSON.stringify({ evidenceId: 'ev-1', notes: 'note 1' }),
    },
    {
      id: 3,
      disputeId: 'disp-1',
      type: 'DISPUTE_RESOLVED',
      actorId: 'u-ari',
      occurredAt: '2026-09-09T11:00:00.000Z',
      payload: JSON.stringify({ resolutionNote: 'carrier pays' }),
    },
  ];
  let prevHash = genesisHash;
  return inputs.map((e) => {
    const hash = computeEventHash(prevHash, e, KEY, ledgerId);
    const row = { ...e, prevHash, hash };
    prevHash = hash;
    return row;
  });
}

describe('canonical payload and envelope', () => {
  it('keeps only the known fields, in a fixed order', () => {
    const payload = buildCanonicalPayload('DISPUTE_RAISED', {
      respondentId: 'u-dana',
      injectedField: 'malicious',
      description: 'damaged cargo',
      orderReference: 'PO-100',
    });
    expect(JSON.stringify(payload)).toBe(
      '{"orderReference":"PO-100","description":"damaged cargo","respondentId":"u-dana"}'
    );
  });

  it('throws on an unknown type or a missing field', () => {
    expect(() => buildCanonicalPayload('UNKNOWN_TYPE', {})).toThrow('Unknown event type');
    expect(() => buildCanonicalPayload('DISPUTE_RAISED', { orderReference: 'PO-1' })).toThrow('missing required fields');
    expect(() => buildCanonicalPayload('EVIDENCE_ADDED', { evidenceId: 'e', notes: 5 })).toThrow('missing required fields');
  });

  it('builds the versioned envelope', () => {
    expect(buildCanonicalEventString(raised, ledgerId, 'k1')).toBe(
      '{"v":1,"ledger":"test-ledger-id","id":1,"type":"DISPUTE_RAISED","disputeId":"disp-1","actorId":"u-sam","occurredAt":"2026-09-09T10:00:00.000Z","keyId":"k1","payload":{"orderReference":"PO-100","description":"broken parts","respondentId":"u-dana"}}'
    );
  });

  it('HMACs the envelope with a domain prefix and the previous hash', () => {
    const canonical = buildCanonicalEventString(raised, ledgerId, keyIdFor(KEY));
    const expected = createHmac('sha256', KEY).update(`dl.event.v1\n${genesisHash}\n${canonical}`).digest('hex');
    expect(computeEventHash(genesisHash, raised, KEY, ledgerId)).toBe(expected);
  });

  it('derives the genesis hash from the ledger id', () => {
    expect(getGenesisHash('a')).not.toBe(getGenesisHash('b'));
    expect(getGenesisHash('a')).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('verifyChain', () => {
  it('accepts a valid chain and reports its head', () => {
    const chain = buildChain();
    const res = verifyChain(chain, KEY, ledgerId);
    expect(res).toEqual({ ok: true, eventsChecked: 3, head: { seq: 3, hash: chain[2].hash } });
  });

  it('accepts an empty chain with the genesis hash as head', () => {
    expect(verifyChain([], KEY, ledgerId)).toEqual({ ok: true, eventsChecked: 0, head: { seq: 0, hash: genesisHash } });
  });

  it('rejects stored payload bytes that are not canonical', () => {
    const chain = buildChain();
    chain[0].payload = JSON.stringify({ ...raised.payload, injected: 'hack' });
    const res = verifyChain(chain, KEY, ledgerId);
    expect(res).toMatchObject({ ok: false, reason: 'PAYLOAD_NOT_CANONICAL', eventId: 1, disputeId: 'disp-1' });
  });

  it('names the missing event, not the one after it', () => {
    const chain = buildChain();
    const res = verifyChain([chain[0], chain[2]], KEY, ledgerId);
    expect(res).toMatchObject({ ok: false, reason: 'CHAIN_BROKEN', eventId: 2 });
    expect(res.ok ? undefined : res.disputeId).toBeUndefined();
  });

  it('fails with the wrong key or the wrong ledger id', () => {
    const chain = buildChain();
    expect(verifyChain(chain, 'another-key', ledgerId)).toMatchObject({ ok: false, reason: 'CHAIN_BROKEN', eventId: 1 });
    expect(verifyChain(chain, KEY, 'other-ledger')).toMatchObject({ ok: false, reason: 'CHAIN_BROKEN', eventId: 1 });
  });
});
