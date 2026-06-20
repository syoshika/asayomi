/* 朝読み — データ層。localStorage をラップし、本・参加者・セッションを管理する。
   フェーズ2でバックエンド(Supabase 等)へ移行できるよう、データ構造は SPEC.md に準拠する。 */

const Store = (() => {
  // localStorage キー
  const KEYS = {
    books: "asayomi.books",
    sessions: "asayomi.sessions",
    participants: "asayomi.participants",
  };

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

  // --- 参加者 ---
  function getParticipants() { return read(KEYS.participants); }
  function saveParticipants(list) { write(KEYS.participants, list); }

  // --- セッション ---
  function getSessions() { return read(KEYS.sessions); }
  function getSessionsByBook(bookId) {
    return read(KEYS.sessions).filter((s) => s.bookId === bookId);
  }
  // 指定の本で最後に到達したページ（次回の開始ページ初期値に使う）
  function getLastEndPage(bookId) {
    const sessions = getSessionsByBook(bookId);
    if (sessions.length === 0) return 1;
    return sessions
      .map((s) => s.endPage)
      .reduce((max, p) => Math.max(max, p), 1);
  }
  function addSession(session) {
    const sessions = read(KEYS.sessions);
    sessions.push(session);
    write(KEYS.sessions, sessions);
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

  // --- エクスポート / インポート ---
  function exportAll() {
    return {
      exportedAt: new Date().toISOString(),
      books: read(KEYS.books),
      sessions: read(KEYS.sessions),
      participants: read(KEYS.participants),
    };
  }
  function importAll(data) {
    if (data.books) write(KEYS.books, data.books);
    if (data.sessions) write(KEYS.sessions, data.sessions);
    if (data.participants) write(KEYS.participants, data.participants);
  }

  seedIfEmpty();

  return {
    today,
    getBooks, getCurrentBook, saveBook,
    getParticipants, saveParticipants,
    getSessions, getSessionsByBook, getLastEndPage, addSession, getStreak,
    exportAll, importAll,
  };
})();
