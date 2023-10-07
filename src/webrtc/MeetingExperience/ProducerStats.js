const TIME_THRESHOLD = 2000;
const SCORE_THRESHOLD = 9;

export default class ProducerStats {
    constructor (id, kind) {
        this.id = id;
        this.kind = kind;
        this.score = 10
        this.scoreTimestamp = Date.now()
    }

    setScore(score) {
        this.score = score
        this.scoreTimestamp = Date.now()
    }

    hasLowScore() {
        return (
            this.score < SCORE_THRESHOLD &&
            Date.now() - this.scoreTimestamp > TIME_THRESHOLD
        );
    }
}