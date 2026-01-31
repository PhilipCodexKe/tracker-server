function ipToNumber(ip) {
    if (!ip) return 1;
    // Remove all non-numeric characters
    const cleanIp = ip.replace(/\D/g, '') || '1';
    return parseInt(cleanIp.substring(0, 15), 10); 
}

function normalizeIp(ip) {
    if (!ip) return '127.0.0.1';
    ip = ip.trim();
    if (ip === '::1') return '127.0.0.1';
    if (ip.startsWith('::ffff:')) return ip.substring(7);
    return ip;
}

module.exports = {
    ipToNumber,
    normalizeIp
};
