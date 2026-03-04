import * as vscode from 'vscode';
import { BackendClient } from '../backendClient';
import { AuthService } from '../auth/authService';

/**
 * SidebarProvider – renders a Webview-based sidebar inside VS Code.
 * Shows a login/signup form when unauthenticated, and the chat interface when authenticated.
 */
export class SidebarProvider implements vscode.WebviewViewProvider {
    private _view?: vscode.WebviewView;

    constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly backend: BackendClient,
        private readonly auth: AuthService,
        private readonly output: vscode.OutputChannel
    ) { }

    resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ): void {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.extensionUri],
        };

        this.updateHtml();

        // Handle messages from the webview
        webviewView.webview.onDidReceiveMessage(async (message) => {
            switch (message.type) {
                case 'login': {
                    const result = await this.auth.login(message.email, message.password);
                    if (result.success) {
                        this.updateHtml();
                        this.postMessage({ type: 'authSuccess' });
                    } else {
                        this.postMessage({ type: 'authError', message: result.error });
                    }
                    break;
                }
                case 'signup': {
                    const result = await this.auth.signup(message.email, message.password, message.displayName || '');
                    if (result.success) {
                        this.updateHtml();
                        this.postMessage({ type: 'authSuccess' });
                    } else {
                        this.postMessage({ type: 'authError', message: result.error });
                    }
                    break;
                }
                case 'logout': {
                    await this.auth.logout();
                    this.updateHtml();
                    break;
                }
                case 'ask': {
                    const question = message.question as string;
                    this.output.appendLine(`[Sidebar] User asked: ${question}`);
                    this.postMessage({ type: 'loading' });

                    const response = await this.backend.askQuestion(question);
                    if (response && !(response as any)._error) {
                        this.postMessage({
                            type: 'answer',
                            summary: response.summary,
                            commands: response.commands ?? [],
                        });
                    } else if (response && (response as any)._error) {
                        this.postMessage({
                            type: 'error',
                            message: `Backend error: ${response.summary}`,
                        });
                    } else {
                        this.postMessage({
                            type: 'error',
                            message: 'Could not reach the SecondCortex backend. Is it running?',
                        });
                    }
                    break;
                }
                case 'checkAuth': {
                    const loggedIn = await this.auth.isLoggedIn();
                    const user = await this.auth.getUser();
                    this.postMessage({ type: 'authStatus', loggedIn, user });
                    break;
                }
            }
        });
    }

    /** Refresh the webview content (e.g. after login/logout). */
    refreshView(): void {
        this.updateHtml();
    }

    private async updateHtml(): Promise<void> {
        if (!this._view) { return; }
        const loggedIn = await this.auth.isLoggedIn();
        const user = await this.auth.getUser();
        this._view.webview.html = this.getHtml(loggedIn, user);
    }

    private postMessage(message: Record<string, unknown>): void {
        this._view?.webview.postMessage(message);
    }

    private getHtml(loggedIn: boolean, user?: { userId: string; email: string; displayName: string }): string {
        if (!loggedIn) {
            return this.getAuthHtml();
        }
        return this.getChatHtml(user);
    }

    // ── Auth Page HTML ─────────────────────────────────────────────

    private getAuthHtml(): string {
        return /*html*/ `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>SecondCortex — Sign In</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: var(--vscode-font-family);
            color: var(--vscode-foreground);
            background: var(--vscode-sideBar-background);
            padding: 16px;
            display: flex;
            flex-direction: column;
            height: 100vh;
        }
        .brand {
            text-align: center;
            margin-bottom: 24px;
            padding-top: 20px;
        }
        .brand h1 {
            font-size: 18px;
            font-weight: 700;
            margin-bottom: 4px;
        }
        .brand p {
            font-size: 11px;
            opacity: 0.6;
        }
        .tabs {
            display: flex;
            gap: 0;
            margin-bottom: 16px;
            border-bottom: 1px solid var(--vscode-panel-border);
        }
        .tab {
            flex: 1;
            padding: 8px 0;
            text-align: center;
            font-size: 13px;
            font-weight: 500;
            cursor: pointer;
            border: none;
            background: transparent;
            color: var(--vscode-foreground);
            opacity: 0.5;
            border-bottom: 2px solid transparent;
            transition: all 0.2s;
        }
        .tab.active {
            opacity: 1;
            border-bottom-color: var(--vscode-button-background);
        }
        .tab:hover { opacity: 0.8; }
        .form-group {
            margin-bottom: 12px;
        }
        .form-group label {
            display: block;
            font-size: 12px;
            font-weight: 500;
            margin-bottom: 4px;
            opacity: 0.8;
        }
        .form-group input {
            width: 100%;
            padding: 8px 10px;
            font-size: 13px;
            border: 1px solid var(--vscode-input-border);
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border-radius: 4px;
            outline: none;
        }
        .form-group input:focus {
            border-color: var(--vscode-focusBorder);
        }
        .submit-btn {
            width: 100%;
            padding: 10px;
            margin-top: 8px;
            font-size: 13px;
            font-weight: 600;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            border-radius: 4px;
            cursor: pointer;
            transition: background 0.2s;
        }
        .submit-btn:hover {
            background: var(--vscode-button-hoverBackground);
        }
        .submit-btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }
        .error-msg {
            color: var(--vscode-inputValidation-errorForeground, #f48771);
            background: var(--vscode-inputValidation-errorBackground, rgba(244,135,113,0.1));
            border: 1px solid var(--vscode-inputValidation-errorBorder, #f48771);
            padding: 6px 10px;
            border-radius: 4px;
            font-size: 12px;
            margin-top: 8px;
            display: none;
        }
        #signup-fields { display: none; }
    </style>
</head>
<body>
    <div class="brand">
        <h1>🧠 SecondCortex</h1>
        <p>Your AI-Powered Second Brain</p>
    </div>

    <div class="tabs">
        <button class="tab active" id="tab-login" onclick="switchTab('login')">Log In</button>
        <button class="tab" id="tab-signup" onclick="switchTab('signup')">Sign Up</button>
    </div>

    <form id="auth-form" onsubmit="handleSubmit(event)">
        <div class="form-group">
            <label for="email">Email</label>
            <input id="email" type="email" placeholder="you@example.com" required />
        </div>
        <div class="form-group">
            <label for="password">Password</label>
            <input id="password" type="password" placeholder="••••••••" required minlength="6" />
        </div>
        <div id="signup-fields">
            <div class="form-group">
                <label for="display-name">Display Name</label>
                <input id="display-name" type="text" placeholder="Your Name" />
            </div>
        </div>
        <button type="submit" class="submit-btn" id="submit-btn">Log In</button>
        <div class="error-msg" id="error-msg"></div>
    </form>

    <script>
        const vscode = acquireVsCodeApi();
        let mode = 'login';

        function switchTab(tab) {
            mode = tab;
            document.getElementById('tab-login').classList.toggle('active', tab === 'login');
            document.getElementById('tab-signup').classList.toggle('active', tab === 'signup');
            document.getElementById('signup-fields').style.display = tab === 'signup' ? 'block' : 'none';
            document.getElementById('submit-btn').textContent = tab === 'login' ? 'Log In' : 'Create Account';
            document.getElementById('error-msg').style.display = 'none';
        }

        function handleSubmit(e) {
            e.preventDefault();
            const email = document.getElementById('email').value.trim();
            const password = document.getElementById('password').value;
            const btn = document.getElementById('submit-btn');
            btn.disabled = true;
            btn.textContent = 'Please wait...';
            document.getElementById('error-msg').style.display = 'none';

            if (mode === 'login') {
                vscode.postMessage({ type: 'login', email, password });
            } else {
                const displayName = document.getElementById('display-name').value.trim();
                vscode.postMessage({ type: 'signup', email, password, displayName });
            }
        }

        window.addEventListener('message', (event) => {
            const msg = event.data;
            const btn = document.getElementById('submit-btn');
            if (msg.type === 'authError') {
                btn.disabled = false;
                btn.textContent = mode === 'login' ? 'Log In' : 'Create Account';
                const errEl = document.getElementById('error-msg');
                errEl.textContent = msg.message;
                errEl.style.display = 'block';
            }
            // authSuccess is handled by the extension re-rendering the webview
        });
    </script>
</body>
</html>`;
    }

    // ── Chat Page HTML ─────────────────────────────────────────────

    private getChatHtml(user?: { userId: string; email: string; displayName: string }): string {
        const displayName = user?.displayName || user?.email || 'User';
        return /*html*/ `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>SecondCortex</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: var(--vscode-font-family);
            color: var(--vscode-foreground);
            background: var(--vscode-sideBar-background);
            padding: 12px;
            display: flex;
            flex-direction: column;
            height: 100vh;
        }
        .header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 12px;
        }
        .header h2 {
            font-size: 14px;
            font-weight: 600;
        }
        .header .user-info {
            font-size: 11px;
            opacity: 0.6;
        }
        .logout-btn {
            font-size: 11px;
            background: transparent;
            border: 1px solid var(--vscode-panel-border);
            color: var(--vscode-foreground);
            padding: 3px 8px;
            border-radius: 3px;
            cursor: pointer;
            opacity: 0.7;
            transition: opacity 0.2s;
        }
        .logout-btn:hover { opacity: 1; }
        #chat-log {
            flex: 1;
            overflow-y: auto;
            margin-bottom: 12px;
            display: flex;
            flex-direction: column;
            gap: 8px;
        }
        .msg {
            padding: 8px 10px;
            border-radius: 6px;
            font-size: 13px;
            line-height: 1.4;
            word-wrap: break-word;
        }
        .msg.user {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            align-self: flex-end;
            max-width: 85%;
        }
        .msg.assistant {
            background: var(--vscode-editor-background);
            border: 1px solid var(--vscode-panel-border);
            align-self: flex-start;
            max-width: 85%;
        }
        .msg.error {
            background: var(--vscode-inputValidation-errorBackground);
            border: 1px solid var(--vscode-inputValidation-errorBorder);
            color: var(--vscode-inputValidation-errorForeground);
        }
        .msg.loading {
            opacity: 0.6;
            font-style: italic;
        }
        #input-area {
            display: flex;
            gap: 6px;
        }
        #question-input {
            flex: 1;
            padding: 8px;
            font-size: 13px;
            border: 1px solid var(--vscode-input-border);
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border-radius: 4px;
            outline: none;
        }
        #question-input:focus {
            border-color: var(--vscode-focusBorder);
        }
        #send-btn {
            padding: 8px 14px;
            font-size: 13px;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            border-radius: 4px;
            cursor: pointer;
        }
        #send-btn:hover {
            background: var(--vscode-button-hoverBackground);
        }
    </style>
</head>
<body>
    <div class="header">
        <h2>🧠 SecondCortex</h2>
        <div>
            <span class="user-info">${displayName}</span>
            <button class="logout-btn" onclick="doLogout()">Logout</button>
        </div>
    </div>
    <div id="chat-log"></div>
    <div id="input-area">
        <input id="question-input" type="text" placeholder="Ask about your project history..." />
        <button id="send-btn">Ask</button>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        const chatLog = document.getElementById('chat-log');
        const input = document.getElementById('question-input');
        const sendBtn = document.getElementById('send-btn');

        function addMessage(className, text) {
            const div = document.createElement('div');
            div.className = 'msg ' + className;
            div.textContent = text;
            chatLog.appendChild(div);
            chatLog.scrollTop = chatLog.scrollHeight;
        }

        function send() {
            const q = input.value.trim();
            if (!q) return;
            addMessage('user', q);
            input.value = '';
            vscode.postMessage({ type: 'ask', question: q });
        }

        function doLogout() {
            vscode.postMessage({ type: 'logout' });
        }

        sendBtn.addEventListener('click', send);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') send();
        });

        window.addEventListener('message', (event) => {
            const msg = event.data;
            const loadingMsgs = chatLog.querySelectorAll('.loading');
            loadingMsgs.forEach(el => el.remove());

            switch (msg.type) {
                case 'loading':
                    addMessage('loading', 'Thinking...');
                    break;
                case 'answer':
                    addMessage('assistant', msg.summary);
                    break;
                case 'error':
                    addMessage('error', msg.message);
                    break;
            }
        });
    </script>
</body>
</html>`;
    }
}
