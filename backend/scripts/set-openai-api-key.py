#!/usr/bin/env python3
"""Set OPENAI_API_KEY in backend/.env (create or update line).

  Interactive (hidden paste):  python3 scripts/set-openai-api-key.py
  One-shot (avoid shell history — prefer interactive): pass as argv only if you accept the risk.

"""
from __future__ import annotations

import os
import re
import sys


def main() -> None:
    backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    env_path = os.path.join(backend_dir, ".env")

    if len(sys.argv) >= 2:
        key = sys.argv[1].strip()
    else:
        try:
            import getpass

            key = getpass.getpass("Paste OPENAI_API_KEY (hidden): ").strip()
        except (EOFError, OSError):
            print(
                "No TTY — run in your terminal:\n"
                "  cd backend && python3 scripts/set-openai-api-key.py",
                file=sys.stderr,
            )
            sys.exit(1)

    if not key:
        print("Empty key.", file=sys.stderr)
        sys.exit(1)

    new_line = f"OPENAI_API_KEY={key}"

    if os.path.isfile(env_path):
        with open(env_path, encoding="utf-8") as f:
            content = f.read()
        if re.search(r"(?m)^OPENAI_API_KEY=", content):
            content = re.sub(r"(?m)^OPENAI_API_KEY=.*", new_line, content)
        else:
            if content and not content.endswith("\n"):
                content += "\n"
            content += new_line + "\n"
    else:
        content = new_line + "\n"

    with open(env_path, "w", encoding="utf-8") as f:
        f.write(content)

    try:
        os.chmod(env_path, 0o600)
    except OSError:
        pass

    print(f"Saved OPENAI_API_KEY in {env_path}")
    print("Restart the backend (e.g. stop/start `npm run dev` in backend) so it picks up the change.")


if __name__ == "__main__":
    main()
