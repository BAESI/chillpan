import { createHash } from "node:crypto";

// Supply the short-lived Sites service token over hidden stdin, never arguments or files.
if (process.stdin.isTTY) process.stdin.setRawMode(true);
process.stdout.write("Ready for migration JSON on hidden stdin.\n");
let input = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) {
  input += chunk;
  if (!input.includes("\n")) continue;
  process.stdin.pause();
  try {
    const { sourceOrigin, sourceToken, targetOrigin } = JSON.parse(input);
    const source = new URL(sourceOrigin);
    const target = new URL(targetOrigin);
    if (source.protocol !== "https:" || target.protocol !== "https:" || !source.hostname.endsWith(".chatgpt.site")) throw new Error("Invalid migration origins");
    const counts = [];
    let day;
    for (const room of [1, 2, 3]) {
      let cursor = 0;
      let count = 0;
      let hasMore = true;
      while (hasMore) {
        const url = new URL(`/api/board?room=${room}&after=${cursor}`, source);
        const response = await fetch(url, { headers: { "OAI-Sites-Authorization": `Bearer ${sourceToken}` }, redirect: "error" });
        if (!response.ok) throw new Error(`Source status ${response.status}`);
        const data = await response.json();
        if (day && data.day !== day) throw new Error("Midnight crossed; restart migration");
        day = data.day;
        if (!Array.isArray(data.strokes)) throw new Error("Invalid source response");
        for (let start = 0; start < data.strokes.length; start += 32) {
          const body = JSON.stringify({ strokes: data.strokes.slice(start, start + 32) });
          const hash = createHash("sha256").update(body).digest("hex");
          let saved = false;
          for (let attempt = 0; attempt < 8; attempt++) {
            const result = await fetch(new URL("/api/board", target), {
              method: "POST", redirect: "error",
              headers: { "content-type": "application/json", "x-amz-content-sha256": hash }, body,
            });
            if (result.ok) { saved = true; break; }
            if (![429, 503].includes(result.status)) throw new Error(`Target status ${result.status}`);
            await new Promise((r) => setTimeout(r, Math.min(1000 * 2 ** attempt, 10000)));
          }
          if (!saved) throw new Error("Target remained busy; rerunning safely resumes by stroke ID");
        }
        count += data.strokes.length;
        if (data.hasMore && data.cursor <= cursor) throw new Error("Source cursor did not advance");
        cursor = data.cursor;
        hasMore = data.hasMore;
      }
      counts.push({ room, copied: count });
    }
    console.log(JSON.stringify({ day, boards: counts }));
    process.exit(0);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
