const path = require("path");
const sqlite3 = require("sqlite3").verbose();

const dbPath = path.join(__dirname, "database.sqlite");
const db = new sqlite3.Database(dbPath);

function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });
}

async function initDatabase() {
  await dbRun(`
    CREATE TABLE IF NOT EXISTS games (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      custom_name TEXT,
      path TEXT UNIQUE,
      extension TEXT,
      cover TEXT,
      resolved_exe TEXT,
      steam_id TEXT,
      play_time INTEGER DEFAULT 0,
      play_count INTEGER DEFAULT 0,
      favorite INTEGER DEFAULT 0,
      last_played TEXT
    )
  `);

  // Garante colunas extras caso a tabela já existisse com schema antigo
  const cols = await dbAll("PRAGMA table_info(games)");
  const colNames = new Set(cols.map((c) => c.name));

  const migrations = [
    ["custom_name", "ALTER TABLE games ADD COLUMN custom_name TEXT"],
    ["extension", "ALTER TABLE games ADD COLUMN extension TEXT"],
    ["cover", "ALTER TABLE games ADD COLUMN cover TEXT"],
    ["resolved_exe", "ALTER TABLE games ADD COLUMN resolved_exe TEXT"],
    ["last_played", "ALTER TABLE games ADD COLUMN last_played TEXT"],
  ];

  for (const [col, sql] of migrations) {
    if (!colNames.has(col)) {
      try {
        await dbRun(sql);
      } catch {
        // Ignore if already exists
      }
    }
  }

  await dbRun(`
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      game_id INTEGER,
      started_at TEXT,
      ended_at TEXT,
      duration INTEGER
    )
  `);

  await dbRun(`
    CREATE TABLE IF NOT EXISTS app_meta (
      key TEXT PRIMARY KEY,
      value TEXT
    )
  `);
}

module.exports = {
  db,
  dbRun,
  dbGet,
  dbAll,
  initDatabase,
};