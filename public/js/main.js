import { api, getAuthToken, setAuthToken, getCurrentUser, setCurrentUser, logout } from './api.js';
import { runVerify, getLastCheck, clearVerify, setGoToEventHandler } from './verify.js';
import { showView, showAlert, renderHeader, renderDisputesList, renderDisputeDetail, escapeHtml } from './views.js';

const appHeader = document.getElementById('app-header');
const btnOpenRaiseModal = document.getElementById('btn-open-raise-modal');
const btnVerify = document.getElementById('btn-verify');
const raiseModal = document.getElementById('raise-modal');
const formRaiseDispute = document.getElementById('form-raise-dispute');
const selectRespondent = document.getElementById('select-respondent');

async function loadDisputes() {
  showView('view-list');
  const container = document.getElementById('disputes-list');
  container.innerHTML = '<p class="empty-state">Loading disputes...</p>';
  try {
    const res = await api('/disputes');
    renderDisputesList(res.items || [], (id) => showDisputeDetail(id));
  } catch (err) {
    container.innerHTML = '';
    showAlert(err.message, 'danger');
  }
}

async function showDisputeDetail(disputeId, focusSelectors = []) {
  showView('view-detail');
  document.getElementById('view-detail').dataset.disputeId = disputeId;
  const container = document.getElementById('dispute-detail-content');
  container.innerHTML = '<p class="empty-state">Loading dispute details...</p>';

  try {
    const [dispute, eventsRes] = await Promise.all([
      api(`/disputes/${disputeId}`),
      api(`/disputes/${disputeId}/events`),
    ]);

    const submit = (path, body, message, focus) => async (text) => {
      try {
        await api(`/disputes/${dispute.id}/${path}`, { method: 'POST', body: JSON.stringify({ [body]: text }) });
        showAlert(message, 'success');
        showDisputeDetail(dispute.id, focus);
      } catch (err) {
        showAlert(err.message, 'danger');
      }
    };

    renderDisputeDetail(
      dispute,
      eventsRes.items || [],
      getLastCheck(),
      submit('evidence', 'notes', 'Evidence added.', ['.evidence-card:last-child']),
      submit('resolution', 'resolutionNote', 'Resolution recorded.', ['.resolution-card h3'])
    );

    // Land on what just changed, or on the event the banner points at
    const target = focusSelectors.map((sel) => container.querySelector(sel)).find(Boolean);
    if (target) {
      target.setAttribute('tabindex', '-1');
      target.focus();
    }
  } catch (err) {
    showAlert(err.message, 'danger');
    loadDisputes();
  }
}

async function openRaiseModal() {
  selectRespondent.innerHTML = '<option value="">Loading partners...</option>';
  raiseModal.showModal();
  document.getElementById('input-order-ref').focus();
  const user = getCurrentUser();
  try {
    const res = await api('/partners');
    const partners = (res.items || []).filter((p) => p.id !== user.id);
    selectRespondent.innerHTML = '<option value="">Select respondent...</option>' +
      partners.map((p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.displayName)}</option>`).join('');
  } catch (err) {
    raiseModal.close();
    showAlert(err.message, 'danger');
  }
}

function setupEventListeners() {
  const formLogin = document.getElementById('form-login');
  formLogin.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('input-username').value.trim();
    const password = document.getElementById('input-password').value;
    try {
      const res = await api('/login', { method: 'POST', body: JSON.stringify({ username, password }) });
      setAuthToken(res.token);
      setCurrentUser(res.user);
      document.getElementById('alert-container').innerHTML = '';
      renderHeader(getCurrentUser());
      await loadDisputes();
    } catch (err) {
      showAlert(err.message, 'danger');
    }
  });

  document.querySelectorAll('.quick-login').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.getElementById('input-username').value = btn.getAttribute('data-user');
      document.getElementById('input-password').value = 'password123';
      formLogin.requestSubmit();
    });
  });

  document.getElementById('btn-logout').addEventListener('click', async () => {
    await logout();
    clearVerify();
    appHeader.classList.add('hidden');
    showView('view-login');
  });

  document.getElementById('nav-home').addEventListener('click', () => {
    if (getCurrentUser()) loadDisputes();
  });

  document.getElementById('btn-back-to-list').addEventListener('click', loadDisputes);

  // The dialog traps focus and closes on Escape by itself; on close, reset it and go back to the opener
  btnOpenRaiseModal.addEventListener('click', openRaiseModal);
  document.getElementById('btn-close-raise').addEventListener('click', () => raiseModal.close());
  document.getElementById('btn-cancel-raise').addEventListener('click', () => raiseModal.close());

  // Light-dismiss fallback for browsers without closedby support
  if (!('closedBy' in HTMLDialogElement.prototype)) {
    raiseModal.addEventListener('click', (event) => {
      if (event.target !== raiseModal) return;
      const rect = raiseModal.getBoundingClientRect();
      const inDialog = (
        rect.top <= event.clientY &&
        event.clientY <= rect.top + rect.height &&
        rect.left <= event.clientX &&
        event.clientX <= rect.left + rect.width
      );
      if (!inDialog) raiseModal.close();
    });
  }

  raiseModal.addEventListener('close', () => {
    formRaiseDispute.reset();
    btnOpenRaiseModal.focus();
  });

  // Sync aria-invalid with modern :user-invalid state
  const syncAria = (el) => {
    if (el && typeof el.matches === 'function') {
      el.setAttribute('aria-invalid', el.matches(':user-invalid') ? 'true' : 'false');
    }
  };
  document.addEventListener('blur', (e) => syncAria(e.target), true);
  document.addEventListener('input', (e) => {
    if (e.target?.hasAttribute?.('aria-invalid')) syncAria(e.target);
  });

  formRaiseDispute.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = formRaiseDispute.querySelector('button[type="submit"]');
    const orderReference = document.getElementById('input-order-ref').value.trim();
    const respondentId = selectRespondent.value;
    const description = document.getElementById('input-description').value.trim();
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Raising...';
    }
    try {
      const created = await api('/disputes', {
        method: 'POST',
        body: JSON.stringify({ orderReference, respondentId, description }),
      });
      raiseModal.close();
      showAlert('Dispute raised.', 'success');
      showDisputeDetail(created.id);
    } catch (err) {
      showAlert(err.message, 'danger');
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Raise Dispute';
      }
    }
  });

  btnVerify.addEventListener('click', async () => {
    btnVerify.disabled = true;
    btnVerify.textContent = 'Checking...';
    try {
      await runVerify();
      // Re-draw an open dispute so its rows show the result
      const detail = document.getElementById('view-detail');
      const open = detail.classList.contains('hidden') ? null : detail.dataset.disputeId;
      if (open) showDisputeDetail(open);
    } catch (err) {
      showAlert(err.message, 'danger');
    } finally {
      btnVerify.disabled = false;
      btnVerify.textContent = 'Verify ledger';
    }
  });

  setGoToEventHandler((disputeId) => showDisputeDetail(disputeId, ['.event-row--bad', '.detail-top h2']));
}

async function init() {
  setupEventListeners();
  if (getAuthToken()) {
    try {
      const data = await api('/me');
      setCurrentUser(data.user);
      renderHeader(getCurrentUser());
      await loadDisputes();
    } catch {
      await logout();
      showView('view-login');
    }
  } else {
    showView('view-login');
  }
}

init();
