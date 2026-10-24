/* 朝読み — データ層。localStorage をラップし、本・参加者・セッションを管理する。
   フェーズ2でバックエンド(Supabase 等)へ移行できるよう、データ構造は SPEC.md に準拠する。 */

const Store = (() => {
  // localStorage キー
  const KEYS = {
    books: "asayomi.books",
    sessions: "asayomi.sessions",
    participants: "asayomi.participants",
    settings: "asayomi.settings",
    draft: "asayomi.draft", // 進行中セッションの一時退避（保存忘れ・復帰用）
  };

  const DEFAULT_PAGES_PER_SESSION = 10; // 1 回で読むページ数の既定値

  // 内部ユーティリティ
  function read(key) {
    try {
      return JSON.parse(localStorage.getItem(key)) || [];
    } catch (e) {
      return [];
    }
  }
  function write(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  // 初回起動時のシードデータ
  function seedIfEmpty() {
    if (read(KEYS.books).length === 0) {
      write(KEYS.books, [
        {
          id: "book_001",
          title: "GIVE & TAKE",
          author: "アダム・グラント",
          totalPages: 376,
          status: "reading",
          startedAt: today(),
          finishedAt: null,
        },
      ]);
    }
    if (read(KEYS.participants).length === 0) {
      const icons = ["🦊", "🐧", "🐱", "🐰", "🦉", "🐢", "🐳", "🦔", "🐝", "🦋"];
      const seed = icons.map((icon, i) => ({
        id: "p" + (i + 1),
        name: "参加者" + (i + 1),
        icon,
        joinedAt: today(),
      }));
      write(KEYS.participants, seed);
    }
  }

  // 今日の日付 (YYYY-MM-DD)
  function today() {
    return new Date().toLocaleDateString("sv-SE"); // ローカルタイムで ISO 形式
  }

  // --- 本 ---
  function getBooks() { return read(KEYS.books); }
  function getCurrentBook() {
    const books = read(KEYS.books);
    return books.find((b) => b.status === "reading") || books[0] || null;
  }
  function saveBook(book) {
    const books = read(KEYS.books);
    const idx = books.findIndex((b) => b.id === book.id);
    if (idx >= 0) books[idx] = book; else books.push(book);
    write(KEYS.books, books);
  }
  // 新しい本に切り替えるとき、読書中だった本を「中断(paused)」にする。
  // （読了 finished とは区別する。履歴は残り、現在の本は新しい1冊だけになる）
  function pauseReadingBooks() {
    const books = read(KEYS.books);
    let changed = false;
    books.forEach((b) => {
      if (b.status === "reading") { b.status = "paused"; changed = true; }
    });
    if (changed) write(KEYS.books, books);
  }

  // 既存の本に切り替える（本棚から選び直す）。
  // 対象を読書中にし、他の読書中は中断へ。中断・読了した本の続きから再開できる。
  function setCurrentBook(bookId) {
    const books = read(KEYS.books);
    books.forEach((b) => {
      if (b.id === bookId) {
        b.status = "reading";
        b.finishedAt = null; // 読了本を読み直す場合に備える
      } else if (b.status === "reading") {
        b.status = "paused";
      }
    });
    write(KEYS.books, books);
  }

  // --- 参加者 ---
  function getParticipants() { return read(KEYS.participants); }
  function saveParticipants(list) { write(KEYS.participants, list); }

  // --- セッション ---
  function getSessions() { return read(KEYS.sessions); }
  function getSessionsByBook(bookId) {
    return read(KEYS.sessions).filter((s) => s.bookId === bookId);
  }
  // 指定の本で「前回読み終えたページ」（次回の開始ページ初期値に使う）。
  // 全セッションの最大値ではなく、最新セッションの endPage を返す。
  // （読み返しなどで end を戻しても、その変更が翌日に反映されるようにするため）
  function getLastEndPage(bookId) {
    const sessions = getSessionsByBook(bookId);
    if (sessions.length === 0) return 1;
    // 日付の新しい順、同日なら id（保存時刻を含む）の新しい順に並べ、先頭を採用
    const latest = sessions.slice().sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      return a.id < b.id ? 1 : -1;
    })[0];
    return latest.endPage;
  }
  // セッションを追加 or 同一idを上書き（サマリーでの自動保存・追記更新に使う）
  function upsertSession(session) {
    const sessions = read(KEYS.sessions);
    const idx = sessions.findIndex((s) => s.id === session.id);
    if (idx >= 0) sessions[idx] = session; else sessions.push(session);
    write(KEYS.sessions, sessions);
  }

  // --- 進行中セッションの一時退避（保存忘れ・タブ復帰用） ---
  function saveWorkingDraft(d) { localStorage.setItem(KEYS.draft, JSON.stringify(d)); }
  function getWorkingDraft() {
    try { return JSON.parse(localStorage.getItem(KEYS.draft)); } catch (e) { return null; }
  }
  function clearWorkingDraft() { localStorage.removeItem(KEYS.draft); }

  // 履歴用の集計。本ごとの軌跡（開催回数・累計ページ・到達ページ）を返す。
  function getBookStats(bookId) {
    const sessions = getSessionsByBook(bookId);
    const reached = sessions.length ? getLastEndPage(bookId) : 1;
    const totalRead = sessions.reduce(
      (sum, s) => sum + Math.max(0, s.endPage - s.startPage),
      0
    );
    return { count: sessions.length, reached, totalRead };
  }

  // "YYYY-MM-DD" をローカル日付として Date に変換（タイムゾーンずれ防止）
  function parseLocalDate(ds) { return new Date(ds + "T00:00:00"); }
  function toYMD(d) {
    return d.getFullYear() + "-" +
      String(d.getMonth() + 1).padStart(2, "0") + "-" +
      String(d.getDate()).padStart(2, "0");
  }
  // 指定日の「ひとつ前の開催対象日」。お休みの曜日(restDays)はスキップする。
  function prevOpenDay(ds, restDays) {
    const d = parseLocalDate(ds);
    do { d.setDate(d.getDate() - 1); } while (restDays.includes(d.getDay()));
    return toYMD(d);
  }

  // 連続開催日数（ストリーク）。最新の開催日から遡って連続している「開催日」を数える。
  // お休みの曜日（土日など）は間に挟まっても連続を途切れさせない。
  // extraDate を渡すと、その日も開催済みとみなして数える（保存前の当日見込み用）。
  function getStreak(extraDate) {
    const restDays = getRestDays();
    const set = new Set(read(KEYS.sessions).map((s) => s.date));
    if (extraDate) set.add(extraDate);
    const dates = [...set].sort().reverse();
    if (dates.length === 0) return 0;
    let streak = 1;
    for (let i = 0; i < dates.length - 1; i++) {
      // dates[i] の直前の開催対象日が dates[i+1] と一致すれば連続（お休み曜日は飛ばす）
      if (prevOpenDay(dates[i], restDays) === dates[i + 1]) streak++;
      else break;
    }
    return streak;
  }

  // --- 設定 ---
  function getSettings() {
    try {
      return JSON.parse(localStorage.getItem(KEYS.settings)) || {};
    } catch (e) {
      return {};
    }
  }
  // 1 回で読むページ数（前回の値を覚える）
  function getPagesPerSession() {
    const s = getSettings();
    return s.pagesPerSession || DEFAULT_PAGES_PER_SESSION;
  }
  function setPagesPerSession(n) {
    const s = getSettings();
    s.pagesPerSession = n;
    write(KEYS.settings, s);
  }
  // 読書会お休みの曜日（0=日 … 6=土）。連続開催のカウント対象外。既定は土日。
  function getRestDays() {
    const s = getSettings();
    return Array.isArray(s.restDays) ? s.restDays : [0, 6];
  }
  function setRestDays(arr) {
    const s = getSettings();
    s.restDays = arr;
    write(KEYS.settings, s);
  }
  // ひとりモード（感想シェアを省略する完全個人利用）
  function getSoloMode() { return !!getSettings().soloMode; }
  function setSoloMode(on) {
    const s = getSettings();
    s.soloMode = !!on;
    write(KEYS.settings, s);
  }

  // --- エクスポート / インポート ---
  function exportAll() {
    return {
      exportedAt: new Date().toISOString(),
      books: read(KEYS.books),
      sessions: read(KEYS.sessions),
      participants: read(KEYS.participants),
      settings: getSettings(),
    };
  }
  // --- インポートの検証・無害化（細工されたバックアップ対策） ---
  // 文字列は型と最大長を強制、数値は整数化＋範囲クランプ、ID は安全な文字種のみ、
  // 日付は YYYY-MM-DD のみ許可。壊れた項目は捨て、構造が不正なら保存しない。
  function vStr(v, max) { return (typeof v === "string" ? v : "").slice(0, max); }
  function vInt(v, min, max, def) {
    const n = Math.round(Number(v));
    if (!Number.isFinite(n)) return def;
    return Math.min(max, Math.max(min, n));
  }
  function vId(v, prefix) {
    const cleaned = String(v == null ? "" : v).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64);
    return cleaned || (prefix + "_" + Math.random().toString(36).slice(2, 10));
  }
  function vDate(v) {
    if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
    const d = parseLocalDate(v);
    // 実在する日付のみ許可（2026-13-99 や 2026-02-30 を弾く）
    return (!isNaN(d.getTime()) && toYMD(d) === v) ? v : null;
  }
  function vBook(b) {
    if (!b || typeof b !== "object") return null;
    const status = ["reading", "paused", "finished"].includes(b.status) ? b.status : "paused";
    return {
      id: vId(b.id, "book"),
      title: vStr(b.title, 300) || "（無題）",
      author: vStr(b.author, 200),
      totalPages: vInt(b.totalPages, 1, 100000, 200),
      status,
      startedAt: vDate(b.startedAt),
      finishedAt: vDate(b.finishedAt),
    };
  }
  function vSession(s) {
    if (!s || typeof s !== "object") return null;
    const date = vDate(s.date);
    if (!date) return null; // 日付が不正な記録は取り込まない
    const r = (s.reactions && typeof s.reactions === "object") ? s.reactions : {};
    return {
      id: vId(s.id, "session"),
      bookId: vId(s.bookId, "book"),
      date,
      startPage: vInt(s.startPage, 0, 100000, 0),
      endPage: vInt(s.endPage, 0, 100000, 0),
      question: vStr(s.question, 200) || "なし",
      participants: Array.isArray(s.participants) ? s.participants.slice(0, 200).map((p) => vId(p, "p")) : [],
      reactions: {
        empathy: vInt(r.empathy, 0, 1000000, 0),
        insight: vInt(r.insight, 0, 1000000, 0),
        discovery: vInt(r.discovery, 0, 1000000, 0),
      },
      nextSteps: Array.isArray(s.nextSteps) ? s.nextSteps.slice(0, 50).map((x) => ({
        step: vStr(x && x.step, 20), count: vInt(x && x.count, 0, 1000000, 0),
      })) : [],
      memo: vStr(s.memo, 2000),
      durationMin: vInt(s.durationMin, 1, 600, 15),
    };
  }
  function vParticipant(p) {
    if (!p || typeof p !== "object") return null;
    return {
      id: vId(p.id, "p"),
      name: vStr(p.name, 100) || "参加者",
      icon: vStr(p.icon, 8) || "📘", // 短い文字列のみ。表示側でもエスケープする
      joinedAt: vDate(p.joinedAt),
    };
  }
  function vSettings(s) {
    if (!s || typeof s !== "object") return {};
    return {
      pagesPerSession: vInt(s.pagesPerSession, 1, 100000, DEFAULT_PAGES_PER_SESSION),
      restDays: Array.isArray(s.restDays)
        ? [...new Set(s.restDays.map((d) => vInt(d, 0, 6, -1)).filter((d) => d >= 0))]
        : [0, 6],
      soloMode: !!s.soloMode,
    };
  }

  function importAll(data) {
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      return { ok: false, reason: "ファイルの形式が正しくありません。" };
    }
    // 配列であるべき項目が配列でなければ、壊れた/細工されたファイルとして拒否
    for (const k of ["books", "sessions", "participants"]) {
      if (data[k] != null && !Array.isArray(data[k])) {
        return { ok: false, reason: "ファイルの形式が正しくありません。" };
      }
    }
    const counts = {};
    if (data.books != null) {
      const v = data.books.map(vBook).filter(Boolean);
      write(KEYS.books, v); counts.books = v.length;
    }
    if (data.sessions != null) {
      const v = data.sessions.map(vSession).filter(Boolean);
      write(KEYS.sessions, v); counts.sessions = v.length;
    }
    if (data.participants != null) {
      const v = data.participants.map(vParticipant).filter(Boolean);
      write(KEYS.participants, v); counts.participants = v.length;
    }
    if (data.settings != null) write(KEYS.settings, vSettings(data.settings));
    return { ok: true, counts };
  }

  seedIfEmpty();

  return {
    today,
    getBooks, getCurrentBook, saveBook,
    getParticipants, saveParticipants,
    pauseReadingBooks, setCurrentBook,
    getSessions, getSessionsByBook, getLastEndPage, upsertSession, getStreak, getBookStats,
    saveWorkingDraft, getWorkingDraft, clearWorkingDraft,
    getPagesPerSession, setPagesPerSession,
    getRestDays, setRestDays,
    getSoloMode, setSoloMode,
    exportAll, importAll,
  };
})();
