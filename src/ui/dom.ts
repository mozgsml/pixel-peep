/** Tiny DOM helpers so the interface code stays readable without a framework. */

type Attrs = Record<string, string | number | boolean | undefined | null>;
type Child = Node | string | null | undefined | false;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = String(value);
    else if (key === 'text') node.textContent = String(value);
    else if (key === 'html') node.innerHTML = String(value);
    else if (key.startsWith('data-') || key.startsWith('aria-')) node.setAttribute(key, String(value));
    else if (value === true) node.setAttribute(key, '');
    else node.setAttribute(key, String(value));
  }
  append(node, ...children);
  return node;
}

export function append(parent: Node, ...children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    parent.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
}

export function clear(node: Node): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function setText(node: HTMLElement, text: string): void {
  if (node.textContent !== text) node.textContent = text;
}

export function toggleClass(node: HTMLElement, name: string, on: boolean): void {
  node.classList.toggle(name, on);
}

/** A group of mutually exclusive buttons, keyboard-navigable as one control. */
export interface SegmentedOption<T extends string> {
  readonly value: T;
  readonly label: string;
  readonly title?: string;
}

export interface Segmented<T extends string> {
  readonly root: HTMLElement;
  setValue(value: T): void;
  setDisabled(disabled: boolean): void;
}

export function segmented<T extends string>(
  options: readonly SegmentedOption<T>[],
  value: T,
  onChange: (value: T) => void,
  label?: string,
): Segmented<T> {
  const root = el('div', { class: 'segmented', role: 'radiogroup', 'aria-label': label ?? '' });
  const buttons = new Map<T, HTMLButtonElement>();

  for (const option of options) {
    const button = el('button', {
      type: 'button',
      class: 'segment',
      role: 'radio',
      title: option.title ?? option.label,
      'aria-checked': String(option.value === value),
    }, option.label);
    button.addEventListener('click', () => onChange(option.value));
    buttons.set(option.value, button);
    root.appendChild(button);
  }

  return {
    root,
    setValue(next: T) {
      for (const [key, button] of buttons) button.setAttribute('aria-checked', String(key === next));
    },
    setDisabled(disabled: boolean) {
      root.classList.toggle('is-disabled', disabled);
      for (const button of buttons.values()) button.disabled = disabled;
    },
  };
}

export function iconButton(label: string, glyph: string, onClick: () => void, title = label): HTMLButtonElement {
  const button = el('button', { type: 'button', class: 'icon-button', title, 'aria-label': label }, glyph);
  button.addEventListener('click', onClick);
  return button;
}

/**
 * A hint that actually appears.
 *
 * The native `title` was doing this job and was not up to it: the target was
 * the 28 px word alone, the browser waits about a second of motionless hover
 * before showing anything, any re-render of the element cancels that wait —
 * seven title rewrites in two seconds while a panel encodes — and on a
 * touchscreen it never appears at all. An interface that promises a hint with a
 * dotted underline and a help cursor has to deliver one.
 *
 * The text is read at show time, so switching language needs no re-wiring.
 */
const TOOLTIP_ID = 'tooltip';
const TOOLTIP_DELAY_MS = 120;

let tooltip: HTMLElement | null = null;
let tooltipTimer: ReturnType<typeof setTimeout> | null = null;

function tooltipNode(): HTMLElement {
  if (!tooltip) {
    tooltip = el('div', { class: 'tooltip', role: 'tooltip', id: TOOLTIP_ID });
    document.body.appendChild(tooltip);
  }
  return tooltip;
}

function hideTooltip(): void {
  if (tooltipTimer !== null) {
    clearTimeout(tooltipTimer);
    tooltipTimer = null;
  }
  tooltip?.classList.remove('is-visible');
}

function showTooltip(trigger: HTMLElement, text: string): void {
  if (!text) return;
  const node = tooltipNode();
  setText(node, text);
  node.classList.add('is-visible');

  // Measured after the text is in place, then kept inside the viewport.
  const anchor = trigger.getBoundingClientRect();
  const box = node.getBoundingClientRect();
  const left = Math.min(Math.max(8, anchor.left + anchor.width / 2 - box.width / 2), window.innerWidth - box.width - 8);
  const above = anchor.top - box.height - 8;
  node.style.left = `${Math.round(left)}px`;
  node.style.top = `${Math.round(above >= 8 ? above : anchor.bottom + 8)}px`;
}

/** Hover, keyboard focus and touch all reach it; Escape dismisses. */
export function attachTooltip(trigger: HTMLElement, text: () => string): void {
  trigger.tabIndex = 0;
  trigger.setAttribute('aria-describedby', TOOLTIP_ID);

  const open = () => showTooltip(trigger, text());
  const openSoon = () => {
    if (tooltipTimer !== null) clearTimeout(tooltipTimer);
    tooltipTimer = setTimeout(open, TOOLTIP_DELAY_MS);
  };

  trigger.addEventListener('pointerenter', openSoon);
  trigger.addEventListener('pointerleave', hideTooltip);
  trigger.addEventListener('focus', open);
  trigger.addEventListener('blur', hideTooltip);
  trigger.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') hideTooltip();
  });
  window.addEventListener('scroll', hideTooltip, { passive: true, capture: true });
}
