import * as vscode from 'vscode';

const AL_KEYWORDS = new Set([
    'if', 'then', 'else', 'while', 'do', 'for', 'to', 'downto', 'repeat', 'until',
    'case', 'of', 'begin', 'end', 'var', 'procedure', 'trigger', 'local', 'internal',
    'protected', 'exit', 'with', 'and', 'or', 'not', 'xor', 'div', 'mod', 'in', 'is',
    'true', 'false', 'rec', 'xrec',
]);

interface ProcInfo { name: string; line: number; }
interface NodeInfo { name: string; line: number; }

function parseProcedures(text: string): ProcInfo[] {
    const lines = text.split('\n');
    const result: ProcInfo[] = [];
    const re = /^\s*(?:(?:local|internal|protected)\s+)*(?:procedure|trigger)\s+(\w+)\s*\(/i;
    for (let i = 0; i < lines.length; i++) {
        const m = re.exec(lines[i]);
        if (m) { result.push({ name: m[1].trim(), line: i }); }
    }
    return result;
}

function rangeOf(idx: number, procs: ProcInfo[], totalLines: number): { start: number; end: number } {
    return {
        start: procs[idx].line,
        end: idx + 1 < procs.length ? procs[idx + 1].line - 1 : totalLines - 1,
    };
}

function stripLine(raw: string): string {
    return raw.replace(/\/\/.*$/, '').replace(/'([^']|'')*'/g, "''");
}

function callsInRange(lines: string[], start: number, end: number): { name: string; line: number }[] {
    const results: { name: string; line: number }[] = [];
    for (let i = start; i <= end && i < lines.length; i++) {
        const stripped = stripLine(lines[i]);
        const re = /\b([A-Za-z_]\w*)\s*\(/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(stripped)) !== null) {
            const name = m[1].trim();
            if (!AL_KEYWORDS.has(name.toLowerCase())) {
                results.push({ name, line: i });
            }
        }
    }
    return results;
}

function getNonce(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    return Array.from({ length: 32 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

function esc(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function buildHtml(
    current: NodeInfo,
    callers: NodeInfo[],
    callees: NodeInfo[],
    fileName: string,
    nonce: string,
): string {
    const callerCards = callers.map(c =>
        `<div class="card caller-card" data-line="${c.line}">
            <div class="card-bar caller-bar"></div>
            <div class="card-body">
                <span class="card-name">${esc(c.name)}</span>
                <span class="card-ln">:${c.line + 1}</span>
            </div>
        </div>`
    ).join('');

    const calleeCards = callees.map(c =>
        `<div class="card callee-card" data-line="${c.line}">
            <div class="card-bar callee-bar"></div>
            <div class="card-body">
                <span class="card-name">${esc(c.name)}</span>
                <span class="card-ln">:${c.line + 1}</span>
            </div>
        </div>`
    ).join('');

    const callerBadge = callers.length > 0
        ? `<span class="badge caller-badge">${callers.length}</span>`
        : '';
    const calleeBadge = callees.length > 0
        ? `<span class="badge callee-badge">${callees.length}</span>`
        : '';

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>
*,*::before,*::after { box-sizing: border-box; margin: 0; padding: 0; }

:root {
    --caller-color: var(--vscode-editorInfo-foreground, #4fc1ff);
    --callee-color: var(--vscode-charts-green, #4ec9b0);
}

body {
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    background: var(--vscode-editor-background);
    color: var(--vscode-editor-foreground);
    padding: 0;
    height: 100vh;
    display: flex;
    flex-direction: column;
}

/* ── Header ── */
.header {
    padding: 16px 24px 14px;
    border-bottom: 1px solid var(--vscode-panel-border);
    display: flex;
    flex-direction: column;
    gap: 3px;
    flex-shrink: 0;
}
.header-title {
    font-size: 15px;
    font-weight: 700;
    letter-spacing: -0.01em;
    color: var(--vscode-editor-foreground);
}
.header-meta {
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
}

/* ── Graph canvas ── */
.canvas {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 32px 40px;
    overflow: auto;
}

.graph {
    display: flex;
    align-items: center;
    gap: 0;
    position: relative;
}

/* ── Columns ── */
.column {
    display: flex;
    flex-direction: column;
    gap: 0;
    min-width: 170px;
}

.column-header {
    display: flex;
    align-items: center;
    gap: 7px;
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.09em;
    color: var(--vscode-descriptionForeground);
    margin-bottom: 12px;
    padding-left: 2px;
}

.dot {
    width: 7px; height: 7px;
    border-radius: 50%;
    flex-shrink: 0;
}
.caller-dot { background: var(--caller-color); }
.callee-dot { background: var(--callee-color); }

.badge {
    font-size: 9px;
    font-weight: 700;
    padding: 1px 5px;
    border-radius: 8px;
    letter-spacing: 0;
}
.caller-badge { background: color-mix(in srgb, var(--caller-color) 18%, transparent); color: var(--caller-color); }
.callee-badge { background: color-mix(in srgb, var(--callee-color) 18%, transparent); color: var(--callee-color); }

/* ── Cards ── */
.cards-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.card {
    display: flex;
    align-items: stretch;
    border-radius: 5px;
    border: 1px solid var(--vscode-panel-border);
    background: var(--vscode-editorWidget-background);
    cursor: pointer;
    overflow: hidden;
    transition: transform 0.1s, box-shadow 0.1s;
    user-select: none;
}
.card:hover {
    transform: translateY(-1px);
    box-shadow: 0 3px 8px rgba(0,0,0,0.2);
}

.card-bar {
    width: 3px;
    flex-shrink: 0;
}
.caller-bar { background: var(--caller-color); }
.callee-bar { background: var(--callee-color); }

.card-body {
    padding: 8px 12px;
    display: flex;
    align-items: center;
    gap: 5px;
    white-space: nowrap;
}

.card-name {
    font-size: 12px;
    font-weight: 500;
}
.card-ln {
    font-size: 10px;
    color: var(--vscode-descriptionForeground);
}

/* ── Centre node ── */
.center-column {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0 48px;
    flex-shrink: 0;
}

.current-node {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border-radius: 7px;
    padding: 12px 20px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 3px;
    min-width: 150px;
    text-align: center;
    box-shadow: 0 2px 12px rgba(0,0,0,0.25);
}
.current-name {
    font-size: 13px;
    font-weight: 700;
}
.current-ln {
    font-size: 10px;
    opacity: 0.65;
}

.empty-hint {
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
    font-style: italic;
    padding: 6px 2px;
}

/* ── Arrow SVG overlay ── */
#arrows {
    position: absolute;
    top: 0; left: 0;
    width: 100%; height: 100%;
    pointer-events: none;
    overflow: visible;
}
#arr-caller polygon { fill: var(--caller-color); }
#arr-callee polygon { fill: var(--callee-color); }
</style>
</head>
<body>

<div class="header">
    <div class="header-title">${esc(current.name)}</div>
    <div class="header-meta">${esc(fileName)} &middot; line ${current.line + 1}</div>
</div>

<div class="canvas">
    <div class="graph" id="graph">

        <!-- Callers -->
        <div class="column" id="callers-col">
            <div class="column-header">
                <span class="dot caller-dot"></span>
                Callers
                ${callerBadge}
            </div>
            <div class="cards-list">
                ${callerCards || '<div class="empty-hint">none in this file</div>'}
            </div>
        </div>

        <!-- Current procedure -->
        <div class="center-column" id="current-col">
            <div class="current-node" id="current-node">
                <span class="current-name">${esc(current.name)}</span>
                <span class="current-ln">line ${current.line + 1}</span>
            </div>
        </div>

        <!-- Callees -->
        <div class="column" id="callees-col">
            <div class="column-header">
                <span class="dot callee-dot"></span>
                Callees
                ${calleeBadge}
            </div>
            <div class="cards-list">
                ${calleeCards || '<div class="empty-hint">none in this file</div>'}
            </div>
        </div>

        <svg id="arrows" aria-hidden="true">
            <defs>
                <marker id="arr-caller" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
                    <polygon points="0 0,8 3,0 6" fill="var(--caller-color)"/>
                </marker>
                <marker id="arr-callee" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
                    <polygon points="0 0,8 3,0 6" fill="var(--callee-color)"/>
                </marker>
            </defs>
        </svg>
    </div>
</div>

<script nonce="${nonce}">
const vscode = acquireVsCodeApi();

document.querySelectorAll('.card[data-line]').forEach(el => {
    el.addEventListener('click', () => {
        vscode.postMessage({ command: 'navigate', line: parseInt(el.dataset.line, 10) });
    });
});

function addPath(svg, x1, y1, x2, y2, cssColorVar, markerId) {
    const ctrl = (x1 + x2) / 2;
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', \`M \${x1} \${y1} C \${ctrl} \${y1} \${ctrl} \${y2} \${x2} \${y2}\`);
    path.style.stroke = cssColorVar;
    path.style.strokeWidth = '1.5';
    path.style.strokeOpacity = '0.75';
    path.style.fill = 'none';
    path.setAttribute('marker-end', \`url(#\${markerId})\`);
    svg.appendChild(path);
}

function drawArrows() {
    const svg   = document.getElementById('arrows');
    const graph = document.getElementById('graph');
    const cur   = document.getElementById('current-node');
    if (!svg || !graph || !cur) { return; }

    const gBox = graph.getBoundingClientRect();
    const cBox = cur.getBoundingClientRect();
    const cL   = cBox.left  - gBox.left;
    const cR   = cBox.right - gBox.left;
    const cMid = cBox.top + cBox.height / 2 - gBox.top;

    document.querySelectorAll('.caller-card').forEach(el => {
        const b = el.getBoundingClientRect();
        addPath(svg,
            b.right - gBox.left, b.top + b.height / 2 - gBox.top,
            cL - 2, cMid,
            'var(--caller-color)', 'arr-caller');
    });

    document.querySelectorAll('.callee-card').forEach(el => {
        const b = el.getBoundingClientRect();
        addPath(svg,
            cR + 2, cMid,
            b.left - gBox.left, b.top + b.height / 2 - gBox.top,
            'var(--callee-color)', 'arr-callee');
    });
}

window.addEventListener('load', drawArrows);
</script>
</body>
</html>`;
}

export async function showCallGraph(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'al') {
        vscode.window.showInformationMessage('Place your cursor in an AL procedure first.');
        return;
    }

    const doc = editor.document;
    const text = doc.getText();
    const lines = text.split('\n');
    const cursor = editor.selection.active.line;
    const procs = parseProcedures(text);

    // Case-insensitive lookup map: lowercase name → ProcInfo
    const nameMap = new Map<string, ProcInfo>();
    for (const p of procs) { nameMap.set(p.name.toLowerCase(), p); }

    let currentIdx = -1;
    for (let i = procs.length - 1; i >= 0; i--) {
        if (procs[i].line <= cursor) {
            const r = rangeOf(i, procs, lines.length);
            if (cursor <= r.end) { currentIdx = i; break; }
        }
    }

    if (currentIdx === -1) {
        vscode.window.showInformationMessage('Place your cursor inside an AL procedure.');
        return;
    }

    const current = procs[currentIdx];
    const currentLower = current.name.toLowerCase();

    // Callers: other procedures that call current — case-insensitive match
    const callerMap = new Map<string, NodeInfo>();
    for (let i = 0; i < procs.length; i++) {
        if (i === currentIdx) { continue; }
        const r = rangeOf(i, procs, lines.length);
        for (const c of callsInRange(lines, r.start, r.end)) {
            if (c.name.toLowerCase() === currentLower && !callerMap.has(procs[i].name)) {
                callerMap.set(procs[i].name, { name: procs[i].name, line: c.line });
            }
        }
    }

    // Callees: internal procedures only (case-insensitive), deduplicated → declaration line
    const calleeMap = new Map<string, NodeInfo>();
    const curRange = rangeOf(currentIdx, procs, lines.length);
    for (const c of callsInRange(lines, curRange.start, curRange.end)) {
        const lc = c.name.toLowerCase();
        if (!calleeMap.has(lc) && nameMap.has(lc) && lc !== currentLower) {
            const decl = nameMap.get(lc)!;
            calleeMap.set(lc, { name: decl.name, line: decl.line });
        }
    }

    const fileName = doc.fileName.split(/[\\/]/).pop() ?? doc.fileName;
    const nonce = getNonce();

    const panel = vscode.window.createWebviewPanel(
        'al-pocket-tools.callGraph',
        `Call Graph · ${current.name}`,
        vscode.ViewColumn.Beside,
        { enableScripts: true, retainContextWhenHidden: true },
    );

    panel.webview.html = buildHtml(
        { name: current.name, line: current.line },
        [...callerMap.values()],
        [...calleeMap.values()],
        fileName,
        nonce,
    );

    panel.webview.onDidReceiveMessage(async (msg: { command: string; line: number }) => {
        if (msg.command !== 'navigate') { return; }
        const pos = new vscode.Position(msg.line, 0);
        const ed = await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
        ed.selection = new vscode.Selection(pos, pos);
        ed.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
    });
}
