// Dispute Ledger - Views Module
import { getCurrentUser } from './api.js';

export function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function formatDate(iso) {
  return iso ? new Date(iso).toLocaleString() : '-';
}

let alertTimer = null;

// Success messages fade out; errors stay until dismissed
export function showAlert(message, type = 'danger') {
  const container = document.getElementById('alert-container');
  clearTimeout(alertTimer);
  if (type === 'danger') {
    container.innerHTML = `
      <div class="alert alert-danger alert-dismissible" role="alert">
        <span>${escapeHtml(message)}</span>
        <button type="button" class="btn btn-sm btn-outline" id="btn-dismiss-alert">Dismiss</button>
      </div>`;
    document.getElementById('btn-dismiss-alert').addEventListener('click', () => { container.innerHTML = ''; });
    return;
  }
  container.innerHTML = `<div class="alert alert-${type}">${escapeHtml(message)}</div>`;
  alertTimer = setTimeout(() => { container.innerHTML = ''; }, 5000);
}

const ROLES = {
  partner: { label: 'Partner', list: 'Disputes you are a party to', can: 'Partner: can raise disputes and add evidence to your own cases.' },
  arbiter: { label: 'Arbiter', list: 'All disputes', can: 'Arbiter: can record rulings and verify the ledger; cannot raise disputes.' },
};

export function renderHeader(user) {
  const role = ROLES[user.role];
  document.getElementById('app-header').classList.remove('hidden');
  document.getElementById('user-info').innerHTML = `<strong>${escapeHtml(user.displayName)}</strong> <span class="role-pill">${role.label}</span>`;
  document.getElementById('list-subtitle').textContent = role.list;
  document.getElementById('role-line').textContent = role.can;
  // Partners raise disputes; only the arbiter can verify the whole ledger
  document.getElementById('btn-open-raise-modal').classList.toggle('hidden', user.role !== 'partner');
  document.getElementById('btn-check-integrity').classList.toggle('hidden', user.role !== 'arbiter');
}

export function showView(viewName) {
  ['view-login', 'view-list', 'view-detail'].forEach((id) => {
    document.getElementById(id).classList.add('hidden');
  });
  const target = document.getElementById(viewName);
  if (target) target.classList.remove('hidden');
}

export function renderDisputesList(items, onSelectDispute) {
  const container = document.getElementById('disputes-list');
  if (items.length === 0) {
    container.innerHTML = '<div class="empty-state">No disputes found.</div>';
    return;
  }

  // The order reference is the only button; the rest of the row is a bigger click target for the mouse
  container.innerHTML = items.map((d) => `
    <div class="dispute-row" data-id="${escapeHtml(d.id)}">
      <div class="dispute-meta">
        <div class="dispute-title-row">
          <button type="button" class="order-ref">${escapeHtml(d.orderReference)}</button>
          <span class="badge ${d.status === 'RESOLVED' ? 'badge-resolved' : 'badge-open'}">${escapeHtml(d.status)}</span>
        </div>
        <div class="parties-summary">
          Claimant: <strong>${escapeHtml(d.claimant.displayName)}</strong> &bull;
          Respondent: <strong>${escapeHtml(d.respondent.displayName)}</strong>
        </div>
        <div class="dispute-desc-preview">${escapeHtml(d.description)}</div>
      </div>
    </div>
  `).join('');

  container.querySelectorAll('.dispute-row').forEach((el) => {
    el.addEventListener('click', () => onSelectDispute(el.getAttribute('data-id')));
  });
}

// lastCheck marks the bad event and everything after it as not trusted
export function renderDisputeDetail(dispute, events, lastCheck, onAddEvidence, onResolveDispute) {
  const currentUser = getCurrentUser();
  const isResolved = dispute.status === 'RESOLVED';
  const isParty = currentUser.role === 'partner' && (currentUser.id === dispute.claimant.id || currentUser.id === dispute.respondent.id);
  const isArbiter = currentUser.role === 'arbiter';
  const badEventId = lastCheck && !lastCheck.ok && lastCheck.eventId !== undefined ? lastCheck.eventId : null;

  const evidenceListHtml = dispute.evidence && dispute.evidence.length > 0
    ? dispute.evidence.map((ev) => `
        <div class="evidence-card">
          <div class="evidence-header"><strong>${escapeHtml(ev.submittedBy.displayName)}</strong><span>${formatDate(ev.createdAt)}</span></div>
          <div class="evidence-notes">${escapeHtml(ev.notes)}</div>
        </div>`).join('')
    : '<p class="empty-state">No evidence submitted yet.</p>';

  const addEvidenceFormHtml = !isResolved && isParty ? `
    <div class="card card-spaced">
      <h3>Add evidence</h3>
      <p class="subtitle subtitle-tight">Evidence cannot be edited or removed once it is added.</p>
      <form id="form-add-evidence">
        <div class="form-group">
          <label for="input-evidence-notes" class="sr-only">Evidence notes</label>
          <textarea id="input-evidence-notes" required rows="3" placeholder="Describe the photo, inspection report or delivery note"></textarea>
        </div>
        <button type="submit" class="btn btn-primary btn-sm">Add Evidence</button>
      </form>
    </div>` : '';

  const resolutionHtml = isResolved && dispute.resolution ? `
    <div class="resolution-card">
      <h3>Ruling</h3><p>${escapeHtml(dispute.resolution.note)}</p>
      <div class="resolution-meta">Ruling by <strong>${escapeHtml(dispute.resolution.by.displayName)}</strong> on ${formatDate(dispute.resolution.at)}</div>
    </div>` : (!isResolved && isArbiter ? `
    <div class="card card-ruling">
      <h3>Record a ruling</h3>
      <p class="subtitle subtitle-tight">This closes the dispute. No more evidence can be added after it.</p>
      <form id="form-resolve-dispute">
        <div class="form-group">
          <label for="input-resolution-note" class="sr-only">Ruling</label>
          <textarea id="input-resolution-note" required rows="3" placeholder="Who is liable, and what was agreed"></textarea>
        </div>
        <button type="submit" class="btn btn-primary">Record ruling</button>
      </form>
    </div>` : '');

  const eventsTableRows = events.map((e) => {
    const isBad = badEventId === e.id;
    const isUntrusted = badEventId !== null && e.id > badEventId;
    return `
      <tr class="${isBad ? 'event-row--bad' : isUntrusted ? 'event-row--untrusted' : ''}">
        <td><strong>#${e.id}</strong> ${isBad ? '<span class="badge badge-tampered">TAMPERED</span>' : ''}${isUntrusted ? '<span class="badge badge-untrusted">not trusted</span>' : ''}</td>
        <td><strong>${escapeHtml(e.type)}</strong></td><td>${escapeHtml(e.actor.displayName)}</td><td>${formatDate(e.occurredAt)}</td>
        <td class="hash-cell" title="${escapeHtml(e.prevHash)}">${escapeHtml(e.prevHash.slice(0, 10))}...</td>
        <td class="hash-cell" title="${escapeHtml(e.hash)}">${escapeHtml(e.hash.slice(0, 10))}...</td>
      </tr>`;
  }).join('');

  document.getElementById('dispute-detail-content').innerHTML = `
    <div class="detail-header-card">
      <div class="detail-top">
        <h2>Order: ${escapeHtml(dispute.orderReference)}</h2>
        <span class="badge ${isResolved ? 'badge-resolved' : 'badge-open'}">${escapeHtml(dispute.status)}</span>
      </div>
      <div class="parties-grid">
        <div class="party-box"><p>Claimant</p><span>${escapeHtml(dispute.claimant.displayName)}</span></div>
        <div class="party-box"><p>Respondent</p><span>${escapeHtml(dispute.respondent.displayName)}</span></div>
      </div>
      <div class="claim-desc"><strong>What happened</strong><p>${escapeHtml(dispute.description)}</p></div>
    </div>
    ${resolutionHtml}
    <h3 class="section-title">Evidence</h3>
    <div class="evidence-list">${evidenceListHtml}</div>
    ${addEvidenceFormHtml}
    <div class="events-section">
      <h3 class="section-title">Ledger events</h3>
      <p class="subtitle subtitle-tight">Each event's hash covers the one before it, in one chain shared by all disputes.</p>
      <div class="table-scroll" tabindex="0" role="region" aria-label="Ledger events"><table class="events-table"><thead><tr><th>#</th><th>Type</th><th>Actor</th><th>Time</th><th>Prev Hash</th><th>Event Hash</th></tr></thead><tbody>${eventsTableRows}</tbody></table></div>
    </div>`;

  const formAdd = document.getElementById('form-add-evidence');
  if (formAdd) {
    formAdd.addEventListener('submit', (e) => {
      e.preventDefault();
      const notes = document.getElementById('input-evidence-notes').value.trim();
      if (notes) onAddEvidence(notes);
    });
  }

  const formResolve = document.getElementById('form-resolve-dispute');
  if (formResolve) {
    formResolve.addEventListener('submit', (e) => {
      e.preventDefault();
      const note = document.getElementById('input-resolution-note').value.trim();
      if (note) onResolveDispute(note);
    });
  }
}
