const output = document.getElementById('output');
const clock = document.getElementById('clock');
const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const wsUrl = `${wsProtocol}//${window.location.host}`;

// Dynamic Hostname for UI
document.querySelector('.ip').innerText = `NODE: ${window.location.hostname.toUpperCase()}`;

// History Array (Temporary Persistence)
const logHistory = [];

let ws;
let myPeerId;

function updateClock() {
    const now = new Date();
    clock.textContent = now.toLocaleTimeString();
}
setInterval(updateClock, 1000);

function log(message, type = 'info') {
    const now = new Date();
    const timestamp = now.toLocaleTimeString();
    
    // Store in array
    logHistory.push({ timestamp, message, type });

    // Render to DOM
    const line = document.createElement('div');
    line.className = 'line';
    line.innerHTML = `<span style="opacity:0.6">[${timestamp}]</span> ${message}`;
    
    if (type === 'error') line.style.color = '#ff5555';
    if (type === 'success') line.style.color = '#50fa7b';
    if (type === 'warning') line.style.color = '#f1fa8c';
    if (type === 'system') line.style.color = '#bd93f9'; // Purple for system events
    
    output.appendChild(line);
    output.scrollTop = output.scrollHeight;
}

const peersListEl = document.getElementById('peers-list');
// Map<PeerId, {name: string, ip: string}>
const connectedPeers = new Map();

function updatePeersList() {
    peersListEl.innerHTML = '';
    
    if (connectedPeers.size === 0) {
        peersListEl.innerHTML = '<div style="opacity:0.5; font-style:italic;">Scanning for peers...</div>';
        return;
    }

    connectedPeers.forEach((info, id) => {
        const item = document.createElement('div');
        item.className = 'peer-block';
        item.innerHTML = `
            <div class="peer-deco">[----------]</div>
            <div class="peer-info">NAME: ${info.name}</div>
            <div class="peer-info">IP:   ${info.ip}</div>
            <div class="peer-info">ID:   ${id}</div>
            <div class="peer-deco">[----------]</div>
        `;
        peersListEl.appendChild(item);
    });
}

function connect() {
    log('Initiating handshake protocol...', 'info');
    
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
        log('Connection established [SECURE]', 'success');
        log('Waiting for network activity...');
    };

    ws.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            
            switch (data.type) {
                case 'welcome':
                    log(`Identity assigned: ${data.peerId}`, 'success');
                    document.title = `NODE: ${data.peerId.substring(0, 8)}...`;
                    
                    myPeerId = data.peerId;
                    
                    // Add Self to List
                    connectedPeers.set(data.peerId, { 
                        name: data.name + " (YOU)", 
                        ip: data.ip 
                    });
                    updatePeersList();
                    break;

                case 'greeting':
                    log(data.message, 'success');
                    break;
                case 'error':
                    log(`Error: ${data.message}`, 'error');
                    break;
                
                // Peer Management Events
                case 'peer-joined':
                    log(`New Peer Detected: ${data.name} (${data.peerId})`, 'system');
                    connectedPeers.set(data.peerId, { name: data.name, ip: data.ip });
                    updatePeersList();
                    break;
                case 'peer-updated':
                    // Name change or other update
                    log(`Peer Updated: ${data.name} (${data.peerId})`, 'system');
                    connectedPeers.set(data.peerId, { name: data.name, ip: data.ip });
                    updatePeersList();
                    break;
                case 'identity-confirmed':
                    // We changed our own name
                    log(`Identity Confirmed: ${data.name}`, 'success');
                    if (myPeerId && connectedPeers.has(myPeerId)) {
                        const myInfo = connectedPeers.get(myPeerId);
                        myInfo.name = data.name + " (YOU)";
                        connectedPeers.set(myPeerId, myInfo);
                        updatePeersList();
                    }
                    break;

                case 'peer-left':
                    log(`Peer Disconnected: ${data.name || data.peerId}`, 'warning');
                    connectedPeers.delete(data.peerId);
                    updatePeersList();
                    break;
                case 'peer-list-snapshot':
                    // Initial load of existing peers
                    data.peers.forEach(p => {
                        connectedPeers.set(p.id, { name: p.name, ip: p.ip });
                    });
                    updatePeersList();
                    break;

                case 'peers':
                    log(`Swarm update: ${data.peers.length} active peers for file`, 'info');
                    break;
                case 'signal':
                    log(`Encrypted signal received from ${data.from}`, 'info');
                    break;
                default:
                    log(`Data received: ${data.type}`);
            }
        } catch (e) {
            log('Raw packet received', 'info');
        }
    };

    ws.onclose = () => {
        log('Connection lost. Retrying in 5000ms...', 'error');
        setTimeout(connect, 5000);
    };

    ws.onerror = (err) => {
        log(`Socket error: ${err.message || 'Unknown'}`, 'error');
        ws.close();
    };
}

// Start
connect();
