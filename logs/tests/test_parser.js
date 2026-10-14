/**
 * Unit tests for logs/js/log-parser.js:
 *  - normalizeSeverity
 *  - parseLogLine across JSONL, Bro/Helm engine format, RFC 5424 & RFC 3164 Syslog,
 *    kernel dmesg, pacman.log, and plain text fallback
 *  - parseLogText with multi-line stack trace & continuation attachment
 *  - filterLogEntries with severity filter, substring search, and regex search via bro.search.Regex
 */

import { app, eq } from '/lib/test.js';

const {
  normalizeSeverity,
  parseLogLine,
  parseLogText,
  filterLogEntries,
} = app.parsers;

// 1. normalizeSeverity
eq(normalizeSeverity('emerg'), 'error', 'emerg -> error');
eq(normalizeSeverity('FATAL'), 'error', 'FATAL -> error');
eq(normalizeSeverity('err'), 'error', 'err -> error');
eq(normalizeSeverity('panic'), 'error', 'panic -> error');
eq(normalizeSeverity('warn'), 'warn', 'warn -> warn');
eq(normalizeSeverity('WARNING'), 'warn', 'WARNING -> warn');
eq(normalizeSeverity('notice'), 'info', 'notice -> info');
eq(normalizeSeverity('INFO'), 'info', 'INFO -> info');
eq(normalizeSeverity('debug'), 'debug', 'debug -> debug');
eq(normalizeSeverity('trace'), 'debug', 'trace -> debug');

// 2. JSONL format
const jsonEntry = parseLogLine(
  '{"timestamp":"2026-10-14T08:15:30.120Z","level":"error","service":"auth-api","message":"Token verification failed","userId":42}',
  1,
  'app.jsonl',
);
eq(jsonEntry.severity, 'error', 'JSONL level parsed as error');
eq(jsonEntry.source, 'auth-api', 'JSONL service parsed as source');
eq(jsonEntry.message, 'Token verification failed', 'JSONL message extracted');
eq(jsonEntry.timeDisplay, '08:15:30.120', 'JSONL ISO time shortened for column display');
assert(jsonEntry.details.includes('"userId": 42'), 'JSONL details pretty-printed');

// 3. Bro / Helm engine formats
const broSimple = parseLogLine('[WARN]   Shader cache miss on pipeline 7', 2, 'bro');
eq(broSimple.severity, 'warn', 'Bro simple [WARN] severity');
eq(broSimple.source, 'bro', 'Bro simple default source');
eq(broSimple.message, 'Shader cache miss on pipeline 7', 'Bro simple message');

const broBracketed = parseLogLine('[2026-10-14 12:34:56.789] [ERROR] [vulkan] Device lost during submit', 3, 'bro');
eq(broBracketed.severity, 'error', 'Bro bracketed [ERROR] severity');
eq(broBracketed.source, 'vulkan', 'Bro bracketed source');
eq(broBracketed.timeDisplay, '12:34:56.789', 'Bro bracketed timeDisplay');
eq(broBracketed.message, 'Device lost during submit', 'Bro bracketed message');

const broIso = parseLogLine('2026-10-14T12:34:56.789Z INFO [helm.shell] Compositor initialized', 4, 'helm');
eq(broIso.severity, 'info', 'Bro ISO INFO severity');
eq(broIso.source, 'helm.shell', 'Bro ISO source');
eq(broIso.message, 'Compositor initialized', 'Bro ISO message');

// 4. Syslog RFC 5424 & RFC 3164
const rfc5424 = parseLogLine('<34>1 2026-10-14T12:00:00Z archbox sshd 1234 - - Failed password for root', 5, 'syslog');
eq(rfc5424.severity, 'error', 'RFC 5424 pri 34 (facility 4, sev 2 crit) -> error');
eq(rfc5424.source, 'sshd', 'RFC 5424 app-name -> sshd');
eq(rfc5424.message, 'Failed password for root', 'RFC 5424 message');

const rfc3164 = parseLogLine('Oct 14 12:00:00 archbox kernel[123]: [ 12.345] error: nvme0n1 timeout', 6, 'syslog');
eq(rfc3164.severity, 'error', 'RFC 3164 error keyword detected');
eq(rfc3164.source, 'kernel', 'RFC 3164 tag without pid');
eq(rfc3164.timestamp, 'Oct 14 12:00:00', 'RFC 3164 timestamp');

// 5. Kernel dmesg and pacman.log
const dmesg = parseLogLine('[   12.345678] amdgpu 0000:03:00.0: [drm] *ERROR* ring gfx timeout', 7, 'dmesg');
eq(dmesg.severity, 'error', 'dmesg *ERROR* detected');
eq(dmesg.source, 'amdgpu', 'dmesg driver source');
eq(dmesg.timeDisplay, '12.346s', 'dmesg uptime display');

const pacman = parseLogLine('[2026-10-14T12:00+00:00] [ALPM] upgraded linux (6.11.1 -> 6.11.2)', 8, 'pacman.log');
eq(pacman.severity, 'info', 'pacman.log ALPM info');
eq(pacman.source, 'ALPM', 'pacman.log source ALPM');
eq(pacman.message, 'upgraded linux (6.11.1 -> 6.11.2)', 'pacman.log message');

// 6. Multi-line stack trace grouping in parseLogText
const multiLineSample = [
  '[2026-10-14 14:00:01.000] [INFO] [helm.files] Loaded directory /home/user',
  '[2026-10-14 14:00:02.100] [ERROR] [helm.files] Uncaught TypeError: Cannot read property of null',
  '    at openFolder (js/main.js:142:15)',
  '    at HTMLButtonElement.onclick (js/main.js:88:9)',
  '[2026-10-14 14:00:03.000] [DEBUG] [helm.files] Selection cleared',
].join('\n');

const parsedMulti = parseLogText(multiLineSample, { sourceName: 'helm.files' });
eq(parsedMulti.length, 3, 'Stack trace lines grouped into preceding error entry');
eq(parsedMulti[1].severity, 'error', 'Second entry is error');
assert(parsedMulti[1].details.includes('at openFolder (js/main.js:142:15)'), 'First stack frame attached to details');
assert(parsedMulti[1].details.includes('at HTMLButtonElement.onclick'), 'Second stack frame attached to details');

// 7. filterLogEntries: severity, substring, and regex (via bro.search.Regex)
const onlyErrors = filterLogEntries(parsedMulti, { severity: 'error' });
eq(onlyErrors.length, 1, 'Filter by error severity returns 1 entry');

const subMatch = filterLogEntries(parsedMulti, { query: 'openfolder', useRegex: false });
eq(subMatch.length, 1, 'Case-insensitive substring search matches stack frame in raw text');

const regexMatch = filterLogEntries(parsedMulti, {
  query: 'js/main\\.js:\\d+',
  useRegex: true,
  searchApi: typeof bro !== 'undefined' ? bro.search : null,
});
eq(regexMatch.length, 1, 'Regex search matches stack trace line numbers');

const invalidRegex = filterLogEntries(parsedMulti, { query: '[unclosed group', useRegex: true });
eq(invalidRegex.length, 0, 'Invalid regex handled gracefully without throwing');

console.log('test_parser PASSED');
