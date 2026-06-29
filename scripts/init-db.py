"""
使用 Python 标准库初始化 SQLite 数据库文件（无需 better-sqlite3 编译）
运行: python scripts/init-db.py
"""
from __future__ import annotations

import sqlite3
from pathlib import Path

DATABASE_DIR = Path(r"D:\SQLlite")
DATABASE_PATH = DATABASE_DIR / "shorekeeper.db"
WORKSPACE_DIR = DATABASE_DIR / "workspace"

MIGRATION_SQL = """
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY NOT NULL,
    title TEXT DEFAULT '新对话' NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY NOT NULL,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    token_count INTEGER,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (session_id) REFERENCES sessions(id)
);

CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);
"""


def main() -> None:
    DATABASE_DIR.mkdir(parents=True, exist_ok=True)
    WORKSPACE_DIR.mkdir(parents=True, exist_ok=True)

    conn = sqlite3.connect(DATABASE_PATH)
    try:
        conn.executescript(MIGRATION_SQL)
        conn.commit()
        version = conn.execute("SELECT sqlite_version()").fetchone()[0]
    finally:
        conn.close()

    print(f"数据库目录: {DATABASE_DIR}")
    print(f"数据库文件: {DATABASE_PATH}")
    print(f"工作区目录: {WORKSPACE_DIR}")
    print(f"SQLite 版本: {version}")
    print(f"文件已创建: {DATABASE_PATH.exists()}")
    print("初始化完成。")


if __name__ == "__main__":
    main()
