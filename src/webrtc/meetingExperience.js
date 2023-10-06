export const calculateRemoteRtpQuality = (producerScores) => {
    if (!Array.isArray(producerScores)) return
    return producerScores.reduce((currScore, prevScore) => (
            currScore > prevScore ? currScore : prevScore
    ))
}