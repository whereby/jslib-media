const defaultSubdomainPattern = /^(?:([^.]+)[.])?((:?[^.]+[.]){1,}[^.]+)$/;
const localstackPattern = /^(?:([^.]+)-)?(ip-[^.]*[.](?:hereby[.]dev|rfc1918[.]disappear[.]at)(?::\d+|))$/;
const localhostPattern = /^(?:([^.]+)[.])?(localhost:?\d*)/;
const serverPattern = /^(?:([^.]+)[.])?(server:?\d*)/;
const ipv4Pattern = /^(?:([^.]+)[.])?((\d+[.]){3}:?\d*)$/;

const subdomainPatterns = [
    { pattern: serverPattern, separator: "." },
    { pattern: localhostPattern, separator: "." },
    { pattern: ipv4Pattern, separator: "." },
    { pattern: localstackPattern, separator: "-" },
    { pattern: defaultSubdomainPattern, separator: "." },
];

/**
 * @param {Location} location - the location object to use to resolve branding information.
 * @return {Object} urls - urls created from this location
 */
export function fromLocation({ host = "whereby.com", protocol = "https:" } = {}) {
    let subdomain = "";
    let domain = host;
    let subdomainSeparator = ".";
    let api = "https://api.whereby.dev";
    let signal = "wss://signal.appearin.net";
    for (const { separator, pattern } of subdomainPatterns) {
        const match = pattern.exec(host);
        if (match) {
            subdomain = match[1] || "";
            domain = match[2];
            subdomainSeparator = separator;
            break;
        }
    }
    const organizationDomain = !subdomain ? domain : `${subdomain}${subdomainSeparator}${domain}`;
    const match = localstackPattern.exec(host)
    if (match) {
        const domainWithoutPort = domain.substring(0, domain.indexOf(":"));
        api = `https://${domainWithoutPort}:4090`;
        signal = `wss://${domainWithoutPort}:4070`;
    }

    return {
        api,
        signal,
        domain,
        domainWithSeparator: `${subdomainSeparator}${domain}`,
        organizationDomain,
        organization: `${protocol}//${organizationDomain}`,
        service: `${protocol}//${domain}`,
        subdomain,
    };
}

export default fromLocation(window && window.location);
