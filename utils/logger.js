const COLORS = [
    '\x1b[36m',  // cyan
    '\x1b[33m',  // yellow
    '\x1b[35m',  // magenta
    '\x1b[32m',  // green
    '\x1b[91m',  // bright red
    '\x1b[96m',  // bright cyan
    '\x1b[93m',  // bright yellow
    '\x1b[95m',  // bright magenta
];
const RESET = '\x1b[0m';

function createLogger(tag, colorIndex) {
    const color = COLORS[colorIndex % COLORS.length];
    const prefix = `${color}${tag}${RESET}`;
    return (...args) => console.log(prefix, ...args);
}

module.exports = { createLogger };
