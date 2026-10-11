// A small event emitter for the application's models.

export class Emitter {
    constructor() { this._listeners = new Map(); }

    on(type, fn) {
        if (!this._listeners.has(type)) this._listeners.set(type, new Set());
        this._listeners.get(type).add(fn);
        return () => this.off(type, fn);
    }

    off(type, fn) {
        const set = this._listeners.get(type);
        if (set) set.delete(fn);
    }

    emit(type, ...args) {
        const set = this._listeners.get(type);
        if (!set) return;
        for (const fn of [...set]) {
            try { fn(...args); } catch (e) { console.error('term: ' + type + ' listener: ' + (e && e.stack || e)); }
        }
    }
}

/// Run `fn` once, `ms` after the last call.
export function debounce(fn, ms) {
    let timer = 0;
    const wrapped = (...args) => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => { timer = 0; fn(...args); }, ms);
    };
    wrapped.flush = (...args) => {
        if (timer) { clearTimeout(timer); timer = 0; }
        fn(...args);
    };
    wrapped.cancel = () => { if (timer) { clearTimeout(timer); timer = 0; } };
    return wrapped;
}
