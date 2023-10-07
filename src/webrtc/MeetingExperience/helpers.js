export const calculateRemoteRtpQuality = (producerScores) => {
    if (!Array.isArray(producerScores)) throw new Error("producerScores must be array of scores")
    return producerScores.reduce((currScore, prevScore) => (
            currScore > prevScore ? currScore : prevScore
    ))
}

export const calculateLocalRtpQuality = (consumerScores) => {
    if (!Array.isArray(consumerScores)) throw new Error("consumerScores must be array of scores")
    return consumerScores.reduce((currScore, prevScore) => (
            currScore.score > prevScore.score ? currScore : prevScore
    )).score
}
