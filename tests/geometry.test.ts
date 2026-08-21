import { describe, expect, it } from 'vitest';
import {
  type LayoutOptions,
  type PanelBox,
  clampCentre,
  drawRects,
  fitScale,
  layoutGeometry,
  leaderCentreFor,
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
    const view = { z: 0.85, u: 0.5, v: 0.5 };
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

  it('leaves the leader alone', () => {
    const withGap = layoutGeometry(boxes, view, { sync: 'continuous', align: 'contain', axis: 'x', gap: 7 });
    expect(withGap[0]!.u).toBe(0.5);
  });

  it('does nothing in mirror mode', () => {
    const withGap = layoutGeometry(boxes, view, { sync: 'mirror', align: 'contain', axis: 'x', gap: 7 });
    expect(withGap[1]!.u).toBe(withGap[0]!.u);
  });
});
