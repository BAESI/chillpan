// Local-only fixture for browser performance, recovery and room-isolation checks.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { WebSocketServer } from "ws";

const day = new Intl.DateTimeFormat("en-CA", {timeZone:"Asia/Seoul",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
const rooms = new Map([1,2,3].map(room => [room, []]));
const seed = Number(process.env.SEED_STROKES || 1500);
for (let i = 0; i < seed; i++) {
  const x = (i % 80) / 80, y = (Math.floor(i / 80) % 30) / 30;
  rooms.get(1).push({ id:i+1,strokeId:`seed-${i}`,room:1,day,color:"#f28eaa",size:.01,
    points:Array.from({length:32},(_,j)=>[Math.min(.99,x+j*.0006),Math.min(.99,y+Math.sin(j/4)*.008+.01)]),
    ...(i % 12 === 11 ? {tool:"eraser"} : {}) });
}
const html = await readFile(".aws-build/web/index.html", "utf8");
const baseline = execFileSync("git", ["show","94dd8fe:public/chillpan/app.js"], {encoding:"utf8"});
const inspect = `\nlet historicalDraws = 0;
const originalDraw = drawStrokeOn;
drawStrokeOn = (...args) => {if (args[0].strokeId.startsWith('seed-')) historicalDraws++;return originalDraw(...args)};
const originalErase = eraseChalk;
let eraserCalls = 0;
eraseChalk = (...args) => {eraserCalls++;return originalErase(...args)};
window.__boardQA = {
  work: () => ({historicalDraws,eraserCalls}), resetWork: () => {historicalDraws=0;eraserCalls=0},
  stats: () => ({shared:sharedStrokes.length, rendered:typeof renderedCount === 'undefined' ? null : renderedCount,
    pending:pendingStrokes.length,optimistic:optimisticStrokes.size,drawing,room:currentRoom,day:dayKey,
    live:typeof liveSocket === 'undefined' ? null : liveSocket?.readyState, busy:boardNeedsReplay}),
  eraser: () => {chalkKind='eraser';chalkRemaining=9600;updateChalkCursor()},
  disconnect: () => liveSocket?.close(),
  sync: () => typeof requestBoardSync === 'undefined' ? pollBoard(boardLoadId) : requestBoardSync()
};`;
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://127.0.0.1:4173");
    if (url.pathname === "/api/board") {
      res.setHeader("content-type", "application/json");
      if (req.method === "POST") {
        let body = ""; for await (const chunk of req) body += chunk;
        for (const stroke of JSON.parse(body).strokes) {
          const rows = rooms.get(stroke.room);
          if (!rows.some(row => row.strokeId === stroke.strokeId)) rows.push({...stroke,id:rows.length+1});
          for (const socket of sockets.clients) if (socket.room === stroke.room && socket.readyState === 1)
            socket.send(JSON.stringify({type:"board",room:stroke.room,day,cursor:rows.length}));
        }
        return res.end(JSON.stringify({saved:true,day}));
      }
      const room = Number(url.searchParams.get("room") || 1), after = Number(url.searchParams.get("after") || 0);
      const remaining = rooms.get(room).filter(row => row.id > after);
      const strokes = remaining.slice(0,500);
      return res.end(JSON.stringify({day,room,strokes,cursor:strokes.at(-1)?.id || after,hasMore:remaining.length>500}));
    }
    if (/^\/(?:[123]\/?|baseline)?$/.test(url.pathname)) {
      res.setHeader("content-type", "text/html");
      const live = html.replace(/data-live-url="[^"]*"/, 'data-live-url=""')
        .replace(/<script async[^>]*><\/script>/, "");
      return res.end(url.pathname === "/baseline" ? live.replace(/src="\/chillpan\/app.js[^\"]*"/, 'src="/baseline-app.js"') :
        live.replace('data-live-url=""', 'data-live-url="ws://127.0.0.1:4173/live"'));
    }
    if (url.pathname === "/baseline-app.js") { res.setHeader("content-type","text/javascript"); return res.end(baseline + inspect); }
    if (url.pathname === "/chillpan/app.js") { res.setHeader("content-type","text/javascript"); return res.end(await readFile("public/chillpan/app.js","utf8") + inspect); }
    if (!/^\/(chillpan\/[a-zA-Z0-9._-]+|favicon.svg)$/.test(url.pathname)) { res.statusCode=404; return res.end(); }
    const types = {js:"text/javascript",css:"text/css",woff2:"font/woff2",svg:"image/svg+xml"};
    res.setHeader("content-type", types[url.pathname.split(".").at(-1)] || "application/octet-stream");
    res.end(await readFile(`public${url.pathname}`));
  } catch (error) { res.statusCode=500; res.end(String(error)); }
});
const sockets = new WebSocketServer({server,path:"/live"});
sockets.on("connection", (socket, req) => { socket.room = Number(new URL(req.url,"http://localhost").searchParams.get("room")); });
server.listen(4173,"127.0.0.1", () => console.log(`Browser fixture ready: http://127.0.0.1:4173 (seed=${seed})`));
