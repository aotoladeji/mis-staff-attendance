// Shared SSE client registry.
// Imported by attendance and mobile routes so both can push real-time events.
export const sseClients = new Set();

/**
 * Broadcast an attendance event to every connected web client.
 * @param {object} data  Full attendance log row (id, staff_id, type, timestamp, name, position, photo)
 */
export function broadcastAttendanceEvent(data) {
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    client.write(payload);
  }
}
