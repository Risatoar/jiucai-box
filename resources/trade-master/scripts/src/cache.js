import { createHash } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tradeMasterHome } from './storage.js';
const DEFAULT_POLICY = {
    retention_days: 30,
    max_entries: 5000,
    max_bytes: 512 * 1024 * 1024,
};
const INDEX_FLUSH_DELAY_MS = 180;
const ACCESS_TOUCH_INTERVAL_MS = 5 * 60_000;
const STALE_LOCK_MS = 30_000;
function atomicWrite(path, value) {
    const temporary = `${path}.${process.pid}.tmp`;
    writeFileSync(temporary, value, 'utf8');
    renameSync(temporary, path);
}
function safePolicy(policy) {
    return {
        retention_days: Math.max(1, Math.floor(policy?.retention_days ?? DEFAULT_POLICY.retention_days)),
        max_entries: Math.max(1, Math.floor(policy?.max_entries ?? DEFAULT_POLICY.max_entries)),
        max_bytes: Math.max(1024 * 1024, Math.floor(policy?.max_bytes ?? DEFAULT_POLICY.max_bytes)),
    };
}
export class MarketCache {
    root;
    dataRoot;
    indexPath;
    lockPath;
    policy;
    index = null;
    pendingEntries = new Map();
    pendingDeletions = new Map();
    flushTimer = null;
    constructor(policy, root = join(tradeMasterHome(), 'market-cache')) {
        this.root = root;
        this.dataRoot = join(root, 'data');
        this.indexPath = join(root, 'index.json');
        this.lockPath = join(root, 'index.lock');
        this.policy = safePolicy(policy);
        mkdirSync(this.dataRoot, { recursive: true });
    }
    emptyIndex() {
        return { schema_version: 1, policy: this.policy, entries: {}, updated_at: new Date().toISOString() };
    }
    readIndex() {
        if (!existsSync(this.indexPath))
            return this.emptyIndex();
        try {
            const parsed = JSON.parse(readFileSync(this.indexPath, 'utf8'));
            return { ...parsed, policy: this.policy, entries: parsed.entries ?? {} };
        }
        catch {
            return this.emptyIndex();
        }
    }
    ensureIndex() {
        if (!this.index)
            this.index = this.readIndex();
        return this.index;
    }
    writeIndex(index) {
        index.updated_at = new Date().toISOString();
        atomicWrite(this.indexPath, `${JSON.stringify(index, null, 2)}\n`);
    }
    id(key) {
        return createHash('sha256').update(key).digest('hex');
    }
    removeDataFile(entry) {
        const path = join(this.dataRoot, entry.file);
        if (existsSync(path))
            unlinkSync(path);
    }
    deleteEntry(id, entry) {
        this.removeDataFile(entry);
        delete this.ensureIndex().entries[id];
        this.pendingEntries.delete(id);
        this.pendingDeletions.set(id, entry.updated_at);
        this.scheduleFlush();
    }
    recoverOrphan(key, id, path, maxAgeMs) {
        if (!existsSync(path))
            return null;
        const stats = statSync(path);
        if (Date.now() - stats.mtimeMs > maxAgeMs)
            return null;
        const timestamp = stats.mtime.toISOString();
        const entry = {
            key,
            file: `${id}.json`,
            created_at: timestamp,
            updated_at: timestamp,
            last_accessed_at: timestamp,
            expires_at: new Date(stats.mtimeMs + this.policy.retention_days * 86_400_000).toISOString(),
            size: stats.size,
            source: 'recovered',
        };
        this.ensureIndex().entries[id] = entry;
        this.pendingEntries.set(id, entry);
        this.scheduleFlush();
        return entry;
    }
    get(key, maxAgeMs = Number.POSITIVE_INFINITY) {
        const index = this.ensureIndex();
        const id = this.id(key);
        const defaultPath = join(this.dataRoot, `${id}.json`);
        const entry = index.entries[id] ?? this.recoverOrphan(key, id, defaultPath, maxAgeMs);
        if (!entry)
            return null;
        const path = join(this.dataRoot, entry.file);
        const now = Date.now();
        const expired = now >= Date.parse(entry.expires_at) || now - Date.parse(entry.updated_at) > maxAgeMs;
        if (expired || !existsSync(path)) {
            this.deleteEntry(id, entry);
            return null;
        }
        try {
            const value = JSON.parse(readFileSync(path, 'utf8'));
            if (now - Date.parse(entry.last_accessed_at) >= ACCESS_TOUCH_INTERVAL_MS) {
                entry.last_accessed_at = new Date(now).toISOString();
                this.pendingEntries.set(id, entry);
                this.scheduleFlush();
            }
            return value;
        }
        catch {
            this.deleteEntry(id, entry);
            return null;
        }
    }
    set(key, value, source) {
        const index = this.ensureIndex();
        const id = this.id(key);
        const file = `${id}.json`;
        const path = join(this.dataRoot, file);
        const serialized = `${JSON.stringify(value)}\n`;
        atomicWrite(path, serialized);
        const now = new Date();
        const existing = index.entries[id];
        index.entries[id] = {
            key,
            file,
            created_at: existing?.created_at ?? now.toISOString(),
            updated_at: now.toISOString(),
            last_accessed_at: now.toISOString(),
            expires_at: new Date(now.getTime() + this.policy.retention_days * 86_400_000).toISOString(),
            size: Buffer.byteLength(serialized),
            source,
        };
        this.pendingDeletions.delete(id);
        this.pendingEntries.set(id, index.entries[id]);
        this.scheduleFlush();
    }
    async getOrLoad(key, loader, maxAgeMs, source) {
        const cached = this.get(key, maxAgeMs);
        if (cached != null)
            return cached;
        const value = await loader();
        this.set(key, value, source);
        return value;
    }
    acquireLock() {
        try {
            return openSync(this.lockPath, 'wx');
        }
        catch {
            try {
                if (Date.now() - statSync(this.lockPath).mtimeMs > STALE_LOCK_MS)
                    unlinkSync(this.lockPath);
            }
            catch { /* another process released the lock */ }
            try {
                return openSync(this.lockPath, 'wx');
            }
            catch {
                return null;
            }
        }
    }
    releaseLock(fd) {
        try {
            closeSync(fd);
        }
        finally {
            try {
                unlinkSync(this.lockPath);
            }
            catch { /* already released */ }
        }
    }
    scheduleFlush() {
        if (this.flushTimer)
            return;
        this.flushTimer = setTimeout(() => {
            this.flushTimer = null;
            let retry = false;
            try {
                retry = !this.flush();
            }
            catch { /* raw cache files remain readable and can be recovered later */ }
            if (retry)
                this.scheduleFlush();
        }, INDEX_FLUSH_DELAY_MS);
    }
    flush() {
        if (this.flushTimer) {
            clearTimeout(this.flushTimer);
            this.flushTimer = null;
        }
        if (!this.pendingEntries.size && !this.pendingDeletions.size)
            return true;
        const fd = this.acquireLock();
        if (fd == null)
            return false;
        try {
            const latest = this.readIndex();
            for (const [id, expectedUpdatedAt] of this.pendingDeletions) {
                const current = latest.entries[id];
                if (current && Date.parse(current.updated_at) <= Date.parse(expectedUpdatedAt))
                    delete latest.entries[id];
            }
            for (const [id, entry] of this.pendingEntries) {
                const current = latest.entries[id];
                if (!current || Date.parse(current.updated_at) <= Date.parse(entry.updated_at))
                    latest.entries[id] = entry;
            }
            this.pruneIndex(latest);
            this.writeIndex(latest);
            this.index = latest;
            this.pendingEntries.clear();
            this.pendingDeletions.clear();
            return true;
        }
        finally {
            this.releaseLock(fd);
        }
    }
    prune() {
        this.flush();
        const before = Object.keys(this.readIndex().entries).length;
        const index = this.reconcile();
        const entries = Object.values(index.entries);
        return {
            removed: before - entries.length,
            entries: entries.length,
            bytes: entries.reduce((sum, item) => sum + item.size, 0),
            retention_days: this.policy.retention_days,
        };
    }
    status() {
        const index = this.ensureIndex();
        const entries = Object.values(index.entries);
        return {
            root: this.root,
            policy: this.policy,
            entries: entries.length,
            bytes: entries.reduce((sum, item) => sum + item.size, 0),
            oldest_access: entries.map((item) => item.last_accessed_at).sort()[0] ?? null,
        };
    }
    reconcile() {
        const index = this.readIndex();
        const known = new Set(Object.values(index.entries).map((item) => item.file));
        for (const file of readdirSync(this.dataRoot)) {
            if (file.endsWith('.json') && !known.has(file))
                unlinkSync(join(this.dataRoot, file));
        }
        for (const [id, entry] of Object.entries(index.entries)) {
            const path = join(this.dataRoot, entry.file);
            if (!existsSync(path))
                delete index.entries[id];
            else
                entry.size = statSync(path).size;
        }
        this.pruneIndex(index);
        this.writeIndex(index);
        this.index = index;
        return index;
    }
    pruneIndex(index) {
        const now = Date.now();
        for (const [id, entry] of Object.entries(index.entries)) {
            if (now >= Date.parse(entry.expires_at)) {
                this.removeDataFile(entry);
                delete index.entries[id];
            }
        }
        const entries = Object.entries(index.entries);
        let bytes = entries.reduce((sum, [, item]) => sum + item.size, 0);
        if (entries.length <= this.policy.max_entries && bytes <= this.policy.max_bytes)
            return;
        const lru = entries.sort(([, left], [, right]) => Date.parse(left.last_accessed_at) - Date.parse(right.last_accessed_at));
        let count = entries.length;
        for (const [id, entry] of lru) {
            if (count <= this.policy.max_entries && bytes <= this.policy.max_bytes)
                break;
            this.removeDataFile(entry);
            bytes -= entry.size;
            delete index.entries[id];
            count -= 1;
        }
    }
}
