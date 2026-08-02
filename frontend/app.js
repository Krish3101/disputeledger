let jwtToken = null;
let currentRole = null;

async function apiCall(endpoint, method, body) {
    const headers = { 'Content-Type': 'application/json' };
    if (jwtToken) headers['Authorization'] = `Bearer ${jwtToken}`;
    
    const res = await fetch(`/api${endpoint}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : null
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
    } catch (e) { document.getElementById('authError').innerText = e.message; }
}

async function login() {
    try {
        const username = document.getElementById('username').value;
        const data = await apiCall('/auth/login', 'POST', { username });
        jwtToken = data.token;
        currentRole = document.getElementById('role').value; // Grab from input for UI logic

        document.getElementById('authPanel').classList.add('hidden');
        document.getElementById('appPanel').classList.remove('hidden');
        document.getElementById('loggedInUser').innerHTML = `Logged in as: <strong>${data.username}</strong> (${currentRole})`;
        
        // RBAC UI Hiding
        document.getElementById('btnEvidence').style.display = currentRole === 'arbiter' ? 'none' : 'inline-block';
        document.getElementById('btnResolve').style.display = currentRole === 'partner' ? 'none' : 'inline-block';

        loadDisputes();
    } catch (e) { document.getElementById('authError').innerText = e.message; }
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
            description: document.getElementById('dDesc').value
        });
        loadDisputes();
    } catch (e) { alert(e.message); }
}

async function addEvidence() {
    try {
        await apiCall(`/disputes/${document.getElementById('actionId').value}/evidence`, 'PATCH', {
            notes: document.getElementById('actionNotes').value
        });
        loadDisputes();
    } catch (e) { alert(e.message); }
}

async function resolveDispute() {
    try {
        await apiCall(`/disputes/${document.getElementById('actionId').value}/resolve`, 'PATCH', {
            resolutionNote: document.getElementById('actionNotes').value
        });
        loadDisputes();
    } catch (e) { alert(e.message); }
}

async function loadDisputes() {
    try {
        const response = await apiCall('/disputes', 'GET');
        const disputes = response.records || [];
        const ledger = document.getElementById('ledger');
        ledger.innerHTML = '';
        disputes.forEach(d => {
            const evidenceHtml = d.evidence.map(e => `<li>[${e.submittedBy}] ${e.notes}</li>`).join('');
            ledger.innerHTML += `
                <div class="dispute-card">
                    <span class="status ${d.status}">${d.status}</span>
                    <strong>${d.id}</strong> (Order: ${d.orderReference})<br>
                    <em>Raised by: ${d.raisedBy} on ${new Date(d.createdAt).toLocaleString()}</em><br>
                    <p>${d.description}</p>
                    ${evidenceHtml ? `<div class="evidence-list"><strong>Evidence:</strong><ul>${evidenceHtml}</ul></div>` : ''}
                    ${d.status === 'RESOLVED' ? `<div style="margin-top:10px; color:#155724;"><strong>Resolution (${d.resolvedBy}):</strong> ${d.resolutionNote}</div>` : ''}
                </div>
            `;
        });
    } catch (e) { alert(e.message); }
}
