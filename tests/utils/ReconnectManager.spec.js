const EventEmitter = require("events");
const { ReconnectManager, PEER_CONNECTION_RENEW_THRESHOLD } = require("../../src/utils/ReconnectManager");
import { getUpdatedStats } from "../../src/webrtc/stats/StatsMonitor/index";

class MockSocket extends EventEmitter {}

const createMockSocket = () => {
    return new MockSocket();
};

jest.mock("../../src/webrtc/stats/StatsMonitor/index");

describe("ReconnectManager", () => {
    it("should store disconnect time", () => {
        const socket = createMockSocket();
        const sut = new ReconnectManager(socket);

        socket.emit("disconnect");

        expect(typeof sut._signalDisconnectTime).toBe("number");
    });

    describe("events", () => {
        describe("room_joined", () => {
            it("should forward event when threshold is exceeded", () => {
                const socket = createMockSocket();
                const sut = new ReconnectManager(socket);
                const forwardEvent = jest.spyOn(sut, "emit");
                getUpdatedStats.mockResolvedValue({});
                sut._signalDisconnectTime = Date.now() - PEER_CONNECTION_RENEW_THRESHOLD + 50;

                socket.emit("room_joined", {
                    room: {
                        clients: [],
                    },
                });

                expect(forwardEvent).toHaveBeenCalledTimes(1);
            });

            it("should remove clients pending to leave event when threshold is exceeded", async () => {
                const socket = createMockSocket();
                const sut = new ReconnectManager(socket);
                const forwardEvent = jest.spyOn(sut, "emit");
                const client1 = { id: "id", isPendingToLeave: true };
                getUpdatedStats.mockResolvedValue({});

                socket.emit("disconnect");
                await socket.emit("room_joined", {
                    room: {
                        clients: [client1],
                    },
                });

                expect(forwardEvent).toHaveBeenCalledTimes(1);
                expect(forwardEvent.mock.calls[0][1].room.clients).toEqual([]);
            });
        });
    });
});
