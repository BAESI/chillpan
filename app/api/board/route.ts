import { env } from "cloudflare:workers";
import { boardDay, validStroke, type Stroke } from "@/lib/board";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

async function forwardToAws(request: Request, body?: string) {
  if (!env.AWS_BOARD_ORIGIN) return null;
  const target = new URL("/api/board", env.AWS_BOARD_ORIGIN);
  if (target.protocol !== "https:") throw new Error("AWS board origin must use HTTPS");
  target.search = new URL(request.url).search;
  const outgoing = new Headers();
  if (body !== undefined) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body));
    outgoing.set("content-type", "application/json");
    outgoing.set("x-amz-content-sha256", Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(""));
  }
  try {
    const response = await fetch(target, {
      method: request.method, headers: outgoing, body, redirect: "error", signal: AbortSignal.timeout(15000),
    });
    // Never forward Sites identity, cookies, or service credentials to the public origin.
    return new Response(response.body, { status: response.status, headers: { ...headers, "Content-Type": "application/json" } });
  } catch {
    return Response.json({ error: "Board temporarily unavailable" }, { status: 503, headers });
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const room = Number(url.searchParams.get("room"));
  const after = Number(url.searchParams.get("after") || 0);
  if (![1, 2, 3].includes(room) || !Number.isSafeInteger(after) || after < 0) {
    return Response.json({ error: "Invalid board" }, { status: 400, headers });
  }
  const forwarded = await forwardToAws(request);
  if (forwarded) return forwarded;
  const day = boardDay();
  const result = await env.DB!.prepare(
    "SELECT id, stroke_id AS strokeId, day, room, color, size, points FROM strokes WHERE day = ? AND room = ? AND id > ? ORDER BY id LIMIT 500",
  ).bind(day, room, after).all<Stroke & { id: number; points: string }>();
  const strokes = result.results.map((row) => ({ ...row, points: JSON.parse(row.points) }));
  return Response.json({ day, room, strokes, cursor: strokes.at(-1)?.id || after, hasMore: strokes.length === 500 }, { headers });
}

export async function POST(request: Request) {
  if (request.headers.get("origin") && request.headers.get("origin") !== new URL(request.url).origin) {
    return Response.json({ error: "Invalid origin" }, { status: 403, headers });
  }
  const text = await request.text();
  if (text.length > 100_000) return Response.json({ error: "Too large" }, { status: 413, headers });
  let body;
  try { body = JSON.parse(text); } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400, headers });
  }
  if (!body || !Array.isArray(body.strokes) || body.strokes.length < 1 || body.strokes.length > 32 || !body.strokes.every(validStroke)) {
    return Response.json({ error: "Invalid strokes" }, { status: 400, headers });
  }
  const day = boardDay();
  if (body.strokes.some((stroke: Stroke) => stroke.day !== day)) {
    return Response.json({ error: "Board has reset", day }, { status: 409, headers });
  }
  const forwarded = await forwardToAws(request, text);
  if (forwarded) return forwarded;
  await env.DB!.batch([
    env.DB!.prepare("DELETE FROM strokes WHERE id IN (SELECT id FROM strokes WHERE day < ? LIMIT 1000)").bind(day),
    ...body.strokes.map((stroke: Stroke) => env.DB!.prepare(
    "INSERT INTO strokes (stroke_id, day, room, color, size, points) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(stroke_id) DO NOTHING",
  ).bind(stroke.strokeId, day, stroke.room, stroke.color, stroke.size, JSON.stringify(stroke.points))),
  ]);
  return Response.json({ ok: true, day }, { headers });
}
