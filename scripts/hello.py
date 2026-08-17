#!/usr/bin/env python3
"""
Serial Pilot external script reference example (zero dependencies, stdlib only).

Purpose: demonstrate the minimal shape of a script command -- print a greeting
and echo the arguments passed in by Serial Pilot. Use it as a template and
replace the body with your own logic (invoke a device tool, toggle power,
drive a relay, etc.).

Calling convention:
- Serial Pilot runs the full command line you type in the "script command",
  e.g.:
      python hello.py COM3 hello
  everything after hello.py is passed in as normal command-line arguments (argv).
- The working directory is fixed to the script's own directory, so you can
  reference sibling files with relative paths.
- Exit code 0 means success; a non-zero code means failure (Serial Pilot uses
  it to decide whether the script command passed).
- Execution timeout is capped at 300 seconds; stdout / stderr appear in the
  execution log.

Usage:
    python hello.py [arg1 arg2 ...]
"""

import sys


def main() -> int:
    print("Hello Serial Pilot")

    args = sys.argv[1:]
    if args:
        print(f"Received {len(args)} argument(s):")
        for i, arg in enumerate(args, start=1):
            print(f"  [{i}] {arg}")
    else:
        print("(no arguments passed)")

    return 0  # 0 = success; return non-zero to make Serial Pilot mark it failed


if __name__ == "__main__":
    sys.exit(main())
