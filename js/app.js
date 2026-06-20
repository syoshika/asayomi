/* 朝読み — 画面遷移とロジック。
   フェーズ1: 進行役の1画面で操作し、ovice の画面共有で全員に見せる。 */

(() => {
  const app = document.getElementById("app");

  // 定数（マジックナンバーを集約）
  const DEFAULT_READ_MINUTES = 15; // 黙読の既定時間
  const READ_STEP_MINUTES = 5;     // 黙読時間の増減単位
  const SPEAK_SECONDS = 60;        // 感想シェア 1 人あたりの持ち時間
  const WARN_SECONDS = 30;         // 残りこの秒数で警告色

  // 今日の問い（お題）プリセット
  const QUESTION_PRESETS = [
    "なし",
    "今日の一文を選ぶなら？",
    "自分に当てはまる箇所は？",
    "明日から試せることは？",
    "意外だった点は？",
  ];

  // リアクションの種類
  const REACTIONS = [
    { key: "empathy", emoji: "💛", label: "共感" },
    { key: "insight", emoji: "💡", label: "なるほど" },
    { key: "discovery", emoji: "✨", label: "発見" },
  ];

  // 「明日の一歩」プリセット
  const NEXT_STEPS = [
    { key: "try", emoji: "🚀", label: "試す" },
    { key: "talk", emoji: "🗣", label: "人に話す" },
    { key: "write", emoji: "✍️", label: "書き留める" },
    { key: "reread", emoji: "🔁", label: "もう一度読む" },
  ];

  // セッションの作業中データ（保存前の状態）
  let draft = null;
  let timer = null; // setInterval ハンドル

  // ---- 画面: ホーム / 準備 ----
  function renderHome() {
    clearTimer();
    const book = Store.getCurrentBook();
    if (!book) {
      app.innerHTML = `<div class="card center"><p>本が登録されていません。</p>
        <button class="primary-btn" id="add-book">本を登録する</button></div>`;
      document.getElementById("add-book").onclick = editBook;
      return;
    }

    const start = Store.getLastEndPage(book.id);
    // 既定の終了ページ: 開始 +10p（総ページを超えない）
    const defaultEnd = Math.min(start + 10, book.totalPages);

    draft = {
      bookId: book.id,
      date: Store.today(),
      startPage: start,
      endPage: defaultEnd,
      question: "なし",
      reactions: { empathy: 0, insight: 0, discovery: 0 },
      nextSteps: [],
      order: [],
      durationMin: DEFAULT_READ_MINUTES,
    };

    app.innerHTML = `
      <div class="card">
        <p class="section-label">今読んでいる本</p>
        <p class="book-title">${escapeHtml(book.title)}</p>
        <p class="book-meta">${escapeHtml(book.author)} ／ 全 ${book.totalPages}p</p>
        <div class="progress" style="margin-top:14px">
          <span style="width:${pct(start, book.totalPages)}%"></span>
        </div>
        <p class="muted center" style="margin-top:6px">${start} / ${book.totalPages}p まで到達</p>
      </div>

      <div class="card">
        <p class="section-label">今日読む範囲</p>
        <div class="range-row">
          <span class="num" id="lbl-start">${start}</span>
          <span class="muted">〜</span>
          <span class="num" id="lbl-end">${defaultEnd}</span>
          <span class="muted">p</span>
        </div>
        <input type="range" id="end-range" min="${start}" max="${book.totalPages}" value="${defaultEnd}" />
        <p class="muted center" id="lbl-count">${defaultEnd - start} ページ</p>
      </div>

      <div class="card">
        <p class="section-label">今日の問い（任意）</p>
        <div class="chips" id="question-chips">
          ${QUESTION_PRESETS.map((q, i) => `<button class="chip ${i === 0 ? "selected" : ""}" data-q="${escapeHtml(q)}">${escapeHtml(q)}</button>`).join("")}
        </div>
      </div>

      <button class="primary-btn big-btn" id="btn-start">黙読スタート ▶</button>
    `;

    const range = document.getElementById("end-range");
    range.oninput = () => {
      draft.endPage = parseInt(range.value, 10);
      document.getElementById("lbl-end").textContent = draft.endPage;
      document.getElementById("lbl-count").textContent = (draft.endPage - draft.startPage) + " ページ";
    };

    document.querySelectorAll("#question-chips .chip").forEach((chip) => {
      chip.onclick = () => {
        document.querySelectorAll("#question-chips .chip").forEach((c) => c.classList.remove("selected"));
        chip.classList.add("selected");
        draft.question = chip.dataset.q;
      };
    });

    document.getElementById("btn-start").onclick = renderTimer;
  }

  // ---- 画面: 黙読タイマー ----
  function renderTimer() {
    clearTimer();
    let remaining = draft.durationMin * 60;
    let running = false;

    app.innerHTML = `
      <div class="card center">
        <p class="section-label">黙読タイム</p>
        <div class="timer-display" id="clock">${fmt(remaining)}</div>
        <p class="timer-sub">${draft.startPage}〜${draft.endPage}p ／ ${draft.question !== "なし" ? escapeHtml(draft.question) : "じっくり読みましょう"}</p>
        <div class="stepper" style="margin-bottom:20px">
          <button id="minus">−</button>
          <span class="value" id="min-val">${draft.durationMin}分</span>
          <button id="plus">＋</button>
        </div>
        <div class="timer-controls">
          <button class="primary-btn" id="toggle">スタート</button>
          <button class="secondary-btn" id="skip">感想へ ▶</button>
        </div>
      </div>
    `;

    const clock = document.getElementById("clock");
    const toggleBtn = document.getElementById("toggle");

    function updateClock() {
      clock.textContent = fmt(remaining);
      clock.classList.toggle("warn", remaining <= WARN_SECONDS);
    }

    document.getElementById("plus").onclick = () => {
      if (running) return;
      draft.durationMin += READ_STEP_MINUTES;
      remaining = draft.durationMin * 60;
      document.getElementById("min-val").textContent = draft.durationMin + "分";
      updateClock();
    };
    document.getElementById("minus").onclick = () => {
      if (running || draft.durationMin <= READ_STEP_MINUTES) return;
      draft.durationMin -= READ_STEP_MINUTES;
      remaining = draft.durationMin * 60;
      document.getElementById("min-val").textContent = draft.durationMin + "分";
      updateClock();
    };

    toggleBtn.onclick = () => {
      if (running) {
        clearTimer();
        running = false;
        toggleBtn.textContent = "再開";
      } else {
        running = true;
        toggleBtn.textContent = "一時停止";
        timer = setInterval(() => {
          remaining--;
          updateClock();
          if (remaining <= 0) {
            clearTimer();
            renderShare();
          }
        }, 1000);
      }
    };

    document.getElementById("skip").onclick = () => { clearTimer(); renderShare(); };
  }

  // ---- 画面: 感想シェア ----
  function renderShare() {
    clearTimer();
    // 参加者の順番をランダム化
    draft.order = shuffle(Store.getParticipants().map((p) => p.id));
    let currentIndex = 0;
    let remaining = SPEAK_SECONDS;

    function participantById(id) {
      return Store.getParticipants().find((p) => p.id === id);
    }

    function drawList() {
      return draft.order.map((id, i) => {
        const p = participantById(id);
        const cls = i === currentIndex ? "current" : (i < currentIndex ? "done" : "");
        const mark = i < currentIndex ? "✓" : (i === currentIndex ? "🎙" : (i + 1));
        return `<li class="${cls}"><span class="av">${p.icon}</span>${escapeHtml(p.name)}
          <span class="muted" style="margin-left:auto">${mark}</span></li>`;
      }).join("");
    }

    function render() {
      app.innerHTML = `
        <div class="card center">
          <p class="section-label">感想シェア</p>
          <div class="timer-display" id="spk-clock">${fmt(remaining)}</div>
          <p class="timer-sub" id="spk-name"></p>
          <div class="timer-controls">
            <button class="primary-btn" id="next">次の人へ ▶</button>
            <button class="secondary-btn" id="reshuffle">順番を変える 🔀</button>
          </div>
        </div>

        <div class="card">
          <p class="section-label">順番</p>
          <ul class="speaker-list" id="list">${drawList()}</ul>
        </div>

        <div class="card center">
          <p class="section-label">リアクション（タップで集計）</p>
          <div class="reactions" id="reactions">
            ${REACTIONS.map((r) => `<button class="reaction-btn" data-k="${r.key}">
              <span class="emoji">${r.emoji}</span>${r.label}
              <span class="count" id="cnt-${r.key}">${draft.reactions[r.key]}</span></button>`).join("")}
          </div>
        </div>

        <button class="primary-btn big-btn" id="to-summary">読書会をまとめる ▶</button>
      `;
      updateName();
      startSpeakerTimer();

      document.getElementById("next").onclick = nextSpeaker;
      document.getElementById("reshuffle").onclick = () => {
        draft.order = shuffle(draft.order);
        currentIndex = 0;
        remaining = SPEAK_SECONDS;
        render();
      };
      document.querySelectorAll("#reactions .reaction-btn").forEach((btn) => {
        btn.onclick = () => {
          const k = btn.dataset.k;
          draft.reactions[k]++;
          document.getElementById("cnt-" + k).textContent = draft.reactions[k];
        };
      });
      document.getElementById("to-summary").onclick = () => { clearTimer(); renderSummary(); };
    }

    function updateName() {
      const p = participantById(draft.order[currentIndex]);
      const el = document.getElementById("spk-name");
      if (el) el.textContent = p ? `${p.icon} ${p.name} さん（${currentIndex + 1}/${draft.order.length}）` : "";
    }

    function startSpeakerTimer() {
      clearTimer();
      const clock = document.getElementById("spk-clock");
      timer = setInterval(() => {
        remaining--;
        if (clock) {
          clock.textContent = fmt(remaining);
          clock.classList.toggle("warn", remaining <= 10);
        }
        if (remaining <= 0) clearTimer();
      }, 1000);
    }

    function nextSpeaker() {
      if (currentIndex < draft.order.length - 1) {
        currentIndex++;
        remaining = SPEAK_SECONDS;
        document.getElementById("list").innerHTML = drawList();
        updateName();
        startSpeakerTimer();
      } else {
        clearTimer();
        renderSummary();
      }
    }

    render();
  }

  // ---- 画面: サマリー / クロージング ----
  function renderSummary() {
    clearTimer();
    const book = Store.getCurrentBook();
    const pagesRead = draft.endPage - draft.startPage;
    const streakAfter = Store.getStreak() + (isTodaySaved() ? 0 : 1);

    app.innerHTML = `
      <div class="card">
        <p class="section-label">今日のまとめ</p>
        <div class="stat-row">
          <div class="stat"><div class="n">${pagesRead}</div><div class="l">読んだページ</div></div>
          <div class="stat"><div class="n">${pct(draft.endPage, book.totalPages)}%</div><div class="l">本の到達率</div></div>
          <div class="stat"><div class="n">${streakAfter}</div><div class="l">連続開催日</div></div>
        </div>
        <div class="progress" style="margin-top:18px">
          <span style="width:${pct(draft.endPage, book.totalPages)}%"></span>
        </div>
        <p class="muted center" style="margin-top:6px">${draft.endPage} / ${book.totalPages}p</p>
      </div>

      <div class="card center">
        <p class="section-label">今日のリアクション合計</p>
        <div class="reactions">
          ${REACTIONS.map((r) => `<div class="reaction-btn"><span class="emoji">${r.emoji}</span>${r.label}
            <span class="count">${draft.reactions[r.key]}</span></div>`).join("")}
        </div>
      </div>

      <div class="card">
        <p class="section-label">明日の一歩（みんなで選ぶ）</p>
        <div class="chips" id="step-chips">
          ${NEXT_STEPS.map((s) => `<button class="chip" data-k="${s.key}">${s.emoji} ${s.label}</button>`).join("")}
        </div>
        <p class="muted" style="margin-top:8px">タップした回数を記録します</p>
      </div>

      <button class="primary-btn big-btn" id="save">保存して終了 ✓</button>
      ${book.status === "reading" && draft.endPage >= book.totalPages
        ? `<button class="secondary-btn big-btn" id="finish-book" style="margin-top:12px">この本を読了にする 🎉</button>` : ""}
    `;

    // 「明日の一歩」はタップ回数を nextSteps に積む（フェーズ1は集計値として保持）
    const stepCounts = {};
    document.querySelectorAll("#step-chips .chip").forEach((chip) => {
      chip.onclick = () => {
        const k = chip.dataset.k;
        stepCounts[k] = (stepCounts[k] || 0) + 1;
        chip.classList.add("selected");
        chip.textContent = chip.textContent.replace(/ ×\d+$/, "") + ` ×${stepCounts[k]}`;
      };
    });

    document.getElementById("save").onclick = () => {
      draft.nextSteps = Object.entries(stepCounts).map(([step, count]) => ({ step, count }));
      Store.addSession({ id: "session_" + draft.date + "_" + Date.now(), ...draft, participants: draft.order });
      alert("保存しました。お疲れさまでした！");
      renderHome();
    };

    const finishBtn = document.getElementById("finish-book");
    if (finishBtn) {
      finishBtn.onclick = () => {
        book.status = "finished";
        book.finishedAt = Store.today();
        Store.saveBook(book);
        alert("読了おめでとうございます！次の本は「本を編集」から登録できます。");
        renderHome();
      };
    }
  }

  // 今日のセッションが既に保存済みか（ストリーク二重カウント防止）
  function isTodaySaved() {
    return Store.getSessions().some((s) => s.date === Store.today());
  }

  // ---- データ管理（モーダル） ----
  function setupDataModal() {
    const modal = document.getElementById("data-modal");
    document.getElementById("btn-data").onclick = () => modal.classList.remove("hidden");
    document.getElementById("btn-close-modal").onclick = () => modal.classList.add("hidden");

    document.getElementById("btn-export").onclick = () => {
      const blob = new Blob([JSON.stringify(Store.exportAll(), null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `asayomi_${Store.today()}.json`;
      a.click();
      URL.revokeObjectURL(url);
    };

    document.getElementById("file-import").onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          Store.importAll(JSON.parse(reader.result));
          alert("インポートしました。");
          modal.classList.add("hidden");
          renderHome();
        } catch (err) {
          alert("読み込みに失敗しました: " + err.message);
        }
      };
      reader.readAsText(file);
    };

    // 参加者編集（セットアップ時のみ。日常操作ではないので prompt を許容）
    document.getElementById("btn-edit-participants").onclick = () => {
      const list = Store.getParticipants();
      const names = prompt("参加者名をカンマ区切りで入力（アイコンは自動割り当て）", list.map((p) => p.name).join(", "));
      if (names === null) return;
      const icons = ["🦊", "🐧", "🐱", "🐰", "🦉", "🐢", "🐳", "🦔", "🐝", "🦋", "🐙", "🦜"];
      const next = names.split(",").map((n) => n.trim()).filter(Boolean).map((name, i) => ({
        id: "p" + (i + 1), name, icon: icons[i % icons.length], joinedAt: Store.today(),
      }));
      if (next.length) { Store.saveParticipants(next); alert("更新しました。"); }
    };

    // 本編集（セットアップ時のみ。総ページのみ数値入力を許容）
    document.getElementById("btn-edit-book").onclick = () => {
      const book = Store.getCurrentBook();
      const title = prompt("本のタイトル", book ? book.title : "");
      if (title === null) return;
      const author = prompt("著者", book ? book.author : "") || "";
      const total = parseInt(prompt("総ページ数", book ? book.totalPages : "200"), 10);
      if (!title || !total) return;
      if (book && book.status === "reading" && title === book.title) {
        book.title = title; book.author = author; book.totalPages = total;
        Store.saveBook(book);
      } else {
        Store.saveBook({ id: "book_" + Date.now(), title, author, totalPages: total, status: "reading", startedAt: Store.today(), finishedAt: null });
      }
      modal.classList.add("hidden");
      renderHome();
    };
  }

  // ---- ユーティリティ ----
  function clearTimer() { if (timer) { clearInterval(timer); timer = null; } }
  function fmt(sec) {
    const s = Math.max(0, sec);
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}:${String(r).padStart(2, "0")}`;
  }
  function pct(a, b) { return b > 0 ? Math.round((a / b) * 100) : 0; }
  function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  // 起動
  setupDataModal();
  renderHome();
})();
