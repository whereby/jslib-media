const debugOn = new URLSearchParams(window.location.search).has("debug");

export const getLogger = (prefix) => {
    const unpack = (arg, args) => {
        const msg = typeof arg === "string" ? arg : "";
        if (Array.isArray(args)) {
            return [`${prefix}: ${msg}`, ...args];
        } else {
            return [`${prefix}: ${msg}`];
        }
    };

    return {
        debug: (msg, ...args) => {
            if (debugOn) {
                // eslint-disable-next-line
                console.debug(...unpack(msg, args));
            }
        },
        error: (msg, ...args) => {
            console.error(...unpack(msg, args));
        },
        warn: (msg, ...args) => {
            console.warn(...unpack(msg, args));
        },
    };
};
