# Call Graph

## What it does

Opens a visual graph panel showing which procedures call the current one (**Callers**) and which internal procedures the current one calls (**Callees**). Only procedures defined in the same AL file appear as callees — built-in BC/AL methods like `Reset()`, `SetRange()`, `Message()`, etc. are excluded.

## How to trigger it

Right-click anywhere inside an AL procedure body → **Show Call Graph** (AL Pocket Tools group).

Also available via the Command Palette: **AL Pocket Tools: Show Call Graph**.

## UX flow

1. Place your cursor anywhere inside a `procedure` or `trigger` body.
2. Right-click → **Show Call Graph**.
3. A panel opens beside the editor with three columns:
   - **Callers** — procedures in the same file that call this procedure. Click any node to jump to the call site.
   - **Current procedure** — the procedure you invoked from, shown in the centre.
   - **Callees** — internal procedures this procedure calls. Click any node to jump to that procedure's declaration.
4. Bezier arrows connect callers → current and current → callees.
5. If there are no callers or no callees, the column shows "none".

## File format conventions

The parser recognises AL declarations matching:

```
[local | internal | protected] procedure ProcedureName(...)
trigger TriggerName(...)
```

Boundary detection: each procedure's body spans from its declaration line to the line before the next procedure/trigger declaration (or end of file). String literals and `//` comments are stripped before scanning for calls.

**Callees filter**: only names that match a procedure declared in the same file are shown. This intentionally excludes BC base-app methods and built-in AL functions.

## Edge cases

- **Cursor not in a procedure** — an info message prompts you to move the cursor inside a procedure before retrying.
- **No callers / no callees** — the corresponding column displays "none"; the graph still opens.
- **Recursive calls** — a self-calling procedure appears in its own Callees column.
- **Multiple call sites from one caller** — deduplicated; the node navigates to the first call site.
- **Multiple calls to the same callee** — deduplicated; the node navigates to the callee's declaration.
