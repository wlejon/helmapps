// The command line (bro.broterm.argv: everything after the program name that
// the native side did not answer itself):
//
//   broterm [-p|--profile NAME] [-d|--directory DIR] [-t|--title TITLE]
//           [--no-restore] [--] [command [args...]]
//
// Everything after `--`, or from the first argument that is not an option, is
// the command the first tab runs (instead of its profile's).

export function parseArgs(argv) {
    const out = { profile: null, cwd: null, title: null, commandline: null, noRestore: false, errors: [] };
    const list = Array.isArray(argv) ? argv.map(String) : [];
    const value = (i, name) => {
        if (i + 1 >= list.length) { out.errors.push(name + ' needs a value'); return null; }
        return list[i + 1];
    };
    for (let i = 0; i < list.length; i++) {
        const a = list[i];
        if (a === '--') { out.commandline = list.slice(i + 1); break; }
        const eq = a.startsWith('--') ? a.indexOf('=') : -1;
        const flag = eq > 0 ? a.slice(0, eq) : a;
        const inline = eq > 0 ? a.slice(eq + 1) : null;
        const take = (name) => {
            if (inline !== null) return inline;
            const v = value(i, name);
            if (v !== null) i++;
            return v;
        };
        if (flag === '-p' || flag === '--profile') out.profile = take(flag);
        else if (flag === '-d' || flag === '--directory' || flag === '--cwd') out.cwd = take(flag);
        else if (flag === '-t' || flag === '--title') out.title = take(flag);
        else if (flag === '--no-restore') out.noRestore = true;
        else if (a.startsWith('-') && a.length > 1) out.errors.push('unknown option ' + a);
        else { out.commandline = list.slice(i); break; }
    }
    if (out.commandline && !out.commandline.length) out.commandline = null;
    return out;
}

/// Whether the command line asked for a particular first tab.
export function asksForTab(opts) {
    return !!(opts && (opts.profile || opts.cwd || opts.title || opts.commandline));
}
