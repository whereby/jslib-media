import EventEmitter from "events";
import { getUpdatedStats } from "../webrtc/stats/StatsMonitor/index"
import { PROTOCOL_EVENTS, PROTOCOL_RESPONSES } from "../model/protocol";

const PEER_CONNECTION_RENEW_THRESHOLD = 2500; // reconnects completed withing this threshold can be "glitch-free"

export class ReconnectManager extends EventEmitter {
    constructor(socket) {
        super()
        this._socket = socket;
        this._pendingClientLeft = new Map();
        this._signalConnectTime = undefined
        this._signalDisconnectTime = undefined
        this.rtcManager = undefined;

        socket.on("disconnect", () => {
            this._signalDisconnectTime = Date.now()
        })

        socket.on(PROTOCOL_RESPONSES.ROOM_JOINED, (payload) => this._onRoomJoined(payload))
        socket.on(PROTOCOL_RESPONSES.NEW_CLIENT, (payload) => this._onNewClient(payload))
        socket.on(PROTOCOL_RESPONSES.CLIENT_LEFT, (payload) => this._onClientLeft(payload))
        socket.on(PROTOCOL_EVENTS.PENDING_CLIENT_LEFT, (payload) => this._onPendingClientLeft(payload))
    }

    async _onRoomJoined(payload) {
        // if the signal connection drop is too long, we don't try to make anything glitch free
        if (Date.now() - (this._signalDisconnectTime || 0) > PEER_CONNECTION_RENEW_THRESHOLD) {
            this.emit(PROTOCOL_RESPONSES.ROOM_JOINED, payload)
        }

        const allStats = await getUpdatedStats();
        
        payload.room.clients = payload.room.clients.filter((newClient) => {
            const oldClient = this.rtcManager.peerConnections[newClient.id]
            if (oldClient) {
                let glitchFree = true
                // TODO: verify we want to try and keep it glitch-free when it comes to media
                // rtcManager? look at streams recieved in newClient.streamIds, e.g. [0, 'id_of_screenshare_stream']?
                
                // verify the client is still active (not removed from other end)
                if (!this._isClientMediaActive(allStats, newClient.id))
                    glitchFree = false 

                // TODO: handle if these values have changed
                // newClient.isAudioEnabled;
                // newClient.isVideoEnabled;
                return glitchFree
            }
            return false
        });

        this.emit(PROTOCOL_RESPONSES.ROOM_JOINED, payload)
    }
    
    _onClientLeft (payload) {
        const c = this._pendingClientLeft.get(payload.clientId)
        
        // if we have a pending_client_left for this clientId, remove it
        if (c) {
            clearTimeout(payload.clientId)
            this._pendingClientLeft.delete(payload.clientId)
        }

        this.emit(PROTOCOL_RESPONSES.CLIENT_LEFT, payload)
    }


    _onPendingClientLeft(payload) {
        // TODO: handle eventClaims, perhaps send from signal-server at pending disconnect?
        this._pendingClientLeft.set(payload.clientId, {
            timeout: setTimeout(() => this._abortIfNotActive(payload), 500),
            attempts: 0
            })
    }
    
    _onNewClient (payload) {
        const c = this._pendingClientLeft.get(payload.client.id)
        
        if (c) {
            clearTimeout(c.timeout)
            this._pendingClientLeft.delete(payload.client.id)
            return
        }

        this.emit("new_client", payload)
    }
    
    _isClientMediaActive (stats, clientId) {
        const clientStats = stats?.[clientId];
        let isActive = false;
        if (clientStats) {
            Object.entries(clientStats.tracks).forEach(([trackId, trackStats]) => {
                if (trackId !== "probator")
                    Object.values(trackStats.ssrcs).forEach((ssrcStats) => {
                        if ((ssrcStats.bitrate || 0) > 0) isActive = true;
                    });
            });
        }
        return isActive;
    }

    // checks stats if client is active by looking at bitrates for all tracks
    // TODO: move this to rtcmanager?
    async _checkIsActive (clientId) {
        const allStats = await getUpdatedStats();
        return this._isClientMediaActive(allStats, clientId);
    };

    async _abortIfNotActive (payload) {
        const { clientId } = payload

        let client = this._pendingClientLeft.get(clientId)
        if (!client)
            return

        client.attempts += 1
        if (client.attempts > 3) {
            return
        }
        
        const stillActive = await this._checkIsActive(clientId);
        if (stillActive) {
            client.timeout = setTimeout(() => this._abortIfNotActive(payload), 500);
            return;
        }

        client = this._pendingClientLeft.get(clientId);
        if (client) {
            clearTimeout(client.timeout);
            this._pendingClientLeft.delete(clientId);
            this.emit(PROTOCOL_RESPONSES.CLIENT_LEFT, payload) 
        }
    }
}

