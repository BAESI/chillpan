"use client";

import { useEffect } from "react";

export default function ChalkboardBoot() {
  useEffect(() => {
    if (document.querySelector("script[data-chillpan]")) return;
    const script = document.createElement("script");
    script.type = "module";
    script.src = "/chillpan/app.js";
    script.dataset.chillpan = "true";
    document.body.appendChild(script);
  }, []);
  return null;
}
