/**
 * Scale the published sizes, including px/pt sizes, absolute keywords and legacy <font> tags.
 * Changing only the root font size leaves those unchanged. Read every size before writing any,
 * so nested em/percentage sizes and inherited text are scaled once, not once per ancestor.
 */
export function createTextScaler(doc: Document): (scale: number) => void {
  let applied: { element: HTMLElement; value: string; priority: string; scaled: string }[] = [];

  return (scale) => {
    // Restore our previous overrides before measuring; repeated zooms must not compound.
    for (const { element, value, priority, scaled } of applied) {
      // A book script may have replaced the size since we applied it. Keep that new style.
      if (element.style.getPropertyValue('font-size') !== scaled || element.style.getPropertyPriority('font-size') !== 'important') continue;
      if (value) element.style.setProperty('font-size', value, priority);
      else element.style.removeProperty('font-size');
    }
    applied = [];
    if (scale === 1 || !doc.body) return;

    const elements = [doc.documentElement, doc.body, ...Array.from(doc.body.querySelectorAll('*'))].filter(
      (element): element is HTMLElement => element instanceof HTMLElement && !element.closest('svg, math'),
    );
    const sizes = elements.map((element) => ({
      element,
      value: element.style.getPropertyValue('font-size'),
      priority: element.style.getPropertyPriority('font-size'),
      size: parseFloat(getComputedStyle(element).fontSize),
    }));
    for (const { element, value, priority, size } of sizes) {
      if (!Number.isFinite(size)) continue;
      element.style.setProperty('font-size', `${size * scale}px`, 'important');
      applied.push({ element, value, priority, scaled: element.style.getPropertyValue('font-size') });
    }
  };
}
