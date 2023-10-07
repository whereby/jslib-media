import EventEmitter from "events";
import ConsumerStats from "./ConsumerStats";
import ProducerStats from "./ProducerStats";


const LOG_PREFIX = "MeetingExperienceDetector: ";
const PACKET_LOSS_THRESHOLD = 0.02;
const PACKET_LOSS_INTERVAL_THRESHOLD = 1;

export default class MeetingExperienceDetector extends EventEmitter {
    constructor(logger) {
        super();
        this.closed = false;
        this._logger = logger;
        this._consumers = new Map();
        this._producers = new Map();
        this._currentMeetingExperience = "good"
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
        if (this._statsPollingIntervalHandle) this.closed = true;
    }

    /**
     * Start monitor that could potentially emit event about changed meeting experience.
     */
    _startMonitor() {
        this._monitorIntervalHandle = setInterval(() => {
            this._evaluateMeetingExperience()
        }, 2000);
    }

    _evaluateMeetingExperience() {
        let meetingExperience = "good"

        const hasPacketLoss = this._packetLossDuringIntervalCount > PACKET_LOSS_INTERVAL_THRESHOLD

        const audioProducer = this._getProducer("audio")
        if (audioProducer && audioProducer.hasLowScore() && hasPacketLoss) meetingExperience = "bad"
        
        const videoProducer = this._getProducer("video")
        if (videoProducer && videoProducer.hasLowScore() && hasPacketLoss) meetingExperience = "bad"

        if (meetingExperience !== this._currentMeetingExperience) {
            this.emit("meetingExperienceChanged", { meetingExperience })
            this._currentMeetingExperience = meetingExperience
        }
    }

    /**
     * An updated producer score was sent from SFU.
     *
     * @param {string} producerId id.
     * @param {string} kind audio | video.
     * @param {number} score score.
     */
    addProducerScore(producerId, kind, score) {
        this._logger.debug(LOG_PREFIX + "addProducerScore: [id: %s, kind: %s, score: %s]", producerId, kind, score);
        if (!kind) return this._logger.error(LOG_PREFIX + "addProducerScore: kind missing");
        if (!score) return this._logger.error(LOG_PREFIX + "addProducerScore: score missing");

        let p = this._producers.get(producerId)
        if (p) p.setScore(score)
        else {
            p = new ProducerStats(producerId, kind) 
            p.setScore(score)
            this._producers.set(producerId, p)
        }
    }

    removeProducer(producerId) {
        this._producers.delete(producerId)
    }
    
    /**
     * An updated consumer score was sent from SFU.
     *
     * @param {string} consumerId consumer id.
     * @param {string} kind audio | video.
     * @param {number} score score.
     */
    addConsumerScore(consumerId, kind, score) {
        this._logger.debug(LOG_PREFIX + "addConsumerScore: [id: %s, kind: %s, score: %s]", consumerId, kind, score);
        if (!kind) return this._logger.error(LOG_PREFIX + "addConsumerScore: kind missing");
        if (!consumerId) return this._logger.error(LOG_PREFIX + "addConsumerScore: consumerId missing");
        if (!score) return this._logger.error(LOG_PREFIX + "addConsumerScore: score missing");

        let c = this._consumers.get(consumerId)
        if (c) c.setScore(score)
        else {
            c = new ConsumerStats(consumerId, kind)
            c.setScore(score)
            this._consumers.set(consumerId, c);
        }
    }

    removeConsumer(consumerId) {
        this,this._consumers.delete(consumerId)
    }
    
    /**
     * Attach the mediasoup recv transport and poll for stats.
     * 
     * @param {object} transport mediasoup recv transport 
     */
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

    _getProducer(kind) {
        return Array.from(this._producers.values()).find(p => p.kind === kind)
    }

    _lowConsumerScores() {
        return Array.from(this._consumers.values()).every(c => c.score < 9)
    }

    _calculatePacketLoss(rtpStats, prevRtpStats) {
        const deltaPacketsLost = rtpStats.packetsLost - prevRtpStats.totalPacketsLost;
        if (!deltaPacketsLost) return 0;
        const deltaPacketsRecv = rtpStats.packetsReceived - prevRtpStats.totalPacketsRecv;
        return deltaPacketsLost / deltaPacketsRecv;
    }

    _hasPacketLoss() {
    }
}
