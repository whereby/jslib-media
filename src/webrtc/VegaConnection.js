import VegaParser from "./VegaParser";
import { EventEmitter } from "events";

export default class VegaConnection extends EventEmitter {
    constructor(wsUrl, logger, protocol = "whereby-sfu#v4") {
        super();

        this.wsUrl = wsUrl;
        this.protocol = protocol;
        this.logger = logger;

        // This is the map of sent requests that are waiting for a response
        this.sents = new Map();
        this._setupSocket();
    }

    _setupSocket() {
        this.socket = new WebSocket(this.wsUrl, this.protocol);
        this.socket.onopen = this._onOpen.bind(this);
        this.socket.onmessage = this._onMessage.bind(this);
        this.socket.onclose = this._onClose.bind(this);
        this.socket.onerror = this._onError.bind(this);
    }

    _tearDown() {
        this.socket.onopen = null;
        this.socket.onmessage = null;
        this.socket.onclose = null;
        this.socket.onerror = null;
        this.socket = null;

        this.sents.forEach((sent) => sent.close());

        this.emit("close");
    }

    close() {
        if (!this.socket) return;

        this.socket.close();
    }

    _onOpen() {
        this.logger.log("VegaConnectionManager: Connected");

        this.emit("open");
    }

    _onMessage(event) {
        const socketMessage = VegaParser.parse(event.data);

        if (!socketMessage) {
            return this.logger.log("VegaConnectionManager: Received invalid message", event.data);
        }

        this.logger.log("VegaConnectionManager: Received message", socketMessage);

        if (socketMessage.response) {
            this._handleResponse(socketMessage);
        } else if (socketMessage.message) {
            this.emit("message", socketMessage);
        }
    }

    _onClose() {
        this.logger.log("VegaConnectionManager: Disconnected");

        this._tearDown();
    }

    _onError(error) {
        this.logger.log("VegaConnectionManager: Error", error);
    }

    _handleResponse(socketMessage) {
        const sent = this.sents.get(socketMessage.id);

        if (socketMessage.ok) {
            sent.resolve(socketMessage.data);
        } else {
            const error = new Error(socketMessage.errorReason);
            sent.reject(error);
        }
    }

    send(message) {
        try {
            this.socket.send(JSON.stringify(message));
        } catch (error) {}
    }

    message(method, data = {}) {
        const message = VegaParser.createMessage(method, data);
        this.send(message);
    }

    request(method, data = {}, timeout = 1500 * (15 + 0.1 * this.sents.size)) {
        const request = VegaParser.createRequest(method, data);

        this.send(request);

        return new Promise((pResolve, pReject) => {
            const sent = {
                id: request.id,
                method: request.method,
                resolve: (data2) => {
                    if (!this.sents.delete(request.id)) return;

                    clearTimeout(sent.timer);
                    pResolve(data2);
                },
                reject: (error) => {
                    if (!this.sents.delete(request.id)) return;

                    clearTimeout(sent.timer);
                    pReject(error);
                },
                timer: setTimeout(() => {
                    if (!this.sents.delete(request.id)) return;

                    pReject(new Error("request timeout"));
                }, timeout),
                close: () => {
                    clearTimeout(sent.timer);
                    pReject(new Error("transport closed"));
                },
            };

            this.sents.set(request.id, sent);
        });
    }
}
