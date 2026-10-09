// --latency-test N: input-to-photon against `broremote serve-test --latency`
// (broremote's docs/design.md, "Latency, measured"), the same probes
// broremote-view's --latency-test sends. Each probe is a press and release of
// KEY_F13; the server answers by drawing a counter into the picture's marker
// row, the session reads it from the decoded pictures, and a probe closes
// when the answering picture is presented. One probe at a time, a quarter
// second or so apart; once N have closed (or been lost) the report goes to
// stdout (and --latency-out), and the app quits.

const fs = require('fs');

const fmt = (s) => `${s.mean.toFixed(1)} / ${s.p90.toFixed(1)} / ${s.max.toFixed(1)}`;

export function runLatencyTest(session, view, opts) {
    let sent = 0;
    let next = 0;
    let done = false;
    const timer = setInterval(() => {
        if (done) return;
        const st = session.status();
        if (st.state === 'closed') {
            clearInterval(timer);
            return;
        }
        if (st.state !== 'connected' || view.stats().presented < 2) return;
        const p = session.probes();
        if (p.count + p.lost >= opts.latencyTest) {
            done = true;
            clearInterval(timer);
            report(session, view, p, opts);
            return;
        }
        const now = Date.now();
        if (now < next || sent >= opts.latencyTest + 20) return;
        if (session.probe()) {
            ++sent;
            next = now + 200 + ((sent * 37) % 67);
        } else {
            next = now + 20;
        }
    }, 5);
}

function report(session, view, p, opts) {
    const st = session.status();
    const v = view.stats();
    const k = session.stats();
    const out = {
        probes: p.count,
        lost: p.lost,
        presented: p.presented,
        decoded: p.decoded,
        parts: p.parts,
        codec: st.codec,
        size: `${st.width}x${st.height}`,
        decoder: st.decoder,
        hardware: st.hardware,
        pictures: v.path,
        zeroCopy: v.zeroCopy,
        gpuPictures: k.gpuPictures,
        uploads: v.uploads,
    };
    const parts = p.parts;
    const text =
        `helmremote: ${p.count} probes (${p.lost} lost), key press to picture presented ` +
        `mean / p90 / max ${fmt(p.presented)} ms, to decoded ${fmt(p.decoded)} ms\n` +
        `  parts (mean): uplink ${parts.uplink.toFixed(2)} queue ${parts.queue.toFixed(2)} ` +
        `encode ${parts.encode.toFixed(2)} wait ${parts.wait.toFixed(2)} net ${parts.net.toFixed(2)} ` +
        `dwait ${parts.dwait.toFixed(2)} decode ${parts.decode.toFixed(2)} present ${parts.present.toFixed(2)} ` +
        `rtt ${parts.rtt.toFixed(2)}\n` +
        `  ${st.codec} ${st.width}x${st.height} ${st.decoder}; pictures ${v.path}` +
        `${v.zeroCopy ? ' (zero-copy)' : ''}, ${k.gpuPictures} left on the GPU, ${v.uploads} uploaded`;
    console.log(text);
    if (opts.latencyOut) {
        try {
            fs.writeFileSync(opts.latencyOut, JSON.stringify(out, null, 2) + '\n' + text + '\n', 'utf-8');
        } catch (e) {
            console.error('helmremote: cannot write ' + opts.latencyOut + ': ' + e.message);
        }
    }
    session.close();
    bro.quit();
}
