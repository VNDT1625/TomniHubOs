import type { DeckBuildOptions, DeckDesignPlan } from './types';

export type {
  DeckBuildOptions,
  DeckDesignColumn,
  DeckDesignItem,
  DeckDesignLayout,
  DeckDesignPlan,
  DeckDesignSlide,
  DeckDesignStyle,
  DeckDesignTheme,
  DeckTransition,
  ObjectAnimationEffect,
  ObjectAnimationPurpose,
  ObjectAnimationSpec,
  ObjectAnimationTrigger,
} from './types';

export { OBJECT_ANIMATION_EFFECTS, OBJECT_ANIMATION_PURPOSES, OBJECT_ANIMATION_TRIGGERS } from './types';

export { preflightDeckDesignPlan, renderDeckPreflightReport } from './quality';
export type { DeckPreflightIssue, DeckPreflightReport } from './quality';

const scriptLine = (value: string): string => value.trim();

/** Build a deterministic presentation-native script with design DNA, layout intelligence and visual QA. */
export const buildPremiumDeckDesignScript = (plan: DeckDesignPlan, options: DeckBuildOptions = {}): string =>
  [
    `const plan = ${JSON.stringify(plan)};`,
    `const buildOptions = ${JSON.stringify(options)};`,
    scriptLine(`
      const ApiRef = Api;
      const W = 12192000;
      const H = 6858000;
      const M = 609600;
      const G = 182880;
      const COL = Math.floor((W - M * 2 - G * 11) / 12);
      const xCol = (n) => M + n * (COL + G);
      const span = (n) => n * COL + (n - 1) * G;
      const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

      const styleName = plan.designStyle || 'modern';
      const stylePresets = {
        modern: { radius: 1, inset: 0, labelCase: 'upper', motif: 'blocks', chartStyle: 10 },
        minimal: { radius: 0, inset: 1, labelCase: 'normal', motif: 'line', chartStyle: 1 },
        editorial: { radius: 0, inset: 0, labelCase: 'upper', motif: 'editorial', chartStyle: 12 },
        technical: { radius: 0, inset: 1, labelCase: 'upper', motif: 'grid', chartStyle: 24 },
        cinematic: { radius: 1, inset: 0, labelCase: 'upper', motif: 'cinematic', chartStyle: 34 },
        academic: { radius: 0, inset: 1, labelCase: 'normal', motif: 'frame', chartStyle: 3 },
      };
      const styleDna = stylePresets[styleName] || stylePresets.modern;
      const transitionEffects = {
        none: 'effectNone',
        fade: 'effectFade',
        push: 'effectPushLeft',
        wipe: 'effectWipeRight',
        split: 'effectSplitVerticalIn',
      };
      const normalizeHex = (hex, fallback = '246BFD') => {
        const raw = String(hex || fallback).replace('#', '');
        return /^[0-9a-fA-F]{6}$/.test(raw) ? raw.toUpperCase() : fallback;
      };
      const rgb = (hex) => {
        const safe = normalizeHex(hex);
        return ApiRef.RGB(parseInt(safe.slice(0, 2), 16), parseInt(safe.slice(2, 4), 16), parseInt(safe.slice(4, 6), 16));
      };
      const mix = (a, b, amount) => {
        const aa = normalizeHex(a);
        const bb = normalizeHex(b);
        const value = clamp(Number(amount) || 0, 0, 1);
        const channel = (offset) => Math.round(parseInt(aa.slice(offset, offset + 2), 16) * (1 - value) + parseInt(bb.slice(offset, offset + 2), 16) * value).toString(16).padStart(2, '0');
        return '#' + channel(0) + channel(2) + channel(4);
      };
      const luminance = (hex) => {
        const raw = normalizeHex(hex);
        const values = [0, 2, 4].map((offset) => parseInt(raw.slice(offset, offset + 2), 16) / 255).map((value) => value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4));
        return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
      };
      const contrastText = (background) => luminance(background) > 0.42 ? '#172033' : '#FFFFFF';
      const dna = {
        radius: styleDna.radius,
        inset: styleDna.inset,
        motif: styleDna.motif,
        border: mix(plan.theme.text, plan.theme.background, styleName === 'technical' ? 0.72 : 0.84),
        surface: mix(plan.theme.background, '#FFFFFF', styleName === 'cinematic' ? 0.18 : 0.72),
        muted: mix(plan.theme.text, plan.theme.background, 0.58),
        subtle: mix(plan.theme.primary, plan.theme.background, styleName === 'cinematic' ? 0.72 : 0.88),
        secondarySurface: mix(plan.theme.secondary, plan.theme.background, 0.86),
        shadow: mix(plan.theme.text, '#000000', 0.45),
        font: plan.theme.fontFamily || 'Arial',
      };
      const solid = (hex) => ApiRef.CreateSolidFill(rgb(hex));
      const noFill = () => ApiRef.CreateNoFill();
      const stroke = (hex, width = 12700) => ApiRef.CreateStroke(width, hex ? solid(hex) : noFill());
      const registry = [];
      const register = (x, y, w, h, role) => { registry.push({ x, y, w, h, role }); };
      const overlaps = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
      const contains = (outer, inner) =>
        outer.x <= inner.x && outer.y <= inner.y && outer.x + outer.w >= inner.x + inner.w && outer.y + outer.h >= inner.y + inner.h;
      const collisionCount = () => {
        let count = 0;
        for (let i = 0; i < registry.length; i++) for (let j = i + 1; j < registry.length; j++) {
          const a = registry[i];
          const b = registry[j];
          if (a.role === 'decor' || b.role === 'decor' || !overlaps(a, b)) continue;
          if (contains(a, b) || contains(b, a)) continue;
          count++;
        }
        return count;
      };
      const box = (slide, x, y, w, h, fill, border, radius = 0, role = 'shape') => {
        const shape = ApiRef.CreateShape(radius > 0 ? 'roundRect' : 'rect', w, h, fill ? solid(fill) : noFill(), stroke(border, border ? 12700 : 0));
        shape.SetPosition(x, y);
        slide.AddObject(shape);
        register(x, y, w, h, role);
        return shape;
      };
      const fit = (text, base, min, width, maxLines = 2) => {
        const chars = Math.max(1, String(text || '').length);
        const capacity = Math.max(12, Math.floor(width / 138000) * maxLines);
        return clamp(Math.floor(base * Math.sqrt(capacity / chars)), min, base);
      };
      const textBox = (slide, text, x, y, w, h, size, color, bold = false, align = 'left', role = 'text') => {
        const shape = box(slide, x, y, w, h, null, null, 0, role);
        const content = shape.GetDocContent();
        if (content && content.RemoveAllElements) content.RemoveAllElements();
        const p = ApiRef.CreateParagraph();
        if (p.SetJc) p.SetJc(align);
        if (p.SetFontSize) p.SetFontSize(size);
        if (p.SetColor) p.SetColor(rgb(color));
        if (p.SetBold) p.SetBold(bold);
        if (p.SetFontFamily) p.SetFontFamily(dna.font);
        p.AddText(String(text || ''));
        content.Push(p);
        return shape;
      };
      const title = (slide, spec, width = span(8)) => textBox(slide, spec.title, M, 548640, width, 914400, fit(spec.title, 38, 27, width), plan.theme.text, true, 'left', 'title');
      const eyebrow = (slide, text, color) => textBox(slide, styleDna.labelCase === 'upper' ? String(text || '').toUpperCase() : String(text || ''), M, 274320, span(5), 274320, 11, color, true, 'left', 'eyebrow');
      const bullets = (slide, items, x, y, w, h, accent) => {
        const safe = (items || []).slice(0, 5);
        const rowH = Math.floor(h / Math.max(1, safe.length));
        safe.forEach((item, index) => {
          const yy = y + index * rowH;
          box(slide, x, yy + 83820, 68580, 68580, accent, null, 1, 'decor');
          textBox(slide, item, x + 182880, yy, w - 182880, rowH, fit(item, 20, 15, w, 2), plan.theme.text, false, 'left', 'body');
        });
      };
      const image = (slide, url, x, y, w, h, accent) => {
        if (url && ApiRef.CreateImage) {
          try {
            const img = ApiRef.CreateImage(url, w, h);
            img.SetPosition(x, y);
            slide.AddObject(img);
            register(x, y, w, h, 'image');
            return;
          } catch (_) {}
        }
        box(slide, x, y, w, h, dna.subtle, accent, dna.radius, 'image');
        box(slide, x + Math.floor(w * 0.12), y + Math.floor(h * 0.18), Math.floor(w * 0.76), Math.floor(h * 0.5), mix(accent, plan.theme.background, 0.72), null, dna.radius, 'decor');
        textBox(slide, 'VISUAL', x, y + Math.floor(h * 0.73), w, 304800, 13, accent, true, 'center', 'caption');
      };
      const bars = (slide, values, x, y, w, h, accent) => {
        const row = values && values[0] && values[0].length ? values[0].slice(0, 7) : [38, 56, 72, 88];
        const gap = 152400;
        const barW = Math.floor((w - gap * (row.length - 1)) / row.length);
        box(slide, x, y + h, w, 12700, dna.border, null, 0, 'decor');
        row.forEach((value, index) => {
          const safe = clamp(Number(value) || 0, 0, 100);
          const barH = Math.max(182880, Math.floor(h * safe / 100));
          const fill = index === row.length - 1 ? accent : mix(accent, plan.theme.background, 0.36 + index * 0.05);
          box(slide, x + index * (barW + gap), y + h - barH, barW, barH, fill, null, dna.radius, 'chart');
          textBox(slide, String(safe), x + index * (barW + gap), y + h + 76200, barW, 304800, 12, plan.theme.text, true, 'center', 'label');
        });
      };
      const lineChart = (slide, values, x, y, w, h, accent) => {
        const row = values && values[0] && values[0].length ? values[0].slice(0, 7) : [24, 36, 51, 47, 70, 84];
        box(slide, x, y + h, w, 12700, dna.border, null, 0, 'decor');
        const pointW = Math.floor(w / Math.max(1, row.length - 1));
        row.forEach((value, index) => {
          const safe = clamp(Number(value) || 0, 0, 100);
          const px = x + index * pointW;
          const py = y + h - Math.floor(h * safe / 100);
          box(slide, px - 45720, py - 45720, 91440, 91440, accent, null, 1, 'chart');
          if (index > 0) {
            const previous = clamp(Number(row[index - 1]) || 0, 0, 100);
            const prevY = y + h - Math.floor(h * previous / 100);
            const segmentY = Math.min(prevY, py);
            const segmentH = Math.max(25400, Math.abs(prevY - py));
            box(slide, px - pointW, segmentY, pointW, segmentH, mix(accent, plan.theme.background, 0.5), null, 0, 'decor');
          }
        });
      };
      const metricCards = (slide, items, accent) => {
        const safe = (items || []).slice(0, 3);
        safe.forEach((item, index) => {
          const x = xCol(index * 4);
          box(slide, x + 76200, 2362200, span(4), 2057400, mix(dna.shadow, plan.theme.background, 0.92), null, dna.radius, 'decor');
          box(slide, x, 2286000, span(4), 2057400, dna.surface, dna.border, dna.radius, 'card');
          box(slide, x, 2286000, 76200, 2057400, index === 1 ? plan.theme.secondary : accent, null, dna.radius, 'decor');
          textBox(slide, String(index + 1).padStart(2, '0'), x + 274320, 2514600, 609600, 381000, 13, dna.muted, true, 'left', 'label');
          textBox(slide, item, x + 274320, 2971800, span(4) - 548640, 990600, fit(item, 27, 19, span(4) - 548640, 3), plan.theme.text, true, 'left', 'body');
        });
      };
      const processDiagram = (slide, items, accent) => {
        const safe = (items || []).slice(0, 4);
        const itemW = span(3);
        safe.forEach((item, index) => {
          const x = xCol(index * 3);
          box(slide, x, 2286000, itemW, 1676400, index % 2 === 0 ? dna.surface : dna.secondarySurface, dna.border, dna.radius, 'card');
          textBox(slide, String(index + 1), x + 228600, 2514600, 457200, 457200, 17, accent, true, 'center', 'label');
          textBox(slide, item, x + 228600, 3048000, itemW - 457200, 685800, fit(item, 20, 15, itemW - 457200, 3), plan.theme.text, true, 'left', 'body');
          if (index < safe.length - 1) {
            textBox(slide, '→', x + itemW + 22860, 2895600, G - 45720, 457200, 20, accent, true, 'center', 'decor');
          }
        });
      };
      const asItems = (spec) => {
        if (spec.items && spec.items.length) return spec.items.slice(0, 8);
        return (spec.bullets || []).slice(0, 8).map((label) => ({ label }));
      };
      const agendaList = (slide, spec, accent) => {
        const items = asItems(spec).slice(0, 6);
        const cols = items.length > 4 ? 2 : 1;
        const rows = Math.ceil(items.length / cols);
        const itemW = cols === 2 ? span(5) : span(9);
        items.forEach((item, index) => {
          const col = cols === 2 ? Math.floor(index / rows) : 0;
          const row = cols === 2 ? index % rows : index;
          const x = M + col * (span(6) + G);
          const y = 1752600 + row * 914400;
          textBox(slide, String(index + 1).padStart(2, '0'), x, y, 609600, 457200, 15, accent, true, 'left', 'label');
          textBox(slide, item.label, x + 762000, y, itemW - 762000, 457200, fit(item.label, 22, 16, itemW - 762000, 2), plan.theme.text, true, 'left', 'body');
          if (item.detail) textBox(slide, item.detail, x + 762000, y + 411480, itemW - 762000, 304800, 12, dna.muted, false, 'left', 'caption');
        });
      };
      const comparisonGrid = (slide, spec, accent) => {
        const columns = spec.columns && spec.columns.length
          ? spec.columns.slice(0, 3)
          : [
              { heading: 'Option A', bullets: (spec.bullets || []).filter((_, index) => index % 2 === 0) },
              { heading: 'Option B', bullets: (spec.bullets || []).filter((_, index) => index % 2 === 1) },
            ];
        const gap = 228600;
        const width = Math.floor((W - M * 2 - gap * (columns.length - 1)) / columns.length);
        columns.forEach((column, index) => {
          const x = M + index * (width + gap);
          box(slide, x, 1752600, width, 3352800, index === 0 ? dna.surface : dna.secondarySurface, dna.border, dna.radius, 'card');
          box(slide, x, 1752600, width, 685800, index === 0 ? accent : plan.theme.secondary, null, dna.radius, 'decor');
          textBox(slide, column.heading, x + 228600, 1905000, width - 457200, 381000, 18, '#FFFFFF', true, 'left', 'label');
          bullets(slide, column.bullets, x + 228600, 2667000, width - 457200, 2133600, index === 0 ? accent : plan.theme.secondary);
        });
      };
      const timelineDiagram = (slide, spec, accent) => {
        const items = asItems(spec).slice(0, 5);
        const width = span(11);
        const step = items.length > 1 ? Math.floor(width / (items.length - 1)) : width;
        box(slide, M, 3124200, width, 38100, dna.border, null, 0, 'decor');
        items.forEach((item, index) => {
          const x = M + index * step;
          box(slide, x - 114300, 3028950, 228600, 228600, index === items.length - 1 ? plan.theme.secondary : accent, null, 1, 'chart');
          textBox(slide, item.value || String(index + 1), x - 457200, 2438400, 914400, 381000, 14, accent, true, 'center', 'label');
          textBox(slide, item.label, x - 838200, 3505200, 1676400, 609600, fit(item.label, 18, 13, 1676400, 3), plan.theme.text, true, 'center', 'body');
          if (item.detail) textBox(slide, item.detail, x - 838200, 4114800, 1676400, 609600, 11, dna.muted, false, 'center', 'caption');
        });
      };
      const richMetricCards = (slide, spec, accent) => {
        const items = asItems(spec).slice(0, 4);
        const gap = 182880;
        const width = Math.floor((W - M * 2 - gap * (items.length - 1)) / Math.max(1, items.length));
        items.forEach((item, index) => {
          const x = M + index * (width + gap);
          box(slide, x, 2057400, width, 2514600, dna.surface, dna.border, dna.radius, 'card');
          box(slide, x, 2057400, width, 76200, index % 2 === 0 ? accent : plan.theme.secondary, null, 0, 'decor');
          textBox(slide, item.value || String(index + 1).padStart(2, '0'), x + 228600, 2438400, width - 457200, 685800, fit(item.value || item.label, 38, 24, width - 457200, 2), index % 2 === 0 ? accent : plan.theme.secondary, true, 'left', 'metric');
          textBox(slide, item.label, x + 228600, 3276600, width - 457200, 609600, fit(item.label, 18, 14, width - 457200, 2), plan.theme.text, true, 'left', 'body');
          if (item.detail) textBox(slide, item.detail, x + 228600, 3962400, width - 457200, 381000, 11, dna.muted, false, 'left', 'caption');
        });
      };
      const architectureDiagram = (slide, spec, accent) => {
        const items = asItems(spec).slice(0, 5);
        const height = Math.floor(3048000 / Math.max(1, items.length));
        items.forEach((item, index) => {
          const x = M + index * 152400;
          const y = 1752600 + index * height;
          const width = W - M * 2 - index * 304800;
          box(slide, x, y, width, height - 114300, index % 2 === 0 ? dna.surface : dna.secondarySurface, dna.border, dna.radius, 'card');
          textBox(slide, item.group || String(index + 1).padStart(2, '0'), x + 228600, y + 114300, 914400, 381000, 12, accent, true, 'left', 'label');
          textBox(slide, item.label, x + 1295400, y + 114300, Math.floor(width * 0.36), 381000, fit(item.label, 19, 14, Math.floor(width * 0.36), 2), plan.theme.text, true, 'left', 'body');
          if (item.detail) textBox(slide, item.detail, x + Math.floor(width * 0.52), y + 114300, Math.floor(width * 0.42), 381000, 12, dna.muted, false, 'left', 'caption');
        });
      };
      const nativeChart = (slide, spec, x, y, w, h, accent) => {
        if (!ApiRef.CreateChart || !spec.chartValues || !spec.chartValues.length) return false;
        try {
          const values = spec.chartValues.map((row) => row.slice(0, 8));
          const categories = spec.chartLabels && spec.chartLabels.length
            ? spec.chartLabels.slice(0, values[0].length)
            : values[0].map((_, index) => String(index + 1));
          const names = values.map((_, index) => 'Series ' + String(index + 1));
          const formats = values.map(() => '0');
          const chart = ApiRef.CreateChart('bar', values, names, categories, w, h, styleDna.chartStyle, formats);
          chart.SetSize(w, h);
          chart.SetPosition(x, y);
          if (chart.SetLegendPos && values.length > 1) chart.SetLegendPos('bottom');
          if (chart.SetShowDataLabels) chart.SetShowDataLabels(false, false, true, false);
          if (chart.SetSeriesFill) {
            chart.SetSeriesFill(solid(accent), 0, false);
            if (values.length > 1) chart.SetSeriesFill(solid(plan.theme.secondary), 1, false);
          }
          slide.AddObject(chart);
          register(x, y, w, h, 'chart');
          return true;
        } catch (_) {
          return false;
        }
      };
      const addTransition = (slide, transitionName) => {
        if (!transitionName || transitionName === 'none' || !ApiRef.CreateSlideShowTransition || !slide.SetSlideShowTransition) return;
        const transition = ApiRef.CreateSlideShowTransition();
        transition.SetEntryEffect(transitionEffects[transitionName] || transitionEffects.fade);
        transition.SetSpeed('medium');
        transition.SetAdvanceOnClick(true);
        slide.SetSlideShowTransition(transition);
      };

      const qualityScore = (spec, collisions) => {
        let score = 100;
        score -= collisions * 12;
        score -= Math.max(0, (spec.bullets || []).length - 5) * 5;
        score -= String(spec.title || '').length > 90 ? 8 : 0;
        score -= !spec.imageUrl && (spec.layout === 'image' || spec.layout === 'split') ? 4 : 0;
        return clamp(score, 0, 100);
      };
      const pres = ApiRef.GetPresentation();
      if (pres.SetSizes) pres.SetSizes(W, H);
      const appendMode = buildOptions.mode === 'append';
      const existingCount = pres.GetSlidesCount ? pres.GetSlidesCount() : 1;
      if (!appendMode && existingCount > 1 && pres.RemoveSlides) pres.RemoveSlides(1, existingCount - 1);
      const baseIndex = appendMode ? existingCount : 0;
      const qa = [];
      for (let i = 0; i < plan.slides.length; i++) {
        registry.length = 0;
        const spec = plan.slides[i];
        const slide = appendMode || i > 0 ? ApiRef.CreateSlide() : pres.GetSlideByIndex(0);
        if (appendMode || i > 0) pres.AddSlide(slide);
        if (slide.RemoveAllObjects) slide.RemoveAllObjects();
        const accent = spec.accentColor || plan.theme.primary;
        slide.SetBackground(solid(plan.theme.background));
        if (spec.layout === 'cover') {
          if (spec.imageUrl) {
            slide.SetBackground(ApiRef.CreateBlipFill(spec.imageUrl, 'stretch'));
            box(slide, 0, 0, Math.floor(W * 0.58), H, mix(plan.theme.text, '#000000', 0.18), null, 0, 'decor');
          } else if (styleName === 'cinematic') {
            box(slide, 0, 0, W, H, mix(accent, '#000000', 0.28), null, 0, 'decor');
            box(slide, xCol(8), 0, W - xCol(8), H, accent, null, 0, 'decor');
            box(slide, 0, H - 914400, W, 914400, mix(plan.theme.secondary, '#000000', 0.2), null, 0, 'decor');
          } else if (styleName === 'editorial') {
            box(slide, xCol(8), 0, W - xCol(8), H, dna.surface, null, 0, 'decor');
            box(slide, xCol(8), 0, 76200, H, accent, null, 0, 'decor');
            textBox(slide, '01', xCol(9), 1066800, span(2), 1524000, 64, plan.theme.secondary, true, 'right', 'decor');
          } else if (styleName === 'technical') {
            box(slide, xCol(7), 0, W - xCol(7), H, dna.subtle, null, 0, 'decor');
            for (let gx = 0; gx < 3; gx++) for (let gy = 0; gy < 4; gy++) {
              box(slide, xCol(8 + gx), 762000 + gy * 1219200, COL, COL, gy === 3 ? accent : mix(accent, plan.theme.background, 0.58 + gy * 0.08), dna.border, 0, 'decor');
            }
          } else {
            box(slide, xCol(7), 0, W - xCol(7), H, accent, null, 0, 'decor');
            box(slide, xCol(8), 914400, span(3), span(3), plan.theme.secondary, null, dna.radius, 'decor');
            box(slide, xCol(9), 3657600, span(2), span(2), mix(accent, '#FFFFFF', 0.46), null, dna.radius, 'decor');
          }
          const coverText = spec.imageUrl || styleName === 'cinematic' ? '#FFFFFF' : plan.theme.text;
          eyebrow(slide, plan.subtitle || 'Presentation', spec.imageUrl ? '#FFFFFF' : accent);
          textBox(slide, spec.title, M, 1676400, span(7), 1828800, fit(spec.title, 50, 34, span(7), 3), coverText, true, 'left', 'title');
          if (spec.subtitle) textBox(slide, spec.subtitle, M, 3733800, span(6), 762000, 22, coverText, false, 'left', 'subtitle');
        } else if (spec.layout === 'section') {
          box(slide, 0, 0, W, H, accent, null, 0, 'decor');
          box(slide, xCol(8), 0, W - xCol(8), H, mix(accent, '#000000', 0.18), null, 0, 'decor');
          textBox(slide, String(baseIndex + i).padStart(2, '0'), M, 762000, span(2), 762000, 34, '#FFFFFF', true, 'left', 'label');
          textBox(slide, spec.title, M, 2286000, span(8), 1524000, fit(spec.title, 46, 32, span(8), 2), '#FFFFFF', true, 'left', 'title');
          if (spec.subtitle) textBox(slide, spec.subtitle, M, 3962400, span(7), 609600, 20, '#FFFFFF', false, 'left', 'subtitle');
        } else if (spec.layout === 'quote') {
          box(slide, xCol(1), 1066800, span(10), 4114800, dna.surface, dna.border, dna.radius, 'card');
          textBox(slide, '“', M, 1066800, span(2), 1066800, 72, accent, true, 'left', 'decor');
          textBox(slide, spec.title, xCol(2), 1524000, span(8), 1981200, fit(spec.title, 40, 28, span(8), 4), plan.theme.text, true, 'center', 'title');
          if (spec.subtitle) textBox(slide, spec.subtitle, xCol(3), 3962400, span(6), 457200, 17, accent, true, 'center', 'subtitle');
        } else if (spec.layout === 'agenda') {
          title(slide, spec);
          if (spec.subtitle) textBox(slide, spec.subtitle, M, 1371600, span(7), 457200, 17, accent, false, 'left', 'subtitle');
          agendaList(slide, spec, accent);
        } else if (spec.layout === 'comparison') {
          title(slide, spec);
          if (spec.subtitle) textBox(slide, spec.subtitle, M, 1371600, span(8), 457200, 17, accent, false, 'left', 'subtitle');
          comparisonGrid(slide, spec, accent);
        } else if (spec.layout === 'timeline') {
          title(slide, spec);
          if (spec.subtitle) textBox(slide, spec.subtitle, M, 1371600, span(8), 457200, 17, accent, false, 'left', 'subtitle');
          timelineDiagram(slide, spec, accent);
        } else if (spec.layout === 'process') {
          title(slide, spec);
          if (spec.subtitle) textBox(slide, spec.subtitle, M, 1371600, span(8), 457200, 17, accent, false, 'left', 'subtitle');
          processDiagram(slide, asItems(spec).map((item) => item.label), accent);
        } else if (spec.layout === 'metrics') {
          title(slide, spec);
          if (spec.subtitle) textBox(slide, spec.subtitle, M, 1371600, span(8), 457200, 17, accent, false, 'left', 'subtitle');
          richMetricCards(slide, spec, accent);
        } else if (spec.layout === 'architecture') {
          title(slide, spec);
          if (spec.subtitle) textBox(slide, spec.subtitle, M, 1371600, span(8), 457200, 17, accent, false, 'left', 'subtitle');
          architectureDiagram(slide, spec, accent);
        } else if (spec.layout === 'closing') {
          box(slide, 0, 0, W, H, accent, null, 0, 'decor');
          box(slide, xCol(9), 0, W - xCol(9), H, mix(accent, '#000000', 0.2), null, 0, 'decor');
          eyebrow(slide, plan.title, '#FFFFFF');
          textBox(slide, spec.title, M, 1752600, span(8), 1676400, fit(spec.title, 48, 32, span(8), 3), '#FFFFFF', true, 'left', 'title');
          if (spec.subtitle) textBox(slide, spec.subtitle, M, 3657600, span(7), 609600, 20, '#FFFFFF', false, 'left', 'subtitle');
          if (spec.bullets && spec.bullets[0]) textBox(slide, spec.bullets[0], M, 4648200, span(6), 457200, 15, '#FFFFFF', true, 'left', 'body');

        } else if (spec.layout === 'image') {
          title(slide, spec, span(6));
          if (spec.subtitle) textBox(slide, spec.subtitle, M, 1371600, span(5), 609600, 18, accent, false, 'left', 'subtitle');
          image(slide, spec.imageUrl, xCol(6), 0, W - xCol(6), H, accent);
          bullets(slide, spec.bullets, M, 2286000, span(5), 2895600, accent);
        } else if (spec.layout === 'split') {
          title(slide, spec);
          bullets(slide, spec.bullets, M, 1828800, span(5), 3352800, accent);
          image(slide, spec.imageUrl, xCol(6), 1524000, span(6), 3657600, accent);
        } else if (spec.layout === 'chart') {
          title(slide, spec);
          if (spec.subtitle) textBox(slide, spec.subtitle, M, 1371600, span(6), 457200, 17, accent, false, 'left', 'subtitle');
          bullets(slide, spec.bullets, M, 2057400, span(4), 2743200, accent);
          const values = spec.chartValues && spec.chartValues[0] ? spec.chartValues[0] : [];
          const changes = values.slice(1).map((value, index) => Number(value) - Number(values[index]));
          const monotonic = changes.length > 1 && changes.every((value) => value >= 0);
          const createdNativeChart = nativeChart(slide, spec, xCol(5), 1905000, span(7), 2743200, accent);
          if (!createdNativeChart && monotonic && values.length >= 5) {
            lineChart(slide, spec.chartValues, xCol(5), 2133600, span(7), 2438400, accent);
          } else if (!createdNativeChart) {
            bars(slide, spec.chartValues, xCol(5), 2133600, span(7), 2438400, accent);
          }
        } else {
          title(slide, spec);
          if (spec.bullets.length <= 3) metricCards(slide, spec.bullets, accent);
          else if (spec.bullets.length === 4) processDiagram(slide, spec.bullets, accent);
          else bullets(slide, spec.bullets, M, 1828800, span(10), 3505200, accent);
        }
        if (spec.source) {
          textBox(slide, 'Source: ' + spec.source, M, H - 685800, span(9), 228600, 9, spec.layout === 'closing' ? '#FFFFFF' : dna.muted, false, 'left', 'source');
        }
        if (spec.speakerNotes && slide.AddNotesText) slide.AddNotesText(spec.speakerNotes);
        addTransition(slide, spec.transition);
        box(slide, M, H - 457200, W - M * 2, 12700, spec.layout === 'closing' ? '#FFFFFF' : dna.border, null, 0, 'decor');
        const pageNumber = baseIndex + i + 1;
        textBox(slide, String(pageNumber).padStart(2, '0'), W - M - 457200, H - 381000, 457200, 228600, 10, spec.layout === 'closing' ? '#FFFFFF' : accent, true, 'right', 'page');
        const collisions = collisionCount();
        qa.push({ slide: pageNumber, score: qualityScore(spec, collisions), collisions });
      }
      const average = qa.length ? Math.round(qa.reduce((sum, item) => sum + item.score, 0) / qa.length) : 0;
      return JSON.stringify({ message: 'Created apex design-engine deck', title: plan.title, slides: plan.slides.length, qualityScore: average, qa });
    `),
  ].join('\n');
