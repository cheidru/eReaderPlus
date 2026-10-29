import { describe, expect, it } from 'vitest';
import { clampView, fittedView, MAX_PICTURE_ZOOM, panView, shownSize, zoomView } from '../src/core/picture-view';

const screen = { width: 1000, height: 800 };
const picture = { width: 2000, height: 1000 };

describe('picture viewer', () => {
  it('fits the whole picture to the screen, centered', () => {
    const view = fittedView(picture, screen);
    expect(shownSize(view, picture, screen)).toEqual({ width: 1000, height: 500 });
    expect(view).toEqual({ zoom: 1, x: 0, y: 150 });
  });

  it('enlarges a small picture to fit, up to four times', () => {
    expect(shownSize(fittedView({ width: 50, height: 40 }, screen), { width: 50, height: 40 }, screen)).toEqual({ width: 200, height: 160 });
  });

  it('zooms about the point under the pointer', () => {
    const view = zoomView(fittedView(picture, screen), 2, 250, 400, picture, screen);
    expect(view.zoom).toBe(2);
    // The picture point under (250, 400) stays there: a quarter across, half way down.
    const shown = shownSize(view, picture, screen);
    expect((250 - view.x) / shown.width).toBeCloseTo(0.25);
    expect((400 - view.y) / shown.height).toBeCloseTo(0.5);
  });

  it('keeps the zoom between fitted and the largest', () => {
    const fitted = fittedView(picture, screen);
    expect(zoomView(fitted, 0.5, 0, 0, picture, screen)).toEqual(fitted);
    expect(zoomView(fitted, 100, 0, 0, picture, screen).zoom).toBe(MAX_PICTURE_ZOOM);
  });

  it('pans a zoomed picture no further than its edges', () => {
    const zoomed = clampView({ zoom: 2, x: -500, y: -100 }, picture, screen);
    expect(panView(zoomed, 10_000, 0, picture, screen).x).toBe(0);
    expect(panView(zoomed, -10_000, 0, picture, screen).x).toBe(1000 - 2000);
    // A picture that fits the screen's height stays centered on it.
    expect(panView(fittedView(picture, screen), 0, 300, picture, screen).y).toBe(150);
  });
});
