const TIME_THRESHOLD = 2000;
const SCORE_THRESHOLD = 9;

export default class ProducerStats {
    constructor (id, kind) {
        this.id = id;
        this.kind = kind;
        this._score = 10
        this._scoreTimestamp = Date.now()
        this.layers = null
    }

    setScore(score) {
        this._score = this._unpackScore(score)
        this._scoreTimestamp = Date.now()
    }

    getScore() {
        return this._score
    }
    
    hasLowScore() {
        return (
            this._score < SCORE_THRESHOLD &&
            Date.now() - this._scoreTimestamp > TIME_THRESHOLD
        );
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
        return score.reduce((curr, prev) => {
            return curr.score > prev.score ? curr.score : prev.score;
        });
    }
}