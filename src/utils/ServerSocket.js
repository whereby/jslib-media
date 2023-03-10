import io from "socket.io-client";
import adapter from "webrtc-adapter";

/**
 * Wrapper class that extends the Socket.IO client library.
 */
export default class ServerSocket {
    constructor(hostName, options) {
        // Prefer websockets but fallback to polling as recommended on
        // https://socket.io/docs/client-api/
        // with modifications to reconnect using WebSocket if we ever
        // connected with Websockets.
        if (options && !options.transports) {
            options.transports = ["websocket"];
        }

        this._socket = io(hostName, options);
        this._socket.on("reconnect", () => {
            this._socket.sendBuffer = [];
        });
        this._socket.on("reconnect_attempt", () => {
            if (this._wasConnectedUsingWebsocket) {
                this._socket.io.opts.transports = ["websocket"];
                // only fallback to polling if not safari
                // safari doesn't support cross doamin cookies making load-balancer stickiness not work
                // and if socket.io reconnects to another signal instance with polling it will fail
                // remove if we move signal to a whereby.com subdomain
                if (adapter.browserDetails.browser !== "safari") delete this._wasConnectedUsingWebsocket;
            } else {
                this._socket.io.opts.transports = ["polling", "websocket"];
            }
        });
        this._socket.on("connect", () => {
            const transport = this.getTransport();
            if (transport === "websocket") {
                this._wasConnectedUsingWebsocket = true;
            }
        });
    }

    connect() {
        if (this.isConnected() || this.isConnecting()) {
            return;
        }
        this._socket.open();
    }

    disconnect() {
        this._socket.disconnect();
    }

    disconnectOnConnect() {
        this._socket.once("connect", () => {
            this._socket.disconnect();
        });
    }

    emit() {
        this._socket.emit.apply(this._socket, arguments);
    }

    emitIfConnected(eventName, data) {
        if (!this.isConnected()) {
            return;
        }
        this.emit(eventName, data);
    }

    getTransport() {
        return (
            this._socket &&
            this._socket.io &&
            this._socket.io.engine &&
            this._socket.io.engine.transport &&
            this._socket.io.engine.transport.name
        );
    }

    isConnecting() {
        return this._socket && this._socket.connecting;
    }

    isConnected() {
        return this._socket && this._socket.connected;
    }

    /**
     * Register a new event handler.
     *
     * @param {string} eventName - Name of the event to listen for.
     * @param {function} handler - The callback function that should be called for the event.
     * @returns {function} Function to deregister the listener.
     */
    on(eventName, handler) {
        this._socket.on(eventName, handler);

        return () => {
            this._socket.off(eventName, handler);
        };
    }

    /**
     * Register a new event handler to be triggered only once.
     *
     * @param {string} eventName - Name of the event to listen for.
     * @param {function} handler - The function that should be called for the event.
     */
    once(eventName, handler) {
        this._socket.once(eventName, handler);
    }

    /**
     * Deregister an event handler.
     *
     * @param {string} eventName - Name of the event the handler is registered for.
     * @param {function} handler - The callback that will be deregistered.
     */
    off(eventName, handler) {
        this._socket.off(eventName, handler);
    }
}
