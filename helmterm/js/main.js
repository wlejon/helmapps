// helmterm's entry point: build the application, open the first tabs.
// window.helmterm is the application object, which is also how the headless
// tests reach in (tests/*.js).

import { App } from './app.js';
import { host } from './core/host.js';

const app = new App();
window.helmterm = app;
app.start(host.argv);
