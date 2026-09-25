const sqlite3 = require("sqlite3").verbose();

const db = new sqlite3.Database("./database.sqlite");

db.serialize(() => {

    db.run(`
        CREATE TABLE IF NOT EXISTS games(

            id INTEGER PRIMARY KEY AUTOINCREMENT,

            name TEXT,

            path TEXT UNIQUE,

            steam_id INTEGER,

            play_time INTEGER DEFAULT 0,

            play_count INTEGER DEFAULT 0,

            favorite INTEGER DEFAULT 0

        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS sessions(

            id INTEGER PRIMARY KEY AUTOINCREMENT,

            game_id INTEGER,

            started_at TEXT,

            ended_at TEXT,

            duration INTEGER

        )
    `);

});

module.exports = db;