const { randomUUID } = require("node:crypto");

const COLORS = ["#f28eaa", "#82d9ad", "#85bdf3", "#f1d46f", "#c6a0ee", "#f5ad7c", "#edc568"];
const dayKey = (date) => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
}).format(date);
const S = (value) => ({ S: String(value) });
const N = (value) => ({ N: String(value) });
const key = (pk, sk = 0) => ({ pk: S(pk), sk: N(sk) });
const validStroke = (s) => s && typeof s.strokeId === "string" && /^[a-zA-Z0-9-]{1,80}$/.test(s.strokeId)
  && typeof s.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s.day)
  && [1, 2, 3].includes(s.room) && COLORS.includes(s.color)
  && (s.tool === undefined || s.tool === "eraser")
  && Number.isFinite(s.size) && s.size >= 0.0001 && s.size <= 0.04
  && Array.isArray(s.points) && s.points.length >= 1 && s.points.length <= 96
  && s.points.every((p) => Array.isArray(p) && p.length === 2
    && p.every((v) => Number.isFinite(v) && v >= 0 && v <= 1));

function createHandler({ send, table, now = () => new Date(), pause = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  const reply = (statusCode, data) => ({ statusCode, headers: {
    "content-type": "application/json; charset=utf-8", "cache-control": "no-store",
    "x-content-type-options": "nosniff", ...(statusCode === 503 ? { "retry-after": "2" } : {}),
  }, body: JSON.stringify(data) });

  async function append(strokes, day, room) {
    const pk = `${day}#${room}`;
    const expires = Math.floor(Date.parse(`${day}T15:00:00Z`) / 1000) + 86400;
    const unique = [...new Map(strokes.map((s) => [s.strokeId, s])).values()];
    for (let attempt = 0; attempt < 6; attempt++) {
      const counter = await send("GetItem", { TableName: table, Key: key(pk), ConsistentRead: true });
      const sequence = Number(counter.Item?.seq?.N || 0);
      const ids = await send("BatchGetItem", { RequestItems: { [table]: {
        Keys: unique.map((s) => key(`seen#${day}#${s.strokeId}`)), ConsistentRead: true,
      } } });
      if (Object.keys(ids.UnprocessedKeys || {}).length) {
        await pause(100 + attempt * 100);
        continue;
      }
      const existing = new Set((ids.Responses?.[table] || []).map((item) => item.pk.S));
      const fresh = unique.filter((s) => !existing.has(`seen#${day}#${s.strokeId}`));
      if (!fresh.length) return;
      if (sequence + fresh.length > 20000) throw new Error("Daily board capacity reached");
      if (dayKey(now()) !== day) throw new Error("Day changed");
      // Counter and all stroke rows commit together, so polling never skips a late writer.
      const actions = [{ Update: {
        TableName: table, Key: key(pk),
        UpdateExpression: "SET seq = :next, expires = :expires",
        ConditionExpression: "attribute_not_exists(seq) OR seq = :previous",
        ExpressionAttributeValues: { ":next": N(sequence + fresh.length), ":previous": N(sequence), ":expires": N(expires) },
      } }];
      fresh.forEach((stroke, i) => {
        const { strokeId, color, size, points, tool } = stroke;
        const data = { strokeId, color, size, points, day, room, ...(tool === "eraser" ? { tool } : {}) };
        actions.push({ Put: { TableName: table, Item: {
          ...key(pk, sequence + i + 1), data: S(JSON.stringify(data)), expires: N(expires),
        }, ConditionExpression: "attribute_not_exists(pk)" } });
        actions.push({ Put: { TableName: table, Item: {
          ...key(`seen#${day}#${strokeId}`), expires: N(expires),
        }, ConditionExpression: "attribute_not_exists(pk)" } });
      });
      try {
        await send("TransactWriteItems", { TransactItems: actions, ClientRequestToken: randomUUID() });
        return;
      } catch (error) {
        if (error.name !== "TransactionCanceledException" && error.name !== "TransactionConflictException") throw error;
        await pause(50 * (attempt + 1) + Math.random() * 100);
      }
    }
    throw new Error("Board is busy");
  }

  return async (event) => {
    const day = dayKey(now());
    const method = event.requestContext?.http?.method;
    if (event.rawPath !== "/api/board") return reply(404, { error: "Not found" });
    try {
      if (method === "GET") {
        const room = Number(event.queryStringParameters?.room || 1);
        const after = Number(event.queryStringParameters?.after || 0);
        if (![1, 2, 3].includes(room) || !Number.isSafeInteger(after) || after < 0) return reply(400, { error: "Invalid cursor or room" });
        const result = await send("Query", {
          TableName: table, KeyConditionExpression: "pk = :pk AND sk > :after",
          ExpressionAttributeValues: { ":pk": S(`${day}#${room}`), ":after": N(after) },
          ConsistentRead: true, Limit: 500,
        });
        const strokes = (result.Items || []).map((row) => ({ ...JSON.parse(row.data.S), id: Number(row.sk.N) }));
        return reply(200, { day, room, strokes, cursor: strokes.at(-1)?.id || after, hasMore: !!result.LastEvaluatedKey });
      }
      if (method !== "POST") return reply(405, { error: "Method not allowed" });
      const headers = event.headers || {};
      if (headers.origin && headers.origin !== `https://${headers["x-chillpan-host"]}`) return reply(403, { error: "Invalid origin" });
      const body = event.isBase64Encoded ? Buffer.from(event.body || "", "base64").toString("utf8") : event.body || "";
      if (Buffer.byteLength(body) > 100000) return reply(413, { error: "Body too large" });
      let strokes;
      try { strokes = JSON.parse(body).strokes; } catch { return reply(400, { error: "Invalid JSON" }); }
      if (!Array.isArray(strokes) || !strokes.length || strokes.length > 32 || !strokes.every(validStroke)) return reply(400, { error: "Invalid strokes" });
      if (strokes.some((s) => s.day !== day)) return reply(409, { day });
      for (const room of [1, 2, 3]) {
        const group = strokes.filter((s) => s.room === room);
        if (group.length) await append(group, day, room);
      }
      return reply(200, { saved: true, day });
    } catch (error) {
      const current = dayKey(now());
      if (current !== day) return reply(409, { day: current });
      console.error("Board request failed", error.name || "Error");
      return reply(503, { error: "Please retry" });
    }
  };
}

let handler;
exports.handler = async (event) => {
  if (!handler) {
    const sdk = require("@aws-sdk/client-dynamodb");
    const client = new sdk.DynamoDBClient({ maxAttempts: 3 });
    handler = createHandler({ table: process.env.TABLE_NAME, send: (name, input) => client.send(new sdk[`${name}Command`](input)) });
  }
  return handler(event);
};
exports.createHandler = createHandler;
