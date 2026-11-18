import { renderDraftPreviewHtml } from "@/lib/integrations/telegram/draft-preview-html";
import { loadDraftPreviewInput } from "@/lib/integrations/telegram/draft-preview-data";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await context.params;
  const loaded = await loadDraftPreviewInput(request, id);
  if ("response" in loaded) return loaded.response;
  const html = renderDraftPreviewHtml(loaded.input);
  return new Response(html, { headers: {
    "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store, max-age=0",
    "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src https: data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  }});
}
