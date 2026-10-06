// Dispute Ledger - ledger check and the banner that shows its result
import { api } from './api.js';
import { escapeHtml } from './views.js';

// Kept between views, so a failed check stays on screen until the next one
let lastCheck = null;
let onGoToEvent = () => {};

const REASON_COPY = {
  CHAIN_BROKEN: 'Ledger broken: a record was changed after it was written',
  PAYLOAD_NOT_CANONICAL: 'Stored event data no longer matches what was signed',
  ROW_MISMATCH: 'This record no longer matches what was signed',
  TIMESTAMP_REGRESSION: 'Event dates run backwards: a record was dated before the one ahead of it',
  ORPHAN_ROW: 'A record exists with no ledger event',
};

export function getLastCheck() {
  return lastCheck ? lastCheck.result : null;
}

export function setGoToEventHandler(handler) {
  onGoToEvent = handler;
}

export function clearIntegrity() {
  lastCheck = null;
  renderBanner();
}

function isGap(result) {
  // A missing event has no dispute to point at: the event itself is gone
  return result.reason === 'CHAIN_BROKEN' && !result.disputeId;
}

function headline(result) {
  if (isGap(result)) return `An event is missing before #${result.eventId + 1}`;
  return REASON_COPY[result.reason] || 'The ledger does not match the database';
}

function where(result) {
  if (isGap(result)) return `Missing event: #${result.eventId}`;
  if (result.eventId !== undefined) return `First bad event: #${result.eventId}`;
  return `Record: ${result.rowId}`;
}

function timeOf(date) {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function renderBanner() {
  const banner = document.getElementById('integrity-banner');
  if (!lastCheck) {
    banner.innerHTML = '';
    banner.classList.add('hidden');
    return;
  }

  const { result, at } = lastCheck;
  banner.classList.remove('hidden');

  if (result.ok) {
    banner.className = 'integrity-banner banner-ok';
    banner.innerHTML = `<p class="container" role="status"><span class="pill-ok">Verified ${result.eventsChecked} events at ${timeOf(at)}</span></p>`;
    return;
  }

  banner.className = 'integrity-banner banner-failed';
  const goTo = result.disputeId
    ? `<button type="button" class="btn btn-on-danger" id="btn-go-to-event">${result.eventId !== undefined ? 'Go to event' : 'Go to dispute'}</button>`
    : '';
  banner.innerHTML = `
    <div class="container banner-inner" role="alert">
      <div>
        <p class="banner-title">Ledger check failed</p>
        <p class="banner-text">${escapeHtml(headline(result))}</p>
        <p class="banner-where">${escapeHtml(where(result))} &middot; checked at ${timeOf(at)}</p>
      </div>
      ${goTo}
    </div>`;

  const btn = document.getElementById('btn-go-to-event');
  if (btn) btn.addEventListener('click', () => onGoToEvent(result.disputeId));
}

export async function runIntegrityCheck() {
  const result = await api('/integrity');
  lastCheck = { result, at: new Date() };
  renderBanner();
  return result;
}
