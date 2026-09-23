"""Account administration for token auth mode.

    python -m app.scripts.manage_users list
    python -m app.scripts.manage_users set-password national_admin       # prompts, never echoes
    python -m app.scripts.manage_users set-password --all                 # one password for every seeded account
    python -m app.scripts.manage_users deactivate phc_operator_001
    python -m app.scripts.manage_users activate phc_operator_001

Accounts are seeded from the demo roster on first use (see services/auth.py);
this is how you change their passwords or switch them off afterwards. A
deactivated user is refused at login and loses any existing session at once.
"""
import argparse
import getpass
import sys

from app.services import auth, db


def _prompt_password() -> str:
    first = getpass.getpass("New password: ")
    if len(first) < 10:
        sys.exit("Password must be at least 10 characters.")
    if first != getpass.getpass("Repeat password: "):
        sys.exit("Passwords did not match.")
    return first


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("list")
    sp = sub.add_parser("set-password")
    sp.add_argument("user_id", nargs="?")
    sp.add_argument("--all", action="store_true")
    for name in ("activate", "deactivate"):
        sub.add_parser(name).add_argument("user_id")
    args = parser.parse_args(argv)

    db.init_db()
    auth.ensure_seeded()

    if args.cmd == "list":
        for uid in sorted(auth.USERS):
            row = db.user_get(uid)
            print(f"{uid:<26} {row['role']:<18} {'active' if row['active'] else 'DISABLED'}")
        return 0

    if args.cmd == "set-password":
        if not args.all and not args.user_id:
            sys.exit("Give a user id, or --all.")
        targets = list(auth.USERS) if args.all else [args.user_id]
        for uid in targets:
            if not db.user_get(uid):
                sys.exit(f"No such user: {uid}")
        hashed = auth.hash_password(_prompt_password())
        for uid in targets:
            user = db.user_get(uid)
            db.user_upsert({k: user[k] for k in ("user_id", "label", "role", "authorized_phc_ids", "authorized_states")}, hashed)
        print(f"Password updated for {len(targets)} account(s).")
        return 0

    if not db.user_get(args.user_id):
        sys.exit(f"No such user: {args.user_id}")
    db.user_set_active(args.user_id, args.cmd == "activate")
    print(f"{args.user_id}: {'activated' if args.cmd == 'activate' else 'deactivated'}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
