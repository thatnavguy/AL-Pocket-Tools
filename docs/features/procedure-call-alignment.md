# Procedure Call Alignment

Formats a selected procedure call expression into either a single-line layout or a vertical layout where each argument is on its own indented line.

## How to trigger

Select the full procedure call lines, then right-click and choose **AL Pocket Tools > Align Selected Procedure Call**.

You can also run **AL Pocket Tools: Align Selected Procedure Call** from the Command Palette.

## Output format

**Before (horizontal):**
```al
ProcessOrderLine(OrderNo, LineNo, PostingDate, QuantityToShip, LocationCode);
```

**After (vertical):**
```al
ProcessOrderLine(
    OrderNo,
    LineNo,
    PostingDate,
    QuantityToShip,
    LocationCode);
```

If you run the command again on the vertical form, it collapses the call back to one line.

It also works when the call is wrapped inside another statement such as:

```al
exit(ResolveLabelTemplateCode(ItemNo, VariantCode, LocationCode));
```

## Rules

- The selection must contain one complete procedure call expression.
- The opening `(` stays at the end of the first line.
- Each argument is indented 4 spaces relative to the call line.
- The closing `)` and trailing `;` stay on the last argument line.
- Nested calls and commas inside string literals are preserved when splitting arguments.

## Scope

Works on selected procedure call blocks, including calls wrapped by statements like `exit(...)`. It does not change procedure declarations.
