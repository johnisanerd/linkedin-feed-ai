import { ImageResponse } from "next/og";
import { IMAGE_WIDTH, IMAGE_HEIGHT } from "./image-config";

export interface PostImageOptions {
  title: string;
  content: string;
  authorName?: string;
}

/**
 * Generate a minimal branded image at LinkedIn portrait dimensions (1080×1350).
 * Renders the first two paragraphs of the post centred on a dark green canvas.
 *
 * Uses @vercel/og (Satori) to render JSX directly to PNG — works in serverless.
 * Tweak IMAGE_WIDTH / IMAGE_HEIGHT in lib/image-config.ts to change sizing.
 */
export async function generatePostImage(
  options: PostImageOptions
): Promise<Buffer> {
  const cleanContent = options.content
    .replace(/\*\*/g, "")
    .replace(/\*/g, "")
    .replace(/`/g, "");

  const lines = cleanContent
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  /*
    Show the first 2 paragraphs — hook + punch — centred on the canvas.
    The full post stays in the LinkedIn caption; the image is the teaser.
  */
  const displayLines = lines.slice(0, 2);

  const bloomWidth = Math.round(IMAGE_WIDTH * 1.4);
  const bloomHeight = Math.round(IMAGE_HEIGHT * 0.7);
  const bloomLeft = Math.round((IMAGE_WIDTH - bloomWidth) / 2);
  const bloomBottom = -Math.round(IMAGE_HEIGHT * 0.55);

  const response = new ImageResponse(
    (
      <div
        style={{
          width: `${IMAGE_WIDTH}px`,
          height: `${IMAGE_HEIGHT}px`,
          background: "#0d2418",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          padding: "360px 90px",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Subtle peach bloom anchored at the bottom edge */}
        <div
          style={{
            position: "absolute",
            left: `${bloomLeft}px`,
            bottom: `${bloomBottom}px`,
            width: `${bloomWidth}px`,
            height: `${bloomHeight}px`,
            backgroundImage:
              "radial-gradient(ellipse at center, rgba(248,218,188,0.55) 0%, rgba(240,188,150,0.25) 35%, rgba(13,36,24,0) 70%)",
          }}
        />
        <div
          style={{
            zIndex: 1,
            display: "flex",
            flexDirection: "column",
            gap: "32px",
            maxWidth: "880px",
            textAlign: "center",
          }}
        >
          {displayLines.map((line, i) => (
            <p
              key={i}
              style={{
                fontFamily: "Inter",
                fontSize: "48px",
                fontWeight: 300,
                color: "rgba(255,255,255,0.94)",
                lineHeight: 1.4,
                margin: 0,
                letterSpacing: "0.005em",
              }}
            >
              {line}
            </p>
          ))}
        </div>
      </div>
    ),
    {
      width: IMAGE_WIDTH,
      height: IMAGE_HEIGHT,
    }
  );

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
