// Dispute Ledger - Client Application (ES Module)

let authToken = localStorage.getItem('dl_token') || null;
let currentUser = null;
let currentFilter = '';
let currentDisputeId = null;

const appHeader = document.getElementById('app-header');
const userInfo = document.getElementById('user-info');
const alertContainer = document.getElementById('alert-container');

const viewLogin = document.getElementById('view-login');
const viewList = document.getElementById('view-list');
const viewDetail = document.getElementById('view-detail');

const formLogin = document.getElementById('form-login');
const inputUsername = document.getElementById('input-username');
const inputPassword = document.getElementById('input-password');
const btnLogout = document.getElementById('btn-logout');
const btnCheckIntegrity = document.getElementById('btn-check-integrity');
const btnBackToList = document.getElementById('btn-back-to-list');
const navHome = document.getElementById('nav-home');

const disputesList = document.getElementById('disputes-list');
const btnOpenRaiseModal = document.getElementById('btn-open-raise-modal');
const raiseModal = document.getElementById('raise-modal');
const btnCloseRaise = document.getElementById('btn-close-raise');
const btnCancelRaise = document.getElementById('btn-cancel-raise');
const formRaiseDispute = document.getElementById('form-raise-dispute');
const selectRespondent = document.getElementById('select-respondent');
const inputOrderRef = document.getElementById('input-order-ref');
const inputDescription = document.getElementById('input-description');

const integrityModal = document.getElementById('integrity-modal');
const btnCloseIntegrity = document.getElementById('btn-close-integrity');
const btnDismissIntegrity = document.getElementById('btn-dismiss-integrity');
const integrityResult = document.getElementById('integrity-result');

const disputeDetailContent = document.getElementById('dispute-detail-content');

async function api(path, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };

  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }

  const response = await fetch(`/api${path}`, {
    ...options,
    headers,
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    if (response.status === 401 && authToken && path !== '/login') {
      logout();
      showAlert('Session expired. Please log in again.', 'danger');
    }
    const errorMsg = data?.error?.message || `Request failed with status ${response.status}`;
    const err = new Error(errorMsg);
    err.code = data?.error?.code;
    err.status = response.status;
    throw err;
  }

  return data;
}

function showAlert(message, type = 'danger') {
  alertContainer.innerHTML = `
    <div class="alert alert-${type}">
      ${escapeHtml(message)}
    </div>
  `;
  setTimeout(() => {
    alertContainer.innerHTML = '';
  }, 5000);
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatDate(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  return d.toLocaleString();
}

function showView(view) {
  viewLogin.classList.add('hidden');
  viewList.classList.add('hidden');
  viewDetail.classList.add('hidden');

  view.classList.remove('hidden');
}

async function init() {
  setupEventListeners();

  if (authToken) {
    try {
      const data = await api('/me');
      currentUser = data.user;
      renderAuthenticatedHeader();
      await showDisputesListView();
    } catch (err) {
      logout();
    }
  } else {
    showView(viewLogin);
  }
}

function renderAuthenticatedHeader() {
  appHeader.classList.remove('hidden');
  userInfo.innerHTML = `<strong>${escapeHtml(currentUser.displayName)}</strong> (${currentUser.role})`;

  if (currentUser.role === 'partner') {
    btnOpenRaiseModal.classList.remove('hidden');
  } else {
    btnOpenRaiseModal.classList.add('hidden');
  }
}

async function logout() {
  if (authToken) {
    try {
      await fetch('/api/logout', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
      });
    } catch (_) {
      // Ignore network errors when logging out
    }
  }
  authToken = null;
  currentUser = null;
  localStorage.removeItem('dl_token');
  appHeader.classList.add('hidden');
  showView(viewLogin);
}

async function showDisputesListView() {
  showView(viewList);
  currentDisputeId = null;
  await loadDisputes();
}

async function loadDisputes() {
  disputesList.innerHTML = '<p class="empty-state">Loading disputes...</p>';
  try {
    const query = currentFilter ? `?status=${currentFilter}` : '';
    const res = await api(`/disputes${query}`);
    const items = res.items || [];

    if (items.length === 0) {
      disputesList.innerHTML = '<div class="empty-state">No disputes found.</div>';
      return;
    }

    disputesList.innerHTML = items
      .map((d) => {
        const isResolved = d.status === 'RESOLVED';
        const badgeClass = isResolved ? 'badge-resolved' : 'badge-open';
        return `
          <div class="dispute-row" data-id="${escapeHtml(d.id)}">
            <div class="dispute-meta">
              <div class="dispute-title-row">
                <span class="order-ref">${escapeHtml(d.orderReference)}</span>
                <span class="badge ${badgeClass}">${escapeHtml(d.status)}</span>
              </div>
              <div class="parties-summary">
                Claimant: <strong>${escapeHtml(d.claimant.displayName)}</strong> &bull;
                Respondent: <strong>${escapeHtml(d.respondent.displayName)}</strong>
              </div>
              <div class="dispute-desc-preview">${escapeHtml(d.description)}</div>
            </div>
            <div>
              <button class="btn btn-sm btn-secondary">View Case &rarr;</button>
            </div>
          </div>
        `;
      })
      .join('');

    document.querySelectorAll('.dispute-row').forEach((el) => {
      el.addEventListener('click', () => {
        const id = el.getAttribute('data-id');
        showDisputeDetailView(id);
      });
    });
  } catch (err) {
    showAlert(err.message, 'danger');
  }
}

async function showDisputeDetailView(disputeId) {
  currentDisputeId = disputeId;
  showView(viewDetail);
  disputeDetailContent.innerHTML = '<p class="empty-state">Loading dispute details...</p>';

  try {
    const [dispute, eventsRes] = await Promise.all([
      api(`/disputes/${disputeId}`),
      api(`/disputes/${disputeId}/events`),
    ]);

    renderDisputeDetail(dispute, eventsRes.items || []);
  } catch (err) {
    showAlert(err.message, 'danger');
    showDisputesListView();
  }
}

function renderDisputeDetail(dispute, events) {
  const isResolved = dispute.status === 'RESOLVED';
  const isParty =
    currentUser.role === 'partner' &&
    (currentUser.id === dispute.claimant.id || currentUser.id === dispute.respondent.id);
  const isArbiter = currentUser.role === 'arbiter';

  let evidenceListHtml = '';
  if (dispute.evidence && dispute.evidence.length > 0) {
    evidenceListHtml = dispute.evidence
      .map(
        (ev) => `
        <div class="evidence-card">
          <div class="evidence-header">
            <strong>${escapeHtml(ev.submittedBy.displayName)}</strong>
            <span>${formatDate(ev.createdAt)}</span>
          </div>
          <div class="evidence-notes">${escapeHtml(ev.notes)}</div>
        </div>
      `
      )
      .join('');
  } else {
    evidenceListHtml = '<p class="empty-state">No evidence submitted yet.</p>';
  }

  let addEvidenceFormHtml = '';
  if (!isResolved && isParty) {
    addEvidenceFormHtml = `
      <div class="card" style="margin-top: 1rem;">
        <h4>Append Evidence Note</h4>
        <p class="subtitle" style="margin-bottom: 0.75rem;">Evidence is permanently written to the case file and hash chain.</p>
        <form id="form-add-evidence">
          <div class="form-group">
            <textarea id="input-evidence-notes" required rows="3" placeholder="Enter photos, inspection reports, or delivery details..."></textarea>
          </div>
          <button type="submit" class="btn btn-primary btn-sm">Add Evidence</button>
        </form>
      </div>
    `;
  }

  let resolutionHtml = '';
  if (isResolved && dispute.resolution) {
    resolutionHtml = `
      <div class="resolution-card">
        <h4>Official Arbiter Resolution</h4>
        <p>${escapeHtml(dispute.resolution.note)}</p>
        <div class="resolution-meta">
          Ruling by <strong>${escapeHtml(dispute.resolution.by.displayName)}</strong> on ${formatDate(dispute.resolution.at)}
        </div>
      </div>
    `;
  } else if (!isResolved && isArbiter) {
    resolutionHtml = `
      <div class="card" style="border-left: 3px solid var(--success); margin-bottom: 1.5rem;">
        <h4>Record Arbiter Ruling</h4>
        <p class="subtitle" style="margin-bottom: 0.75rem;">Resolving the dispute is terminal: no further evidence will be accepted.</p>
        <form id="form-resolve-dispute">
          <div class="form-group">
            <textarea id="input-resolution-note" required rows="3" placeholder="Enter finding of liability and settlement ruling..."></textarea>
          </div>
          <button type="submit" class="btn btn-primary" style="background-color: var(--success);">Record Ruling & Resolve</button>
        </form>
      </div>
    `;
  }

  const eventsTableHtml = `
    <table class="events-table">
      <thead>
        <tr>
          <th>#</th>
          <th>Type</th>
          <th>Actor</th>
          <th>Time</th>
          <th>Prev Hash</th>
          <th>Event Hash</th>
        </tr>
      </thead>
      <tbody>
        ${events
          .map(
            (e) => `
          <tr>
            <td>${e.id}</td>
            <td><strong>${escapeHtml(e.type)}</strong></td>
            <td>${escapeHtml(e.actor.displayName)}</td>
            <td>${formatDate(e.occurredAt)}</td>
            <td class="hash-cell" title="${escapeHtml(e.prevHash || '')}">${escapeHtml((e.prevHash || '').slice(0, 10))}...</td>
            <td class="hash-cell" title="${escapeHtml(e.hash || '')}">${escapeHtml((e.hash || '').slice(0, 10))}...</td>
          </tr>
        `
          )
          .join('')}
      </tbody>
    </table>
  `;

  disputeDetailContent.innerHTML = `
    <div class="detail-header-card">
      <div class="detail-top">
        <h2>Order: ${escapeHtml(dispute.orderReference)}</h2>
        <span class="badge ${isResolved ? 'badge-resolved' : 'badge-open'}">${escapeHtml(dispute.status)}</span>
      </div>

      <div class="parties-grid">
        <div class="party-box">
          <p>Claimant</p>
          <span>${escapeHtml(dispute.claimant.displayName)}</span>
        </div>
        <div class="party-box">
          <p>Respondent</p>
          <span>${escapeHtml(dispute.respondent.displayName)}</span>
        </div>
      </div>

      <div class="claim-desc">
        <strong>Dispute Description:</strong>
        <p style="margin-top: 0.35rem;">${escapeHtml(dispute.description)}</p>
      </div>
    </div>

    ${resolutionHtml}

    <div class="section-title">
      Case Evidence File
    </div>
    <div class="evidence-list">
      ${evidenceListHtml}
    </div>

    ${addEvidenceFormHtml}

    <div class="audit-section">
      <div class="section-title">
        Cryptographic Audit Log (SHA-256 Hash Chain)
      </div>
      <p class="subtitle" style="margin-bottom: 0.5rem;">Append-only ledger events linked to this dispute case file</p>
      ${eventsTableHtml}
    </div>
  `;

  const formAddEvidence = document.getElementById('form-add-evidence');
  if (formAddEvidence) {
    formAddEvidence.addEventListener('submit', async (e) => {
      e.preventDefault();
      const submitBtn = formAddEvidence.querySelector('button[type="submit"]');
      const notes = document.getElementById('input-evidence-notes').value.trim();
      if (!notes) return;
      if (submitBtn) submitBtn.disabled = true;
      try {
        await api(`/disputes/${dispute.id}/evidence`, {
          method: 'POST',
          body: JSON.stringify({ notes }),
        });
        showAlert('Evidence appended successfully.', 'success');
        showDisputeDetailView(dispute.id);
      } catch (err) {
        showAlert(err.message, 'danger');
        if (submitBtn) submitBtn.disabled = false;
      }
    });
  }

  const formResolveDispute = document.getElementById('form-resolve-dispute');
  if (formResolveDispute) {
    formResolveDispute.addEventListener('submit', async (e) => {
      e.preventDefault();
      const submitBtn = formResolveDispute.querySelector('button[type="submit"]');
      const resolutionNote = document.getElementById('input-resolution-note').value.trim();
      if (!resolutionNote) return;
      if (submitBtn) submitBtn.disabled = true;
      try {
        await api(`/disputes/${dispute.id}/resolution`, {
          method: 'POST',
          body: JSON.stringify({ resolutionNote }),
        });
        showAlert('Dispute resolved successfully.', 'success');
        showDisputeDetailView(dispute.id);
      } catch (err) {
        showAlert(err.message, 'danger');
        if (submitBtn) submitBtn.disabled = false;
      }
    });
  }
}

async function openRaiseModal() {
  selectRespondent.innerHTML = '<option value="">Loading partners...</option>';
  raiseModal.classList.remove('hidden');

  try {
    const res = await api('/partners');
    const partners = (res.items || []).filter((p) => p.id !== currentUser.id);

    selectRespondent.innerHTML =
      '<option value="">Select respondent...</option>' +
      partners
        .map((p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.displayName)}</option>`)
        .join('');
  } catch (err) {
    showAlert(err.message, 'danger');
    raiseModal.classList.add('hidden');
  }
}

function closeRaiseModal() {
  raiseModal.classList.add('hidden');
  formRaiseDispute.reset();
}

async function runIntegrityCheck() {
  integrityResult.innerHTML = '<p>Computing SHA-256 hashes and validating state against event log...</p>';
  integrityModal.classList.remove('hidden');

  try {
    const res = await api('/integrity');
    if (res.ok) {
      integrityResult.innerHTML = `
        <div class="alert alert-success" style="margin: 0;">
          <h4>Ledger Integrity Verified</h4>
          <p style="margin-top: 0.5rem;">All <strong>${res.eventsChecked}</strong> events in the hash chain match their SHA-256 digests and perfectly reflect current dispute and evidence states.</p>
        </div>
      `;
    } else {
      integrityResult.innerHTML = `
        <div class="alert alert-danger" style="margin: 0;">
          <h4>INTEGRITY VIOLATION DETECTED</h4>
          <p style="margin-top: 0.5rem;">Tampering detected at <strong>Event #${res.firstBadEventId}</strong>! The stored record or hash chain does not match original cryptographic state.</p>
        </div>
      `;
    }
  } catch (err) {
    integrityResult.innerHTML = `<div class="alert alert-danger">${escapeHtml(err.message)}</div>`;
  }
}

function setupEventListeners() {
  formLogin.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = formLogin.querySelector('button[type="submit"]');
    const username = inputUsername.value.trim();
    const password = inputPassword.value;
    if (submitBtn) submitBtn.disabled = true;

    try {
      const res = await api('/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });
      authToken = res.token;
      currentUser = res.user;
      localStorage.setItem('dl_token', authToken);
      renderAuthenticatedHeader();
      await showDisputesListView();
    } catch (err) {
      showAlert(err.message, 'danger');
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  });

  document.querySelectorAll('.quick-login').forEach((btn) => {
    btn.addEventListener('click', () => {
      const user = btn.getAttribute('data-user');
      inputUsername.value = user;
      inputPassword.value = 'password123';
      formLogin.dispatchEvent(new Event('submit'));
    });
  });

  btnLogout.addEventListener('click', logout);
  navHome.addEventListener('click', () => {
    if (currentUser) showDisputesListView();
  });
  btnBackToList.addEventListener('click', showDisputesListView);

  btnOpenRaiseModal.addEventListener('click', openRaiseModal);
  btnCloseRaise.addEventListener('click', closeRaiseModal);
  btnCancelRaise.addEventListener('click', closeRaiseModal);

  formRaiseDispute.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = formRaiseDispute.querySelector('button[type="submit"]');
    const orderReference = inputOrderRef.value.trim();
    const respondentId = selectRespondent.value;
    const description = inputDescription.value.trim();
    if (submitBtn) submitBtn.disabled = true;

    try {
      const created = await api('/disputes', {
        method: 'POST',
        body: JSON.stringify({ orderReference, respondentId, description }),
      });
      closeRaiseModal();
      showAlert('Dispute successfully raised.', 'success');
      showDisputeDetailView(created.id);
    } catch (err) {
      showAlert(err.message, 'danger');
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  });

  document.querySelectorAll('.filter-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = btn.getAttribute('data-status') || '';
      loadDisputes();
    });
  });

  btnCheckIntegrity.addEventListener('click', runIntegrityCheck);
  btnCloseIntegrity.addEventListener('click', () => integrityModal.classList.add('hidden'));
  btnDismissIntegrity.addEventListener('click', () => integrityModal.classList.add('hidden'));

  // Close modals when clicking the dimmed backdrop overlay
  [raiseModal, integrityModal].forEach((modal) => {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.classList.add('hidden');
        if (modal === raiseModal) formRaiseDispute.reset();
      }
    });
  });

  // Close modals on Escape key press
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!raiseModal.classList.contains('hidden')) {
        closeRaiseModal();
      }
      if (!integrityModal.classList.contains('hidden')) {
        integrityModal.classList.add('hidden');
      }
    }
  });
}

init();
