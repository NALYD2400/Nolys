export const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Preserve damaged values before repairing them, so a bad preference never prevents startup. */
export function readJSON(key, fallback, validate = () => true, storage = globalThis.localStorage) {
    let raw;
    try {
        raw = storage?.getItem(key);
        if (raw === null || raw === undefined) return structuredClone(fallback);
        const value = JSON.parse(raw);
        if (validate(value)) return value;
    } catch { /* Recover syntax errors and invalid types alike. */ }
    try {
        if (raw !== undefined && raw !== null) {
            storage.setItem(`liquid_recovery_${key}`, raw);
            storage.setItem(key, JSON.stringify(fallback));
            globalThis.window?.dispatchEvent(new CustomEvent('nolys-storage-recovered', { detail: { key } }));
        }
    } catch { /* A full or read-only store must not prevent using the application. */ }
    return structuredClone(fallback);
}

export const readRecord = (key, fallback = {}, storage) => readJSON(key, fallback, isRecord, storage);
