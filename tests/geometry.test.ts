import { describe, expect, it } from 'vitest';
import {
  type LayoutOptions,
  type PanelBox,
  clampCentre,
  drawRects,
  fitScale,
  layoutGeometry,
  leaderCentreFor,
  panelFits,
  spreadFrameCentre,
  panBy,
  panelGeometry,
  pointAtCursor,
  scaleForZoom,
  splitStage,
  visibleSpan,
  zoomAtCursor,
  zoomForScale,
} from '../src/core/geometry.ts';

const landscape: PanelBox = { image: { width: 6000, height: 4000 }, panel: { width: 900, height: 600 } };
const portrait: PanelBox = { image: { width: 3000, height: 4500 }, panel: { width: 900, height: 600 } };
const tiny: PanelBox = { image: { width: 120, height: 80 }, panel: { width: 900, height: 600 } };

const mirror: LayoutOptions = { sync: 'mirror', align: 'contain', axis: 'x' };
const continuous: LayoutOptions = { sync: 'continuous', align: 'contain', axis: 'x' };

describe('fitScale', () => {
  it('fits the whole image at z = 0', () => {
    expect(fitScale(landscape)).toBeCloseTo(0.15, 10);
    expect(fitScale(portrait)).toBeCloseTo(600 / 4500, 10);
  });

  it('aligns by width or height on demand', () => {
    expect(fitScale(portrait, 'width')).toBeCloseTo(900 / 3000, 10);
    expect(fitScale(portrait, 'height')).toBeCloseTo(600 / 4500, 10);
  });

  it('goes above 1 for images smaller than the panel, without clamping', () => {
    expect(fitScale(tiny)).toBeCloseTo(Math.min(900 / 120, 600 / 80), 10);
    expect(fitScale(tiny)).toBeGreaterThan(1);
  });

  it('survives degenerate sizes', () => {
    const zero: PanelBox = { image: { width: 0, height: 0 }, panel: { width: 0, height: 0 } };
    expect(Number.isFinite(fitScale(zero))).toBe(true);
    expect(Number.isNaN(fitScale(zero))).toBe(false);
  });
});

describe('scaleForZoom', () => {
  it('interpolates geometrically between fit and 1:1', () => {
    const fit = fitScale(landscape);
    expect(scaleForZoom(fit, 0)).toBeCloseTo(fit, 12);
    expect(scaleForZoom(fit, 1)).toBeCloseTo(1, 12);
    expect(scaleForZoom(fit, 0.5)).toBeCloseTo(Math.sqrt(fit), 12);
  });

  it('gives equal ratios for equal steps — not equal differences', () => {
    const fit = fitScale(landscape);
    const a = scaleForZoom(fit, 0.2) / scaleForZoom(fit, 0.1);
    const b = scaleForZoom(fit, 0.9) / scaleForZoom(fit, 0.8);
    expect(a).toBeCloseTo(b, 12);
  });

  it('round-trips through zoomForScale', () => {
    const fit = fitScale(landscape);
    for (const z of [-0.3, 0, 0.25, 0.5, 1, 2]) {
      expect(zoomForScale(fit, scaleForZoom(fit, z))).toBeCloseTo(z, 10);
    }
  });

  it('works with fit > 1, running the scale the other way', () => {
    const fit = fitScale(tiny);
    expect(scaleForZoom(fit, 0)).toBeGreaterThan(1);
    expect(scaleForZoom(fit, 1)).toBeCloseTo(1, 12);
  });
});

describe('clamping', () => {
  it('keeps the window inside the image', () => {
    expect(clampCentre(0, 0.4)).toBeCloseTo(0.2, 12);
    expect(clampCentre(1, 0.4)).toBeCloseTo(0.8, 12);
    expect(clampCentre(0.5, 0.4)).toBeCloseTo(0.5, 12);
  });

  it('lets an image that already fits be moved, but not off screen', () => {
    // Pinning it to 0.5 made a small frame impossible to nudge, and in
    // "continue" mode it then never reached the next panel.
    expect(clampCentre(0.1, 1)).toBe(0.1);
    expect(clampCentre(0.9, 2.5)).toBe(0.9);
    expect(clampCentre(-4, 2.5)).toBe(0);
    expect(clampCentre(9, 2.5)).toBe(1);
  });

  it('never lets the visible window leave the image while panning', () => {
    const view = { z: 0.8, u: 0.5, v: 0.5 };
    let current = view;
    for (let i = 0; i < 50; i++) {
      current = panBy({ boxes: [landscape], view: current, opts: mirror, index: 0, dx: -500, dy: -500 });
    }
    const geom = layoutGeometry([landscape], current, mirror)[0]!;
    expect(current.u).toBeLessThanOrEqual(1 - geom.visW / 2 + 1e-9);
    expect(current.v).toBeLessThanOrEqual(1 - geom.visH / 2 + 1e-9);
  });
});

describe('zoom anchored at the cursor', () => {
  const cursors = [
    { x: 0, y: 0 },
    { x: 900, y: 600 },
    { x: 123, y: 457 },
    { x: 450, y: 300 },
  ];

  it('keeps the point under the cursor within a pixel across the range', () => {
    for (const cursor of cursors) {
      for (let z = 0; z <= 1.0001; z += 0.05) {
        const view = { z, u: 0.5, v: 0.5 };
        const before = layoutGeometry([landscape], view, mirror)[0]!;
        const anchor = pointAtCursor(cursor, landscape, before);

        const next = zoomAtCursor({
          boxes: [landscape],
          view,
          opts: mirror,
          index: 0,
          cursor,
          nextZ: Math.min(1, z + 0.1),
        });
        const after = layoutGeometry([landscape], next, mirror)[0]!;
        const settled = pointAtCursor(cursor, landscape, after);

        // Compare in image pixels, then convert to the panel pixels the eye sees.
        const dx = Math.abs(settled.u - anchor.u) * landscape.image.width * after.scale;
        const dy = Math.abs(settled.v - anchor.v) * landscape.image.height * after.scale;
        // Clamping legitimately moves the anchor at the edges; the interior
        // must be exact.
        const clampedX = after.u !== next.u || after.visW >= 1;
        const clampedY = after.v !== next.v || after.visH >= 1;
        if (!clampedX && after.visW < 1) expect(dx).toBeLessThan(1);
        if (!clampedY && after.visH < 1) expect(dy).toBeLessThan(1);
      }
    }
  });

  it('anchors at the panel centre when no cursor is given', () => {
    const view = { z: 0.3, u: 0.4, v: 0.6 };
    const next = zoomAtCursor({ boxes: [landscape], view, opts: mirror, index: 0, cursor: null, nextZ: 0.7 });
    const before = layoutGeometry([landscape], view, mirror)[0]!;
    const after = layoutGeometry([landscape], next, mirror)[0]!;
    expect(after.u).toBeCloseTo(before.u, 6);
    expect(after.v).toBeCloseTo(before.v, 6);
  });
});

describe('z = 0 and z = 1', () => {
  it('shows both images whole at z = 0', () => {
    const geoms = layoutGeometry([landscape, portrait], { z: 0, u: 0.5, v: 0.5 }, mirror);
    for (const geom of geoms) {
      expect(geom.visW).toBeGreaterThanOrEqual(1 - 1e-9);
      expect(geom.visH).toBeGreaterThanOrEqual(1 - 1e-9);
    }
  });

  it('is exactly 1:1 at z = 1 whatever the alignment', () => {
    for (const align of ['contain', 'width', 'height'] as const) {
      const geoms = layoutGeometry([landscape, portrait], { z: 1, u: 0.5, v: 0.5 }, { ...mirror, align });
      for (const geom of geoms) expect(geom.scale).toBeCloseTo(1, 12);
    }
  });

  it('is 1:1 at z = 1 for every device pixel ratio, because scale is dpr-free', () => {
    const geom = panelGeometry(landscape, 1, { u: 0.5, v: 0.5 });
    expect(geom.scale).toBeCloseTo(1, 12);
    const rects = drawRects(landscape, geom);
    expect(rects).not.toBeNull();
    expect(rects!.dw / rects!.sw).toBeCloseTo(1, 12);
  });
});

describe('panning modes', () => {
  it('mirror gives every panel the same centre', () => {
    const geoms = layoutGeometry([landscape, portrait], { z: 0.9, u: 0.3, v: 0.7 }, mirror);
    expect(geoms[0]!.u).toBeCloseTo(geoms[1]!.u, 12);
    expect(geoms[0]!.v).toBeCloseTo(geoms[1]!.v, 12);
  });

  it('continuous starts panel i+1 where panel i ended', () => {
    const geoms = layoutGeometry([landscape, portrait], { z: 0.9, u: 0.3, v: 0.5 }, continuous);
    const expected = geoms[0]!.u + geoms[0]!.visW / 2 + geoms[1]!.visW / 2;
    expect(geoms[1]!.u).toBeCloseTo(expected, 12);
    expect(geoms[1]!.v).toBeCloseTo(geoms[0]!.v, 12);
  });

  it('continues along the layout axis, not a setting', () => {
    const vertical = layoutGeometry([landscape, portrait], { z: 0.9, u: 0.5, v: 0.4 }, { ...continuous, axis: 'y' });
    expect(vertical[1]!.u).toBeCloseTo(vertical[0]!.u, 12);
    expect(vertical[1]!.v).toBeCloseTo(vertical[0]!.v + vertical[0]!.visH / 2 + vertical[1]!.visH / 2, 12);
  });

  it('inverts a follower centre back to the leader', () => {
    const view = { z: 0.85, u: 0.4, v: 0.5 };
    const geoms = layoutGeometry([landscape, portrait], view, continuous);
    const leader = leaderCentreFor([landscape, portrait], view, continuous, 1, {
      u: geoms[1]!.u,
      v: geoms[1]!.v,
    });
    expect(leader.u).toBeCloseTo(geoms[0]!.u, 10);
    expect(leader.v).toBeCloseTo(geoms[0]!.v, 10);
  });

  it('drives the whole set from a drag on the second panel', () => {
    // Away from the ends of the travel: at u = 0.5 the row already has its
    // trailing edge on the frame's edge and there is nothing left to give.
    const view = { z: 0.85, u: 0.4, v: 0.5 };
    const next = panBy({ boxes: [landscape, portrait], view, opts: continuous, index: 1, dx: -60, dy: 0 });
    const before = layoutGeometry([landscape, portrait], view, continuous)[1]!;
    const after = layoutGeometry([landscape, portrait], next, continuous)[1]!;
    expect(after.u).toBeGreaterThan(before.u);
  });

  it('works on images of different proportions', () => {
    const boxes = [landscape, portrait, tiny];
    for (const opts of [mirror, continuous]) {
      const geoms = layoutGeometry(boxes, { z: 0.6, u: 0.5, v: 0.5 }, opts);
      expect(geoms).toHaveLength(3);
      for (const geom of geoms) {
        expect(Number.isFinite(geom.scale)).toBe(true);
        expect(Number.isFinite(geom.u)).toBe(true);
      }
    }
  });
});

describe('visibleSpan', () => {
  it('is the panel measured in image widths', () => {
    const { visW, visH } = visibleSpan(landscape, 1);
    expect(visW).toBeCloseTo(900 / 6000, 12);
    expect(visH).toBeCloseTo(600 / 4000, 12);
  });

  it('reacts to a window resize', () => {
    const wide = visibleSpan({ ...landscape, panel: { width: 1800, height: 600 } }, 1);
    expect(wide.visW).toBeCloseTo(1800 / 6000, 12);
  });
});

describe('drawRects', () => {
  it('letterboxes an image smaller than the panel instead of stretching it', () => {
    const geom = panelGeometry(tiny, 1, { u: 0.5, v: 0.5 });
    const rects = drawRects(tiny, geom)!;
    expect(rects.sw).toBeCloseTo(tiny.image.width, 9);
    expect(rects.sh).toBeCloseTo(tiny.image.height, 9);
    expect(rects.dx).toBeGreaterThan(0);
    expect(rects.dy).toBeGreaterThan(0);
  });

  it('returns null when nothing is visible', () => {
    const geom = { ...panelGeometry(landscape, 1, { u: 0.5, v: 0.5 }), u: 40, v: 40 };
    expect(drawRects(landscape, geom)).toBeNull();
  });

  it('keeps the destination scale equal to the geometry scale', () => {
    const geom = panelGeometry(landscape, 0.6, { u: 0.5, v: 0.5 });
    const rects = drawRects(landscape, geom)!;
    expect(rects.dw / rects.sw).toBeCloseTo(geom.scale, 10);
  });
});

describe('splitStage', () => {
  it('splits by columns in landscape and rows in portrait', () => {
    const cols = splitStage({ width: 1000, height: 500 }, 2, 'x', [0.5, 0.5]);
    expect(cols[0]).toEqual({ x: 0, y: 0, width: 500, height: 500 });
    expect(cols[1]!.x).toBe(500);

    const rows = splitStage({ width: 1000, height: 500 }, 2, 'y', [0.5, 0.5]);
    expect(rows[1]!.y).toBe(250);
  });

  it('falls back to equal shares for nonsense fractions', () => {
    const rects = splitStage({ width: 900, height: 300 }, 3, 'x', []);
    expect(rects.map((r) => r.width)).toEqual([300, 300, 300]);
  });

  it('generalises past two panels', () => {
    const rects = splitStage({ width: 1200, height: 400 }, 4, 'x', [0.25, 0.25, 0.25, 0.25]);
    expect(rects).toHaveLength(4);
    expect(rects.at(-1)!.x + rects.at(-1)!.width).toBeCloseTo(1200, 9);
  });
});

describe('one photograph, one magnification', () => {
  // Reported from a 4096x2304 photo with the divider dragged to about 27/73:
  // the narrow panel fitted the frame against its width, the wide one against
  // its height, and the same picture came out 2.5x larger on one side.
  const wide = { width: 4096, height: 2304 };
  const dragged: PanelBox[] = [
    { image: wide, panel: { width: 697, height: 1003 } },
    { image: wide, panel: { width: 1908, height: 1003 } },
  ];

  it('gives panels holding the same frame the same fit', () => {
    const fits = panelFits(dragged);
    expect(fits[0]).toBeCloseTo(fits[1]!, 12);
  });

  it('takes the smallest fit, so no panel crops the frame at z = 0', () => {
    const geoms = layoutGeometry(dragged, { z: 0, u: 0.5, v: 0.5 }, mirror);
    for (const [index, geom] of geoms.entries()) {
      const box = dragged[index]!;
      expect(box.image.width * geom.scale).toBeLessThanOrEqual(box.panel.width + 1);
      expect(box.image.height * geom.scale).toBeLessThanOrEqual(box.panel.height + 1);
    }
  });

  it('holds the magnification equal at every zoom', () => {
    for (const z of [-0.35, 0, 0.3, 0.7, 1, 2]) {
      const geoms = layoutGeometry(dragged, { z, u: 0.5, v: 0.5 }, mirror);
      expect(geoms[0]!.scale).toBeCloseTo(geoms[1]!.scale, 12);
    }
  });

  it('still fits frames of different sizes to their own panels', () => {
    // Different frames are what the alignment control is for; forcing one
    // scale there would shrink the smaller frame for no reason.
    const fits = panelFits([landscape, portrait]);
    expect(fits[0]).not.toBeCloseTo(fits[1]!, 6);
  });
});

describe('panning in continuous mode', () => {
  // From the report: a 4096x2304 frame, the panels roughly even, everything
  // fitted. The picture would not travel far enough for the second panel to
  // come onto the frame — it sat on a sliver of the right-hand edge and the
  // drag simply stopped.
  const wide = { width: 4096, height: 2304 };
  const boxes: PanelBox[] = [
    { image: wide, panel: { width: 1256, height: 547 } },
    { image: wide, panel: { width: 1348, height: 547 } },
  ];
  const opts: LayoutOptions = { sync: 'continuous', align: 'contain', axis: 'x', gap: 7 };

  /** How much of the frame a panel actually shows, as a fraction of its width. */
  function seen(geom: { u: number; visW: number }): number {
    return Math.max(0, Math.min(1, geom.u + geom.visW / 2) - Math.max(0, geom.u - geom.visW / 2));
  }

  /** Drag one way until it stops, and report where the travel ended. */
  function dragToEnd(dx: number) {
    let view = { z: 0, u: 0.5, v: 0.5 };
    let steps = 0;
    for (; steps < 500; steps++) {
      const next = panBy({ boxes, view, opts, index: 0, dx, dy: 0 });
      if (Math.abs(next.u - view.u) < 1e-9) break;
      view = next;
    }
    return { geoms: layoutGeometry(boxes, view, opts), steps };
  }

  it('can bring the trailing panel onto the frame', () => {
    // Clamping the leader alone capped this at about a third of the frame.
    const { geoms } = dragToEnd(40);
    expect(seen(geoms[1]!)).toBeGreaterThan(0.99);
  });

  it('can bring the leading panel onto the frame', () => {
    const { geoms } = dragToEnd(-40);
    expect(seen(geoms[0]!)).toBeGreaterThan(0.94);
  });

  it('travels a bounded distance and then stops', () => {
    const { steps } = dragToEnd(40);
    expect(steps).toBeGreaterThan(0);
    expect(steps).toBeLessThan(500);
  });
});

describe('sharing the frame out across the row', () => {
  const wide = { width: 4096, height: 2304 };
  const opts: LayoutOptions = { sync: 'continuous', align: 'contain', axis: 'x', gap: 7 };

  /** How much of the frame a panel shows, as a fraction of the frame's width. */
  function seen(geom: { u: number; visW: number }): number {
    return Math.max(0, Math.min(1, geom.u + geom.visW / 2) - Math.max(0, geom.u - geom.visW / 2));
  }

  it('gives every panel a piece when one of them could hold everything', () => {
    // Switching into the mode used to land on "whole frame in panel 0, nothing
    // in panel 1" — the one arrangement that shows nothing.
    const boxes: PanelBox[] = [
      { image: wide, panel: { width: 1256, height: 547 } },
      { image: wide, panel: { width: 1348, height: 547 } },
    ];
    const view = { z: 0, u: 0.5, v: 0.5 };
    const spread = spreadFrameCentre(boxes, view, opts);
    const geoms = layoutGeometry(boxes, { ...view, ...spread }, opts);

    for (const geom of geoms) expect(seen(geom)).toBeGreaterThan(0.2);
    // Between them they cover the frame, give or take the splitter.
    expect(seen(geoms[0]!) + seen(geoms[1]!)).toBeGreaterThan(0.98);
  });

  it('splits in proportion to what each panel can hold', () => {
    const boxes: PanelBox[] = [
      { image: wide, panel: { width: 697, height: 1003 } },
      { image: wide, panel: { width: 1908, height: 1003 } },
    ];
    const view = { z: 0, u: 0.5, v: 0.5 };
    const geoms = layoutGeometry(boxes, { ...view, ...spreadFrameCentre(boxes, view, opts) }, opts);
    // The narrow panel gets the smaller slice, not an equal one.
    expect(seen(geoms[0]!)).toBeLessThan(seen(geoms[1]!));
    expect(seen(geoms[0]!)).toBeGreaterThan(0.1);
  });

  it('leaves a zoomed-in view where it was', () => {
    // Once the row is shorter than the frame the panels already tile it, and
    // moving the view would just throw away whatever was being looked at.
    const boxes: PanelBox[] = [
      { image: wide, panel: { width: 600, height: 400 } },
      { image: wide, panel: { width: 600, height: 400 } },
    ];
    const view = { z: 1, u: 0.42, v: 0.31 };
    expect(spreadFrameCentre(boxes, view, opts)).toEqual({ u: 0.42, v: 0.31 });
  });

  it('does nothing with a single panel', () => {
    const view = { z: 0, u: 0.3, v: 0.7 };
    expect(spreadFrameCentre([landscape], view, opts)).toEqual({ u: 0.3, v: 0.7 });
  });
});

describe('the splitter in continuous mode', () => {
  const boxes = [
    { image: { width: 1000, height: 1000 }, panel: { width: 500, height: 500 } },
    { image: { width: 1000, height: 1000 }, panel: { width: 500, height: 500 } },
  ];
  const view = { z: 1, u: 0.5, v: 0.5 };

  it('skips the image hidden behind the divider', () => {
    const seamless = layoutGeometry(boxes, view, { sync: 'continuous', align: 'contain', axis: 'x' });
    const withGap = layoutGeometry(boxes, view, { sync: 'continuous', align: 'contain', axis: 'x', gap: 7 });
    // 7 CSS px at 1:1 on a 1000 px wide image is 0.007 of its width.
    expect(withGap[1]!.u - seamless[1]!.u).toBeCloseTo(0.007, 6);
  });

  it('tiles the frame across the row rather than hanging off its end', () => {
    // Two 500 px panels on a 1000 px frame at 1:1: the row is exactly as long
    // as the frame, so continuous mode has one correct answer — the left half
    // and the right half. Clamping the leader on its own left it centred at
    // 0.5, which put panel 0 on the middle and ran panel 1 off the edge.
    const withGap = layoutGeometry(boxes, view, { sync: 'continuous', align: 'contain', axis: 'x', gap: 7 });
    expect(withGap[0]!.u).toBeCloseTo(0.25, 6);
    expect(withGap[0]!.u - withGap[0]!.visW / 2).toBeCloseTo(0, 6);
  });

  it('does nothing in mirror mode', () => {
    const withGap = layoutGeometry(boxes, view, { sync: 'mirror', align: 'contain', axis: 'x', gap: 7 });
    expect(withGap[1]!.u).toBe(withGap[0]!.u);
  });
});
