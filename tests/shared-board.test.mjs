import assert from "node:assert/strict";
import { test } from "node:test";
import { boardDay } from "../lib/board.ts";

const base = "http://127.0.0.1:4173";
const read = async (room, after = 0) => (await fetch(`${base}/api/board?room=${room}&after=${after}`)).json();
const write = (strokes) => fetch(`${base}/api/board`, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ strokes }),
});
const stroke = (day) => ({
  strokeId: crypto.randomUUID(), day, room: 3, color: "#f28eaa", size: 0.005,
  points: [[0.4, 0.4], [0.5, 0.45]],
});

test("everyone crosses midnight at the same Korean time", () => {
  assert.equal(boardDay(new Date("2026-10-09T14:59:59Z")), "2026-10-09");
  assert.equal(boardDay(new Date("2026-10-09T15:00:00Z")), "2026-10-10");
});

test("concurrent visitors append without losing strokes; retries are idempotent", async () => {
  const initial = await read(3);
  const batch = Array.from({ length: 8 }, () => stroke(initial.day));
  const responses = await Promise.all([...batch, batch[0]].map((item) => write([item])));
  assert.ok(responses.every((response) => response.status === 200));
  const saved = await read(3, initial.cursor);
  const ids = new Set(batch.map((item) => item.strokeId));
  assert.equal(saved.strokes.filter((item) => ids.has(item.strokeId)).length, 8);
  const otherRoom = await read(2);
  assert.ok(otherRoom.strokes.every((item) => !ids.has(item.strokeId)));
  const increment = await read(3, saved.cursor);
  assert.equal(increment.strokes.length, 0);
});

test("expired strokes cannot reappear after midnight", async () => {
  const response = await write([stroke("2000-01-01")]);
  assert.equal(response.status, 409);
  assert.equal((await response.json()).day, boardDay());
});

test("invalid coordinates and classrooms are rejected", async () => {
  const invalid = stroke(boardDay());
  invalid.points = [[-1, 0.5]];
  assert.equal((await write([invalid])).status, 400);
  assert.equal((await fetch(`${base}/api/board?room=4`)).status, 400);
});
