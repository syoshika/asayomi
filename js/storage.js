/* 朝読み — データ層。localStorage をラップし、本・参加者・セッションを管理する。
   フェーズ2でバックエンド(Supabase 等)へ移行できるよう、データ構造は SPEC.md に準拠する。 */

const Store = (() => {
  // localStorage キー
  const KEYS = {
    books: "asayomi.books",
    sessions: "asayomi.sessions",
    participants: "asayomi.participants",
    settings: "asayomi.settings",
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
  function addSession(session) {
    const sessions = read(KEYS.sessions);
    sessions.push(session);
    write(KEYS.sessions, sessions);
  }

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

  // 連続開催日数（ストリーク）。最新の開催日から遡って連続している日数を数える。
  function getStreak() {
    const dates = [...new Set(read(KEYS.sessions).map((s) => s.date))].sort().reverse();
    if (dates.length === 0) return 0;
    let streak = 1;
    for (let i = 0; i < dates.length - 1; i++) {
      const cur = new Date(dates[i]);
      const next = new Date(dates[i + 1]);
      const diffDays = Math.round((cur - next) / 86400000);
      if (diffDays === 1) streak++; else break;
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
  function importAll(data) {
    if (data.books) write(KEYS.books, data.books);
    if (data.sessions) write(KEYS.sessions, data.sessions);
    if (data.participants) write(KEYS.participants, data.participants);
    if (data.settings) write(KEYS.settings, data.settings);
  }

  seedIfEmpty();

  return {
    today,
    getBooks, getCurrentBook, saveBook,
    getParticipants, saveParticipants,
    pauseReadingBooks,
    getSessions, getSessionsByBook, getLastEndPage, addSession, getStreak, getBookStats,
    getPagesPerSession, setPagesPerSession,
    exportAll, importAll,
  };
})();
