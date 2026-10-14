// term's entry point: build the application, open the first tabs.
// window.term is the application object, which is also how the headless
// tests reach in (tests/*.js).

import { followShellAccent } from '/lib/app.js';
import { App } from './app.js';
import { host } from './core/host.js';

followShellAccent();
const app = new App();
window.term = app;
app.start(host.argv);
