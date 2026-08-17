# Scripts

External scripts invoked by "script commands". Serial Pilot runs the full command line you type in a script command through the system shell, which lets you perform helper actions beyond serial send/receive (toggle power, drive a relay, invoke a device tool, etc.).

## Calling convention

- **Execution**: the app runs the full command line you type, e.g. `python hello.py COM3 hello`; everything after the script name is passed in as normal command-line arguments (argv).
- **Working directory**: fixed to the script's own directory, so you can reference sibling files with relative paths.
- **Success/failure**: exit code `0` = success, non-zero = failure.
- **Timeout**: capped at 300 seconds; `stdout` / `stderr` appear in the execution log.
- **Interpreter**: the command runs exactly as written, so `python` / `node`, etc. must be available on the system PATH.

## Reference script

- **`hello.py`** — zero-dependency (stdlib only) minimal example: prints `Hello Serial Pilot` and echoes the arguments passed in. Use it as a template for writing your own script.

  Type `python hello.py COM3 hello` in a script command to see the greeting and argument echo in the execution log.

---

[中文版](./README.md)
