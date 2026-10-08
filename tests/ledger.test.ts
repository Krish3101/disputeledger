import { createHmac } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import {
  computeEventHash,
  FIRST_PREV_HASH,
  verifyChain,
  type StoredEventRow,
} from '../src/ledger.js';

const KEY = 'test-key';

const raised = {
  id: 1,
  disputeId: 'disp-1',
  type: 'DISPUTE_RAISED',
  actorId: 'u-sam',
  occurredAt: '2026-09-09T10:00:00.000Z',
  payload: JSON.stringify({ orderReference: 'PO-100', description: 'broken parts', respondentId: 'u-dana' }),
};

function buildChain(): StoredEventRow[] {
  const inputs = [
    raised,
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
  let prevHash = FIRST_PREV_HASH;
  return inputs.map((e) => {
    const hash = computeEventHash(prevHash, e, KEY);
    const row = { ...e, prevHash, hash };
    prevHash = hash;
    return row;
  });
}

describe('event hash', () => {
  it('is the HMAC of the previous hash and the event fields, keyed with LEDGER_KEY', () => {
    const fields =
      '{"id":1,"type":"DISPUTE_RAISED","disputeId":"disp-1","actorId":"u-sam","occurredAt":"2026-09-09T10:00:00.000Z",' +
      '"payload":"{\\"orderReference\\":\\"PO-100\\",\\"description\\":\\"broken parts\\",\\"respondentId\\":\\"u-dana\\"}"}';
    const expected = createHmac('sha256', KEY).update(`${FIRST_PREV_HASH}\n${fields}`).digest('hex');
    expect(computeEventHash(FIRST_PREV_HASH, raised, KEY)).toBe(expected);
  });

  it('starts the chain at 64 zeros', () => {
    expect(FIRST_PREV_HASH).toBe('0'.repeat(64));
  });
});

describe('verifyChain', () => {
  it('accepts a valid chain and reports its head', () => {
    const chain = buildChain();
    const res = verifyChain(chain, KEY);
    expect(res).toEqual({ ok: true, eventsChecked: 3, head: { seq: 3, hash: chain[2].hash } });
  });

  it('accepts an empty chain with 64 zeros as head', () => {
    expect(verifyChain([], KEY)).toEqual({ ok: true, eventsChecked: 0, head: { seq: 0, hash: FIRST_PREV_HASH } });
  });

  it('breaks the chain when a stored payload changes by even one byte', () => {
    const chain = buildChain();
    chain[0].payload = chain[0].payload.replace('broken', 'Broken');
    const res = verifyChain(chain, KEY);
    expect(res).toMatchObject({ ok: false, reason: 'CHAIN_BROKEN', eventId: 1, disputeId: 'disp-1' });
  });

  it('names the missing event, not the one after it', () => {
    const chain = buildChain();
    const res = verifyChain([chain[0], chain[2]], KEY);
    expect(res).toMatchObject({ ok: false, reason: 'CHAIN_BROKEN', eventId: 2 });
    expect(res.ok ? undefined : res.disputeId).toBeUndefined();
  });

  it('fails with the wrong key', () => {
    const chain = buildChain();
    expect(verifyChain(chain, 'another-key')).toMatchObject({ ok: false, reason: 'CHAIN_BROKEN', eventId: 1 });
  });
});
