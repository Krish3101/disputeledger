let authToken = localStorage.getItem('dl_token') || null;
let currentUser = null;

export function getAuthToken() {
  return authToken;
}

export function setAuthToken(token) {
  authToken = token;
  if (token) {
    localStorage.setItem('dl_token', token);
  } else {
    localStorage.removeItem('dl_token');
  }
}

export function getCurrentUser() {
  return currentUser;
}

export function setCurrentUser(user) {
  currentUser = user;
}

export async function api(path, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers,
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
      await logout();
      window.location.hash = '';
      window.location.reload();
    }
    const errorMsg = data?.error?.message || `Request failed with status ${response.status}`;
    const err = new Error(errorMsg);
    err.code = data?.error?.code;
    err.status = response.status;
    err.data = data;
    throw err;
  }

  return data;
}

export async function logout() {
  if (authToken) {
    try {
      await fetch('/api/logout', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
      });
    } catch {
      // Ignore network errors on logout
    }
  }
  setAuthToken(null);
  setCurrentUser(null);
}
