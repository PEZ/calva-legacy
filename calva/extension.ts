import * as vscode from 'vscode';
import * as path from "path";

import * as state from './state';
import status from './status';
import connector from './connector';
import terminal from './terminal';
import CalvaCompletionItemProvider from './providers/completion';
import TextDocumentContentProvider from './providers/content';
import HoverProvider from './providers/hover';
import { DefinitionProvider, WslDefinitionProvider } from './providers/definition';
import EvaluateMiddleWare from './repl/middleware/evaluate';
import LintMiddleWare from './repl/middleware/lint';
import TestRunnerMiddleWare from './repl/middleware/testRunner';
import annotations from './providers/annotations';
import select from './repl/middleware/select';
import * as util from './utilities';
import evaluate from "./repl/middleware/evaluate"
import { nClient } from "./connector"

import { readFileSync, stat } from 'fs';

import Analytics from './analytics';

const greetings = require('@cospaia/calva-lib/lib/calva.greet');

function onDidSave(document) {
    let {
        evaluate,
        lint,
        test
    } = state.config();

    if (document.languageId !== 'clojure') {
        return;
    }

    if (test) {
        if (test) {
            TestRunnerMiddleWare.runNamespaceTests(document);
            state.analytics().logEvent("Calva", "OnSaveTest");
        }
    } else if (evaluate) {
        EvaluateMiddleWare.evaluateFile(document);
        state.analytics().logEvent("Calva", "OnSaveLoad");
    }
    if (lint) {
        LintMiddleWare.lintDocument(document);
        state.analytics().logEvent("Calva", "OnSaveLint");
    }
}

function onDidOpen(document) {
    if (document.languageId !== 'clojure') {
        return;
    }

    if (state.config().lint) {
        LintMiddleWare.lintDocument(document);
    }
}


function activate(context: vscode.ExtensionContext) {
    state.cursor.set('analytics', new Analytics(context));
    state.analytics().logPath("/start");
    state.analytics().logEvent("LifeCycle", "Started");

    let newCalvaExtension = vscode.extensions.getExtension('betterthantomorrow.calva');

    if (newCalvaExtension) {
        vscode.window.showErrorMessage("The new Calva extension detected. Please uninstall or diable one of the Calva extensions (probably this one.)", ...["Oh, dear. Of course!"]);
        return false;
    } else {
        if (!context.workspaceState.get("dontNag")) {
            const NO_NAG = "Nice! But don't nag me about this";
            vscode.window.showInformationMessage("This is the Legacy version of Calva. It will be removed from the marketplace very soon. Install the new Calva extension instead.\n\nIf there is something with the new version that makes it not work for you, please update this issue on Github: https://github.com/BetterThanTomorrow/calva/issues/267", ...["Got it!"])
                .then(v => {
                    context.workspaceState.update("dontNag", v == NO_NAG);
                });
        }
    }

    let chan = state.outputChannel();
    chan.appendLine("Calva activated.");
    let {
        autoConnect,
        lint,
        useWSL
    } = state.config();

    status.update();

    context.subscriptions.push(vscode.commands.registerCommand('calva.connect', connector.connect));
    context.subscriptions.push(vscode.commands.registerCommand('calva.reconnect', connector.reconnect));
    context.subscriptions.push(vscode.commands.registerCommand('calva.toggleCLJCSession', connector.toggleCLJCSession));
    context.subscriptions.push(vscode.commands.registerCommand('calva.recreateCljsRepl', connector.recreateCljsRepl));
    context.subscriptions.push(vscode.commands.registerCommand('calva.selectCurrentForm', select.selectCurrentForm));
    context.subscriptions.push(vscode.commands.registerCommand('calva.evaluateFile', EvaluateMiddleWare.evaluateFile));
    context.subscriptions.push(vscode.commands.registerCommand('calva.evaluateSelection', EvaluateMiddleWare.evaluateSelection));
    context.subscriptions.push(vscode.commands.registerCommand('calva.evaluateCurrentTopLevelForm', EvaluateMiddleWare.evaluateTopLevelForm));
    context.subscriptions.push(vscode.commands.registerCommand('calva.evaluateSelectionPrettyPrint', EvaluateMiddleWare.evaluateSelectionPrettyPrint));
    context.subscriptions.push(vscode.commands.registerCommand('calva.evaluateCurrentTopLevelFormPrettyPrint', EvaluateMiddleWare.evaluateCurrentTopLevelFormPrettyPrint));
    context.subscriptions.push(vscode.commands.registerCommand('calva.evaluateSelectionReplace', EvaluateMiddleWare.evaluateSelectionReplace));
    context.subscriptions.push(vscode.commands.registerCommand('calva.lintFile', LintMiddleWare.lintDocument));
    context.subscriptions.push(vscode.commands.registerCommand('calva.runNamespaceTests', TestRunnerMiddleWare.runNamespaceTestsCommand));
    context.subscriptions.push(vscode.commands.registerCommand('calva.runAllTests', TestRunnerMiddleWare.runAllTestsCommand));
    context.subscriptions.push(vscode.commands.registerCommand('calva.rerunTests', TestRunnerMiddleWare.rerunTestsCommand));
    context.subscriptions.push(vscode.commands.registerCommand('calva.openREPLTerminal', terminal.openREPLTerminalCommand));
    context.subscriptions.push(vscode.commands.registerCommand('calva.loadNamespace', terminal.loadNamespaceCommand));
    context.subscriptions.push(vscode.commands.registerCommand('calva.setREPLNamespace', terminal.setREPLNamespaceCommand));
    context.subscriptions.push(vscode.commands.registerCommand('calva.evalCurrentFormInREPLTerminal', terminal.evalCurrentFormInREPLTerminalCommand));
    context.subscriptions.push(vscode.commands.registerCommand('calva.evalCurrentTopLevelFormInREPLTerminal', terminal.evalCurrentTopLevelFormInREPLTerminalCommand));
    context.subscriptions.push(vscode.commands.registerCommand('calva.clearInlineResults', annotations.clearEvaluationDecorations));
    context.subscriptions.push(vscode.commands.registerCommand('calva.copyLastResults', evaluate.copyLastResultCommand));

    // PROVIDERS
    context.subscriptions.push(vscode.languages.registerCompletionItemProvider(state.mode, new CalvaCompletionItemProvider()));
    context.subscriptions.push(vscode.languages.registerHoverProvider(state.mode, new HoverProvider()));
    context.subscriptions.push(vscode.languages.registerDefinitionProvider(state.mode, useWSL ? new WslDefinitionProvider() : new DefinitionProvider()));

    vscode.workspace.registerTextDocumentContentProvider('jar', new TextDocumentContentProvider());

    // //EVENTS
    context.subscriptions.push(vscode.workspace.onDidOpenTextDocument((document) => {
        onDidOpen(document);
    }));
    context.subscriptions.push(vscode.workspace.onDidSaveTextDocument((document) => {
        onDidSave(document);
    }));
    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor((editor) => {
        status.update();
        if (state.config().syncReplNamespaceToCurrentFile) {
            terminal.setREPLNamespace()
        }
    }));
    context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(annotations.onDidChangeTextDocument))
    context.subscriptions.push(new vscode.Disposable(() => {
        connector.disconnect();
        chan.dispose();
    }));

    // context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((event) => {
    //     console.log(event);
    // }));

    vscode.commands.executeCommand('setContext', 'calva:activated', true);

    greetings.activationGreetings(chan, lint);

    //Try to connect using an existing .nrepl-port file, searching the root-directory
    if (autoConnect) {
        chan.appendLine("Autoconnecting... (This can be disabled in Settings)");
        connector.autoConnect();
    } else {
        chan.appendLine("Autoconnect disabled in Settings.")
    }

    // REPL
    function getUrl(name?: string) {
        if (name)
            return vscode.Uri.file(path.join(context.extensionPath, "html", name)).with({ scheme: 'vscode-resource' }).toString()
        else
            return vscode.Uri.file(path.join(context.extensionPath, "html")).with({ scheme: 'vscode-resource' }).toString()
    }
    state.analytics().logPath("/activated");
    state.analytics().logEvent("LifeCycle", "Activated");
}

function deactivate() {
    state.analytics().logEvent("LifeCycle", "Dectivated");
}


export { activate, deactivate };
