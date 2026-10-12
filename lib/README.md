# The helm app kit

Shared look and building blocks for every helm app. bro mounts this folder
at `/lib` for any app inside `helmapps/` (the root `bro.json` says
`"lib": "lib"`), and `bro --install` copies it into the installed app, so
imports are always `/lib/...`.

Each module's header comment is its full documentation, with examples. This
page says what exists and when to use it. [`../diskusage/`](../diskusage/)
uses all of it.

## Styles

```html
<link rel="stylesheet" href="/lib/kit.css">   <!-- tokens, controls, layout, overlays -->
<link rel="stylesheet" href="css/app.css">     <!-- your app's few extra rules -->
```

| File | What |
|---|---|
| `css/tokens.css` | Every colour, size, radius, duration and z-index, as custom properties. Use only these. |
| `css/controls.css` | Reset, type classes (`.micro`, `.num`, `.mono`, `.dim`, `.title`), `.btn` (`.primary`, `.ghost`, `.danger`, `.small`), `.icon-btn`, `.field`, `.search-field`, `.checkbox`, `.switch`, `.slider`, `.segmented`, `.select`, `.list-row`, `.badge`, `.progress`, `.spinner`, `.empty`, `.kbd` |
| `css/layout.css` | `.app-frame`, `.toolbar`, `.sidebar`, `.content`, `.statusbar`, `.split`, `.crumbs`, `.tabstrip`, `.list-header`, `.vlist`, `.card`, `.page`, `.group`, `.form-row` |
| `css/overlays.css` | `.menu`, `.dialog`, `.toast`, `.tooltip`, `.popover` |

The look is helm's "graphite": quiet near-neutral dark surfaces, one solid
accent colour used sparingly (`--accent` for the one primary action or a
control that is on, `--accent-soft` for selection, `--accent-text` for an
accent icon or word; never a gradient), small consistent radii (`--r-ctl`
6px, `--r-card` 10px, `--r-panel` 12px), and Inter everywhere, shipped in
`lib/fonts` so every machine draws the same letters. Figures in columns or
that tick get `.num` (tabular figures), not a monospace face. `--accent-h`
follows the user's accent setting in helm automatically (`startApp` does
it).

Surfaces from back to front are `--surface-1` (toolbar, sidebar, status
bar: the darker chrome), `--surface-0` (content), `--surface-2` (cards) and
`--surface-3` (menus, dialogs, tooltips). Text runs `--t1` (primary) to
`--t4` (hints). The spacing scale is `--s1`…`--s10` on a 4px rhythm.
`meter(fraction)` (layout.js) is the thin "how full" bar; a sidebar item can
carry one under a second line (`{ sub, meter }`).

## JavaScript

| Module | Exports | Use it for |
|---|---|---|
| `app.js` | `startApp`, `followShellAccent` | The first line of `main.js`. Gives `app.commands`, `app.settings`, `app.onLaunch`, `app.setTitle`, `app.newWindow`, `app.quit`, `app.expose` (→ `window.app` for tests). |
| `dom.js` | `h`, `$`, `$$`, `on`, `append`, `replaceChildren`, `api`, `apiReason`, `attempt`, `clamp`, `debounce`, `perFrame`, `isTyping` | Building DOM (`h('div.row', {onclick}, ...)`), getting optional `bro.*` namespaces safely (`api('vfs')` → null when missing). |
| `icons.js` | `icon`, `iconHtml`, `hydrateIcons`, `hasIcon`, `defineIcon`, `iconNames` | Stroke icons (`icon('folder')`). About 150 names; `iconNames()` lists them. |
| `commands.js` | `Commands`, `normalizeChord`, `eventChord`, `displayChord` | Every action, its label, icon, shortcuts, enabled/checked state. `commands.item(id)` makes a menu item. |
| `settings.js` | `Settings`, `shellPref`, `watchShellPrefs` | Persistent per-app settings in bro.conf (`app.settings` when you pass a schema to `startApp`). |
| `layout.js` | `appFrame`, `Toolbar`, `Sidebar`, `SplitPane`, `Breadcrumbs`, `Tabs`, `emptyState`, `meter` | The window's structure. |
| `list.js` | `VirtualList` | Any collection: list with columns and sortable headers, an icon grid, or a sideways strip (`orientation: 'horizontal'`); selection, rubber band, keyboard, type-ahead, context menu, drag (and Alt+arrow) to reorder (`reorderable`, `onReorder`). Handles 100k items; a hidden list paints nothing. |
| `menu.js` | `menu` (the `Menu` instance) | Context menus and drop-downs, with submenus and keyboard navigation. |
| `dialog.js` | `Dialog`, `confirmDialog`, `alertDialog`, `promptDialog` | Modal questions. Promise-based; never `alert()`/`confirm()`/`prompt()`. |
| `toast.js` | `toast` | Brief in-app messages with an optional Undo. |
| `controls.js` | `Switch`, `Checkbox`, `Slider`, `Segmented`, `Select`, `Progress` | Form controls with `.el`, `set()`, `onChange`. |
| `combobox.js` | `Combobox` | A text field with suggestions as you type (`suggest(text)` → items): arrows, Enter (Shift+Enter passed on), Tab completes, Escape; free text allowed. |
| `format.js` | `formatBytes`, `formatCount`, `formatNumber`, `formatPercent`, `formatTime`, `formatDate`, `formatDateLong`, `formatDuration`, `formatRelative` | Displaying values the same way everywhere. |
| `files.js` | `userDirs`, `kindOf`, `mimeOf`, `iconFor`, `openFile`, `openApp`, `defaultAppFor`, `appsFor`, `addRecent`, `statOrNull`, `exists`, `isDirectory`, `isHidden`, path helpers | User folders, file kinds and icons, opening files with their default app. |
| `tooltip.js` | `installTooltips` | `data-tip="…"` (and `data-keys`) on any element. `startApp` installs it. |
| `test.js` | `app`, `waitFor`, `settle`, `eq`, `press`, `type`, `mod`, `clickEl`, `dblClickEl`, `rightClickEl`, `drag`, `center`, `menuLabels`, `chooseMenu`, `currentDialog`, `dialogButton`, `answerPrompt`, `fixtureDir` | Headless tests. |

## A minimal app

```js
import { startApp } from '/lib/app.js';
import { h } from '/lib/dom.js';
import { appFrame, Toolbar } from '/lib/layout.js';
import { toast } from '/lib/toast.js';

const app = startApp({ settings: { count: { type: 'int', default: 0 } } });
const ui = appFrame({ toolbar: true });
document.body.appendChild(ui.frame);

const label = h('div.head', String(app.settings.get('count')));
ui.content.appendChild(h('div.page', label));

app.commands.add({ id: 'add', label: 'Add One', icon: 'plus', keys: ['Mod+='],
  run: () => {
    app.settings.set('count', app.settings.get('count') + 1);
    label.textContent = String(app.settings.get('count'));
    toast('Added one');
  } });
new Toolbar(ui.toolbar, app.commands).button('add');
app.expose({ label });
```

## What the kit does not have (yet)

If your app needs one of these, build it inside your app and add a GAPS.md
entry (`Belongs in: kit`), so it can be lifted into `lib/` later:

- drag and drop of items between views and apps
- a tree view (folders in a sidebar that expand)
- a code or rich-text editor component
- a colour picker, a date picker
- a command palette (the `Commands` registry has `list()` for building one)
- a properties/inspector side panel beyond `SplitPane` + `.form-row`

Kit gaps found while building the kit itself are in [../GAPS.md](../GAPS.md).
