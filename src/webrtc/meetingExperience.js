export const calculateRemoteRtpQuality = (producerScores) => {
    if (!Array.isArray(producerScores)) return
    return producerScores.reduce((currScore, prevScore) => (
            currScore > prevScore ? currScore : prevScore
    ))
}

export const calculateLocalRtpQuality = (consumerScores) => {
    if (!Array.isArray(consumerScores)) return
    return consumerScores.reduce((currScore, prevScore) => (
            currScore.score > prevScore.score ? currScore : prevScore
    ))
}