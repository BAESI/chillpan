import ChalkboardBoot from "./chalkboard-boot";
import { Mail } from "lucide-react";

export default function Home() {
  return <>
    <main className="app-shell">
      <canvas id="chalkboard" aria-label="함께 그리는 칠판" />
      <canvas id="chalkDust" aria-hidden="true" />
      <p className="board-motto">하루 지나면 다 지운다</p>
      <div className="board-controls">
        <button className="new-chalk" id="newChalkButton" type="button">
          <span className="chalk-swatch" aria-hidden="true" />
          <span id="newChalkLabel">새 분필</span>
        </button>
        <select id="roomSelect" aria-label="칠판 이동" defaultValue="1">
          <option value="1">1반</option>
          <option value="2">2반</option>
          <option value="3">3반</option>
        </select>
        <label className="sound-toggle">
          <input id="soundToggle" type="checkbox" defaultChecked />
          <span id="soundLabel">소리</span>
        </label>
        <a className="feedback-button" id="feedbackButton"
          href={`mailto:baesi4879@gmail.com?subject=${encodeURIComponent("Chillpan 피드백")}`}
          aria-label="피드백 보내기" title="피드백 보내기">
          <Mail size={18} aria-hidden="true" />
        </a>
      </div>
      <div className="chalk-tray" aria-hidden="true" />
      <div className="chalk-cursor" id="chalkCursor" aria-hidden="true"><span /></div>
      <div className="notice is-hidden" id="notice" role="status" aria-live="polite" />
    </main>
    <ChalkboardBoot />
  </>;
}
