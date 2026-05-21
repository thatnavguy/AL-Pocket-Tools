import * as vscode from 'vscode';

const COLORS = [
    'rgba(0, 210, 210, 0.22)',
    'rgba(100, 220, 80, 0.22)',
    'rgba(230, 180, 0, 0.22)',
    'rgba(230, 80, 110, 0.22)',
    'rgba(70, 140, 255, 0.22)',
    'rgba(170, 100, 255, 0.22)',
];

function getEditorSwitchMode(): 'autoHide' | 'follow' {
    return vscode.workspace.getConfiguration('al-pocket-tools')
        .get<'autoHide' | 'follow'>('rainbowIndent.onEditorSwitch', 'autoHide');
}

export class RainbowIndentController implements vscode.Disposable {
    private isActive = false;
    private readonly decorationTypes: vscode.TextEditorDecorationType[];
    private listeners: vscode.Disposable[] = [];
    private decoratedEditor: vscode.TextEditor | undefined;

    constructor() {
        this.decorationTypes = COLORS.map(color =>
            vscode.window.createTextEditorDecorationType({ backgroundColor: color })
        );
    }

    toggle(): void {
        this.isActive = !this.isActive;
        if (this.isActive) {
            this.applyToActiveEditor();
            this.startListeners();
            void vscode.window.setStatusBarMessage('Rainbow indent: ON', 2000);
        } else {
            this.stopListeners();
            this.clearDecoratedEditor();
            void vscode.window.setStatusBarMessage('Rainbow indent: OFF', 2000);
        }
    }

    private hide(): void {
        this.isActive = false;
        this.stopListeners();
        this.clearDecoratedEditor();
    }

    private startListeners(): void {
        this.listeners.push(
            vscode.workspace.onDidChangeTextDocument(e => {
                if (e.document === vscode.window.activeTextEditor?.document) {
                    this.hide();
                }
            }),
            vscode.window.onDidChangeActiveTextEditor(editor => {
                if (getEditorSwitchMode() === 'autoHide') {
                    this.hide();
                } else {
                    this.clearDecoratedEditor();
                    if (editor) { this.applyToActiveEditor(); }
                }
            })
        );
    }

    private stopListeners(): void {
        this.listeners.forEach(d => d.dispose());
        this.listeners = [];
    }

    private applyToActiveEditor(): void {
        const editor = vscode.window.activeTextEditor;
        if (!editor) { return; }

        this.decoratedEditor = editor;

        const document = editor.document;
        const editorConfig = vscode.workspace.getConfiguration('editor', document.uri);
        const tabSize = editorConfig.get<number>('tabSize', 4);
        const insertSpaces = editorConfig.get<boolean>('insertSpaces', true);

        const rangesPerColor: vscode.Range[][] = COLORS.map(() => []);

        for (let lineIdx = 0; lineIdx < document.lineCount; lineIdx++) {
            const line = document.lineAt(lineIdx);
            if (line.isEmptyOrWhitespace) { continue; }

            const text = line.text;
            let indentLevel: number;
            let col = 0;

            if (insertSpaces) {
                while (col < text.length && text[col] === ' ') { col++; }
                indentLevel = Math.floor(col / tabSize);
            } else {
                while (col < text.length && text[col] === '\t') { col++; }
                indentLevel = col;
            }

            for (let level = 0; level < indentLevel; level++) {
                const colorIdx = level % COLORS.length;
                const startChar = insertSpaces ? level * tabSize : level;
                const endChar = insertSpaces ? (level + 1) * tabSize : level + 1;
                rangesPerColor[colorIdx].push(new vscode.Range(lineIdx, startChar, lineIdx, endChar));
            }
        }

        this.decorationTypes.forEach((dt, idx) => {
            editor.setDecorations(dt, rangesPerColor[idx]);
        });
    }

    private clearDecoratedEditor(): void {
        if (this.decoratedEditor) {
            const ed = this.decoratedEditor;
            this.decorationTypes.forEach(dt => ed.setDecorations(dt, []));
            this.decoratedEditor = undefined;
        }
    }

    dispose(): void {
        this.stopListeners();
        this.clearDecoratedEditor();
        this.decorationTypes.forEach(dt => dt.dispose());
    }
}
