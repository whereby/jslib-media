import BaseRtcManager from "./BaseRtcManager";
import { PROTOCOL_REQUESTS, RELAY_MESSAGES } from "../model/protocol";
import * as CONNECTION_STATUS from "../model/connectionStatusConstants";

import adapter from "webrtc-adapter";
import { CAMERA_STREAM_ID } from "../utils/constants";

const logger = console;
const browserName = adapter.browserDetails.browser;
export default class P2pRtcManager extends BaseRtcManager {
    _connect(clientId) {
        const shouldAddLocalVideo = true;
        let session = this._getSession(clientId);
        let bandwidth = (session && session.bandwidth) || 0;
        if (session) {
            logger.warn("Replacing peer session", clientId);
            this._cleanup(clientId);
        } else {
            bandwidth = this._changeBandwidthForAllClients(true);
        }
        session = this._createP2pSession(clientId, bandwidth, shouldAddLocalVideo, true);
        this._negotiatePeerConnection(clientId, session);
        return Promise.resolve(session);
    }

    _maybeRestartIce(clientId, session) {
        const pc = session.pc;
        if (!(pc.iceConnectionState === "disconnected" || pc.iceConnectionState === "failed")) {
            return;
        }

        // Only automatically try to restart if you sent the original offer
        if (pc.localDescription.type === "offer") {
            // clean up some helpers.
            session.wasEverConnected = false;
            session.relayCandidateSeen = false;

            this._negotiatePeerConnection(
                clientId,
                session,
                Object.assign({}, this.offerOptions, { iceRestart: true })
            );
        }
    }

    _negotiatePeerConnection(clientId, session, constraints) {
        if (!session) {
            logger.warn("No RTCPeerConnection in negotiatePeerConnection()", clientId);
            return;
        }
        const pc = session.pc;
        if (!session.canModifyPeerConnection()) {
            session.pending.push(() => {
                this._negotiatePeerConnection(clientId, session, constraints);
            });
            return;
        }
        session.isOperationPending = true;

        pc.createOffer(constraints || this.offerOptions)
            .then((offer) => {
                this._emitServerEvent(RELAY_MESSAGES.SDP_OFFER, {
                    receiverId: clientId,
                    message: this._transformOutgoingSdp(offer),
                });

                // workaround for https://bugzilla.mozilla.org/show_bug.cgi?id=1394602
                // make Chrome send media later when there are two (more more?) video tracks.
                if (
                    browserName === "chrome" &&
                    pc.getSenders().filter((sender) => sender.track && sender.track.kind === "video").length >= 2
                ) {
                    session.pendingOffer = offer;
                    return;
                }
                pc.setLocalDescription(offer).catch((e) => {
                    logger.warn("RTCPeerConnection.setLocalDescription() failed with local offer", e);
                });
            })
            .catch((e) => {
                logger.warn("RTCPeerConnection.createOffer() failed to create local offer", e);
            });
    }

    _withForcedRenegotiation(session, action) {
        const pc = session.pc;
        const originalOnnegotationneeded = pc.onnegotationneeded;
        pc.onnegotiationneeded = null;
        action();
        this._negotiatePeerConnection(session.clientId, session);
        setTimeout(() => (pc.onnegotiationneeded = originalOnnegotationneeded), 0);
    }

    // implements a strategy to change the bandwidth for all clients (without negotiation)
    // returns bandwidth so it can be used as initial bandwidth for new client.
    _changeBandwidthForAllClients(isJoining) {
        let numPeers = this.numberOfPeerconnections();
        if (isJoining) {
            // client will be added to RTCManager.peerConnections afterwards
            numPeers += 1;
        }

        if (numPeers === 0) {
            return 0;
        }

        if (numPeers > 7) {
            // use last table value.
            numPeers = 7;
        }

        // We use a slightly different curve in premium to give better quality when
        // there are few participants.
        const bandwidth = this._features.bandwidth
            ? parseInt(this._features.bandwidth, 10)
            : {
                  1: 0,
                  2: this._features.highP2PBandwidth ? 768 : 384,
                  3: this._features.highP2PBandwidth ? 512 : 256,
                  4: 192,
                  5: 128,
                  6: 128,
                  7: 64,
              }[numPeers];

        if (bandwidth === undefined) {
            return 0;
        }

        this._forEachPeerConnection((session) => {
            session.changeBandwidth(bandwidth);
        });

        return bandwidth;
    }

    _createP2pSession(clientId, initialBandwidth, shouldAddLocalVideo, isOfferer) {
        const session = this._createSession({
            peerConnectionId: clientId,
            clientId,
            initialBandwidth,
            shouldAddLocalVideo,
            isOfferer,
        });
        const pc = session.pc;

        /*
         * Explicitly add the video track so that stopOrResumeVideo() can
         * replace it when the video is re-enabled.
         */
        const localCameraStream = this.localStreams[CAMERA_STREAM_ID];
        if (
            shouldAddLocalVideo &&
            localCameraStream &&
            !localCameraStream.getVideoTracks().length &&
            this._stoppedVideoTrack
        ) {
            pc.addTrack(this._stoppedVideoTrack, localCameraStream);
        }

        pc.onicecandidate = (event) => {
            if (event.candidate) {
                session.relayCandidateSeen = session.relayCandidateSeen || event.candidate.type === "relay";
                this._emitServerEvent(RELAY_MESSAGES.ICE_CANDIDATE, {
                    receiverId: clientId,
                    message: event.candidate,
                });
            } else {
                this._emitServerEvent(RELAY_MESSAGES.ICE_END_OF_CANDIDATES, {
                    receiverId: clientId,
                });
            }
        };

        pc.onnegotiationneeded = () => {
            if (pc.iceConnectionState === "new" || !session.connectionStatus) {
                // initial negotiation is handled by our CLIENT_READY/READY_TO_RECEIVE_OFFER exchange
                return;
            }
            this._negotiatePeerConnection(clientId, session);
        };
        return session;
    }

    /**
     * Possibly start a new peer connection for the new stream if needed.
     */
    acceptNewStream({ streamId, clientId, shouldAddLocalVideo }) {
        let session = this._getSession(clientId);
        if (session && streamId !== clientId) {
            // we are adding a screenshare stream to existing session/pc
            return session;
        }
        let bandwidth = (session && session.bandwidth) || 0;
        if (session) {
            // this will happen on a signal-server reconnect
            // before we tried an ice-restart here, now we recreate the session/pc
            logger.warn("Replacing peer session", clientId);
            this._cleanup(clientId); // will cleanup and delete session/pc
        } else {
            // we adjust bandwidth based on number of sessions/pcs
            // so only needed when streamId === clientId (camera) and we're not replacing beacuse of reconnect
            bandwidth = this._changeBandwidthForAllClients(true);
        }
        session = this._createP2pSession(clientId, bandwidth, shouldAddLocalVideo);
        this._emitServerEvent(RELAY_MESSAGES.READY_TO_RECEIVE_OFFER, {
            receiverId: clientId,
        });
        return session;
    }

    disconnect(clientId) {
        this._cleanup(clientId);
        this._changeBandwidthForAllClients(false);
        const numPeers = this.numberOfPeerconnections();
        if (numPeers === 0) {
            setTimeout(() => {
                const numPeers = this.numberOfPeerconnections();
            }, 60 * 1000);
        }
    }

    // this does not (currently) make sense for peer-to-peer connections
    updateStreamResolution(/* streamId, clientId, resolution */) {}

    stopOrResumeAudio(/*localStream, enable*/) {
        // detaches the audio from the peerconnection. No-op in P2P mode.
    }

    stopOrResumeVideo(localStream, enable) {
        // actually turn off the camera. Chrome-only (Firefox has different plans)
        if (browserName !== "chrome") {
            return;
        }
        if (enable === false) {
            // try to stop the local camera so the camera light goes off.
            setTimeout(() => {
                localStream.getVideoTracks().forEach((track) => {
                    if (track.enabled === false) {
                        track.stop();
                        localStream.removeTrack(track);
                        this._emit(CONNECTION_STATUS.EVENTS.LOCAL_STREAM_TRACK_REMOVED, {
                            stream: localStream,
                            track,
                        });

                        this._stoppedVideoTrack = track;
                    }
                });
            }, 5000);
        } else {
            if (this._features.simplifiedVegaClientOn) {
                const track = localStream.getVideoTracks()?.[0];

                if (this._stoppedVideoTrack) {
                    this._replaceTrackToPeerConnections(this._stoppedVideoTrack, track);
                    delete this._stoppedVideoTrack;
                    this._emit(CONNECTION_STATUS.EVENTS.LOCAL_STREAM_TRACK_ADDED, {
                        streamId: localStream.id,
                        tracks: [track],
                        screenShare: false,
                    });
                } else {
                    if (!track) {
                        this._addTrackToPeerConnections(track);
                    }
                }
            } else {
                if (localStream.getVideoTracks().length === 0) {
                    // re-enable the stream
                    const constraints = this._webrtcProvider.getMediaConstraints().video;
                    if (!constraints) {
                        // user was screensharing with no-devices, the video
                        // device has been plugged out or similar
                        return;
                    }
                    navigator.mediaDevices.getUserMedia({ video: constraints }).then((stream) => {
                        const track = stream.getVideoTracks()[0];
                        localStream.addTrack(track);
                        this._emit(CONNECTION_STATUS.EVENTS.LOCAL_STREAM_TRACK_ADDED, {
                            streamId: localStream.id,
                            tracks: [track],
                            screenShare: false,
                        });

                        if (this._stoppedVideoTrack) {
                            this._replaceTrackToPeerConnections(this._stoppedVideoTrack, track);
                            delete this._stoppedVideoTrack;
                        } else {
                            this._addTrackToPeerConnections(track);
                        }
                    });
                }
            }
        }
    }

    _shareScreen(streamId, stream) {
        this._emitServerEvent(PROTOCOL_REQUESTS.START_SCREENSHARE, {
            streamId,
            hasAudioTrack: !!stream.getAudioTracks().length,
        });
        this._addStreamToPeerConnections(stream);
    }

    removeStream(streamId, stream, requestedByClientId) {
        super.removeStream(streamId, stream);
        this._removeStreamFromPeerConnections(stream);
        this._emitServerEvent(PROTOCOL_REQUESTS.STOP_SCREENSHARE, { streamId, requestedByClientId });
    }
}
