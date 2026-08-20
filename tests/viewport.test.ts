import { describe, expect, it, vi } from 'vitest';
import type { PanelBox } from '../src/core/geometry.ts';
import { Viewport } from '../src/core/viewport.ts';

const landscape: PanelBox = { image: { width: 6000, height: 4000 }, panel: { width: 900, height: 600 } };
const portrait: PanelBox = { image: { width: 3000, height: 4500 }, panel: { width: 900, height: 600 } };

function viewport(boxes: PanelBox[] = [landscape, landscape]): Viewport {
  const vp = new Viewport();
  vp.setBoxes(boxes);
  return vp;
}

describe('Viewport', () => {
  it('starts fitted and centred', () => {
    const vp = viewport();
    expect(vp.view).toEqual({ z: 0, u: 0.5, v: 0.5 });
    expect(vp.geometry()[0]!.visW).toBeGreaterThanOrEqual(1);
  });

  it('clamps zoom into its range', () => {
    const vp = viewport();
    vp.zoomTo(99);
    expect(vp.view.z).toBe(Viewport.MAX_Z);
    vp.zoomTo(-99);
    expect(vp.view.z).toBe(Viewport.MIN_Z);
  });

  it('allows zooming past 1:1 for looking at artefacts', () => {
    const vp = viewport();
    vp.zoomTo(2);
    expect(vp.scaleOf(0)).toBeGreaterThan(1);
  });

  it('toggles between fit and actual pixels on double click', () => {
    const vp = viewport();
    vp.toggleFit(0, { x: 100, y: 100 });
    expect(vp.view.z).toBe(1);
    expect(vp.scaleOf(0)).toBeCloseTo(1, 12);
    vp.toggleFit(0, { x: 100, y: 100 });
    expect(vp.view.z).toBe(0);
  });

  it('notifies subscribers on every change', () => {
    const vp = viewport();
    const listener = vi.fn();
    const off = vp.subscribe(listener);
    vp.zoomTo(0.5);
    vp.pan(10, 10);
    expect(listener).toHaveBeenCalledTimes(2);
    off();
    vp.zoomTo(0.2);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('re-clamps when the panels are resized', () => {
    const vp = viewport();
    vp.zoomTo(1);
    vp.pan(-5000, -5000);
    const before = vp.view;
    expect(before.u).toBeGreaterThan(0.5);

    // A much wider panel shows more of the image, so the centre must move back.
    vp.setBoxes([{ ...landscape, panel: { width: 5800, height: 3800 } }]);
    const geom = vp.geometry()[0]!;
    expect(vp.view.u).toBeLessThanOrEqual(1 - geom.visW / 2 + 1e-9);
  });

  it('keeps every panel 1:1 at z = 1 regardless of alignment', () => {
    const vp = viewport([landscape, portrait]);
    vp.setAlign('width');
    vp.zoomTo(1);
    for (const geom of vp.geometry()) expect(geom.scale).toBeCloseTo(1, 12);
  });

  it('changes what fits when the alignment changes', () => {
    const vp = viewport([portrait]);
    vp.setAlign('contain');
    const contain = vp.geometry()[0]!;
    vp.setAlign('width');
    const width = vp.geometry()[0]!;
    expect(width.fit).toBeGreaterThan(contain.fit);
    expect(width.visW).toBeCloseTo(1, 9);
  });

  it('reports the zoom needed for an exact magnification', () => {
    const vp = viewport();
    const z = vp.zoomForMagnification(0, 0.5);
    vp.zoomTo(z);
    expect(vp.scaleOf(0)).toBeCloseTo(0.5, 9);
  });

  it('survives having no panels at all', () => {
    const vp = new Viewport();
    vp.zoomTo(0.5);
    vp.pan(10, 10);
    expect(vp.geometry()).toEqual([]);
    expect(vp.view.z).toBe(0.5);
  });

  it('pans by a fraction of the panel for the arrow keys', () => {
    const vp = viewport();
    vp.zoomTo(1);
    const before = vp.geometry()[0]!.u;
    vp.panByFraction(-0.12, 0, 0);
    expect(vp.geometry()[0]!.u).toBeGreaterThan(before);
  });

  it('switches synchronisation modes without losing position', () => {
    const vp = viewport([landscape, portrait]);
    vp.zoomTo(0.9);
    vp.setSync('continuous');
    const geoms = vp.geometry();
    expect(geoms[1]!.u).toBeCloseTo(geoms[0]!.u + geoms[0]!.visW / 2 + geoms[1]!.visW / 2, 12);
    vp.setSync('mirror');
    expect(vp.geometry()[1]!.u).toBeCloseTo(vp.geometry()[0]!.u, 12);
  });
});
