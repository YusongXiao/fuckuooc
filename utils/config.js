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

const USERNAME = cfg.USERNAME || process.env.UOOC_USERNAME;
const PASSWORD = cfg.PASSWORD || process.env.UOOC_PASSWORD;
const API_KEY = cfg.API_KEY || process.env.LLM_API_KEY;
const MODEL_NAME = cfg.MODEL || process.env.LLM_MODEL || 'doubao-seed-2-0-mini-260215';
const RETRY_MODEL = cfg.RETRY_MODEL || process.env.LLM_RETRY_MODEL || 'doubao-seed-2-0-lite-260215';
const API_BASE_URL = cfg.BASE_URL || process.env.LLM_BASE_URL || 'https://ark.cn-beijing.volces.com/api/v3/chat/completions';

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

module.exports = { USERNAME, PASSWORD, API_KEY, MODEL_NAME, RETRY_MODEL, API_BASE_URL, DATA_DIR };
