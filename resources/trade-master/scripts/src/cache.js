import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tradeMasterHome } from './storage.js';
const DEFAULT_POLICY = {
    retention_days: 30,
    max_entries: 5000,
    max_bytes: 512 * 1024 * 1024,
};
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
    policy;
    constructor(policy, root = join(tradeMasterHome(), 'market-cache')) {
        this.root = root;
        this.dataRoot = join(root, 'data');
        this.indexPath = join(root, 'index.json');
        this.policy = safePolicy(policy);
        mkdirSync(this.dataRoot, { recursive: true });
        this.reconcile();
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
    writeIndex(index) {
        index.updated_at = new Date().toISOString();
        atomicWrite(this.indexPath, `${JSON.stringify(index, null, 2)}\n`);
    }
    id(key) {
        return createHash('sha256').update(key).digest('hex');
    }
    get(key, maxAgeMs = Number.POSITIVE_INFINITY) {
        const index = this.readIndex();
        const id = this.id(key);
        const entry = index.entries[id];
        if (!entry)
            return null;
        const path = join(this.dataRoot, entry.file);
        const now = Date.now();
        const expired = now >= Date.parse(entry.expires_at) || now - Date.parse(entry.updated_at) > maxAgeMs;
        if (expired || !existsSync(path)) {
            if (existsSync(path))
                unlinkSync(path);
            delete index.entries[id];
            this.writeIndex(index);
            return null;
        }
        try {
            const value = JSON.parse(readFileSync(path, 'utf8'));
            entry.last_accessed_at = new Date().toISOString();
            this.writeIndex(index);
            return value;
        }
        catch {
            if (existsSync(path))
                unlinkSync(path);
            delete index.entries[id];
            this.writeIndex(index);
            return null;
        }
    }
    set(key, value, source) {
        const index = this.readIndex();
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
        this.pruneIndex(index);
        this.writeIndex(index);
    }
    async getOrLoad(key, loader, maxAgeMs, source) {
        const cached = this.get(key, maxAgeMs);
        if (cached != null)
            return cached;
        const value = await loader();
        this.set(key, value, source);
        return value;
    }
    prune() {
        const index = this.readIndex();
        const before = Object.keys(index.entries).length;
        this.pruneIndex(index);
        this.writeIndex(index);
        const entries = Object.values(index.entries);
        return {
            removed: before - entries.length,
            entries: entries.length,
            bytes: entries.reduce((sum, item) => sum + item.size, 0),
            retention_days: this.policy.retention_days,
        };
    }
    status() {
        const index = this.readIndex();
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
    }
    pruneIndex(index) {
        const now = Date.now();
        for (const [id, entry] of Object.entries(index.entries)) {
            const path = join(this.dataRoot, entry.file);
            if (now >= Date.parse(entry.expires_at) || !existsSync(path)) {
                if (existsSync(path))
                    unlinkSync(path);
                delete index.entries[id];
            }
        }
        const lru = () => Object.entries(index.entries)
            .sort(([, left], [, right]) => Date.parse(left.last_accessed_at) - Date.parse(right.last_accessed_at));
        let bytes = Object.values(index.entries).reduce((sum, item) => sum + item.size, 0);
        while (Object.keys(index.entries).length > this.policy.max_entries || bytes > this.policy.max_bytes) {
            const [id, entry] = lru()[0] ?? [];
            if (!id || !entry)
                break;
            const path = join(this.dataRoot, entry.file);
            if (existsSync(path))
                unlinkSync(path);
            bytes -= entry.size;
            delete index.entries[id];
        }
    }
}
