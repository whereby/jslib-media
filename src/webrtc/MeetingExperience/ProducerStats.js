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
    
    hasBadAudio(scoreThreshold, timeThreshold) {
        return (
            this._score < scoreThreshold &&
            Date.now() - this._scoreTimestamp > timeThreshold
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