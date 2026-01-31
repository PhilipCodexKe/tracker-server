/**
 * Global State
 */
const files = new Map(); // InfoHash -> Set<PeerId>
const peerSockets = new Map(); // PeerId -> WebSocket
const peerInfo = new Map(); // PeerId -> { name: string, ip: string }

let anonymousCounter = 1;

function getNextAnonymousName() {
    return `Anonymous ${anonymousCounter++}`;
}

module.exports = {
    files,
    peerSockets,
    peerInfo,
    getNextAnonymousName
};
