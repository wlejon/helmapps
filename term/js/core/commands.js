// The command registry: every action helmterm can take, by id. Keybindings,
// the command palette, menus and the tests all run commands through here.

export class CommandRegistry {
    constructor() {
        this.commands = new Map();
    }

    /// `spec`: { title, run(args), palette?: false, enabled?(): boolean,
    ///           category?: string }
    register(id, spec) {
        this.commands.set(id, { id, category: 'General', palette: true, ...spec });
    }

    has(id) { return this.commands.has(id); }

    get(id) { return this.commands.get(id) || null; }

    enabled(id) {
        const c = this.commands.get(id);
        return !!c && (typeof c.enabled !== 'function' || c.enabled());
    }

    /// Run a command. Returns whatever it returns; false when unknown or
    /// disabled. Errors are logged, not thrown, so a key press never takes
    /// the input handler down.
    run(id, args) {
        const c = this.commands.get(id);
        if (!c) { console.error('helmterm: unknown command ' + id); return false; }
        if (typeof c.enabled === 'function' && !c.enabled()) return false;
        try {
            const r = c.run(args || {});
            return r === undefined ? true : r;
        } catch (e) {
            console.error('helmterm: ' + id + ' failed: ' + (e && e.stack || e));
            return false;
        }
    }

    list() { return [...this.commands.values()]; }
}
