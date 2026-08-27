import { TranscriptEntry } from './speech';

/**
 * Local checkpointing of an in-progress assessment.
 *
 * A clinician who accidentally refreshes, or whose phone drops the connection mid-session,
 * must not lose the consultation. The committed transcript is written to IndexedDB as it
 * grows, so it can be recovered.
 *
 * Two honesty constraints govern this:
 *
 * - Recovery restores the TRANSCRIPT, not the recording. Killing the browser tab ends audio
 *   capture; nothing can bring that back, and the UI must not imply otherwise.
 * - This is clinical content on a shared or personal device, so it is temporary by design.
 *   It is cleared as soon as the server has the transcript, and any checkpoint older than
 *   the retention window is discarded on startup rather than lingering indefinitely.
 */

const DB_NAME = 'vabatim-session';
const STORE = 'checkpoints';
const DB_VERSION = 1;

/** Checkpoints older than this are stale and are deleted rather than offered for recovery. */
const MAX_AGE_MS = 12 * 60 * 60 * 1000;

export interface SessionCheckpoint {
  meetingId: string;
  clientRef: string;
  entries: TranscriptEntry[];
  startedAtIso: string;
  updatedAtIso: string;
  /** True when audio was being recorded. Recovery cannot restore it; this is for honesty. */
  wasRecordingAudio: boolean;
}

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') return resolve(null);

    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      // Private browsing and some locked-down configurations throw outright.
      return resolve(null);
    }

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'meetingId' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest
): Promise<T | null> {
  const db = await openDb();
  if (!db) return null;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, mode);
      const request = fn(tx.objectStore(STORE));
      request.onsuccess = () => resolve(request.result as T);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export const sessionCheckpoint = {
  /** Every call is best-effort. Checkpointing must never interrupt a consultation. */
  async save(checkpoint: Omit<SessionCheckpoint, 'updatedAtIso'>): Promise<void> {
    await withStore('readwrite', (store) =>
      store.put({ ...checkpoint, updatedAtIso: new Date().toISOString() })
    );
  },

  async load(meetingId: string): Promise<SessionCheckpoint | null> {
    const result = await withStore<SessionCheckpoint>('readonly', (store) => store.get(meetingId));
    if (!result) return null;

    if (Date.now() - new Date(result.updatedAtIso).getTime() > MAX_AGE_MS) {
      await sessionCheckpoint.clear(meetingId);
      return null;
    }
    return result;
  },

  /** The most recent recoverable session, for offering recovery after a refresh. */
  async loadLatest(): Promise<SessionCheckpoint | null> {
    const all = await withStore<SessionCheckpoint[]>('readonly', (store) => store.getAll());
    if (!all || all.length === 0) return null;

    const fresh = all.filter((c) => Date.now() - new Date(c.updatedAtIso).getTime() <= MAX_AGE_MS);
    // Discard anything stale rather than leaving clinical text on the device.
    for (const stale of all.filter((c) => !fresh.includes(c))) {
      await sessionCheckpoint.clear(stale.meetingId);
    }

    return fresh.sort((a, b) => b.updatedAtIso.localeCompare(a.updatedAtIso))[0] ?? null;
  },

  async clear(meetingId: string): Promise<void> {
    await withStore('readwrite', (store) => store.delete(meetingId));
  },

  /** Called on startup so old clinical text never accumulates on a shared device. */
  async purgeStale(): Promise<void> {
    await sessionCheckpoint.loadLatest();
  }
};

/**
 * Queues a transcript that could not be uploaded, so a network drop costs a retry rather
 * than the consultation.
 */
const PENDING_KEY = 'vabatim_pending_upload';

export interface PendingUpload {
  meetingId: string;
  transcriptText: string;
  clientRef: string;
  queuedAtIso: string;
}

export const pendingUpload = {
  save(entry: PendingUpload): void {
    try {
      localStorage.setItem(PENDING_KEY, JSON.stringify(entry));
    } catch {
      // Storage unavailable; the in-memory transcript is still on screen.
    }
  },
  load(): PendingUpload | null {
    try {
      const raw = localStorage.getItem(PENDING_KEY);
      return raw ? (JSON.parse(raw) as PendingUpload) : null;
    } catch {
      return null;
    }
  },
  clear(): void {
    try {
      localStorage.removeItem(PENDING_KEY);
    } catch {
      // Nothing to do.
    }
  }
};
