import * as helpers from "./webRtcHelpers";
import P2pRtcManager from "../../src/webrtc/P2pRtcManager";
import VegaRtcManager from "../../src/webrtc/VegaRtcManager";
import RtcManagerDispatcher from "../../src/webrtc/RtcManagerDispatcher";
import { PROTOCOL_RESPONSES } from "../../src/model/protocol";
import * as CONNECTION_STATUS from "../../src/model/connectionStatusConstants";
import EventEmitter from "events";
import { v4 as uuidv4 } from "uuid";

describe("RtcManagerDispatcher", () => {
    let emitter;
    let serverSocketStub;

    beforeEach(() => {
        emitter = new EventEmitter();
        serverSocketStub = helpers.createServerSocketStub();
        const serverSocket = serverSocketStub.socket;
        // eslint-disable-next-line no-new
        new RtcManagerDispatcher({ emitter, serverSocket, webrtcProvider: {}, features: {} });
    });

    function mockEmitRoomJoined({
        // selfId = helpers.randomString("client-"),
        selfId = uuidv4(),
        name = helpers.randomString("/room-"),
        sfuServer,
        error,
    } = {}) {
        let emitted;
        emitter.on(CONNECTION_STATUS.EVENTS.RTC_MANAGER_CREATED, ({ rtcManager }) => (emitted = rtcManager));
        serverSocketStub.emitFromServer(PROTOCOL_RESPONSES.ROOM_JOINED, {
            selfId,
            room: { name, sfuServer, iceServers: {} },
            error,
        });
        return emitted;
    }

    it("emits a P2pRtcManager when sfuServer is not set", () => {
        const rtcManager = mockEmitRoomJoined();
        expect(rtcManager).to.be.an.instanceof(P2pRtcManager);
    });

    it("emits an VegaRtcManager when sfuServer is set", () => {
        const rtcManager = mockEmitRoomJoined({ sfuServer: { url: helpers.randomString("sfu-") + ":443" } });
        expect(rtcManager).to.be.an.instanceof(VegaRtcManager);
    });

    it("emits nothing when error is set", () => {
        const rtcManager = mockEmitRoomJoined({ error: "yo" });
        expect(rtcManager).to.equal(undefined);
    });

    it("replaces RTC manager when switching room mode", () => {
        const messages = [];
        emitter.on(CONNECTION_STATUS.EVENTS.RTC_MANAGER_CREATED, ({ rtcManager }) =>
            messages.push({ create: rtcManager })
        );
        emitter.on(CONNECTION_STATUS.EVENTS.RTC_MANAGER_DESTROYED, () => messages.push({ destroy: true }));

        mockEmitRoomJoined();
        mockEmitRoomJoined({ sfuServer: { url: helpers.randomString("sfu-") + ":443" } });

        expect(messages.length).to.equal(3);
        expect(messages[0].create).to.be.an.instanceof(P2pRtcManager);
        expect(messages[1].destroy).to.equal(true);
        expect(messages[2].create).to.be.an.instanceof(VegaRtcManager);
    });
});
