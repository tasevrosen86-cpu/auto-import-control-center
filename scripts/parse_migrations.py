"""Parses each migration with the real PostgreSQL grammar.

No server is needed and nothing is executed: pglast wraps libpg_query, the same
parser Postgres uses, so a file that parses here is a file the SQL Editor will
accept. This catches what a careful reading misses — an unbalanced `$$`, a comma
left behind, a keyword in the wrong place — before the migration is pasted by
hand into production, where a failed paste has no undo.

Usage: python scripts/parse_migrations.py
"""

import glob
import sys

import pglast

failed = 0
for path in sorted(glob.glob("supabase/migrations/*.sql")) + sorted(glob.glob("supabase/manual/*.sql")):
    try:
        statements = pglast.parser.parse_sql(path and open(path, encoding="utf-8").read())
    except Exception as error:  # noqa: BLE001 - the message is the point
        print(f"FAIL {path}")
        print(f"     {error}")
        failed = 1
        continue
    print(f"ok   {path} ({len(statements)} statements)")

sys.exit(failed)
