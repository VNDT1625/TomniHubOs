/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

/** Small model-facing display contract shared across conversation providers. */
export const PRESENTATION_GUIDANCE =
  '[TomniPresentation] Prefer concise Markdown for simple answers. For meaningful comparisons use a Markdown table; for real numerical trends a chart fence, and for complex relations a mermaid fence. For illustrations, use a normal Markdown image with a direct sourced HTTPS URL, or for multiple relevant sourced images prefer a horizontally scrollable tomni-ui gallery block: {"type":"gallery","images":[{"src":"https://trusted-public-image-url","alt":"Description","caption":"Caption","source":"https://original-source-url","sourceLabel":"Publisher"}]}. For requested N images, set gallery.targetCount to N (1–16) and provide up to 32 verifiable candidate images (ideally more than N); only successfully loaded images are displayed, and the UI honestly reports if fewer than N work. For example request 5, give 8–12 distinct checked sources if available. Never claim N were found unless successfully sourced. Real retrieved or user-provided image URLs only; NEVER invent links or use private/local addresses. A gallery keeps images together with the text instead of replacing the explanation. For clear multi-step processes, a few metrics, or grouped concepts use one fenced tomni-ui JSON block when it helps comprehension: {"version":1,"title":"...","fallbackText":"An accurate plain-text equivalent","blocks":[{"type":"flow","steps":[{"title":"Start"},{"title":"Finish"}]}]}. Other available blocks: metrics items [{label,value,detail?,tone?}], cards items [{title,description,tag?,tone?}], table columns and rows. Accent tone is only neutral, info, success or warning; use sparingly for meaning. For user-requested teaching, the safe interactive lesson block has 2–10 slides: [{title,body,reveal?,question?,options?,correctIndex?,allowTextAnswer?}]. For multiple-choice questions set question, options as 2–4 strings, and correctIndex as zero-based integer. For free-form answers set question and allowTextAnswer:true (no options or correctIndex), and supply reveal as an example answer; free text is NOT automatically graded. For explanatory steps omit all quiz fields. Markdown in body/reveal is formatted; avoid embedding raw HTML. Agent chooses the question format, not every lesson requires a quiz. Learners can select answers, submit, revisit, and reveal explanations. Prefer lesson before HTML if HTML-specific interactions are unnecessary. Never invent numbers or force visuals. Use a fenced html block for complete small interactive offline lessons or web mockups only when the user requests a runnable demo; its preview is sandboxed without filesystem or network. Ordinary Markdown supports bold, italic, highlights and quotes. Keep diagrams legible and short, and do not emit executable actions in tomni-ui.';

/** Inject only for ordinary user turns. Slash workflows keep their explicit contracts. */
export const addPresentationGuidance = (input: string, prepared?: string): string | undefined => {
  const trimmed = input.trim();
  if (!trimmed || trimmed.startsWith('/') || trimmed.length > 40_000) return undefined;
  // No extra tokens for pleasantries, short facts or ordinary agent commands.
  if (
    !/(so sánh|giải thích|kiến trúc|quy trình|sơ đồ|biểu đồ|luồng|hoạt động|vận hành|minh họa|trực quan|mô phỏng|bài học|trang web|giao diện|compare|explain|how does|how do|architecture|workflow|diagram|visuali[sz]e|interactive|tutorial|teach|website|mockup)/i.test(
      trimmed
    )
  ) {
    return undefined;
  }
  return `${PRESENTATION_GUIDANCE}\n\n${prepared?.trim() ? prepared : input}`;
};
