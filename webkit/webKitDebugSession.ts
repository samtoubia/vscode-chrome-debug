/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import {Response} from '../common/v8Protocol';
import {DebugSession, ErrorDestination} from '../common/debugSession';
import {WebKitDebugAdapter} from './webKitDebugAdapter';

import {AdapterProxy} from '../adapter/adapterProxy';
import {LineNumberTransformer} from '../adapter/lineNumberTransformer';
import {SourceMapTransformer} from '../adapter/sourceMaps/sourceMapTransformer';

export class WebKitDebugSession extends DebugSession {
    private _adapterProxy: AdapterProxy;

    public constructor(targetLinesStartAt1: boolean, isServer: boolean = false) {
        super(targetLinesStartAt1, isServer);
        Logger.init(isServer);

        this._adapterProxy = new AdapterProxy(
            [
                new LineNumberTransformer(targetLinesStartAt1),
                new SourceMapTransformer()
            ],
            new WebKitDebugAdapter(),
            event => this.sendEvent(event));
    }

    /**
     * Overload sendEvent to log
     */
    public sendEvent(event: DebugProtocol.Event): void {
        Logger.log(`To client: ${JSON.stringify(event) }`);
        super.sendEvent(event);
    }

    /**
     * Overload sendResponse to log
     */
    public sendResponse(response: DebugProtocol.Response): void {
        Logger.log(`To client: ${JSON.stringify(response) }`);
        super.sendResponse(response);
    }

    /**
     * Takes a response and a promise to the response body. If the promise is successful, assigns the response body and sends the response.
     * If the promise fails, sets the appropriate response parameters and sends the response.
     */
    private sendResponseAsync(request: DebugProtocol.Request, response: DebugProtocol.Response, responseP: Promise<any>): void {
        responseP.then(
            (body?) => {
                response.body = body;
                this.sendResponse(response);
            },
            e => {
                const eStr = e.toString();
                if (eStr === 'unknowncommand') {
                    this.sendErrorResponse(response, 1014, 'Unrecognized request', null, ErrorDestination.Telemetry);
                    return;
                }

                Logger.log(e.toString());
                if (request.command === 'evaluate') {
                    // Errors from evaluate show up in the console or watches pane. Doesn't seem right
                    // as it's not really a failed request. So it doesn't need the tag and worth special casing.
                    response.message = e.toString();
                } else {
                    // These errors show up in the message bar at the top (or nowhere), sometimes not obvious that they
                    // come from the adapter
                    response.message = '[webkit-debug-adapter] ' + e.toString();
                }

                response.success = false;
                this.sendResponse(response);
            });
    }

    /**
     * Overload dispatchRequest to dispatch to the adapter proxy instead of debugSession's methods for each request.
     */
    protected dispatchRequest(request: DebugProtocol.Request): void {
        const response = new Response(request);
        try {
            Logger.log(`From client: ${request.command}(${JSON.stringify(request.arguments) })`);
            this.sendResponseAsync(
                request,
                response,
                this._adapterProxy.dispatchRequest(request));
        } catch (e) {
            this.sendErrorResponse(response, 1104, 'Exception while processing request (exception: {_exception})', { _exception: e.message }, ErrorDestination.Telemetry);
        }
    }
}

/**
 * Holds a singleton to manage access to console.log.
 * Logging is only allowed when running in server mode, because otherwise it goes through the same channel that Code uses to
 * communicate with the adapter, which can cause communication issues.
 * ALLOW_LOGGING should be set to false when packaging and releasing to ensure it's always disabled.
 */
export class Logger {
    private static ALLOW_LOGGING = true;

    private static _logger: Logger;
    private _isServer: boolean;

    public static log(msg: string): void {
        if (this._logger) this._logger._log(msg);
    }

    public static init(isServer: boolean): void {
        this._logger = new Logger(isServer);

        // Logs tend to come in bursts, so this is useful for providing separation between groups of events that were logged at the same time
        setInterval(() => Logger.log('-'), 1000);
    }

    constructor(isServer: boolean) {
        this._isServer = isServer;
    }

    private _log(msg: string): void {
        if (this._isServer && Logger.ALLOW_LOGGING) console.log(msg);
    }
}
