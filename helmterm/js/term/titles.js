// What a pane is called.
//
//   1. A title the user gave the tab or pane (rename, -t, session restore).
//   2. With suppressApplicationTitle, the profile's tabTitle, else its name:
//      the program's own titles are ignored (Windows Terminal's setting).
//   3. When the element reports a foreground process that is not the shell
//      (bro T2b), a description of it: "vim — notes.txt", "ssh host".
//      A title the program set after it started wins over the description.
//   4. The program's title (OSC 0 / 2), unless it is only an executable's
//      path. ConPTY titles a console with the path of the program it started
//      ("C:\Program Files\PowerShell\7\pwsh.exe"), and cmd.exe appends the
//      running command to that ("C:\WINDOWS\system32\cmd.exe - ping x"); a
//      bare path becomes the profile's name, and a path with a suffix the
//      profile's name with the suffix.
//   5. The profile's tabTitle, else its name.

const EXE_PATH = /^(?:[A-Za-z]:[\\/]|\\\\|\/)[^\0]*?[^\\/]+?(?:\.(?:exe|com|bat|cmd))?$/i;

function basename(p) { return String(p || '').split(/[\\/]/).pop(); }

function stem(p) { return basename(p).replace(/\.(exe|com|bat|cmd)$/i, '').toLowerCase(); }

/// Whether `t` is just the path of an executable (no spaces after its last
/// separator other than inside the file name), and so not a real title.
export function isExecutablePath(t, command) {
    const s = String(t || '').trim();
    if (!s) return false;
    if (command && stem(s) === stem(command) && /[\\/]/.test(s)) return true;
    if (/\.(exe|com)$/i.test(s) && /[\\/]/.test(s)) return true;
    // A bare POSIX path to the shell ("/usr/bin/bash") reads the same way.
    return EXE_PATH.test(s) && !/\s/.test(basename(s)) && !!command && stem(s) === stem(command);
}

/// "C:\WINDOWS\system32\cmd.exe - ping host" -> " - ping host".
function exeSuffix(t) {
    const m = /^((?:[A-Za-z]:[\\/]|\/)[^]*?\.(?:exe|com))(\s+-\s+.*)$/i.exec(String(t || ''));
    return m ? m[2] : null;
}

const SHELLS = new Set(['bash', 'zsh', 'fish', 'sh', 'dash', 'ksh', 'tcsh', 'csh', 'pwsh', 'powershell', 'cmd',
    'nu', 'xonsh', 'elvish', 'wsl', 'wslhost', 'conhost', 'openconsole', 'login']);

const FILE_PROGRAMS = new Set(['vim', 'nvim', 'vi', 'nano', 'micro', 'emacs', 'hx', 'helix', 'less', 'more',
    'kak', 'joe', 'mcedit', 'bat', 'tail', 'view']);
const HOST_PROGRAMS = new Set(['ssh', 'mosh', 'telnet', 'sftp', 'et']);
// ssh's options that take a value, so the host is the first word after them.
const SSH_VALUE_OPTS = new Set(['-b', '-c', '-D', '-E', '-e', '-F', '-I', '-i', '-J', '-L', '-l', '-m', '-O',
    '-o', '-p', '-Q', '-R', '-S', '-W', '-w', '-B']);

/// A foreground process as a title: "vim — notes.txt", "ssh host",
/// "python — script.py", or its name alone.
export function describeProcess(fg) {
    if (!fg || !fg.name) return '';
    const name = fg.name;
    const lower = name.toLowerCase();
    const args = fg.args || [];
    if (HOST_PROGRAMS.has(lower)) {
        for (let i = 0; i < args.length; i++) {
            const a = args[i];
            if (SSH_VALUE_OPTS.has(a)) { i++; continue; }
            if (a.startsWith('-')) continue;
            return name + ' ' + a;
        }
        return name;
    }
    const firstFile = args.find((a) => a && !a.startsWith('-') && !a.startsWith('+'));
    if (FILE_PROGRAMS.has(lower)) return firstFile ? name + ' — ' + basename(firstFile) : name;
    if (/^(python\d*(\.\d+)?|node|deno|bun|ruby|perl|php|lua)$/.test(lower) && firstFile) {
        return name + ' — ' + basename(firstFile);
    }
    return name;
}

export function isShellProcess(fg, shellCommand) {
    if (!fg) return true;
    const n = (fg.name || '').toLowerCase();
    return SHELLS.has(n) || (!!shellCommand && n === stem(shellCommand));
}

/// The title for a pane, from the state Pane keeps (see the rules above).
///   s: { userTitle, profile, programTitle, programTitleAt, command,
///        foreground, foregroundAt }
export function resolveTitle(s) {
    if (s.userTitle) return s.userTitle;
    const p = s.profile || {};
    const fixed = p.tabTitle || p.name || 'Terminal';
    if (p.suppressApplicationTitle) return fixed;
    const t = String(s.programTitle || '').trim();
    const usable = t && !isExecutablePath(t, s.command);
    const fg = s.foreground;
    if (fg && !isShellProcess(fg, s.command)) {
        // The program renamed itself since it came to the front: its word.
        if (usable && s.programTitleAt >= (s.foregroundAt || 0)) return t;
        const d = describeProcess(fg);
        if (d) return d;
    }
    if (usable) {
        const suffix = exeSuffix(t);
        return suffix ? fixed + suffix : t;
    }
    if (t) {
        const suffix = exeSuffix(t);
        if (suffix) return fixed + suffix;
    }
    return fixed;
}
