// Guarda as sessões de login no SQLite (node:sqlite) pra elas NAO sumirem
// quando o servidor reinicia (deploy). Sem isso, todo restart deslogava todo mundo.
module.exports = (session, db) => {
  db.exec('CREATE TABLE IF NOT EXISTS sessions (sid TEXT PRIMARY KEY, sess TEXT NOT NULL, expire INTEGER NOT NULL)');
  const SETE_DIAS = 7 * 24 * 60 * 60 * 1000;
  const venc = sess => (sess.cookie && sess.cookie.expires) ? new Date(sess.cookie.expires).getTime() : Date.now() + SETE_DIAS;

  return class SqliteStore extends session.Store {
    get(sid, cb) {
      try {
        const row = db.prepare('SELECT sess, expire FROM sessions WHERE sid = ?').get(sid);
        if (!row) return cb(null, null);
        if (row.expire < Date.now()) { db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid); return cb(null, null); }
        cb(null, JSON.parse(row.sess));
      } catch (e) { cb(e); }
    }
    set(sid, sess, cb) {
      try {
        db.prepare('INSERT INTO sessions (sid, sess, expire) VALUES (?, ?, ?) ON CONFLICT(sid) DO UPDATE SET sess = excluded.sess, expire = excluded.expire')
          .run(sid, JSON.stringify(sess), venc(sess));
        cb && cb(null);
      } catch (e) { cb && cb(e); }
    }
    destroy(sid, cb) {
      try { db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid); cb && cb(null); }
      catch (e) { cb && cb(e); }
    }
    touch(sid, sess, cb) {
      try { db.prepare('UPDATE sessions SET expire = ? WHERE sid = ?').run(venc(sess), sid); cb && cb(null); }
      catch (e) { cb && cb(e); }
    }
  };
};
