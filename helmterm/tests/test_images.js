// Inline images, where the element has them: imageMemory (MiB, per profile)
// sets each terminal's quota, an image a program draws is held against it,
// and 0 turns images off.

import { app, waitFor, eq, childAvailable, requireApp, writeSettings, reportPath, childProfile } from './lib/harness.js';
import * as term from '../js/term/adapter.js';

const MIB = 1024 * 1024;
const RED = btoa(String.fromCharCode(...[255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255]));
const KITTY = '\x1b_Ga=T,f=32,s=2,v=2,c=6,r=3;' + RED + '\x1b\\';

if (requireApp() && !childAvailable()) {
    skipTest('helmterm-testchild is not built beside the headless binary');
} else if (app && !term.caps.images) {
    skipTest('this build\'s <terminal> has no inline images');
} else if (app) {
    const ws = app.workspace;
    writeSettings({
        confirmClose: 'never',
        imageMemory: 64,
        profiles: { list: [
            childProfile('Img On', reportPath('i')),
            childProfile('Img Off', reportPath('o'), { imageMemory: 0 }),
        ] },
    });
    const open = (name) => {
        const p = ws.openTab({ profile: name }).focused;
        waitFor(() => p.el.screenText().includes('TESTCHILD READY'), name);
        return p;
    };
    const on = open('Img On');
    eq(on.el.options.imageMemoryLimit, 64 * MIB, 'imageMemory sets the quota');
    on.el.feed(KITTY);
    waitFor(() => on.el.images.count === 1, 'the image is held: ' + JSON.stringify(on.el.images));
    eq([on.el.images.placements, on.el.images.limit], [1, 64 * MIB], 'placed, against the quota');

    const off = open('Img Off');
    eq(off.el.options.imageMemoryLimit, 0, 'a profile turns images off');
    off.el.feed(KITTY);
    advanceTime(100);
    eq(off.el.images.count, 0, 'and none are held');

    app.settings.set('imageMemory', null);
    waitFor(() => on.el.options.imageMemoryLimit === 320 * MIB, 'back to bro\'s default: ' + on.el.options.imageMemoryLimit);
    eq(off.el.options.imageMemoryLimit, 0, 'the profile still has its own');
    console.log('test_images: finished');
}
