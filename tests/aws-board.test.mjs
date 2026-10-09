import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
const { createHandler } = createRequire(import.meta.url)("../aws/handler.cjs");

function fixture() {
  const rows = new Map();
  const id = (k) => `${k.pk.S}/${k.sk.N}`;
  const send = async (name, input) => {
    // Yield so concurrent tests exercise the optimistic transaction retry path.
    await new Promise((r) => setImmediate(r));
    if (name === "GetItem") return { Item: rows.get(id(input.Key)) };
    if (name === "BatchGetItem") return { Responses: { board: input.RequestItems.board.Keys.map((k) => rows.get(id(k))).filter(Boolean) } };
    if (name === "Query") {
      const items = [...rows.values()].filter((row) => row.pk.S === input.ExpressionAttributeValues[":pk"].S && +row.sk.N > +input.ExpressionAttributeValues[":after"].N).sort((a, b) => +a.sk.N - +b.sk.N);
      return { Items: items.slice(0, input.Limit), ...(items.length > input.Limit ? { LastEvaluatedKey: items[input.Limit - 1] } : {}) };
    }
    if (name === "TransactWriteItems") {
      for (const action of input.TransactItems) {
        if (action.Update) {
          const previous = rows.get(id(action.Update.Key));
          if (previous && previous.seq.N !== action.Update.ExpressionAttributeValues[":previous"].N) throw Object.assign(new Error(), { name: "TransactionCanceledException" });
        } else if (rows.has(id(action.Put.Item))) throw Object.assign(new Error(), { name: "TransactionCanceledException" });
      }
      for (const action of input.TransactItems) {
        if (action.Update) rows.set(id(action.Update.Key), { ...action.Update.Key, seq: action.Update.ExpressionAttributeValues[":next"] });
        else rows.set(id(action.Put.Item), action.Put.Item);
      }
      return {};
    }
    throw new Error(`Unexpected command: ${name}`);
  };
  return createHandler({ send, table: "board", now: () => new Date("2026-10-09T06:00:00Z"), pause: async () => {} });
}
const stroke = (strokeId, room = 1) => ({ strokeId, day: "2026-10-09", room, color: "#f28eaa", size: 5 / 390, points: [[0.2, 0.4], [0.4, 0.4]] });
const post = (strokes, headers = {}) => ({ rawPath: "/api/board", requestContext: { http: { method: "POST" } }, body: JSON.stringify({ strokes }), headers });
const get = (room = 1, after = 0) => ({ rawPath: "/api/board", requestContext: { http: { method: "GET" } }, queryStringParameters: { room: String(room), after: String(after) } });

test("AWS transactions preserve concurrent writers and deduplicate retries", async () => {
  const handler = fixture();
  const results = await Promise.all(Array.from({ length: 4 }, (_, i) => handler(post([stroke(`writer-${i}`)]))));
  assert.ok(results.every((r) => r.statusCode === 200));
  assert.equal((await handler(post([stroke("writer-0"), stroke("writer-0")]))).statusCode, 200);
  const board = JSON.parse((await handler(get())).body);
  assert.equal(board.strokes.length, 4);
  assert.deepEqual(board.strokes.map((s) => s.id), [1, 2, 3, 4]);
  assert.equal(JSON.parse((await handler(get(1, 4))).body).strokes.length, 0);
  assert.equal(JSON.parse((await handler(get(2))).body).strokes.length, 0);
});

test("AWS rejects stale days, invalid coordinates, origins and cursors", async () => {
  const handler = fixture();
  assert.equal((await handler(post([{ ...stroke("old"), day: "2026-10-08" }]))).statusCode, 409);
  assert.equal((await handler(post([{ ...stroke("bad"), points: [[2, 0]] }]))).statusCode, 400);
  assert.equal((await handler(post([stroke("cross")], { origin: "https://evil.example", "x-chillpan-host": "board.example" }))).statusCode, 403);
  assert.equal((await handler(get(4))).statusCode, 400);
  assert.equal((await handler(get(1, -1))).statusCode, 400);
});

test("mixed-room batches remain isolated and can be retried", async () => {
  const handler = fixture();
  const batch = post([stroke("room-one", 1), stroke("room-three", 3)]);
  assert.equal((await handler(batch)).statusCode, 200);
  assert.equal((await handler(batch)).statusCode, 200);
  for (const room of [1, 3]) assert.equal(JSON.parse((await handler(get(room))).body).strokes.length, 1);
});
