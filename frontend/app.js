let jwtToken = null;
let currentRole = null;
let notificationTimeout = null;
const PAGE_SIZE = 10;
let currentPage = 1;
let currentBookmark = '';
let bookmarkHistory = [''];
let nextBookmark = '';

function showNotification(msg, isError = false) {
  const el = document.getElementById('notification');
  if (!el) return;
  if (notificationTimeout) clearTimeout(notificationTimeout);

  el.textContent = msg;
  el.className = `notification ${isError ? 'error' : 'success'}`;
  el.classList.remove('hidden');

  notificationTimeout = setTimeout(() => {
    el.classList.add('hidden');
  }, 5000);
}

function clearNotification() {
  const el = document.getElementById('notification');
  if (el) el.classList.add('hidden');
  if (notificationTimeout) clearTimeout(notificationTimeout);
}

async function apiCall(endpoint, method, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (jwtToken) headers['Authorization'] = `Bearer ${jwtToken}`;

  const res = await fetch(`/api${endpoint}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : null,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'API Error');
  return data;
}

async function setButtonBusy(btnId, isBusy, busyText, defaultText) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  btn.disabled = isBusy;
  btn.textContent = isBusy ? busyText : defaultText;
}

async function register() {
  const errEl = document.getElementById('authError');
  errEl.innerText = '';
  clearNotification();

  const username = document.getElementById('username').value.trim();
  const role = document.getElementById('role').value;

  if (!username) {
    errEl.innerText = 'Username is required';
    return;
  }

  await setButtonBusy('btnRegister', true, 'Registering...', 'Register');
  try {
    const data = await apiCall('/auth/register', 'POST', { username, role });
    showNotification(data.message || 'Registered successfully! Now click Login.', false);
  } catch (e) {
    errEl.innerText = e.message;
  } finally {
    await setButtonBusy('btnRegister', false, 'Registering...', 'Register');
  }
}

async function login() {
  const errEl = document.getElementById('authError');
  errEl.innerText = '';
  clearNotification();

  const username = document.getElementById('username').value.trim();
  if (!username) {
    errEl.innerText = 'Username is required';
    return;
  }

  await setButtonBusy('btnLogin', true, 'Logging in...', 'Login');
  try {
    const data = await apiCall('/auth/login', 'POST', { username });
    jwtToken = data.token;
    currentRole = data.role;

    document.getElementById('authPanel').classList.add('hidden');
    document.getElementById('appPanel').classList.remove('hidden');

    const loggedInUser = document.getElementById('loggedInUser');
    loggedInUser.textContent = 'Logged in as: ';
    const strong = document.createElement('strong');
    strong.textContent = data.username;
    loggedInUser.appendChild(strong);
    loggedInUser.appendChild(document.createTextNode(` (${currentRole.toUpperCase()})`));

    // RBAC UI Gating
    const raisePanel = document.getElementById('raisePanel');
    const actionHeading = document.getElementById('actionHeading');
    const actionNotesLabel = document.getElementById('actionNotesLabel');
    const btnEvidence = document.getElementById('btnEvidence');
    const btnResolve = document.getElementById('btnResolve');

    if (currentRole === 'arbiter') {
      raisePanel.classList.add('hidden');
      actionHeading.textContent = 'Adjudicate Dispute';
      actionNotesLabel.textContent = 'Resolution Findings / Decision';
      btnEvidence.classList.add('hidden');
      btnResolve.classList.remove('hidden');
    } else {
      raisePanel.classList.remove('hidden');
      actionHeading.textContent = 'Add Evidence';
      actionNotesLabel.textContent = 'Evidence Notes';
      btnEvidence.classList.remove('hidden');
      btnResolve.classList.add('hidden');
    }

    resetAndLoadDisputes();
  } catch (e) {
    errEl.innerText = e.message;
  } finally {
    await setButtonBusy('btnLogin', false, 'Logging in...', 'Login');
  }
}

function logout() {
  jwtToken = null;
  currentRole = null;
  currentPage = 1;
  currentBookmark = '';
  bookmarkHistory = [''];
  nextBookmark = '';
  clearNotification();
  document.getElementById('authPanel').classList.remove('hidden');
  document.getElementById('appPanel').classList.add('hidden');
  document.getElementById('authError').innerText = '';
}

async function raiseDispute() {
  clearNotification();
  const dId = document.getElementById('dId').value.trim();
  const dRef = document.getElementById('dRef').value.trim();
  const dDesc = document.getElementById('dDesc').value.trim();

  await setButtonBusy('btnRaise', true, 'Submitting to Ledger...', 'Submit to Ledger');
  try {
    await apiCall('/disputes', 'POST', {
      disputeId: dId,
      orderReference: dRef,
      description: dDesc,
    });
    document.getElementById('dId').value = '';
    document.getElementById('dRef').value = '';
    document.getElementById('dDesc').value = '';
    showNotification(`Dispute ${dId} successfully registered on the ledger!`, false);
    resetAndLoadDisputes();
  } catch (e) {
    showNotification(e.message, true);
  } finally {
    await setButtonBusy('btnRaise', false, 'Submitting to Ledger...', 'Submit to Ledger');
  }
}

async function addEvidence() {
  clearNotification();
  const actionId = document.getElementById('actionId').value.trim();
  const notes = document.getElementById('actionNotes').value.trim();

  await setButtonBusy('btnEvidence', true, 'Adding Evidence...', 'Add Evidence');
  try {
    await apiCall(`/disputes/${actionId}/evidence`, 'PATCH', { notes });
    document.getElementById('actionNotes').value = '';
    showNotification(`Evidence appended to dispute ${actionId}.`, false);
    loadDisputes(currentBookmark);
  } catch (e) {
    showNotification(e.message, true);
  } finally {
    await setButtonBusy('btnEvidence', false, 'Adding Evidence...', 'Add Evidence');
  }
}

async function resolveDispute() {
  clearNotification();
  const actionId = document.getElementById('actionId').value.trim();
  const resolutionNote = document.getElementById('actionNotes').value.trim();

  await setButtonBusy('btnResolve', true, 'Adjudicating...', 'Adjudicate Dispute (Arbiter)');
  try {
    await apiCall(`/disputes/${actionId}/resolve`, 'PATCH', { resolutionNote });
    document.getElementById('actionNotes').value = '';
    showNotification(`Dispute ${actionId} successfully adjudicated and closed on-chain.`, false);
    loadDisputes(currentBookmark);
  } catch (e) {
    showNotification(e.message, true);
  } finally {
    await setButtonBusy('btnResolve', false, 'Adjudicating...', 'Adjudicate Dispute (Arbiter)');
  }
}

function selectDisputeForAction(disputeId) {
  const actionInput = document.getElementById('actionId');
  if (actionInput) {
    actionInput.value = disputeId;
    actionInput.focus();
    const notesInput = document.getElementById('actionNotes');
    if (notesInput) notesInput.focus();
  }
}

function resetAndLoadDisputes() {
  currentPage = 1;
  currentBookmark = '';
  bookmarkHistory = [''];
  nextBookmark = '';
  loadDisputes('');
}

function nextPage() {
  if (!nextBookmark) return;
  bookmarkHistory[currentPage] = nextBookmark;
  currentPage++;
  loadDisputes(nextBookmark);
}

function prevPage() {
  if (currentPage <= 1) return;
  currentPage--;
  const prevBookmark = bookmarkHistory[currentPage - 1] || '';
  loadDisputes(prevBookmark);
}

async function loadDisputes(bookmark = '') {
  const ledger = document.getElementById('ledger');
  const paginationPanel = document.getElementById('paginationPanel');
  const btnPrevPage = document.getElementById('btnPrevPage');
  const btnNextPage = document.getElementById('btnNextPage');
  const pageInfo = document.getElementById('pageInfo');

  try {
    const query = new URLSearchParams();
    query.set('pageSize', String(PAGE_SIZE));
    if (bookmark) query.set('bookmark', bookmark);

    const response = await apiCall(`/disputes?${query.toString()}`, 'GET');
    const disputes = response.records || [];
    nextBookmark = response.bookmark || '';
    currentBookmark = bookmark;

    ledger.innerHTML = '';

    if (disputes.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent = 'No disputes currently recorded on the ledger.';
      ledger.appendChild(empty);

      if (paginationPanel) {
        if (currentPage === 1) {
          paginationPanel.classList.add('hidden');
        } else {
          paginationPanel.classList.remove('hidden');
          if (btnPrevPage) btnPrevPage.disabled = false;
          if (btnNextPage) btnNextPage.disabled = true;
          if (pageInfo) pageInfo.textContent = `Page ${currentPage}`;
        }
      }
      return;
    }

    if (paginationPanel) {
      paginationPanel.classList.remove('hidden');
      if (btnPrevPage) btnPrevPage.disabled = currentPage <= 1;
      if (btnNextPage) btnNextPage.disabled = !nextBookmark;
      if (pageInfo) pageInfo.textContent = `Page ${currentPage}`;
    }

    disputes.forEach((d) => {
      const card = document.createElement('div');
      card.className = 'dispute-card';

      const header = document.createElement('div');
      header.className = 'dispute-card-header';

      const selectBtn = document.createElement('button');
      selectBtn.className = 'btn-select';
      selectBtn.textContent = 'Select for Action';
      selectBtn.addEventListener('click', () => selectDisputeForAction(d.id));
      header.appendChild(selectBtn);

      const status = document.createElement('span');
      status.className = `status ${d.status}`;
      status.textContent = d.status;
      header.appendChild(status);

      const title = document.createElement('strong');
      title.textContent = `${d.id} `;
      header.appendChild(title);

      const ref = document.createElement('span');
      ref.style.color = '#64748b';
      ref.textContent = `(Order: ${d.orderReference})`;
      header.appendChild(ref);

      card.appendChild(header);

      const meta = document.createElement('div');
      meta.style.fontSize = '0.85rem';
      meta.style.color = '#64748b';
      meta.style.marginBottom = '8px';
      const createdDate = d.createdAt ? new Date(d.createdAt).toLocaleString() : 'N/A';
      meta.textContent = `Raised by: ${d.raisedBy} • ${createdDate}`;
      card.appendChild(meta);

      const desc = document.createElement('p');
      desc.style.margin = '8px 0';
      desc.textContent = d.description;
      card.appendChild(desc);

      if (d.evidence && d.evidence.length) {
        const evDiv = document.createElement('div');
        evDiv.className = 'evidence-list';
        const evLabel = document.createElement('strong');
        evLabel.textContent = `Evidence Trail (${d.evidence.length}):`;
        evDiv.appendChild(evLabel);
        const ul = document.createElement('ul');
        d.evidence.forEach((e) => {
          const li = document.createElement('li');
          const timeStr = e.timestamp ? ` [${new Date(e.timestamp).toLocaleTimeString()}]` : '';
          li.textContent = `${e.submittedBy}${timeStr}: ${e.notes}`;
          ul.appendChild(li);
        });
        evDiv.appendChild(ul);
        card.appendChild(evDiv);
      }

      if (d.status === 'RESOLVED') {
        const res = document.createElement('div');
        res.className = 'resolution-box';
        const resLabel = document.createElement('strong');
        const resolvedTime = d.resolvedAt ? ` on ${new Date(d.resolvedAt).toLocaleString()}` : '';
        resLabel.textContent = `Arbitration Decision (${d.resolvedBy}${resolvedTime}): `;
        res.appendChild(resLabel);
        res.appendChild(document.createTextNode(d.resolutionNote || 'Resolved without remarks.'));
        card.appendChild(res);
      }

      ledger.appendChild(card);
    });
  } catch (e) {
    showNotification(e.message, true);
  }
}

function initEventListeners() {
  document.getElementById('btnRegister')?.addEventListener('click', register);
  document.getElementById('btnLogin')?.addEventListener('click', login);
  document.getElementById('btnLogout')?.addEventListener('click', logout);
  document.getElementById('btnRaise')?.addEventListener('click', raiseDispute);
  document.getElementById('btnEvidence')?.addEventListener('click', addEvidence);
  document.getElementById('btnResolve')?.addEventListener('click', resolveDispute);
  document
    .getElementById('btnRefresh')
    ?.addEventListener('click', () => loadDisputes(currentBookmark));
  document.getElementById('btnPrevPage')?.addEventListener('click', prevPage);
  document.getElementById('btnNextPage')?.addEventListener('click', nextPage);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initEventListeners);
} else {
  initEventListeners();
}
