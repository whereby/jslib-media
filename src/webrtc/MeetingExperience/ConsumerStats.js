export default class ConsumerStats {
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
