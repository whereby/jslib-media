import EventEmitter from "events";

const LOG_PREFIX = "VegaTransmissionAnalyser: ";
const PACKET_LOSS_THRESHOLD = 0.03;

// Criteria used to consider if rtp transmission is having problems
const FAIL_INTERVAL_THRESHOLD = 2;
const FAIL_SCORE_THRESHOLD = 9;
const FAIL_TIME_THRESHOLD = 2000;

// Criteria used to consider if rtp transmission is ok
const RECOVER_INTERVAL_THRESHOLD = 10;
const RECOVER_TARGET_SCORE = 10;
const RECOVER_TIME_THRESHOLD = 10000;

export default class VegaTransmissionAnalyser extends EventEmitter {
    constructor(logger) {
        super();
        this.closed = false;
        this._logger = logger;
        this._consumerStats = new Map();
        this._producerStats = new Map();
        this._currentTransmission = "ok";
        this._prevRecvStats = {
            totalPacketsLost: 0,
            totalPacketsRecv: 0,
            packetLoss: 0,
        };
        this._packetLossDuringIntervalCount = 0;
        this._noPacketLossDuringIntervalCount = 0;
        this._monitorIntervalHandle = setInterval(() => {
            this._evaluateTransmission();
        }, 2000);
    }

    close() {
        clearInterval(this._monitorIntervalHandle);
        clearInterval(this._statsPollingIntervalHandle);
        this.closed = true;
    }

    _evaluateTransmission() {
        let transmission = "";
        if (this._currentTransmission === "problems")
            transmission = this._transmissionIsOk(
                RECOVER_INTERVAL_THRESHOLD,
                RECOVER_TARGET_SCORE,
                RECOVER_TIME_THRESHOLD
            )
                ? "ok"
                : "problems";
        else
            transmission = this._transmissionHasProblems(
                FAIL_INTERVAL_THRESHOLD,
                FAIL_SCORE_THRESHOLD,
                FAIL_TIME_THRESHOLD
            )
                ? "problems"
                : "ok";

        if (transmission !== this._currentTransmission) {
            this.emit("transmissionChanged", transmission);
            this._currentTransmission = transmission;
        }
    }

    /**
     * Decide if the rtp transmission can be consided as ok.
     *
     * @param {number} packetLossIntervalThreshold
     * @param {number} targetScore
     * @param {number} timeThreshold
     * @returns {boolean} rtp transmission is ok.
     */
    _transmissionIsOk(packetLossIntervalThreshold, targetScore, timeThreshold) {
        if (this._noPacketLossDuringIntervalCount < packetLossIntervalThreshold) return false;

        let producerGoodScore = false;

        const audioProducer = this._getProducer("audio");
        if (audioProducer && audioProducer.hasScore(targetScore, timeThreshold)) producerGoodScore = true;
        else producerGoodScore = false;

        const videoProducer = this._getProducer("video");
        if (videoProducer && videoProducer.hasScore(targetScore, timeThreshold)) producerGoodScore = true;
        else producerGoodScore = false;
        return producerGoodScore;
    }

    /**
     * Decide if the rtp transmission can be considered as having problems.
     *
     * @param {number} packetLossIntervalThreshold
     * @param {number} scoreThreshold
     * @param {number} timeThreshold
     * @returns {boolean} rtp transmission is having problems.
     */
    _transmissionHasProblems(packetLossIntervalThreshold, scoreThreshold, timeThreshold) {
        const hasPacketLoss = this._packetLossDuringIntervalCount > packetLossIntervalThreshold;

        const audioProducer = this._getProducer("audio");
        if (audioProducer && audioProducer.hasScoreLessThan(scoreThreshold, timeThreshold) && hasPacketLoss)
            return true;

        const videoProducer = this._getProducer("video");
        if (videoProducer && videoProducer.hasScoreLessThan(scoreThreshold, timeThreshold) && hasPacketLoss)
            return true;
        return false;
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
        if (typeof score !== "number") return this._logger.error(LOG_PREFIX + "addProducerScore: score missing");

        let p = this._producerStats.get(producerId);
        if (p) p.setScore(score);
        else {
            p = new ProducerStats(producerId, kind);
            p.setScore(score);
            this._producerStats.set(producerId, p);
        }
    }

    removeProducer(producerId) {
        this._producerStats.delete(producerId);
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
        if (typeof score !== "number") return this._logger.error(LOG_PREFIX + "addConsumerScore: score missing");

        let c = this._consumerStats.get(consumerId);
        if (c) c.setScore(score);
        else {
            c = new ConsumerStats(consumerId, kind);
            c.setScore(score);
            this._consumerStats.set(consumerId, c);
        }
    }

    removeConsumer(consumerId) {
        this._consumerStats.delete(consumerId);
    }

    /**
     * Poll the mediasoup recv transport for stats.
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
                    else {
                        this._noPacketLossDuringIntervalCount++;
                        this._packetLossDuringIntervalCount = 0;
                    }

                    this._prevRecvStats = {
                        totalPacketsRecv: inboundRtpStats.packetsReceived,
                        totalPacketsLost: inboundRtpStats.packetsLost,
                        packetLoss,
                    };
                })
                .catch((error) => this._logger.error(LOG_PREFIX + "%o", error));
        }, 2000);

        transport.once("closed", () => clearInterval(this._statsPollingIntervalHandle));
    }

    _getProducer(kind) {
        return Array.from(this._producerStats.values()).find((p) => p.kind === kind);
    }

    _lowConsumerScores() {
        return Array.from(this._consumerStats.values()).every((c) => c.score < 9);
    }

    _calculatePacketLoss(rtpStats, prevRtpStats) {
        const deltaPacketsLost = rtpStats.packetsLost - prevRtpStats.totalPacketsLost;
        if (!deltaPacketsLost) return 0;
        const deltaPacketsRecv = rtpStats.packetsReceived - prevRtpStats.totalPacketsRecv;
        return deltaPacketsLost / deltaPacketsRecv;
    }
}

class ConsumerStats {
    constructor(id, kind) {
        this.id = id;
        this.kind = kind;
        this._score = null;
    }

    setScore({ score, producerScores, producerScore }) {
        this._score = {
            timestamp: Date.now(),
            score,
            producerScore,
            producerScores,
        };
    }
}

class ProducerStats {
    constructor(id, kind) {
        this.id = id;
        this.kind = kind;
        this.score = 10;
        this.scoreTimestamp = Date.now();
    }

    setScore(score) {
        this.score = score;
        this.scoreTimestamp = Date.now();
    }

    hasScoreLessThan(scoreThreshold, timeThreshold) {
        return this.score < scoreThreshold && Date.now() - this.scoreTimestamp > timeThreshold;
    }

    hasScore(score, timeThreshold) {
        return this.score === score && Date.now() - this.scoreTimestamp > timeThreshold;
    }
}
