export type LinkedInMediaFormat = "image_carousel" | "document";

export interface LinkedInMediaDescriptor {
  mediaType: "image" | "document";
  mimeType: string;
}

export function validateLinkedInMedia(
  format: LinkedInMediaFormat,
  media: LinkedInMediaDescriptor[]
): string | null {
  if (format === "image_carousel") {
    if (media.length < 2 || media.length > 20) return "An image carousel requires 2–20 image slides.";
    if (media.some((item) => item.mediaType !== "image" || !["image/jpeg", "image/png"].includes(item.mimeType))) {
      return "Every carousel slide must be a JPG or PNG image.";
    }
    return null;
  }
  if (media.length !== 1 || media[0]?.mediaType !== "document" || media[0]?.mimeType !== "application/pdf") {
    return "A document post requires one PDF file.";
  }
  return null;
}
