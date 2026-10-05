// broterm's entry point: build the application, open the first tabs.
// window.broterm is the application object, which is also how the headless
// tests reach in (tests/*.js).

import { App } from './app.js';
import { host } from './core/host.js';

const app = new App();
window.broterm = app;
app.start(host.argv);
