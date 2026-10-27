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
      last_played TEXT,
      genre TEXT
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
    ["genre", "ALTER TABLE games ADD COLUMN genre TEXT"],
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

  await dbRun(`
    CREATE TABLE IF NOT EXISTS achievements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      game_id INTEGER NOT NULL,
      steam_id TEXT NOT NULL,
      api_name TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      icon_url TEXT,
      icon_gray_url TEXT,
      hidden INTEGER DEFAULT 0,
      achieved INTEGER DEFAULT 0,
      unlock_time INTEGER DEFAULT 0,
      updated_at TEXT,
      FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE,
      UNIQUE(game_id, api_name)
    )
  `);

  await dbRun(`CREATE INDEX IF NOT EXISTS idx_achievements_game_id ON achievements(game_id)`);
  await dbRun(`CREATE INDEX IF NOT EXISTS idx_achievements_steam_id ON achievements(steam_id)`);
}

module.exports = {
  db,
  dbRun,
  dbGet,
  dbAll,
  initDatabase,
};