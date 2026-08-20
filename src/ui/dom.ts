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
