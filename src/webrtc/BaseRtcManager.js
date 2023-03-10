import * as CONNECTION_STATUS from "../model/connectionStatusConstants";
import { RELAY_MESSAGES, PROTOCOL_REQUESTS, PROTOCOL_RESPONSES } from "../model/protocol";
import adapter from "webrtc-adapter";
import ServerSocket from "../utils/ServerSocket";
import rtcManagerEvents from "./rtcManagerEvents";
import Session from "./Session";
import assert from "assert";
import { MAXIMUM_TURN_BANDWIDTH, MAXIMUM_TURN_BANDWIDTH_PREMIUM } from "../utils/turnConstants";
import { CAMERA_STREAM_ID } from "../utils/constants";

const logger = console;

const browserName = adapter.browserDetails.browser;
const browserVersion = adapter.browserDetails.version;

export default class BaseRtcManager {
    constructor({ selfId, room, emitter, serverSocket, webrtcProvider, features }) {
        assert.ok(selfId, "selfId is required");
        assert.ok(room, "room is required");
        assert.ok(emitter && emitter.emit, "emitter is required");
        assert.ok(serverSocket instanceof ServerSocket, "serverSocket is required");
        assert.ok(webrtcProvider, "webrtcProvider is required");

        const { name, session, iceServers, sfuServer, mediaserverConfigTtlSeconds } = room;

        this._selfId = selfId;
        this._roomName = name;
        this._roomSessionId = session && session.id;
        this.peerConnections = {};
        this.localStreams = {};
        this.enabledLocalStreamIds = [];
        this._socketListenerDeregisterFunctions = [];
        this._emitter = emitter;
        this._serverSocket = serverSocket;
        this._webrtcProvider = webrtcProvider;
        this._features = features || {};

        this.offerOptions = { offerToReceiveAudio: true, offerToReceiveVideo: true };
        this._pendingActionsForConnectedPeerConnections = [];

        this._updateAndScheduleMediaServersRefresh({
            sfuServer,
            iceServers: iceServers.iceServers || [],
            mediaserverConfigTtlSeconds,
        });
    }

    numberOfPeerconnections() {
        return Object.keys(this.peerConnections).length;
    }

    numberOfRemotePeers() {
        return Object.values(this.peerConnections).filter((session) => session.clientId !== this._selfId).length;
    }

    _setConnectionStatus(session, newStatus, clientId) {
        const previousStatus = session.connectionStatus;
        if (previousStatus === newStatus) {
            return;
        }

        // prevent showing 'connecting' in the SFU case.
        if (session.peerConnectionId === this._selfId) {
            return;
        }

        // Never go from disconnected -> checking
        if (
            previousStatus === CONNECTION_STATUS.TYPES.CONNECTION_DISCONNECTED &&
            newStatus === CONNECTION_STATUS.TYPES.CONNECTING
        ) {
            return;
        }
        session.connectionStatus = newStatus;

        setTimeout(() => {
            this._emit(CONNECTION_STATUS.EVENTS.CLIENT_CONNECTION_STATUS_CHANGED, {
                streamIds: session.streamIds,
                clientId,
                status: newStatus,
                previous: previousStatus,
            });
        }, 0);
    }

    _emitServerEvent(eventName, data, callback) {
        this._serverSocket.emit(eventName, data, callback);
    }

    _emit(eventName, data) {
        this._emitter.emit(eventName, data);
    }

    isInitializedWith({ selfId, roomName, isSfu }) {
        return this._selfId === selfId && this._roomName === roomName && isSfu === !!this._sfuServer;
    }

    supportsScreenShareAudio() {
        return true;
    }

    _addEnabledLocalStreamId(streamId) {
        this.enabledLocalStreamIds.push(streamId);
    }

    _deleteEnabledLocalStreamId(streamId) {
        const index = this.enabledLocalStreamIds.indexOf(streamId);
        if (index !== -1) {
            this.enabledLocalStreamIds.splice(index, 1);
        }
    }

    _getSession(peerConnectionId) {
        if (!(peerConnectionId in this.peerConnections)) {
            return null;
        }
        return this.peerConnections[peerConnectionId];
    }

    _getOrCreateSession(peerConnectionId, initialBandwidth) {
        let session = this.peerConnections[peerConnectionId];

        if (session === undefined) {
            // Some macs + ios devices have troubles using h264 encoder since safari 14
            // this will make them encode VP8 instead if available
            const deprioritizeH264Encoding =
                browserName === "safari" && browserVersion >= 14 && this._features.deprioritizeH264OnSafari;

            this.peerConnections[peerConnectionId] = session = new Session({
                peerConnectionId,
                bandwidth: initialBandwidth,
                maximumTurnBandwidth: this._features.restrictBandwidthWhenUsingRelay
                    ? MAXIMUM_TURN_BANDWIDTH
                    : MAXIMUM_TURN_BANDWIDTH_PREMIUM,
                deprioritizeH264Encoding,
            });
        }
        return session;
    }

    _getLocalCameraStream() {
        return this.localStreams[CAMERA_STREAM_ID];
    }

    _getNonLocalCameraStreamIds() {
        return Object.keys(this.localStreams).filter((streamId) => streamId !== CAMERA_STREAM_ID);
    }

    _isScreensharingLocally() {
        return this._getNonLocalCameraStreamIds().length > 0;
    }

    _getFirstLocalNonCameraStream() {
        const streamIds = this._getNonLocalCameraStreamIds();
        return streamIds.length === 0 ? null : this.localStreams[streamIds[0]];
    }

    _transformIncomingSdp(original) {
        return { type: original.type, sdp: original.sdpU };
    }

    _transformOutgoingSdp(original) {
        return { type: original.type, sdpU: original.sdp };
    }

    _createSession({ clientId, initialBandwidth, isOfferer, peerConnectionId, shouldAddLocalVideo }) {
        if (!peerConnectionId) {
            throw new Error("peerConnectionId is missing");
        }
        if (!clientId) {
            throw new Error("clientId is missing");
        }
        const session = this._getOrCreateSession(peerConnectionId, initialBandwidth);
        const constraints = { optional: [] };
        if (browserName === "chrome") {
            constraints.optional.push({
                googCpuOveruseDetection: true,
            });
        }

        const peerConnectionConfig = {
            iceServers: this._iceServers,
        };
        if (this._features.turnServerOverrideHost) {
            const host = this._features.turnServerOverrideHost;
            const port = host.indexOf(":") > 0 ? "" : ":443";
            const override = ":" + host + port;
            peerConnectionConfig.iceServers = peerConnectionConfig.iceServers.map((original) => {
                const entry = Object.assign({}, original);
                if (entry.url) {
                    entry.url = entry.url.replace(/:[^?]*/, override);
                }
                if (entry.urls) {
                    entry.urls = entry.urls.map((url) => url.replace(/:[^?]*/, override));
                }
                return entry;
            });
        }
        if (this._features.useOnlyTURN) {
            peerConnectionConfig.iceTransportPolicy = "relay";
            const filter = {
                onlyudp: /^turn:.*transport=udp$/,
                onlytcp: /^turn:.*transport=tcp$/,
                onlytls: /^turns:.*transport=tcp$/,
            }[this._features.useOnlyTURN];
            if (filter) {
                peerConnectionConfig.iceServers = peerConnectionConfig.iceServers.filter(
                    (entry) => entry.url && entry.url.match(filter)
                );
            }
        }

        if (browserName === "chrome") {
            peerConnectionConfig.sdpSemantics = "unified-plan";
        }

        const pc = session.setAndGetPeerConnection({
            constraints,
            peerConnectionConfig,
            shouldAddLocalVideo,
            clientId,
        });

        pc.ontrack = (event) => {
            const stream = event.streams[0];
            if (stream.id === "default" && stream.getAudioTracks().length === 0) {
                // due to our PlanB / UnifiedPlan conversion we can run into this:
                // https://bugs.chromium.org/p/webrtc/issues/detail?id=8228
                // and ignore it.
                return;
            }
            // ontrack fires for each track of a stream. Emulate old onaddstream behaviour.
            if (session.streamIds.indexOf(stream.id) === -1) {
                session.streamIds.push(stream.id);
                this._emit(CONNECTION_STATUS.EVENTS.STREAM_ADDED, {
                    clientId,
                    stream,
                });

                // when adding a new stream to an already established connection
                // we need to tell the GUI about it.
                if (session.connectionStatus === CONNECTION_STATUS.TYPES.CONNECTION_SUCCESSFUL) {
                    setTimeout(() => {
                        this._emit(CONNECTION_STATUS.EVENTS.CLIENT_CONNECTION_STATUS_CHANGED, {
                            streamIds: session.streamIds,
                            clientId,
                            status: session.connectionStatus,
                            previous: CONNECTION_STATUS.TYPES.CONNECTING,
                        });
                    }, 0);
                }
            }
        };

        pc.oniceconnectionstatechange = () => {
            let newStatus;
            const currentStatus = session.connectionStatus;
            switch (pc.iceConnectionState) {
                case "checking":
                    newStatus = CONNECTION_STATUS.TYPES.CONNECTING;
                    break;
                case "connected":
                case "completed":
                    newStatus = CONNECTION_STATUS.TYPES.CONNECTION_SUCCESSFUL;
                    if (!session.wasEverConnected) {
                        this._pendingActionsForConnectedPeerConnections.forEach((action) => {
                            if (typeof action === "function") {
                                action();
                            }
                        });
                        this._pendingActionsForConnectedPeerConnections = [];
                    }
                    // working around the fact that chrome does not go to completed for the
                    // ice-controlled answerer
                    if (
                        !session.wasEverConnected &&
                        (pc.iceConnectionState.match(/connected|completed/) ||
                            (browserName === "chrome" && pc.localDescription && pc.localDescription.type === "answer"))
                    ) {
                        session.wasEverConnected = true;
                        if (this._features.bandwidth !== "false") {
                            this.maybeRestrictRelayBandwidth(session);
                        }
                    }
                    session.registerConnected();
                    break;
                case "disconnected":
                    newStatus = CONNECTION_STATUS.TYPES.CONNECTION_DISCONNECTED;
                    setTimeout(() => {
                        if (pc.iceConnectionState === "disconnected") {
                            this._maybeRestartIce(clientId, session);
                        }
                    }, 2000);
                    break;
                case "failed":
                    newStatus = CONNECTION_STATUS.TYPES.CONNECTION_FAILED;
                    if (currentStatus !== newStatus) {
                        this._maybeRestartIce(clientId, session);
                    }
                    if (session.relayCandidateSeen === null && !session.wasEverConnected) {
                        // this means we did not gather any relay candidates.
                        // which shows that we are on a restricted network and it is an
                        // issue on the local end.
                        // Should not trigger if we  were ever connected.
                        this._emit(rtcManagerEvents.CONNECTION_BLOCKED_BY_NETWORK);
                    }
                    break;
                default:
                    // other states are not interesting
                    return;
            }
            this._setConnectionStatus(session, newStatus, clientId);
        };
        pc.onconnectionstate = () => {
            // since Chrome insists on not going to failed for unified-plan
            // (/new-iceconnectionstate)... listen for connectionState.
            // See also
            //   https://bugs.chromium.org/p/chromium/issues/detail?id=933786
            //   https://bugs.chromium.org/p/chromium/issues/detail?id=982793
            switch (pc.connectionState) {
                case "connected":
                    // try to detect audio problems.
                    // this waits 3 seconds after the connection is up
                    // to be sure the DTLS handshake is done even in Firefox.
                    session.registerConnected();
                    break;
                case "failed":
                    const newStatus = CONNECTION_STATUS.TYPES.CONNECTION_FAILED;
                    if (session.relayCandidateSeen === null && !session.wasEverConnected) {
                        // this means we did not gather any relay candidates.
                        // which shows that we are on a restricted network and it is an
                        // issue on the local end.
                        // Should not trigger if we  were ever connected.
                        this._emit(rtcManagerEvents.CONNECTION_BLOCKED_BY_NETWORK);
                    }
                    this._setConnectionStatus(session, newStatus, clientId);
                    break;
            }
        };

        const localCameraStream = this.localStreams[CAMERA_STREAM_ID];
        if (shouldAddLocalVideo && localCameraStream) {
            session.addStream(localCameraStream);
        }

        // Don't add existing screenshare-streams when using SFU as those will be
        // added in a separate session/peerConnection
        if (shouldAddLocalVideo) {
            Object.keys(this.localStreams).forEach((id) => {
                if (id === CAMERA_STREAM_ID) {
                    return;
                }
                const screenshareStream = this.localStreams[id];
                // if we are offering it's safe to add screensharing streams in initial offer
                if (isOfferer) {
                    session.addStream(screenshareStream);
                } else {
                    // if not we are here because of reconnecting, and will need to start screenshare
                    // after connection is ready
                    session.afterConnected.then(() => {
                        this._emitServerEvent(PROTOCOL_REQUESTS.START_SCREENSHARE, {
                            receiverId: session.clientId,
                            streamId: screenshareStream.id,
                            hasAudioTrack: !!screenshareStream.getAudioTracks().length,
                        });
                        this._withForcedRenegotiation(session, () => session.addStream(screenshareStream));
                    });
                }
            });
        }

        return session;
    }

    _cleanup(peerConnectionId) {
        const session = this._getSession(peerConnectionId);
        if (!session) {
            logger.warn("No RTCPeerConnection in RTCManager.disconnect()", peerConnectionId);
            return;
        }
        session.close();
        delete this.peerConnections[peerConnectionId];
    }

    _forEachPeerConnection(func) {
        Object.keys(this.peerConnections).forEach((peerConnectionId) => {
            const peerConnection = this.peerConnections[peerConnectionId];
            func(peerConnection);
        });
    }

    _addStreamToPeerConnections(stream) {
        this._forEachPeerConnection((session) => {
            this._withForcedRenegotiation(session, () => session.addStream(stream));
        });
    }

    _addTrackToPeerConnections(track, stream) {
        this._forEachPeerConnection((session) => {
            this._withForcedRenegotiation(session, () => session.addTrack(track, stream));
        });
    }

    _replaceTrackToPeerConnections(oldTrack, newTrack) {
        const promises = [];
        this._forEachPeerConnection((session) => {
            if (!session.hasConnectedPeerConnection()) {
                logger.log("Session doesn't have a connected PeerConnection, adding pending action!");
                const pendingActions = this._pendingActionsForConnectedPeerConnections;
                if (!pendingActions) {
                    logger.warn(
                        `No pending action is created to repalce track, because the pending actions array is null`
                    );
                    return;
                }
                const promise = new Promise((resolve, reject) => {
                    const action = () => {
                        const replacedTrackPromise = session.replaceTrack(oldTrack, newTrack);
                        if (!replacedTrackPromise) {
                            logger.error("replaceTrack returned false!");
                            reject(`ReplaceTrack returned false`);
                            return;
                        }
                        replacedTrackPromise.then((track) => resolve(track)).catch((error) => reject(error));
                    };
                    pendingActions.push(action);
                });
                promises.push(promise);
                return;
            }
            const replacedTrackResult = session.replaceTrack(oldTrack, newTrack);
            if (!replacedTrackResult) {
                logger.error("replaceTrack returned false!");
                return;
            }
            promises.push(replacedTrackResult);
        });
        return Promise.all(promises);
    }

    _removeStreamFromPeerConnections(stream) {
        this._forEachPeerConnection((session) => {
            this._withForcedRenegotiation(session, () => session.removeStream(stream));
        });
    }

    _removeTrackFromPeerConnections(track) {
        this._forEachPeerConnection((session) => {
            this._withForcedRenegotiation(session, () => session.removeTrack(track));
        });
    }

    _addLocalStream(streamId, stream) {
        this._addEnabledLocalStreamId(streamId);
        this.localStreams[streamId] = stream;
    }

    _removeLocalStream(streamId) {
        delete this.localStreams[streamId];
        this._deleteEnabledLocalStreamId(streamId);
    }

    maybeRestrictRelayBandwidth(session) {
        session.maybeRestrictRelayBandwidth();
    }

    addNewStream(streamId, stream) {
        if (stream === this.localStreams[streamId]) {
            // this can happen after reconnect. We do not want to add the stream to the
            // peerconnection again.
            return;
        }

        this._addLocalStream(streamId, stream);

        if (streamId === CAMERA_STREAM_ID) {
            this._addStreamToPeerConnections(stream);
            return;
        }

        // at this point it is clearly a screensharing stream.
        this._shareScreen(streamId, stream);
        return;
    }

    removeStream(streamId, stream) {
        // essentially we only ever remove screensharing streams.
        // SFU and P2P provide their own ways of doing this.
        this._removeLocalStream(streamId, stream);
    }

    replaceTrack(oldTrack, newTrack) {
        return this._replaceTrackToPeerConnections(oldTrack, newTrack);
    }

    accept({ clientId, shouldAddLocalVideo }) {
        return this.acceptNewStream({ streamId: clientId, clientId, shouldAddLocalVideo });
    }

    disconnectAll() {
        Object.keys(this.peerConnections).forEach((peerConnectionId) => {
            this.disconnect(peerConnectionId);
        });
        this.peerConnections = {};
        this._socketListenerDeregisterFunctions.forEach((func) => {
            func();
        });
        this._socketListenerDeregisterFunctions = [];
    }

    // the user has muted/unmuted the audio track on the local stream.
    stopOrResumeAudio(/*localStream, enable*/) {}

    // the user has muted/unmuted the video track on the local stream.
    stopOrResumeVideo(/*localStream, enable*/) {}

    /* the Chrome audio process crashed (probably?)
     * try to fix it. Constraints are the audio device constraints
     * used in getUserMedia.
     */
    fixChromeAudio(constraints) {
        if (browserName !== "chrome") {
            return;
        }
        const localStream = this._getLocalCameraStream();
        const audioTrack = localStream.getAudioTracks()[0];
        if (!audioTrack || audioTrack.readyState !== "ended") {
            return;
        }
        return navigator.mediaDevices.getUserMedia({ audio: constraints }).then((stream) => {
            const track = stream.getAudioTracks()[0];
            track.enabled = audioTrack.enabled; // retain mute state and don't accidentally unmute.
            localStream.removeTrack(audioTrack); // remove the old track.
            localStream.addTrack(track); // add the new track.
            return this.replaceTrack(audioTrack, track);
        });
    }

    _updateAndScheduleMediaServersRefresh({ iceServers, sfuServer, mediaserverConfigTtlSeconds }) {
        this._iceServers = iceServers;
        this._sfuServer = sfuServer;
        this._mediaserverConfigTtlSeconds = mediaserverConfigTtlSeconds;

        this._clearMediaServersRefresh();
        if (!mediaserverConfigTtlSeconds) {
            return;
        }
        this._fetchMediaServersTimer = setTimeout(
            () => this._emitServerEvent(PROTOCOL_REQUESTS.FETCH_MEDIASERVER_CONFIG),
            mediaserverConfigTtlSeconds * 1000
        );
    }

    _clearMediaServersRefresh() {
        if (!this._fetchMediaServersTimer) return;
        clearTimeout(this._fetchMediaServersTimer);
        this._fetchMediaServersTimer = null;
    }

    setupSocketListeners() {
        this._socketListenerDeregisterFunctions = [
            () => this._clearMediaServersRefresh(),

            this._serverSocket.on(PROTOCOL_RESPONSES.MEDIASERVER_CONFIG, (data) => {
                if (data.error) {
                    logger.warn("FETCH_MEDIASERVER_CONFIG failed:", data.error);
                    return;
                }
                this._updateAndScheduleMediaServersRefresh(data);
            }),

            this._serverSocket.on(RELAY_MESSAGES.READY_TO_RECEIVE_OFFER, (data) => {
                this._connect(data.clientId);
            }),

            this._serverSocket.on(RELAY_MESSAGES.ICE_CANDIDATE, (data) => {
                const session = this._getSession(data.clientId);
                if (!session) {
                    logger.warn("No RTCPeerConnection on ICE_CANDIDATE", data);
                    return;
                }
                session.addIceCandidate(data.message);
            }),

            this._serverSocket.on(RELAY_MESSAGES.ICE_END_OF_CANDIDATES, (data) => {
                const session = this._getSession(data.clientId);
                if (!session) {
                    logger.warn("No RTCPeerConnection on ICE_END_OF_CANDIDATES", data);
                    return;
                }
                session.addIceCandidate(null);
            }),

            // when a new SDP offer is received from another client
            this._serverSocket.on(RELAY_MESSAGES.SDP_OFFER, (data) => {
                const session = this._getSession(data.clientId);
                if (!session) {
                    logger.warn("No RTCPeerConnection on SDP_OFFER", data);
                    return;
                }
                const offer = this._transformIncomingSdp(data.message, session.pc);
                session.handleOffer(offer).then((answer) => {
                    this._emitServerEvent(RELAY_MESSAGES.SDP_ANSWER, {
                        receiverId: data.clientId,
                        message: this._transformOutgoingSdp(answer),
                    });
                });
            }),

            // when a new SDP answer is received from another client
            this._serverSocket.on(RELAY_MESSAGES.SDP_ANSWER, (data) => {
                const session = this._getSession(data.clientId);
                if (!session) {
                    logger.warn("No RTCPeerConnection on SDP_ANSWER", data);
                    return;
                }
                const answer = this._transformIncomingSdp(data.message, session.pc);
                session.handleAnswer(answer);
            }),
        ];
    }

    setRoomSessionId(roomSessionId) {
        this._roomSessionId = roomSessionId;
    }
}
