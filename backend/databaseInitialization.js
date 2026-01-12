import Database from "better-sqlite3";

const db = new Database("./langData/app.db");

export default db;