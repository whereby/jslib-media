export default class ProducerStats {
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
