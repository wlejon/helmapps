// The command line: remote [HOST] [options]
//
//   HOST                 ssh destination ([user@]host); none: the connect screen
//   -s, --socket NAME    the server's socket (default: the server's default)
//   --local              connect to a socket on this machine (no ssh)
//   --fullscreen         start fullscreen
//   --no-audio           no audio lane
//   --no-mic             the host's audio only
//   --stats              show the statistics overlay
//   --latency-test N     send N latency probes (the host runs
//                        `broremote serve-test --latency`), report, and quit
//   --latency-out FILE   also write the report (JSON) there
//
// Pure: parseArgs(argv) -> {host, socket, local, fullscreen, audio, mic,
// stats, latencyTest, latencyOut, errors}.

export function parseArgs(argv) {
    const out = {
        host: '', socket: '', local: false, fullscreen: false, audio: true, mic: true, stats: false,
        latencyTest: 0, latencyOut: '', errors: [],
    };
    const value = (i, name) => {
        if (i + 1 >= argv.length) {
            out.errors.push(name + ' needs a value');
            return null;
        }
        return argv[i + 1];
    };
    for (let i = 0; i < argv.length; ++i) {
        let a = argv[i];
        let inline = null;
        if (a.startsWith('--') && a.includes('=')) {
            inline = a.slice(a.indexOf('=') + 1);
            a = a.slice(0, a.indexOf('='));
        }
        const take = (name) => {
            if (inline !== null) return inline;
            const v = value(i, name);
            if (v !== null) ++i;
            return v;
        };
        switch (a) {
            case '-s': case '--socket': { const v = take(a); if (v !== null) out.socket = v; break; }
            case '--local': out.local = true; break;
            case '--fullscreen': out.fullscreen = true; break;
            case '--no-audio': out.audio = false; break;
            case '--no-mic': out.mic = false; break;
            case '--stats': out.stats = true; break;
            case '--latency-test': {
                const v = take(a);
                if (v === null) break;
                const n = Number(v);
                if (!Number.isInteger(n) || n < 1) out.errors.push('--latency-test needs a count');
                else out.latencyTest = n;
                break;
            }
            case '--latency-out': { const v = take(a); if (v !== null) out.latencyOut = v; break; }
            default:
                if (a.startsWith('-')) out.errors.push('unknown option ' + a);
                else if (!out.host) out.host = a;
                else out.errors.push('unexpected argument ' + a);
        }
    }
    return out;
}
