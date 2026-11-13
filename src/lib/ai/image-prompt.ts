export type ImageStyle = "editorial" | "cinematic" | "illustration" | "3d" | "minimalist";
export type ImageSubject = "objects" | "people" | "abstract";

const IMAGE_STYLES: Record<ImageStyle, string> = {
  editorial: "Premium editorial photography for a leading business publication. Art-directed, visually specific, tactile details, natural cinematic light, sophisticated color grading, authentic materials, intentional negative space.",
  cinematic: "Cinematic documentary still, dramatic but believable lighting, rich atmospheric depth, strong composition, realistic lens and material detail, restrained color grade, premium film production quality.",
  illustration: "Sophisticated conceptual editorial illustration, distinctive art direction, elegant shapes and textures, restrained palette, clear visual metaphor, polished magazine-cover quality, not childish or clip-art.",
  "3d": "High-end product visualization with physically plausible materials, refined studio lighting, realistic reflections and shadows, precise geometry, premium commercial art direction.",
  minimalist: "Minimalist Swiss-inspired editorial visual, one unmistakable focal object, deliberate negative space, precise geometry, restrained palette, subtle texture, exceptionally clean composition.",
};

const IMAGE_SUBJECTS: Record<ImageSubject, string> = {
  objects: [
    "SUBJECT RULE: Create a non-human visual. Do NOT show a person, human face, portrait, body, silhouette, crowd, hands, or human figure.",
    "Use a concrete object, product, environment, architecture, machine, natural element, or a carefully designed still life as the main subject.",
    "People are forbidden even as background decoration. Do not turn an abstract business topic into a random person standing in an office.",
  ].join(" "),
  people: [
    "SUBJECT RULE: Human subjects are allowed because the user explicitly selected people.",
    "Show people only when they directly communicate the post's topic. Avoid generic stock-photo poses, staged handshakes, people pointing at screens, and random office portraits.",
  ].join(" "),
  abstract: [
    "SUBJECT RULE: Create a non-human conceptual visual metaphor. Do NOT show people, faces, portraits, bodies, silhouettes, crowds, or hands.",
    "Use symbolic objects, geometry, materials, light, architecture, or surreal but coherent visual metaphors. Make the idea understandable without a human character.",
  ].join(" "),
};

export function buildImagePrompt(
  post: { internal_title: string | null; text: string },
  direction?: string,
  style: ImageStyle = "editorial",
  subject: ImageSubject = "objects"
): string {
  const title = (post.internal_title || post.text.slice(0, 180)).replace(/\s+/g, " ").trim();
  const context = post.text.replace(/\s+/g, " ").slice(0, 2_000).trim();
  const userDirection = direction?.trim();

  return [
    "Create one exceptional, publication-ready visual for the LinkedIn post described below.",
    "FIRST identify the single most important idea in the post. Translate that idea into one specific, memorable visual concept. Do not illustrate generic business success.",
    "ART DIRECTION: " + IMAGE_STYLES[style],
    "SUBJECT CONTROL: " + IMAGE_SUBJECTS[subject],
    "SCENE DESIGN: Name and depict a specific primary subject that directly represents the post. Build a coherent scene around it with intentional foreground, background, lighting, camera angle, scale, and composition. The subject must occupy the visual focus.",
    "PROMPT PRIORITY: Follow the selected subject mode first, then the user's creative direction within that constraint, then the post context. Never replace a requested object, animal, place, product, diagram-like concept, or environment with a human portrait.",
    "QUALITY: Professional art direction, coherent geometry, accurate object construction, realistic materials, deliberate color palette, controlled detail, no malformed anatomy or objects.",
    "OUTPUT: One image only. No lettering, captions, numbers, logos, watermarks, borders, UI mockups, split panels, or collage layouts.",
    "POST TITLE: " + title,
    "POST CONTENT: " + context,
    userDirection
      ? "USER'S EXACT CREATIVE DIRECTION: " + userDirection
      : "CREATIVE DIRECTION: Choose a concrete visual concept from the post. Prefer an object, environment, product, or visual metaphor. Do not default to a person, office, laptop, handshake, or generic stock photography.",
  ].join("\n");
}
