import { env } from "cloudflare:workers";
import { boardDay } from "@/lib/board";

export const dynamic = "force-dynamic";
const expectedHash = "003cb1c82158e4450d38a488bf73552a7411b712032fe0e965ab8fc7eb5e1c42";

export async function DELETE(request: Request) {
  const token = request.headers.get("X-Chillpan-Reset") || "";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  const hash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  if (hash !== expectedHash) return new Response(null, { status: 403 });
  const day = boardDay();
  const marker = `maintenance-${expectedHash}`;
  await env.DB!.batch([
    env.DB!.prepare("DELETE FROM strokes WHERE day = ? AND room IN (1, 2, 3) AND NOT EXISTS (SELECT 1 FROM strokes WHERE stroke_id = ?)")
      .bind(day, marker),
    env.DB!.prepare("INSERT INTO strokes (stroke_id, day, room, color, size, points) VALUES (?, ?, 0, '#reset', 0, '[]') ON CONFLICT(stroke_id) DO NOTHING")
      .bind(marker, day),
  ]);
  return Response.json({ ok: true, day }, { headers: { "Cache-Control": "no-store" } });
}
