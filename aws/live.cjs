const S = (value) => ({ S: String(value) });
const N = (value) => ({ N: String(value) });
const connectionKey = (room, connection) => ({ room: S(room), connection: S(connection) });

function createLiveHandler({ send, post, table, origins, now = () => Date.now() }) {
  const remove = (room, connection) => send("DeleteItem", { TableName: table, Key: connectionKey(room, connection) });
  async function broadcast(room, update) {
    let cursor;
    do {
      const result = await send("Query", { TableName: table, ConsistentRead: true,
        KeyConditionExpression: "room = :room", ExpressionAttributeValues: { ":room": S(room) },
        ...(cursor ? { ExclusiveStartKey: cursor } : {}) });
      const connections = (result.Items || []).filter((item) => Number(item.expires.N) > now() / 1000);
      // Bound fan-out concurrency in the low-budget deployment.
      for (let i = 0; i < connections.length; i += 5) {
        await Promise.all(connections.slice(i, i + 5).map(async (item) => {
          try { await post(item.connection.S, JSON.stringify(update)); }
          catch (error) {
            if (error.statusCode === 410 || error.$metadata?.httpStatusCode === 410) await remove(room, item.connection.S);
            else throw error;
          }
        }));
      }
      cursor = result.LastEvaluatedKey;
    } while (cursor);
  }
  return async (event) => {
    if (event.Records) {
      const updates = new Map();
      for (const record of event.Records) {
        const row = record.dynamodb?.NewImage;
        if (record.eventName !== "INSERT" || !row?.data?.S || !row.sk?.N) continue;
        const [day, room] = row.pk.S.split("#");
        if (!/^[123]$/.test(room)) continue;
        const group = `${day}#${room}`;
        const previous = updates.get(group);
        updates.set(group, { type: "board", day, room: Number(room), cursor: Math.max(previous?.cursor || 0, Number(row.sk.N)) });
      }
      for (const update of updates.values()) await broadcast(String(update.room), update);
      return;
    }
    const { routeKey, connectionId } = event.requestContext;
    if (routeKey === "$connect") {
      const origin = event.headers?.origin || event.headers?.Origin;
      const room = event.queryStringParameters?.room;
      if (!origins.includes(origin)) return { statusCode: 403 };
      if (!/^[123]$/.test(room || "")) return { statusCode: 400 };
      await send("PutItem", { TableName: table, Item: {
        ...connectionKey(room, connectionId), expires: N(Math.floor(now() / 1000) + 7500),
      } });
    } else if (routeKey === "$disconnect") {
      // The disconnect request does not carry the original query string.
      for (const room of ["1", "2", "3"]) await remove(room, connectionId);
    }
    return { statusCode: 200, body: "ok" };
  };
}

let handler;
exports.handler = async (event) => {
  if (!handler) {
    const db = require("@aws-sdk/client-dynamodb");
    const gateway = require("@aws-sdk/client-apigatewaymanagementapi");
    const client = new db.DynamoDBClient({ maxAttempts: 3 });
    const api = new gateway.ApiGatewayManagementApiClient({ endpoint: process.env.LIVE_ENDPOINT, maxAttempts: 3 });
    handler = createLiveHandler({ table: process.env.CONNECTION_TABLE,
      origins: process.env.ALLOWED_ORIGINS.split(","),
      send: (name, input) => client.send(new db[`${name}Command`](input)),
      post: (ConnectionId, Data) => api.send(new gateway.PostToConnectionCommand({ ConnectionId, Data })),
    });
  }
  return handler(event);
};
exports.createLiveHandler = createLiveHandler;
