export const getAverageScore = (scores) => {
    if (!Array.isArray(scores)) throw new Error("getAverageScore() scores must be array of scores");
    if (scores.length === 0) return 0;

    let totalScore = 0;
    let divisor = 0;

    scores.forEach((score) => {
        if (Object.prototype.hasOwnProperty.call(score, "score")) {
            totalScore += score.score;
            if (typeof score.score === "number" && score.score > 0) divisor++;
        } else {
            totalScore += score;
            if (typeof score === "number" && score > 0) divisor++;
        }
    });
    if (totalScore === 0 || divisor === 0) return 0;
    return Math.ceil(totalScore / divisor);
};
