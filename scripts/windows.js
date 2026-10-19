// D&D Amigos Connector — scripts/windows.js
//
// Every window this module opens goes through here, so the "which kind of Foundry
// window" question lives in ONE place:
//
//   openDialog({ title, content, buttons, default, width, render, close })
//   confirmDialog({ title, content })      -> Promise<boolean>
//   MenuWindow                             base class for Configure Settings menu buttons
//
// Foundry's old Dialog / FormApplication windows are deprecated (since v13); the newer
// DialogV2 is used whenever it exists. `openDialog` takes the OLD Dialog's shape
// (buttons as an object, callbacks and render handed a jQuery-like `html` to .find() in),
// so the window code in main.js and lore.js reads the same either way.
//
// Escape hatch: the client setting "Use legacy windows" forces the old Dialog back, and
// any failure to build a new-style window falls back to the old one automatically.

import { MODULE_ID } from './util.js';

/* --------------------------------------------------------------------
   MiniQuery — the handful of jQuery methods the windows use, over plain
   DOM, so nothing depends on Foundry still shipping jQuery.
-------------------------------------------------------------------- */

class MiniQuery {
  constructor(elements) {
    this.elements = elements.filter(Boolean);
    this.length = this.elements.length;
    this.elements.forEach((el, i) => { this[i] = el; });
  }

  find(selector) {
    return new MiniQuery(this.elements.flatMap((el) => [...el.querySelectorAll(selector)]));
  }

  first() { return new MiniQuery(this.elements.slice(0, 1)); }

  closest(selector) { return new MiniQuery(this.elements.map((el) => el.closest(selector))); }

  on(type, handler) {
    this.elements.forEach((el) => el.addEventListener(type, handler));
    return this;
  }

  val(value) {
    if (value === undefined) return this.elements[0]?.value;
    this.elements.forEach((el) => { el.value = value; });
    return this;
  }

  html(value) {
    if (value === undefined) return this.elements[0]?.innerHTML;
    this.elements.forEach((el) => { el.innerHTML = value; });
    return this;
  }

  text(value) {
    if (value === undefined) return this.elements[0]?.textContent;
    this.elements.forEach((el) => { el.textContent = value; });
    return this;
  }

  prop(name, value) {
    if (value === undefined) return this.elements[0]?.[name];
    this.elements.forEach((el) => { el[name] = value; });
    return this;
  }

  css(name, value) {
    this.elements.forEach((el) => { el.style[name] = value; });
    return this;
  }

  empty() {
    this.elements.forEach((el) => el.replaceChildren());
    return this;
  }

  is(selector) { return this.elements.some((el) => el.matches(selector)); }

  trigger(type) {
    this.elements.forEach((el) => {
      if (typeof el[type] === 'function' && (type === 'focus' || type === 'blur' || type === 'click')) el[type]();
      else el.dispatchEvent(new Event(type, { bubbles: true }));
    });
    return this;
  }
}

function wrap(element) { return new MiniQuery([element]); }

/* --------------------------------------------------------------------
   Which kind of window
-------------------------------------------------------------------- */

function dialogV2() {
  return globalThis.foundry?.applications?.api?.DialogV2 ?? null;
}

function legacyWanted() {
  try {
    return Boolean(game.settings.get(MODULE_ID, 'legacyWindows'));
  } catch (err) {
    return false; // setting not registered yet
  }
}

function useNewWindows() {
  return Boolean(dialogV2()) && !legacyWanted();
}

/** The old Dialog class, wherever this Foundry keeps it (undefined once it is removed). */
function legacyDialogClass() {
  return globalThis.foundry?.appv1?.api?.Dialog ?? globalThis.Dialog;
}

/* --------------------------------------------------------------------
   Dialogs
-------------------------------------------------------------------- */

// `<i class="fa-solid fa-link"></i>` (the old button icon) -> "fa-solid fa-link" (the new one).
function iconClasses(icon) {
  if (!icon) return '';
  const match = /class\s*=\s*["']([^"']+)["']/.exec(icon);
  return match ? match[1] : String(icon);
}

let amigosDialogClass = null;

/** DialogV2 plus two hooks of ours: "first rendered" and "closed". Built on first use. */
function getAmigosDialogClass() {
  if (amigosDialogClass) return amigosDialogClass;
  const DialogV2 = dialogV2();
  amigosDialogClass = class AmigosDialog extends DialogV2 {
    constructor(config, hooks) {
      super(config);
      this.amigosHooks = hooks || {};
    }

    _onRender(context, options) {
      super._onRender(context, options);
      if (this.amigosRendered) return;
      this.amigosRendered = true;
      // If this Foundry did not take our element as the dialog's content, put it in ourselves.
      const root = this.amigosHooks.root;
      if (root && !this.element.contains(root)) {
        const holder = this.element.querySelector('.dialog-content') ?? this.element.querySelector('form') ?? this.element;
        holder.replaceChildren(root);
      }
      this.amigosHooks.render?.(wrap(this.element));
    }

    _onClose(options) {
      super._onClose(options);
      this.amigosHooks.close?.();
    }
  };
  return amigosDialogClass;
}

function openNewDialog(options) {
  const { title, content, buttons, default: defaultKey, width, render, close } = options;
  // Trusted markup built by this module (everything dynamic in it is escaped), so it goes in as
  // an element: a plain string would be sanitized by DialogV2.
  const root = document.createElement('div');
  root.className = 'dnd-amigos-window';
  root.innerHTML = content;
  root.querySelectorAll('button:not([type])').forEach((b) => { b.type = 'button'; });
  // DialogV2 sits in a <form>: Enter inside a text box would "press" the first button (usually Close).
  root.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && ev.target.tagName === 'INPUT') ev.preventDefault();
  });

  let dialog;
  const buttonList = Object.entries(buttons || {}).map(([action, b]) => ({
    action,
    label: b.label,
    icon: iconClasses(b.icon),
    default: action === defaultKey,
    callback: b.callback ? () => b.callback(wrap(dialog.element)) : undefined,
  }));

  const AmigosDialog = getAmigosDialogClass();
  dialog = new AmigosDialog({
    window: { title, resizable: true },
    position: { width },
    content: root,
    buttons: buttonList,
  }, { render, close, root });
  // Building the window is async: if drawing it fails, tidy up and use the legacy window instead.
  Promise.resolve(dialog.render({ force: true })).catch((err) => {
    console.warn(`${MODULE_ID} | new-style window failed to draw, using the legacy one`, err);
    dialog.amigosHooks = {}; // the legacy window takes over the render/close handlers
    Promise.resolve(dialog.close?.()).catch(() => {}).finally(() => {
      try { openLegacyDialog(options); } catch (e) { console.error(`${MODULE_ID} | no usable window type`, e); }
    });
  });
  return dialog;
}

function openLegacyDialog({ title, content, buttons, default: defaultKey, width, render, close }) {
  const Legacy = legacyDialogClass();
  if (!Legacy) throw new Error('This Foundry version has no window type the module can use.');
  const dialog = new Legacy({ title, content, buttons, default: defaultKey, render, close }, { width });
  dialog.render(true);
  return dialog;
}

/**
 * Open a window. Same shape as the old `new Dialog({...}, { width }).render(true)`:
 * buttons is { key: { label, icon, callback(html) } }, `render(html)` runs once the window is
 * drawn, `close()` when it goes away. Returns the dialog (it has .close()).
 */
export function openDialog(options) {
  if (useNewWindows()) {
    try {
      return openNewDialog(options);
    } catch (err) {
      console.warn(`${MODULE_ID} | new-style window failed, using the legacy one`, err);
    }
  }
  return openLegacyDialog(options);
}

/** A yes/no question. Resolves true on Yes, false otherwise. */
export async function confirmDialog({ title, content }) {
  if (useNewWindows()) {
    try {
      const root = document.createElement('div');
      root.innerHTML = content;
      return Boolean(await dialogV2().confirm({ window: { title }, content: root, rejectClose: false }));
    } catch (err) {
      console.warn(`${MODULE_ID} | new-style confirm failed, using the legacy one`, err);
    }
  }
  const Legacy = legacyDialogClass();
  if (!Legacy) throw new Error('This Foundry version has no window type the module can use.');
  return Boolean(await Legacy.confirm({ title, content }));
}

/* --------------------------------------------------------------------
   Configure Settings menu buttons. Foundry wants a window class there
   (it checks the type, then builds one and calls render()); ours opens
   a dialog instead of drawing a window of its own.
-------------------------------------------------------------------- */

const MenuBase = globalThis.foundry?.applications?.api?.ApplicationV2
  ?? globalThis.foundry?.appv1?.api?.FormApplication
  ?? globalThis.FormApplication
  ?? class {};

export class MenuWindow extends MenuBase {
  /** Subclasses set `open` to the function that opens their dialog. */
  render() {
    this.constructor.open();
    return this;
  }
}
