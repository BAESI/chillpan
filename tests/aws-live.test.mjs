import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
const { createLiveHandler } = createRequire(import.meta.url)("../aws/live.cjs");

function fixture(post = async () => {}) {
  const commands = [], messages = [];
  const handler = createLiveHandler({ table: "connections", origins: ["https://chillpan.day"], now: () => 100000,
    send: async (name, input) => {
      commands.push([name, input]);
      if (name === "Query") return { Items: [{connection:{S:"alive"},expires:{N:"200"}}, {connection:{S:"stale"},expires:{N:"1"}}] };
      return {};
    },
    post: async (id, message) => { messages.push([id, JSON.parse(message)]); await post(id, message); },
  });
  return { handler, commands, messages };
}
const connect = (room, origin = "https://chillpan.day") => ({ requestContext: { routeKey: "$connect", connectionId: "abc" }, queryStringParameters: {room}, headers: {origin} });
const record = (room, seq, extra = {}) => ({ eventName:"INSERT", dynamodb: { NewImage: {pk:{S:`2026-10-10#${room}`},sk:{N:String(seq)},data:{S:"{}"}} }, ...extra });

test("live connections validate origin/room, expire and disconnect cleanly", async () => {
  const {handler, commands} = fixture();
  assert.equal((await handler(connect("1", "https://evil.example"))).statusCode, 403);
  assert.equal((await handler(connect("4"))).statusCode, 400);
  assert.equal(commands.length, 0);
  assert.equal((await handler(connect("2"))).statusCode, 200);
  assert.equal(commands[0][1].Item.room.S, "2");
  assert.ok(Number(commands[0][1].Item.expires.N) > 7200);
  await handler({requestContext:{routeKey:"$disconnect",connectionId:"abc"}});
  assert.equal(commands.filter(([name]) => name === "DeleteItem").length, 3);
});

test("stream updates coalesce per room, ignore deletes/counters and skip expired connections", async () => {
  const {handler, messages} = fixture();
  await handler({Records:[record(1,1),record(1,3),record(2,2),record(1,4,{eventName:"REMOVE"}),
    {eventName:"INSERT",dynamodb:{NewImage:{pk:{S:"counter"}}}}]});
  assert.deepEqual(messages.map(([id, msg]) => [id,msg.room,msg.cursor]), [["alive",1,3],["alive",2,2]]);
});

test("gone sockets are cleaned up, other broadcast failures retry through Streams", async () => {
  const gone = fixture(async () => { throw { $metadata:{httpStatusCode:410} }; });
  await gone.handler({Records:[record(1,1)]});
  assert.equal(gone.commands.at(-1)[0], "DeleteItem");
  const failed = fixture(async () => { throw new Error("network"); });
  await assert.rejects(failed.handler({Records:[record(1,1)]}), /network/);
});
