let jwtToken = null;
let currentRole = null;

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

async function register() {
  try {
    const username = document.getElementById('username').value;
    const role = document.getElementById('role').value;
    await apiCall('/auth/register', 'POST', { username, role });
    alert('Registered! Now please log in.');
  } catch (e) {
    document.getElementById('authError').innerText = e.message;
  }
}

async function login() {
  try {
    const username = document.getElementById('username').value;
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
    loggedInUser.appendChild(document.createTextNode(` (${currentRole})`));

    // RBAC UI Hiding
    document.getElementById('btnEvidence').style.display =
      currentRole === 'arbiter' ? 'none' : 'inline-block';
    document.getElementById('btnResolve').style.display =
      currentRole === 'partner' ? 'none' : 'inline-block';

    loadDisputes();
  } catch (e) {
    document.getElementById('authError').innerText = e.message;
  }
}

function logout() {
  jwtToken = null;
  currentRole = null;
  document.getElementById('authPanel').classList.remove('hidden');
  document.getElementById('appPanel').classList.add('hidden');
}

async function raiseDispute() {
  try {
    await apiCall('/disputes', 'POST', {
      disputeId: document.getElementById('dId').value,
      orderReference: document.getElementById('dRef').value,
      description: document.getElementById('dDesc').value,
    });
    loadDisputes();
  } catch (e) {
    alert(e.message);
  }
}

async function addEvidence() {
  try {
    await apiCall(`/disputes/${document.getElementById('actionId').value}/evidence`, 'PATCH', {
      notes: document.getElementById('actionNotes').value,
    });
    loadDisputes();
  } catch (e) {
    alert(e.message);
  }
}

async function resolveDispute() {
  try {
    await apiCall(`/disputes/${document.getElementById('actionId').value}/resolve`, 'PATCH', {
      resolutionNote: document.getElementById('actionNotes').value,
    });
    loadDisputes();
  } catch (e) {
    alert(e.message);
  }
}

async function loadDisputes() {
  try {
    const response = await apiCall('/disputes', 'GET');
    const disputes = response.records || [];
    const ledger = document.getElementById('ledger');
    ledger.innerHTML = '';
    disputes.forEach((d) => {
      const card = document.createElement('div');
      card.className = 'dispute-card';

      const status = document.createElement('span');
      status.className = `status ${d.status}`;
      status.textContent = d.status;
      card.appendChild(status);

      const title = document.createElement('strong');
      title.textContent = ` ${d.id} `;
      card.appendChild(title);
      card.appendChild(document.createTextNode(`(Order: ${d.orderReference})`));
      card.appendChild(document.createElement('br'));

      const meta = document.createElement('em');
      meta.textContent = `Raised by: ${d.raisedBy} on ${new Date(d.createdAt).toLocaleString()}`;
      card.appendChild(meta);
      card.appendChild(document.createElement('br'));

      const desc = document.createElement('p');
      desc.textContent = d.description;
      card.appendChild(desc);

      if (d.evidence && d.evidence.length) {
        const evDiv = document.createElement('div');
        evDiv.className = 'evidence-list';
        const evLabel = document.createElement('strong');
        evLabel.textContent = 'Evidence:';
        evDiv.appendChild(evLabel);
        const ul = document.createElement('ul');
        d.evidence.forEach((e) => {
          const li = document.createElement('li');
          li.textContent = `[${e.submittedBy}] ${e.notes}`;
          ul.appendChild(li);
        });
        evDiv.appendChild(ul);
        card.appendChild(evDiv);
      }

      if (d.status === 'RESOLVED') {
        const res = document.createElement('div');
        res.style.marginTop = '10px';
        res.style.color = '#155724';
        const resLabel = document.createElement('strong');
        resLabel.textContent = `Resolution (${d.resolvedBy}): `;
        res.appendChild(resLabel);
        res.appendChild(document.createTextNode(d.resolutionNote || ''));
        card.appendChild(res);
      }

      ledger.appendChild(card);
    });
  } catch (e) {
    alert(e.message);
  }
}

function initEventListeners() {
  document.getElementById('btnRegister')?.addEventListener('click', register);
  document.getElementById('btnLogin')?.addEventListener('click', login);
  document.getElementById('btnLogout')?.addEventListener('click', logout);
  document.getElementById('btnRaise')?.addEventListener('click', raiseDispute);
  document.getElementById('btnEvidence')?.addEventListener('click', addEvidence);
  document.getElementById('btnResolve')?.addEventListener('click', resolveDispute);
  document.getElementById('btnRefresh')?.addEventListener('click', loadDisputes);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initEventListeners);
} else {
  initEventListeners();
}
