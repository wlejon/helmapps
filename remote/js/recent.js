// Recent connections, newest first, in bro.app.dataDir/recent.json.

const fs = require('fs');
const path = require('path');

const MAX = 8;

function file() {
    const dir = bro.app.dataDir;
    try { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); } catch (e) { /* the write says */ }
    return path.join(dir, 'recent.json');
}

export function loadRecent() {
    try {
        const list = JSON.parse(fs.readFileSync(file(), 'utf-8'));
        return Array.isArray(list) ? list.filter((r) => r && typeof r.host === 'string').slice(0, MAX) : [];
    } catch (e) {
        return [];
    }
}

// Puts {host, socket} first (once), stamped now.
export function rememberRecent(host, socket) {
    const list = loadRecent().filter((r) => !(r.host === host && (r.socket || '') === (socket || '')));
    list.unshift({ host, socket: socket || '', when: Date.now() });
    try {
        fs.writeFileSync(file(), JSON.stringify(list.slice(0, MAX), null, 2), 'utf-8');
    } catch (e) {
        console.warn('remote: cannot save recent hosts: ' + e.message);
    }
    return list.slice(0, MAX);
}

export function describe(r) {
    const where = r.host || 'this machine';
    return r.socket ? where + ' : ' + r.socket : where;
}
