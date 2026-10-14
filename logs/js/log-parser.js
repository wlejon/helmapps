/**
 * Fast, pure log line & multi-line log file parser and filter engine.
 * Supports:
 *  1. JSONL / NDJSON structured logs
 *  2. Bro & Helm engine logs ([INFO] msg, [timestamp] [LEVEL] [source] msg, ISO LEVEL [source] msg)
 *  3. RFC 5424 & RFC 3164 Syslog (<pri>1 ts host app pid msgid sd msg, Month Day HH:MM:SS host app[pid]: msg)
 *  4. Kernel dmesg ([  12.345678] subsys: msg) and pacman.log ([ISO] [ALPM] msg)
 *  5. Plain text fallback with timestamp & severity detection
 *  6. Multi-line stack trace & indented continuation line grouping
 */

const SEVERITY_MAP = {
  emerg: 'error',
  emergency: 'error',
  alert: 'error',
  crit: 'error',
  critical: 'error',
  fatal: 'error',
  err: 'error',
  error: 'error',
  panic: 'error',
  severe: 'error',
  warn: 'warn',
  warning: 'warn',
  notice: 'info',
  info: 'info',
  information: 'info',
  log: 'info',
  debug: 'debug',
  trace: 'debug',
  verbose: 'debug',
  dbg: 'debug',
};

const SYSLOG_SEV = ['error', 'error', 'error', 'error', 'warn', 'info', 'info', 'debug'];

/**
 * Normalize a severity string or numeric level into 'error' | 'warn' | 'info' | 'debug'.
 */
export function normalizeSeverity(level) {
  if (level == null) return 'info';
  if (typeof level === 'number') {
    if (level <= 7 && level >= 0) return SYSLOG_SEV[level] || 'info';
    if (level >= 50) return 'error';
    if (level >= 40) return 'warn';
    if (level >= 30) return 'info';
    return 'debug';
  }
  const s = String(level).trim().toLowerCase();
  if (!s) return 'info';
  if (SEVERITY_MAP[s]) return SEVERITY_MAP[s];
  if (s.includes('err') || s.includes('fatal') || s.includes('crit') || s.includes('panic')) return 'error';
  if (s.includes('warn')) return 'warn';
  if (s.includes('debug') || s.includes('trace')) return 'debug';
  return 'info';
}

export function severityBadgeText(sev) {
  if (sev === 'error') return 'ERR';
  if (sev === 'warn') return 'WARN';
  if (sev === 'debug') return 'DBG';
  return 'INFO';
}

const RE_INFER_ERR = /\b(?:FATAL|PANIC|CRITICAL|EMERG|ERROR|ERR|segfault|Failed|Exception|Traceback)\b|\*ERROR\*/i;
const RE_INFER_WARN = /\b(?:WARN|WARNING)\b/i;
const RE_INFER_DBG = /\b(?:DEBUG|TRACE)\b/i;

/** Detect severity from message content when no explicit level tag exists. */
function inferSeverityFromText(text) {
  if (!text) return 'info';
  if (RE_INFER_ERR.test(text)) return 'error';
  if (RE_INFER_WARN.test(text)) return 'warn';
  if (RE_INFER_DBG.test(text)) return 'debug';
  return 'info';
}

/** Shorten a timestamp for compact tabular column display while keeping full timestamp. */
function formatTimeDisplay(ts) {
  if (!ts) return '—';
  const s = String(ts).trim();
  if (!s) return '—';
  const c0 = s.charCodeAt(0);
  if (c0 >= 48 && c0 <= 57) {
    // ISO timestamp: 2026-10-14T12:34:56.789Z or 2026-10-14 12:34:56.789
    if (s.length >= 19 && s.charCodeAt(4) === 45 && s.charCodeAt(7) === 45) {
      const c10 = s.charCodeAt(10);
      if (c10 === 84 || c10 === 32) {
        let end = 19;
        if (s.charCodeAt(19) === 46) {
          end = 20;
          while (end < s.length && end < 23 && s.charCodeAt(end) >= 48 && s.charCodeAt(end) <= 57) end++;
        }
        return s.slice(11, end);
      }
    }
    // ISO without seconds: 2026-10-14T12:00+00:00
    if (s.length >= 16 && s.charCodeAt(4) === 45 && s.charCodeAt(7) === 45) {
      return s.slice(11, 16);
    }
    // Kernel uptime e.g. "12.345678"
    if (s.indexOf('.') > 0 && /^\d+\.\d+$/.test(s)) return `${Number(s).toFixed(3)}s`;
    // Epoch ms
    if (s.length === 13 && /^\d{13}$/.test(s)) {
      const d = new Date(Number(s));
      if (!isNaN(d.getTime())) {
        return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
      }
    }
  }
  return s.length > 19 ? s.slice(0, 19) : s;
}

// Precompiled regexes for fallback formats
const RE_RFC5424 = /^<(\d{1,3})>\d+\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(?:-|\[.*?\])\s*(.*)$/;
const RE_RFC3164 = /^(?:<(\d{1,3})>)?([A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2})\s+(\S+)\s+([^\s:]+?)(?:\[(\d+)\])?:\s*(.*)$/;
const RE_ISO_LEVEL = /^(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)\s+([A-Za-z]+)\s+(?:\[([^\]]+)\]\s+|([A-Za-z0-9_.-]+):\s+)?(.*)$/;
const RE_DMESG = /^\[\s*(\d+\.\d+)\]\s*(?:([^\s:]+(?:\s+\d+:\d+:\d+\.\d+)?):\s*)?(.*)$/;
const RE_LEADING_TS = /^(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?|\d{2}:\d{2}:\d{2}(?:\.\d+)?)\s+(.*)$/;

function isKnownLevel(s) {
  if (!s) return false;
  return SEVERITY_MAP[s.toLowerCase()] !== undefined;
}

/**
 * Parse a single log line into a structured entry.
 * Uses fast indexOf/charCodeAt dispatch before falling back to regexes.
 */
export function parseLogLine(line, index = 1, defaultSource = 'log', { eagerDetails = true } = {}) {
  let raw = String(line ?? '');
  if (raw.length > 0 && raw.charCodeAt(raw.length - 1) === 13) {
    raw = raw.slice(0, -1);
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return {
      id: index,
      timestamp: '',
      timeDisplay: '—',
      severity: 'info',
      source: defaultSource,
      message: '',
      raw,
      details: '',
      json: null,
    };
  }

  const c0 = trimmed.charCodeAt(0);

  // 1. JSONL ({...})
  if (c0 === 123 && trimmed.charCodeAt(trimmed.length - 1) === 125) {
    try {
      const obj = JSON.parse(trimmed);
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
        const ts = obj.timestamp ?? obj.time ?? obj.ts ?? obj['@timestamp'] ?? obj.date ?? '';
        const rawLevel = obj.level ?? obj.severity ?? obj.lvl ?? obj.log_level ?? null;
        const source = String(obj.source ?? obj.logger ?? obj.app ?? obj.module ?? obj.service ?? obj.component ?? obj.name ?? defaultSource);
        let msg = obj.message ?? obj.msg ?? obj.err ?? obj.error ?? '';
        if (typeof msg === 'object' && msg !== null) {
          msg = msg.message || msg.stack || JSON.stringify(msg);
        }
        msg = String(msg || trimmed);
        const severity = rawLevel != null ? normalizeSeverity(rawLevel) : inferSeverityFromText(msg);
        return {
          id: index,
          timestamp: String(ts),
          timeDisplay: formatTimeDisplay(ts),
          severity,
          source,
          message: msg,
          raw,
          details: eagerDetails ? JSON.stringify(obj, null, 2) : '',
          json: obj,
        };
      }
    } catch (_) {
      // Fall through to text parsers if malformed JSON
    }
  }

  // 2. Bracket-prefixed formats: [...]
  if (c0 === 91) {
    const close1 = trimmed.indexOf(']', 1);
    if (close1 > 1) {
      const firstTag = trimmed.slice(1, close1);
      const c1 = firstTag.charCodeAt(0);

      // [INFO] message or [ERROR] [source] message
      if ((c1 >= 65 && c1 <= 90) || (c1 >= 97 && c1 <= 122)) {
        if (isKnownLevel(firstTag)) {
          let pos = close1 + 1;
          while (pos < trimmed.length && trimmed.charCodeAt(pos) === 32) pos++;
          let src = defaultSource;
          if (trimmed.charCodeAt(pos) === 91) {
            const close2 = trimmed.indexOf(']', pos + 1);
            if (close2 > pos + 1) {
              src = trimmed.slice(pos + 1, close2);
              pos = close2 + 1;
              while (pos < trimmed.length && trimmed.charCodeAt(pos) === 32) pos++;
            }
          }
          return {
            id: index,
            timestamp: '',
            timeDisplay: '—',
            severity: normalizeSeverity(firstTag),
            source: src,
            message: trimmed.slice(pos),
            raw,
            details: '',
            json: null,
          };
        }
      }

      // [2026-10-14 ...] [LEVEL/TAG] [optional-source] message
      if (c1 >= 48 && c1 <= 57 && firstTag.length >= 10 && firstTag.charCodeAt(4) === 45) {
        let pos = close1 + 1;
        while (pos < trimmed.length && trimmed.charCodeAt(pos) === 32) pos++;
        if (trimmed.charCodeAt(pos) === 91) {
          const close2 = trimmed.indexOf(']', pos + 1);
          if (close2 > pos + 1) {
            const secondTag = trimmed.slice(pos + 1, close2);
            pos = close2 + 1;
            while (pos < trimmed.length && trimmed.charCodeAt(pos) === 32) pos++;
            if (isKnownLevel(secondTag)) {
              let src = defaultSource;
              if (trimmed.charCodeAt(pos) === 91) {
                const close3 = trimmed.indexOf(']', pos + 1);
                if (close3 > pos + 1) {
                  src = trimmed.slice(pos + 1, close3);
                  pos = close3 + 1;
                  while (pos < trimmed.length && trimmed.charCodeAt(pos) === 32) pos++;
                }
              }
              return {
                id: index,
                timestamp: firstTag,
                timeDisplay: formatTimeDisplay(firstTag),
                severity: normalizeSeverity(secondTag),
                source: src,
                message: trimmed.slice(pos),
                raw,
                details: '',
                json: null,
              };
            } else {
              // Pacman / bracketed source tag: [2026-10-14T12:00+00:00] [ALPM] message
              const msg = trimmed.slice(pos);
              return {
                id: index,
                timestamp: firstTag,
                timeDisplay: formatTimeDisplay(firstTag),
                severity: inferSeverityFromText(msg),
                source: secondTag,
                message: msg,
                raw,
                details: '',
                json: null,
              };
            }
          }
        }
      }

      // Kernel / dmesg: [   12.345678] amdgpu 0000:03:00.0: [drm] *ERROR* ring gfx timeout
      const dm = RE_DMESG.exec(trimmed);
      if (dm) {
        const [, uptime, subsys, msg] = dm;
        const fullMsg = msg || '';
        return {
          id: index,
          timestamp: uptime,
          timeDisplay: formatTimeDisplay(uptime),
          severity: inferSeverityFromText(fullMsg),
          source: subsys ? subsys.split(/\s+/)[0] : (defaultSource === 'log' ? 'kernel' : defaultSource),
          message: fullMsg,
          raw,
          details: '',
          json: null,
        };
      }
    }
  }

  // 3. Angle-bracket syslog priority: <34>...
  if (c0 === 60) {
    const m5424 = RE_RFC5424.exec(trimmed);
    if (m5424) {
      const [, priStr, ts, , appName, , , msg] = m5424;
      const pri = Number(priStr);
      const sevNum = !isNaN(pri) ? (pri & 7) : 6;
      const sev = SYSLOG_SEV[sevNum] || inferSeverityFromText(msg);
      return {
        id: index,
        timestamp: ts === '-' ? '' : ts,
        timeDisplay: formatTimeDisplay(ts === '-' ? '' : ts),
        severity: sev,
        source: appName === '-' ? defaultSource : appName,
        message: msg,
        raw,
        details: '',
        json: null,
      };
    }
  }

  // 4. RFC 3164 Syslog: Oct 14 12:00:00 host kernel[123]: message
  if ((c0 >= 65 && c0 <= 90) || c0 === 60) {
    const m3164 = RE_RFC3164.exec(trimmed);
    if (m3164) {
      const [, priStr, ts, , appName, , msg] = m3164;
      let sev = inferSeverityFromText(msg);
      if (priStr != null) {
        const pri = Number(priStr);
        if (!isNaN(pri)) sev = SYSLOG_SEV[pri & 7] || sev;
      }
      return {
        id: index,
        timestamp: ts,
        timeDisplay: ts,
        severity: sev,
        source: appName || defaultSource,
        message: msg,
        raw,
        details: '',
        json: null,
      };
    }
  }

  // 5. Digit-prefixed ISO timestamp + LEVEL or plain timestamp
  if (c0 >= 48 && c0 <= 57) {
    const mIso = RE_ISO_LEVEL.exec(trimmed);
    if (mIso && isKnownLevel(mIso[2])) {
      const [, ts, lvl, bracketSrc, colonSrc, msg] = mIso;
      return {
        id: index,
        timestamp: ts,
        timeDisplay: formatTimeDisplay(ts),
        severity: normalizeSeverity(lvl),
        source: bracketSrc || colonSrc || defaultSource,
        message: msg,
        raw,
        details: '',
        json: null,
      };
    }

    const mTs = RE_LEADING_TS.exec(trimmed);
    if (mTs) {
      const [, ts, rest] = mTs;
      return {
        id: index,
        timestamp: ts,
        timeDisplay: formatTimeDisplay(ts),
        severity: inferSeverityFromText(rest),
        source: defaultSource,
        message: rest,
        raw,
        details: '',
        json: null,
      };
    }
  }

  return {
    id: index,
    timestamp: '',
    timeDisplay: '—',
    severity: inferSeverityFromText(trimmed),
    source: defaultSource,
    message: trimmed,
    raw,
    details: '',
    json: null,
  };
}

/**
 * Check if a line is a stack-trace or multi-line continuation of the preceding entry.
 */
export function isContinuationLine(line) {
  if (!line) return false;
  const c0 = line.charCodeAt(0);
  if (c0 === 32 || c0 === 9) {
    if (/^\s+at\s+/.test(line)) return true;
    if (/^\s+File\s+"[^"]+",\s+line\s+\d+/.test(line)) return true;
    if (/^[ \t]{2,}\S/.test(line)) {
      const t = line.trimStart();
      if (t.startsWith('{') && t.endsWith('}')) return false;
      if (/^\[(?:INFO|WARN|WARNING|ERROR|ERR|DEBUG|TRACE|FATAL|\d{4}-\d{2}-\d{2}|\s*\d+\.\d+)\]/i.test(t)) return false;
      return true;
    }
    return false;
  }
  if (c0 === 84 && line.startsWith('Traceback (most recent call last):')) return true;
  if (c0 === 67 && line.startsWith('Caused by:')) return true;
  return false;
}

/**
 * Parse multi-line log text into an array of structured entries, attaching
 * stack traces and indented continuation lines to the preceding entry.
 */
export function parseLogText(text, { sourceName = 'log', startId = 1 } = {}) {
  if (!text) return [];
  const lines = String(text).split('\n');
  const entries = [];
  let nextId = startId;

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    if (line.length > 0 && line.charCodeAt(line.length - 1) === 13) {
      line = line.slice(0, -1);
    }
    if (!line || !line.trim()) continue;

    if (entries.length > 0 && isContinuationLine(line)) {
      const prev = entries[entries.length - 1];
      prev.raw += '\n' + line;
      prev.details = prev.details ? prev.details + '\n' + line : line;
      if (/Error:|Exception:|Panic:/i.test(line) && prev.severity === 'info') {
        prev.severity = 'error';
      }
      continue;
    }

    const entry = parseLogLine(line, nextId++, sourceName);
    entries.push(entry);
  }

  return entries;
}

/**
 * Asynchronously parse large multi-line log text in frame-friendly slices so
 * 10,000+ line files never block a single UI frame for >16 ms.
 */
export async function parseLogTextAsync(text, { sourceName = 'log', startId = 1, chunkLines = 500 } = {}) {
  if (!text) return [];
  const lines = String(text).split('\n');
  if (lines.length <= chunkLines) {
    return parseLogText(text, { sourceName, startId });
  }

  const entries = [];
  let nextId = startId;

  for (let start = 0; start < lines.length; start += chunkLines) {
    const end = Math.min(lines.length, start + chunkLines);
    for (let i = start; i < end; i++) {
      let line = lines[i];
      if (line.length > 0 && line.charCodeAt(line.length - 1) === 13) {
        line = line.slice(0, -1);
      }
      if (!line || !line.trim()) continue;

      if (entries.length > 0 && isContinuationLine(line)) {
        const prev = entries[entries.length - 1];
        prev.raw += '\n' + line;
        prev.details = prev.details ? prev.details + '\n' + line : line;
        if (/Error:|Exception:|Panic:/i.test(line) && prev.severity === 'info') {
          prev.severity = 'error';
        }
        continue;
      }

      const entry = parseLogLine(line, nextId++, sourceName, { eagerDetails: false });
      entries.push(entry);
    }
    await new Promise((r) => setTimeout(r, 0));
  }

  return entries;
}

/**
 * Filter log entries by severity and search query (substring or regex via bro.search.Regex / RegExp).
 */
export function filterLogEntries(entries, { severity = 'all', query = '', useRegex = false, searchApi = null } = {}) {
  if (!Array.isArray(entries) || entries.length === 0) return [];
  const sevFilter = severity && severity !== 'all' ? severity.toLowerCase() : null;
  const q = query ? String(query).trim() : '';

  if (!sevFilter && !q) return entries;

  let matcher = null;
  if (q) {
    if (useRegex) {
      const sApi = searchApi || (typeof bro !== 'undefined' && bro && bro.search ? bro.search : null);
      if (sApi && typeof sApi.Regex === 'function') {
        try {
          const rx = new sApi.Regex(q);
          matcher = (e) => rx.test(e.raw);
        } catch (_) {
          // Fallback to JS RegExp or invalid regex
        }
      }
      if (!matcher) {
        try {
          const rx = new RegExp(q, 'i');
          matcher = (e) => rx.test(e.raw);
        } catch (_) {
          return [];
        }
      }
    } else {
      const needle = q.toLowerCase();
      matcher = (e) => {
        if (e._searchLower === undefined) {
          e._searchLower = e.raw.toLowerCase();
        }
        return e._searchLower.includes(needle);
      };
    }
  }

  const out = [];
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (sevFilter && e.severity !== sevFilter) continue;
    if (matcher && !matcher(e)) continue;
    out.push(e);
  }
  return out;
}
