/** Human-readable tab names for generated HTML. Do not execute HTML to inspect its title. */
export const previewTitleOf = (html: string, fileName: string | undefined, index: number): string => {
  const explicit = fileName?.trim();
  if (explicit && !/^(html|htm|index(?:\.html?)?)$/i.test(explicit)) return explicit.slice(0, 70);
  const title = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1];
  const text = title
    ?.replace(/<[^>]*>/g, ' ')
    .replace(/&(?:amp|lt|gt|quot|nbsp);/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text?.slice(0, 70) || `Trang web ${index}`;
};
