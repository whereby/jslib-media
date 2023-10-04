import EventEmitter from "events";

// TODO: add granularity in case we want it in PWA/SDK.
export const meetingExperience = Object.freeze({
    BAD: "bad",
    GOOD: "good",
});

const LOG_PREFIX = "MeetingExperienceDetector: ";
const LOW_AUDIO_SCORE_TIME_THRESHOLD = 3000;
const AUDIO_SCORE_THRESHOLD = 7;
const PACKET_LOSS_THRESHOLD = 0.03;
const PACKET_LOSS_INTERVAL_THRESHOLD = 2;

export default class MeetingExperienceDetector extends EventEmitter {
    constructor(logger) {
        super();
        this._consumerLayers = new Map();
        this._audioRTPConnectionQuality = { timestamp: Date.now() };
        this._currentMeetingExperience = meetingExperience.GOOD;
        this._logger = logger;
        this.closed = false;
        this._prevRecvStats = {
            totalPacketsLost: 0,
            totalPacketsRecv: 0,
            packetLoss: 0,
        };
        this._packetLossDuringIntervalCount = 0;
        this._startMonitor();
    }

    close() {
        clearInterval(this._monitorIntervalHandle);
        if (this._statsPollingIntervalHandle) {
        }
        this.closed = true;
    }

    /**
     * Start monitor that could potentially emit event about changed meeting experience.
     */
    _startMonitor() {
        this._monitorIntervalHandle = setInterval(() => {
            let newMeetingExperience = this._currentMeetingExperience;

            if (this._audioScoreIsLow() && this._onLowestSpatialLayers() && this._hasPacketLoss()) {
                newMeetingExperience = meetingExperience.BAD;
            }

            if (newMeetingExperience !== this._currentMeetingExperience) {
                this._currentMeetingExperience = meetingExperience.BAD;
                this.emit("meetingExperienceChanged", { newExperience: meetingExperience.BAD });
            }
        }, 3000);
    }

    /**
     * Add a producer score + timestamp.
     *
     * @param {string} kind audio | video.
     * @param {object} score array of mediasoup producerscores.
     * @returns
     */
    addProducerScore(kind, score) {
        this._logger.debug(LOG_PREFIX + "addProducerScore: [kind: %s, score: %o]", kind, score);
        if (!kind) {
            this._logger.error(LOG_PREFIX + "addProducerScore: kind missing");
            return;
        }
        if (!score || !Array.isArray(score)) {
            this._logger.error(LOG_PREFIX + "addProducerScore: score missing");
            return;
        }

        if (kind === "audio") {
            this._audioRTPConnectionQuality = {
                timestamp: Date.now(),
                score: this._unpackScore(score),
            };
        }
    }

    attachTransport(transport) {
        this._logger.debug(LOG_PREFIX + "attachTransport [id: %s]", transport.id);
        if (this._statsPollingIntervalHandle) return;
        this._statsPollingIntervalHandle = setInterval(() => {
            if (transport.closed) {
                return clearInterval(this._statsPollingIntervalHandle);
            }
            transport
                .getStats()
                .then((rtcStatsReport) => {
                    const inboundRtpStats = Array.from(rtcStatsReport.values()).find(
                        ({ type, mid }) => type === "inbound-rtp" && mid !== "probator"
                    );
                    if (!inboundRtpStats) return;

                    const packetLoss = this._calculatePacketLoss(inboundRtpStats, this._prevRecvStats);
                    if (packetLoss > PACKET_LOSS_THRESHOLD) this._packetLossDuringIntervalCount++;
                    else this._packetLossDuringIntervalCount = 0;

                    this._prevRecvStats = {
                        totalPacketsRecv: inboundRtpStats.packetsReceived,
                        totalPacketsLost: inboundRtpStats.packetsLost,
                        packetLoss,
                    };
                })
                .catch((error) => this._logger.error(LOG_PREFIX + "%o", error));
        }, 3000);

        transport.once("closed", () => clearInterval(this._statsPollingIntervalHandle));
    }

    /**
     * Unpack the score number from the array of mediasoup producerscores.
     * Pick highest number among the layers for svc/simulcast.
     *
     * @param {object[]} score mediasoup producer scores
     * @returns
     */
    _unpackScore(score) {
        if (!Array.isArray(score)) return;
        if (score.length === 1) return score[0].score;
        return score.reduce((a, b) => {
            return a.score > b.score ? a.score : b.score;
        });
    }

    updateLayers(consumerId, layers) {
        this._logger.debug(LOG_PREFIX + "updateLayers: [consumerId: %s, layers: %o]", consumerId, layers);
        const c = this._consumerLayers.get(consumerId);
        if (c) c.spatialLayer = layers.spatialLayer;
        else this._consumerLayers.set(consumerId, { consumerId, spatialLayer: layers.spatialLayer });
    }

    _audioScoreIsLow() {
        return (
            this._audioRTPConnectionQuality.score < AUDIO_SCORE_THRESHOLD &&
            Date.now() - this._audioRTPConnectionQuality.timestamp > LOW_AUDIO_SCORE_TIME_THRESHOLD
        );
    }

    _onLowestSpatialLayers() {
        return Array.from(this._consumerLayers.values()).every((c) => c.spatialLayer === 0);
    }

    _calculatePacketLoss(inboundRtpStats, prevRtpStats) {
        const deltaPacketsLost = inboundRtpStats.packetsLost - prevRtpStats.totalPacketsLost;
        if (!deltaPacketsLost) return 0;
        const deltaPacketsRecv = inboundRtpStats.packetsReceived - prevRtpStats.totalPacketsRecv;
        return deltaPacketsLost / deltaPacketsRecv;
    }

    _hasPacketLoss() {
        return this._packetLossDuringIntervalCount > PACKET_LOSS_INTERVAL_THRESHOLD;
    }
}
