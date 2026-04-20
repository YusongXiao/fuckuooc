const path = require('path');
const fs = require('fs');

// 从 config.txt 读取配置，环境变量作为备选
const cfgPath = path.join(__dirname, '..', 'config.txt');
const cfg = {};
if (fs.existsSync(cfgPath)) {
    for (const line of fs.readFileSync(cfgPath, 'utf-8').split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const idx = trimmed.indexOf('=');
        if (idx <= 0) continue;
        const key = trimmed.slice(0, idx).trim();
        const val = trimmed.slice(idx + 1).trim();
        if (val) cfg[key] = val;
    }
}

function pickConfig(name) {
    return cfg[name] || process.env[name];
}

function parseBoolean(value, defaultValue = false) {
    if (value == null || value === '') return defaultValue;
    return /^(1|true|yes|on)$/i.test(String(value).trim());
}

function parseInteger(value, defaultValue = 0) {
    if (value == null || value === '') return defaultValue;
    const parsed = Number.parseInt(String(value).trim(), 10);
    return Number.isFinite(parsed) ? parsed : defaultValue;
}

const USERNAME = cfg.USERNAME || process.env.UOOC_USERNAME;
const PASSWORD = cfg.PASSWORD || process.env.UOOC_PASSWORD;
const API_KEY = cfg.API_KEY || process.env.LLM_API_KEY;
const MODEL_NAME = cfg.MODEL || process.env.LLM_MODEL || 'doubao-seed-2-0-mini-260215';
const RETRY_MODEL = cfg.RETRY_MODEL || process.env.LLM_RETRY_MODEL || 'doubao-seed-2-0-lite-260215';
const API_BASE_URL = cfg.BASE_URL || process.env.LLM_BASE_URL || 'https://ark.cn-beijing.volces.com/api/v3/chat/completions';
const HEADLESS = parseBoolean(pickConfig('HEADLESS'), false);
const SLOW_MO = Math.max(0, parseInteger(pickConfig('SLOW_MO'), 100));
const COURSE_CONCURRENCY = Math.max(1, parseInteger(pickConfig('COURSE_CONCURRENCY'), 3));
const MAX_COURSES = Math.max(0, parseInteger(pickConfig('MAX_COURSES'), 0));
const COURSE_CENTER_URL = pickConfig('COURSE_CENTER_URL') || 'http://www.uooc.net.cn/home#/center/course/learn';
const ENABLE_CONSOLE_MENU = parseBoolean(pickConfig('ENABLE_CONSOLE_MENU'), true);
const ENABLE_LEARNING = parseBoolean(pickConfig('ENABLE_LEARNING'), true);
const ENABLE_DISCUSSION = parseBoolean(pickConfig('ENABLE_DISCUSSION'), false);
const ENABLE_HOMEWORK = parseBoolean(pickConfig('ENABLE_HOMEWORK'), false);
const ENABLE_TASK_WORKER = parseBoolean(pickConfig('ENABLE_TASK_WORKER'), true);
const DISCUSSION_INTERVAL_MS = Math.max(1000, parseInteger(pickConfig('DISCUSSION_INTERVAL_MS'), 65000));
const DISCUSSION_MAX_POSTS = Math.max(0, parseInteger(pickConfig('DISCUSSION_MAX_POSTS'), 3));
const DISCUSSION_SCAN_PAGES = Math.max(1, parseInteger(pickConfig('DISCUSSION_SCAN_PAGES'), 1));
const DISCUSSION_MAX_ROUNDS = Math.max(1, parseInteger(pickConfig('DISCUSSION_MAX_ROUNDS'), 5));
const HOMEWORK_MAX_TASKS = Math.max(0, parseInteger(pickConfig('HOMEWORK_MAX_TASKS'), 0));

if (!USERNAME || !PASSWORD) {
    console.error('❌ 请在 config.txt 中填写 USERNAME 和 PASSWORD');
    process.exit(1);
}

if (!API_KEY) {
    console.error('❌ 请在 config.txt 中填写 API_KEY');
    process.exit(1);
}

const DATA_DIR = path.join(__dirname, '..', 'data', USERNAME);
fs.mkdirSync(DATA_DIR, { recursive: true });

module.exports = {
    USERNAME,
    PASSWORD,
    API_KEY,
    MODEL_NAME,
    RETRY_MODEL,
    API_BASE_URL,
    DATA_DIR,
    HEADLESS,
    SLOW_MO,
    COURSE_CONCURRENCY,
    MAX_COURSES,
    COURSE_CENTER_URL,
    ENABLE_CONSOLE_MENU,
    ENABLE_LEARNING,
    ENABLE_DISCUSSION,
    ENABLE_HOMEWORK,
    ENABLE_TASK_WORKER,
    DISCUSSION_INTERVAL_MS,
    DISCUSSION_MAX_POSTS,
    DISCUSSION_SCAN_PAGES,
    DISCUSSION_MAX_ROUNDS,
    HOMEWORK_MAX_TASKS
};
