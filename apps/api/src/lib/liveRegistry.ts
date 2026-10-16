// Open live WebSocket connections on this API instance, so the admin console can show who is
// online and disconnect a suspended user. Per instance: with several API replicas each one only
// knows its own sockets.

interface LiveConnection {
  close: (code: number, reason: string) => void;
}

const byUser = new Map<string, Set<LiveConnection>>();

export function trackConnection(userId: string, conn: LiveConnection) {
  let set = byUser.get(userId);
  if (!set) byUser.set(userId, (set = new Set()));
  set.add(conn);
  return () => {
    set.delete(conn);
    if (!set.size) byUser.delete(userId);
  };
}

export function onlineUserIds(): Set<string> {
  return new Set(byUser.keys());
}

export function connectionCount() {
  let n = 0;
  for (const s of byUser.values()) n += s.size;
  return n;
}

/** Closes every live connection a user has. Returns how many were closed. */
export function disconnectUser(userId: string, reason: string) {
  const set = byUser.get(userId);
  if (!set) return 0;
  const n = set.size;
  for (const c of [...set]) c.close(4003, reason);
  return n;
}
