import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { parseArgs } from "node:util";
import { mkdir } from "node:fs/promises";
import WebSocket from "ws";

const {values} = parseArgs({options:{profile:{type:"string"},account:{type:"string"},run:{type:"boolean"}}});
if (!values.run || !values.profile || !/^\d{12}$/.test(values.account || "")) throw new Error("Explicit --run --profile --account required");
const base=["--profile",values.profile,"--region","ap-northeast-2","--no-cli-pager"];
const aws=args=>JSON.parse(execFileSync("aws",[...args,...base],{encoding:"utf8"}));
assert.equal(aws(["sts","get-caller-identity"]).Account,values.account);
const stack=aws(["cloudformation","describe-stacks","--stack-name","chillpan"]).Stacks[0];
const outputs=Object.fromEntries(stack.Outputs.map(item=>[item.OutputKey,item.OutputValue]));
const functionName=aws(["cloudformation","describe-stack-resource","--stack-name","chillpan","--logical-resource-id","LiveFunction"]).StackResourceDetail.PhysicalResourceId;
const day=(await (await fetch(`${outputs.SiteUrl}/api/board?room=3`)).json()).day;
const sockets=[], received=[];
try {
  for (const room of [3,3,2]) {
    const socket=new WebSocket(`${outputs.LiveUrl}?room=${room}`,{origin:new URL(outputs.SiteUrl).origin});
    const messages=[]; received.push(messages); sockets.push(socket);
    socket.on("message",data=>messages.push(JSON.parse(String(data))));
    await new Promise((resolve,reject)=>{socket.once("open",resolve);socket.once("error",reject);setTimeout(()=>reject(new Error("Connect timeout")),10000).unref()});
  }
  // Invoke only the broadcaster with an inert cursor=0 hint. No board writes or erasures.
  await mkdir("output/playwright",{recursive:true});
  const payload={Records:[{eventName:"INSERT",dynamodb:{NewImage:{pk:{S:`${day}#3`},sk:{N:"0"},data:{S:"{}"}}}}]};
  const start=Date.now();
  const invocation=aws(["lambda","invoke","--function-name",functionName,"--cli-binary-format","raw-in-base64-out",
    "--payload",JSON.stringify(payload),"output/playwright/live-smoke-response.json"]);
  assert.equal(invocation.StatusCode,200);
  assert.equal(invocation.FunctionError,undefined);
  await new Promise(resolve=>setTimeout(resolve,750));
  for (const messages of received.slice(0,2)) assert.equal(messages.some(message=>message.type==="board" && message.room===3 && message.cursor===0 && message.day===day),true);
  assert.equal(received[2].some(message=>message.room===3 && message.cursor===0),false);
  console.log(JSON.stringify({site:outputs.SiteUrl,connections:3,roomBroadcast:true,roomIsolation:true,boardWrites:0,invokeAndCheckMs:Date.now()-start},null,2));
} finally { for (const socket of sockets) socket.close(); }
