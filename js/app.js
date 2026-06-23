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
    const pagesPerSession = Store.getPagesPerSession(); // 1 回で読むページ数（前回値）
    // 既定の終了ページ: 開始 + 1 回で読むページ数（総ページを超えない）
    const defaultEnd = Math.min(start + pagesPerSession, book.totalPages);

    draft = {
      bookId: book.id,
      date: Store.today(),
      startPage: start,
      endPage: defaultEnd,
      pagesPerSession: pagesPerSession,
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

        <p class="muted" style="margin:10px 0 2px">開始ページ</p>
        <input type="range" id="start-range" min="1" max="${book.totalPages}" value="${start}" />
        <div class="center">
          <button class="chip" id="btn-reset-start">前回の続き（${start}p）に戻す</button>
        </div>

        <p class="muted center" style="margin:18px 0 6px">1回で読むページ数</p>
        <div class="stepper">
          <button id="pages-minus">−</button>
          <span class="value" id="pages-val">${defaultEnd - start}<span style="font-size:20px">p</span></span>
          <button id="pages-plus">＋</button>
        </div>

        <p class="muted" style="margin:18px 0 2px">終了ページ</p>
        <input type="range" id="end-range" min="${start}" max="${book.totalPages}" value="${defaultEnd}" />
      </div>

      <div class="card">
        <p class="section-label">今日の問い（任意）</p>
        <div class="chips" id="question-chips">
          ${QUESTION_PRESETS.map((q, i) => `<button class="chip ${i === 0 ? "selected" : ""}" data-q="${escapeHtml(q)}">${escapeHtml(q)}</button>`).join("")}
        </div>
      </div>

      <button class="primary-btn big-btn" id="btn-start">黙読スタート ▶</button>
    `;

    const startRange = document.getElementById("start-range");
    const endRange = document.getElementById("end-range");

    // draft の値をスライダー・ラベルへ反映する
    function syncUI() {
      startRange.value = draft.startPage;
      endRange.min = draft.startPage;
      endRange.value = draft.endPage;
      document.getElementById("lbl-start").textContent = draft.startPage;
      document.getElementById("lbl-end").textContent = draft.endPage;
      // 「1回で読むページ数」は実際の範囲（終了 − 開始）を表示
      document.getElementById("pages-val").innerHTML =
        Math.max(0, draft.endPage - draft.startPage) + '<span style="font-size:20px">p</span>';
    }

    // 開始ページ変更 → 終了ページ＝開始＋1回で読むページ数（総ページ上限）
    startRange.oninput = () => {
      draft.startPage = parseInt(startRange.value, 10);
      draft.endPage = Math.min(draft.startPage + draft.pagesPerSession, book.totalPages);
      syncUI();
    };

    // 終了ページ変更 → 1回で読むページ数を連動更新
    endRange.oninput = () => {
      draft.endPage = parseInt(endRange.value, 10);
      draft.pagesPerSession = Math.max(1, draft.endPage - draft.startPage);
      syncUI();
    };

    // 「1回で読むページ数」を増減 → 終了ページ＝開始＋ページ数
    document.getElementById("pages-plus").onclick = () => {
      draft.pagesPerSession++;
      draft.endPage = Math.min(draft.startPage + draft.pagesPerSession, book.totalPages);
      syncUI();
    };
    document.getElementById("pages-minus").onclick = () => {
      if (draft.pagesPerSession <= 1) return;
      draft.pagesPerSession--;
      draft.endPage = Math.min(draft.startPage + draft.pagesPerSession, book.totalPages);
      syncUI();
    };

    // 「前回の続き」に戻す（開始を前回末へ、終了はページ数に追従）
    document.getElementById("btn-reset-start").onclick = () => {
      draft.startPage = start;
      draft.endPage = Math.min(start + draft.pagesPerSession, book.totalPages);
      syncUI();
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
    // 参加者の順番は名前の数字順（自然順）で初期化。「順番を変える」でランダム化できる。
    draft.order = sortByName(Store.getParticipants()).map((p) => p.id);
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
        return `<li class="${cls}" data-i="${i}"><span class="av">${p.icon}</span>${escapeHtml(p.name)}
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
      // リストの人をクリックして話者を選ぶ
      document.getElementById("list").onclick = (e) => {
        const li = e.target.closest("li[data-i]");
        if (li) selectSpeaker(parseInt(li.dataset.i, 10));
      };
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

    // クリックで指定の人を話者にする
    function selectSpeaker(i) {
      if (i < 0 || i >= draft.order.length) return;
      currentIndex = i;
      remaining = SPEAK_SECONDS;
      document.getElementById("list").innerHTML = drawList();
      updateName();
      startSpeakerTimer();
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
      // 今回の「1回で読むページ数」を次回の既定値として記憶
      Store.setPagesPerSession(draft.pagesPerSession);
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

  // ---- 画面: 履歴 ----
  function renderHistory() {
    clearTimer();
    const sessions = Store.getSessions();
    const books = Store.getBooks();

    if (sessions.length === 0) {
      app.innerHTML = `
        <div class="card center">
          <p class="section-label">これまでの記録</p>
          <p class="muted" style="font-size:18px;margin:8px 0 20px">まだ記録がありません。<br>読書会を1回ひらくとここに残ります。</p>
          <button class="primary-btn" id="back-home">← ホームに戻る</button>
        </div>`;
      document.getElementById("back-home").onclick = renderHome;
      return;
    }

    // 全体の集計
    const heldDays = new Set(sessions.map((s) => s.date)).size;
    const totalPages = sessions.reduce((sum, s) => sum + Math.max(0, s.endPage - s.startPage), 0);
    const finishedBooks = books.filter((b) => b.status === "finished").length;

    app.innerHTML = `
      <div class="card row-between" style="padding:18px 28px">
        <p class="section-label" style="margin:0">これまでの記録</p>
        <button class="ghost-btn" id="back-home">← ホームに戻る</button>
      </div>

      <div class="card">
        <p class="section-label">全体</p>
        <div class="stat-row">
          <div class="stat"><div class="n">${heldDays}</div><div class="l">開催日数</div></div>
          <div class="stat"><div class="n">${totalPages}</div><div class="l">累計ページ</div></div>
          <div class="stat"><div class="n">${Store.getStreak()}</div><div class="l">連続開催日</div></div>
          <div class="stat"><div class="n">${finishedBooks}</div><div class="l">読了した本</div></div>
        </div>
      </div>

      <div class="card">
        <p class="section-label">本ごとの軌跡</p>
        ${books.map((b) => {
          const st = Store.getBookStats(b.id);
          const badge = b.status === "finished" ? `<span class="badge done">読了 🎉</span>` : `<span class="badge">読書中</span>`;
          return `
            <div class="book-track">
              <div class="row-between">
                <span class="book-track-title">${escapeHtml(b.title)} ${badge}</span>
                <span class="muted">${st.count}回・累計${st.totalRead}p</span>
              </div>
              <div class="progress" style="margin-top:8px">
                <span style="width:${pct(st.reached, b.totalPages)}%"></span>
              </div>
              <p class="muted" style="margin:4px 0 0;font-size:13px">${st.reached} / ${b.totalPages}p（${pct(st.reached, b.totalPages)}%）</p>
            </div>`;
        }).join("")}
      </div>

      <div class="card">
        <p class="section-label">カレンダー</p>
        <div id="calendar"></div>
      </div>

      <div class="card">
        <p class="section-label">セッション履歴</p>
        <ul class="session-list">
          ${[...sessions].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : (a.id < b.id ? 1 : -1)))
            .map((s) => {
              const book = books.find((b) => b.id === s.bookId);
              const r = s.reactions || {};
              const rTotal = (r.empathy || 0) + (r.insight || 0) + (r.discovery || 0);
              return `
                <li class="session-row">
                  <div class="session-date">${fmtDateLabel(s.date)}</div>
                  <div class="session-main">
                    <div class="session-book">${book ? escapeHtml(book.title) : "（不明な本）"}</div>
                    <div class="muted">${s.startPage}→${s.endPage}p（${Math.max(0, s.endPage - s.startPage)}p）${s.question && s.question !== "なし" ? "・" + escapeHtml(s.question) : ""}</div>
                  </div>
                  <div class="session-react muted">${rTotal > 0 ? "💛" + (r.empathy || 0) + " 💡" + (r.insight || 0) + " ✨" + (r.discovery || 0) : "—"}</div>
                </li>`;
            }).join("")}
        </ul>
      </div>
    `;

    document.getElementById("back-home").onclick = renderHome;
    renderCalendar(new Date());
  }

  // 履歴カレンダー（月送り）。開催日をハイライトし、ページ数をセルに表示する。
  function renderCalendar(monthDate) {
    const wrap = document.getElementById("calendar");
    if (!wrap) return;

    const year = monthDate.getFullYear();
    const month = monthDate.getMonth(); // 0-11

    // その月の開催日 → 読んだページ数 のマップ
    const pagesByDate = {};
    Store.getSessions().forEach((s) => {
      pagesByDate[s.date] = (pagesByDate[s.date] || 0) + Math.max(0, s.endPage - s.startPage);
    });

    const firstWeekday = new Date(year, month, 1).getDay(); // 0=日
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const todayStr = Store.today();

    const weekHead = ["日", "月", "火", "水", "木", "金", "土"]
      .map((d) => `<div class="cal-head">${d}</div>`).join("");

    let cells = "";
    for (let i = 0; i < firstWeekday; i++) cells += `<div class="cal-cell empty"></div>`;
    for (let d = 1; d <= daysInMonth; d++) {
      const ds = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const held = ds in pagesByDate;
      const isToday = ds === todayStr;
      cells += `<div class="cal-cell${held ? " held" : ""}${isToday ? " today" : ""}">
        <span class="cal-day">${d}</span>
        ${held ? `<span class="cal-pages">${pagesByDate[ds]}p</span>` : ""}
      </div>`;
    }

    wrap.innerHTML = `
      <div class="cal-nav row-between">
        <button class="ghost-btn" id="cal-prev">←</button>
        <span class="cal-month">${year}年 ${month + 1}月</span>
        <button class="ghost-btn" id="cal-next">→</button>
      </div>
      <div class="cal-grid">${weekHead}${cells}</div>
    `;

    document.getElementById("cal-prev").onclick = () => renderCalendar(new Date(year, month - 1, 1));
    document.getElementById("cal-next").onclick = () => renderCalendar(new Date(year, month + 1, 1));
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
  // "2026-06-20" → "6/20 (土)"
  function fmtDateLabel(ds) {
    const d = new Date(ds + "T00:00:00");
    const wd = ["日", "月", "火", "水", "木", "金", "土"][d.getDay()];
    return `${d.getMonth() + 1}/${d.getDate()} (${wd})`;
  }
  function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  // 名前を自然順（参加者2 < 参加者10）で並べ替える
  function sortByName(participants) {
    return [...participants].sort((a, b) =>
      a.name.localeCompare(b.name, "ja", { numeric: true })
    );
  }
  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  // 起動
  setupDataModal();
  document.getElementById("btn-history").onclick = renderHistory;
  renderHome();
})();
