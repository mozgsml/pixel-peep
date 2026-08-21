import type { ParamSchema, ParamValue } from '../codecs/types.ts';
import { getLocale, t } from '../i18n/index.ts';
import { el, setText } from './dom.ts';

/**
 * Controls are generated from `ParamSchema` and nothing else. A new format
 * brings its own knobs with it; no file in this directory is ever edited to
 * support one.
 */

export interface ParamsView {
  readonly root: HTMLElement;
  /** Re-render for a new schema, or refresh values for the same one. */
  update(schema: ParamSchema, values: Readonly<Record<string, ParamValue>>): void;
}

export interface ParamsCallbacks {
  /** Continuous change — a slider being dragged. Encode the proxy. */
  onPreview(key: string, value: ParamValue): void;
  /** Committed change — pointer released, checkbox toggled, option picked. */
  onCommit(key: string, value: ParamValue): void;
}

export function createParamsView(callbacks: ParamsCallbacks): ParamsView {
  const root = el('div', { class: 'params' });
  let currentSchema: ParamSchema | null = null;
  let builtFor = '';
  const refresh = new Map<string, (values: Readonly<Record<string, ParamValue>>) => void>();

  function build(schema: ParamSchema): void {
    root.replaceChildren();
    refresh.clear();
    currentSchema = schema;
    builtFor = getLocale();

    if (schema.length === 0) {
      root.appendChild(el('p', { class: 'params-empty' }, t('params.empty')));
      return;
    }

    for (const item of schema) {
      const id = `p-${Math.random().toString(36).slice(2, 8)}-${item.key}`;
      const row = el('div', { class: `param param-kind-${item.kind}` });
      // Schemas carry message keys; `t()` returns anything else unchanged.
      const label = el('label', { class: 'param-label', for: id }, t(item.label));
      if (item.hint) label.title = t(item.hint);

      switch (item.kind) {
        case 'range': {
          const value = el('output', { class: 'param-value' });
          const input = el('input', {
            type: 'range',
            id,
            min: item.min,
            max: item.max,
            step: item.step,
            class: 'param-slider',
          });
          input.addEventListener('input', () => {
            setText(value, `${input.value}${item.unit ?? ''}`);
            callbacks.onPreview(item.key, Number(input.value));
          });
          input.addEventListener('change', () => callbacks.onCommit(item.key, Number(input.value)));
          row.append(el('div', { class: 'param-head' }, label, value), input);
          refresh.set(item.key, (values) => {
            const v = Number(values[item.key] ?? item.default);
            if (document.activeElement !== input) input.value = String(v);
            setText(value, `${v}${item.unit ?? ''}`);
            const enabled = item.enabledWhen ? item.enabledWhen(values) : true;
            input.disabled = !enabled;
            row.classList.toggle('is-disabled', !enabled);
          });
          break;
        }

        case 'toggle': {
          const input = el('input', { type: 'checkbox', id, class: 'param-checkbox' });
          input.addEventListener('change', () => callbacks.onCommit(item.key, input.checked));
          row.append(el('div', { class: 'param-head' }, el('span', { class: 'switch' }, input, el('span', { class: 'switch-track' })), label));
          refresh.set(item.key, (values) => {
            input.checked = values[item.key] === true;
            const enabled = item.enabledWhen ? item.enabledWhen(values) : true;
            input.disabled = !enabled;
            row.classList.toggle('is-disabled', !enabled);
          });
          break;
        }

        case 'select': {
          const select = el('select', { id, class: 'param-select' });
          for (const option of item.options) {
            select.appendChild(el('option', { value: option.value }, option.label));
          }
          select.addEventListener('change', () => callbacks.onCommit(item.key, select.value));
          row.append(el('div', { class: 'param-head' }, label), select);
          refresh.set(item.key, (values) => {
            select.value = String(values[item.key] ?? item.default);
            const enabled = item.enabledWhen ? item.enabledWhen(values) : true;
            select.disabled = !enabled;
            row.classList.toggle('is-disabled', !enabled);
          });
          break;
        }
      }

      root.appendChild(row);
    }
  }

  return {
    root,
    update(schema, values) {
      // Labels are baked into the DOM, so a locale switch has to rebuild them.
      if (schema !== currentSchema || builtFor !== getLocale()) build(schema);
      for (const apply of refresh.values()) apply(values);
    },
  };
}
