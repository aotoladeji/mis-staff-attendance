const BASE = '/api/staff';

const readError = async (res, fallback) => {
  try {
    const payload = await res.json();
    return payload?.error || fallback;
  } catch {
    return fallback;
  }
};

export const getStaff = async () => {
  const res = await fetch(BASE);
  if (!res.ok) throw new Error(await readError(res, 'Failed to load staff'));
  return res.json();
};

export const createStaff = async (payload) => {
  const res = await fetch(BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await readError(res, 'Failed to register staff'));
  return res.json();
};

export const updateStaff = async (id, payload) => {
  const res = await fetch(`${BASE}/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) throw new Error(await readError(res, 'Failed to update staff'));
  return res.json();
};

export const bulkImportStaff = async (staff) => {
  const res = await fetch(`${BASE}/bulk-import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ staff }),
  });

  if (!res.ok) throw new Error(await readError(res, 'Failed to import staff records'));
  return res.json();
};

export const deleteStaff = async (id) => {
  const res = await fetch(`${BASE}/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(await readError(res, 'Failed to delete staff'));
};

export const updatePendingQuery = async (id, note) => {
  const res = await fetch(`${BASE}/${id}/pending-query`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ note }),
  });

  if (!res.ok) throw new Error(await readError(res, 'Failed to update pending query note'));
  return res.json();
};

