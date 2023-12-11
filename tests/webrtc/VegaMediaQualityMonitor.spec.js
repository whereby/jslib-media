const { default: VegaMediaQualityMonitor } = require("../../src/webrtc/VegaMediaQualityMonitor");

const SELF_CLIENT_ID = "selfClientId";
const CLIENT_ID1 = "remoteClientId1";
const CLIENT_ID2 = "remoteClientId2";
const PRODUCER_ID1 = "producerId1";
const PRODUCER_ID2 = "producerId2";
const CONSUMER_ID1 = "consumerId1";
const CONSUMER_ID2 = "consumerId2";
const CONSUMER_ID3 = "consumerId3";
const logger = {
    warn: jest.fn(),
    error: jest.fn(),
};

describe("VegaMediaQualityMonitor", () => {
    it("should keep track of remote clients producer score", () => {
        const sut = new VegaMediaQualityMonitor({ logger });

        sut.addConsumer(CLIENT_ID1, CONSUMER_ID1);
        sut.addConsumer(CLIENT_ID2, CONSUMER_ID2);
        sut.addConsumer(CLIENT_ID2, CONSUMER_ID3);
        sut.addConsumerScore(CLIENT_ID1, CONSUMER_ID1, "video", { producerScores: [10, 10, 10] });
        sut.addConsumerScore(CLIENT_ID2, CONSUMER_ID2, "audio", { producerScores: [5] });
        sut.addConsumerScore(CLIENT_ID2, CONSUMER_ID3, "video", { producerScores: [8, 0] });

        expect(Object.keys(sut._producers).length).toBe(2);
        expect(sut._producers[CLIENT_ID1][CONSUMER_ID1].kind).toBe("video");
        expect(sut._producers[CLIENT_ID1][CONSUMER_ID1].score).toBe(10);
        expect(sut._producers[CLIENT_ID2][CONSUMER_ID2].kind).toBe("audio");
        expect(sut._producers[CLIENT_ID2][CONSUMER_ID2].score).toBe(5);
        expect(sut._producers[CLIENT_ID2][CONSUMER_ID3].kind).toBe("video");
        expect(sut._producers[CLIENT_ID2][CONSUMER_ID3].score).toBe(8);
        sut.close();
    });

    it("should keep track of local producer score", () => {
        const sut = new VegaMediaQualityMonitor({ logger });

        sut.addProducer(SELF_CLIENT_ID, PRODUCER_ID1);
        sut.addProducer(SELF_CLIENT_ID, PRODUCER_ID2);
        sut.addProducerScore(SELF_CLIENT_ID, PRODUCER_ID1, "video", [{ score: 10 }, { score: 0 }]);
        sut.addProducerScore(SELF_CLIENT_ID, PRODUCER_ID2, "audio", [{ score: 8 }]);

        expect(Object.keys(sut._producers).length).toBe(1);
        expect(sut._producers[SELF_CLIENT_ID][PRODUCER_ID1].kind).toBe("video");
        expect(sut._producers[SELF_CLIENT_ID][PRODUCER_ID1].score).toBe(10);
        expect(sut._producers[SELF_CLIENT_ID][PRODUCER_ID2].kind).toBe("audio");
        expect(sut._producers[SELF_CLIENT_ID][PRODUCER_ID2].score).toBe(8);
        sut.close();
    });

    it.each([
        [[{ score: 10 }, { score: 7 }], 8.5],
        [[{ score: 10 }, { score: 0 }], 10],
        [[{ score: 0 }, { score: 0 }], 0],
    ])("should calculate score average on simulcast/svc local producer score: %o, avg: %s", (score, avg) => {
        const sut = new VegaMediaQualityMonitor({ logger });

        sut.addProducer(SELF_CLIENT_ID, PRODUCER_ID1);
        sut.addProducerScore(SELF_CLIENT_ID, PRODUCER_ID1, "video", score);

        expect(sut._producers[SELF_CLIENT_ID][PRODUCER_ID1].score).toBe(avg);
        sut.close();
    });

    it.each([
        [{ producerScores: [10, 7] }, 8.5],
        [{ producerScores: [10, 0] }, 10],
        [{ producerScores: [0, 0] }, 0],
    ])("should calculate score average on simulcast/svc remote producer score: %o, avg: %s", (score, avg) => {
        const sut = new VegaMediaQualityMonitor({ logger });

        sut.addConsumer(CLIENT_ID1, CONSUMER_ID1);
        sut.addConsumerScore(CLIENT_ID1, CONSUMER_ID1, "video", score);

        expect(sut._producers[CLIENT_ID1][CONSUMER_ID1].score).toBe(avg);
        sut.close();
    });

    it("should not remove remote client with active producers", () => {
        const sut = new VegaMediaQualityMonitor({ logger });
        sut.addConsumer(CLIENT_ID1, CONSUMER_ID1);
        sut.addConsumer(CLIENT_ID1, CONSUMER_ID2);
        sut.addConsumerScore(CLIENT_ID1, CONSUMER_ID1, "video", { producerScores: [10, 10, 10] });

        sut.removeConsumer(CLIENT_ID1, CONSUMER_ID2);

        expect(Object.keys(sut._producers).length).toBe(1);
        expect(sut._producers[CLIENT_ID1][CONSUMER_ID1].kind).toBe("video");
        expect(sut._producers[CLIENT_ID1][CONSUMER_ID1].score).toBe(10);
        sut.close();
    });

    it("should remove remote client without active producers", () => {
        const sut = new VegaMediaQualityMonitor({ logger });
        sut.addConsumer(CLIENT_ID1, CONSUMER_ID1);
        sut.addConsumer(CLIENT_ID1, CONSUMER_ID2);
        sut.addConsumerScore(CLIENT_ID1, CONSUMER_ID1, "video", { producerScores: [10, 10, 10] });

        sut.removeConsumer(CLIENT_ID1, CONSUMER_ID1);
        sut.removeConsumer(CLIENT_ID1, CONSUMER_ID2);

        expect(Object.keys(sut._producers).length).toBe(0);
        expect(sut._producers[CLIENT_ID1]).toBeUndefined();
        sut.close();
    });

    it("should not remove self client with active producers", () => {
        const sut = new VegaMediaQualityMonitor({ logger });
        sut.addProducer(SELF_CLIENT_ID, PRODUCER_ID1);
        sut.addProducer(SELF_CLIENT_ID, PRODUCER_ID2);
        sut.addProducerScore(SELF_CLIENT_ID, PRODUCER_ID2, "video", [{ score: 10 }]);

        sut.removeProducer(SELF_CLIENT_ID, PRODUCER_ID1);

        expect(Object.keys(sut._producers).length).toBe(1);
        expect(sut._producers[SELF_CLIENT_ID][PRODUCER_ID2].kind).toBe("video");
        expect(sut._producers[SELF_CLIENT_ID][PRODUCER_ID2].score).toBe(10);
        sut.close();
    });

    it("should remove remote client without active producers", () => {
        const sut = new VegaMediaQualityMonitor({ logger });
        sut.addProducer(SELF_CLIENT_ID, PRODUCER_ID1);
        sut.addProducer(SELF_CLIENT_ID, PRODUCER_ID2);
        sut.addProducerScore(SELF_CLIENT_ID, PRODUCER_ID2, "video", [{ score: 10 }]);

        sut.removeProducer(SELF_CLIENT_ID, PRODUCER_ID1);
        sut.removeProducer(SELF_CLIENT_ID, PRODUCER_ID2);

        expect(Object.keys(sut._producers).length).toBe(0);
        expect(sut._producers[SELF_CLIENT_ID]).toBeUndefined();
        sut.close();
    });

    it("should cleanup on close", async () => {
        const sut = new VegaMediaQualityMonitor({ logger });
        sut.addProducer(SELF_CLIENT_ID, PRODUCER_ID1);
        sut.addProducerScore(SELF_CLIENT_ID, PRODUCER_ID1, "video", [{ score: 10 }]);
        sut.addConsumer(CLIENT_ID1, CONSUMER_ID1);
        sut.addConsumerScore(CLIENT_ID1, CONSUMER_ID1, "video", { producerScores: [10, 10, 10] });

        const delay = new Promise((resolve) => {
            setTimeout(() => {
                expect(Object.keys(sut._producers).length).toBe(2);
                expect(Object.keys(sut._clients).length).toBe(2);
                sut.close();
                expect(Object.keys(sut._producers).length).toBe(0);
                expect(Object.keys(sut._clients).length).toBe(0);
                expect(sut._intervalHandle).toBeUndefined();
                resolve();
            }, 3200);
        });
        await delay;
    });

    it.each([[null], [undefined], [{}], [[]], [[{ score: 1 }, {}]], [[{ score: 10 }, null]]])(
        "should not throw on unexpected producer score format: %o",
        (illegalScore) => {
            const sut = new VegaMediaQualityMonitor({ logger });
            sut.addProducer(SELF_CLIENT_ID, PRODUCER_ID1);

            expect(() => sut.addProducerScore(SELF_CLIENT_ID, PRODUCER_ID1, "video", illegalScore)).not.toThrow();

            sut.close();
        }
    );

    it.each([[null], [undefined], [{}], [[]], [[{ score: 1 }, {}]], [[{ score: 10 }, null]]])(
        "should not throw on unexpected consumer score format: %o",
        (illegalScore) => {
            const sut = new VegaMediaQualityMonitor({ logger });
            sut.addConsumer(CLIENT_ID1, CONSUMER_ID1);

            expect(() => sut.addConsumerScore(CLIENT_ID1, CONSUMER_ID1, "video", illegalScore)).not.toThrow();

            sut.close();
        }
    );

    it.each([[[]], [["id", null]], [[undefined, "id"]], [["id"]]])(
        "should ignore illegal consumer params %o",
        (illegalParams) => {
            const sut = new VegaMediaQualityMonitor({ logger });

            expect(() => sut.addConsumer(illegalParams)).not.toThrow();
            expect(Object.keys(sut._producers).length).toBe(0);
        }
    );

    it.each([[[]], [["id", null]], [[undefined, "id"]], [["id"]]])(
        "should ignore illegal producer params %o",
        (illegalParams) => {
            const sut = new VegaMediaQualityMonitor({ logger });

            expect(() => sut.addProducer(illegalParams)).not.toThrow();
            expect(Object.keys(sut._producers).length).toBe(0);
        }
    );
});
