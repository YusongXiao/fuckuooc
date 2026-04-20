const { chromium } = require('playwright');
const { HEADLESS, SLOW_MO } = require('./config');

async function launchBrowser() {
    const browser = await chromium.launch({
        headless: HEADLESS,
        slowMo: SLOW_MO,
        channel: 'chrome',
        args: [
            '--disable-blink-features=AutomationControlled',
            '--disable-infobars',
            '--start-maximized',
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--mute-audio'
        ],
        ignoreDefaultArgs: ['--enable-automation']
    });

    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        viewport: null
    });

    await context.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3] });
        Object.defineProperty(navigator, 'languages', { get: () => ['zh-CN', 'zh', 'en'] });
        window.chrome = { runtime: {} };
    });

    const page = await context.newPage();
    return { browser, context, page };
}

// 在主页面或任意 iframe 中查找可见元素
async function locateInAnyFrame(page, selector) {
    const locator = page.locator(selector);
    if (await locator.count() > 0 && await locator.first().isVisible().catch(() => false)) {
        return locator.first();
    }
    for (const frame of page.frames()) {
        try {
            const fl = frame.locator(selector);
            if (await fl.count() > 0) {
                console.log(`🔎 在 Iframe (${frame.url()}) 中找到了 ${selector}`);
                return fl.first();
            }
        } catch {}
    }
    return null;
}

// 模拟人类鼠标点击
async function humanClick(page, element) {
    const box = await element.boundingBox();
    if (!box) {
        await element.click({ timeout: 5000, force: true });
        return;
    }
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    // 随机偏移钳制在元素尺寸 1/4 以内，避免移出元素边界触发 mouseleave
    const maxDx = Math.min(5, box.width / 4);
    const maxDy = Math.min(5, box.height / 4);
    await page.mouse.move(x + (Math.random() * 2 - 1) * maxDx, y + (Math.random() * 2 - 1) * maxDy, { steps: 5 });
    await page.waitForTimeout(100 + Math.random() * 200);
    await page.mouse.click(x, y);
}

// 通用阿里云验证码处理
// locateFn: (selector) => Promise<Locator|null>
// checkEnabledFn: () => Promise<boolean> — 检查目标按钮是否已启用
async function handleCaptcha(page, locateFn, checkEnabledFn, maxRetries = 10, log) {
    const _log = log || console.log;
    _log('🛡️ 处理智能验证...');
    while (maxRetries > 0) {
        const verifyBox = await locateFn('#aliyunCaptcha-checkbox-icon');
        if (verifyBox) {
            try {
                await verifyBox.scrollIntoViewIfNeeded();
                await humanClick(page, verifyBox);
            } catch {}
        }

        await page.waitForTimeout(2000);

        if (await checkEnabledFn()) {
            _log('✅ 智能验证成功');
            return true;
        }

        _log(`⚠️ 验证重试中... (剩余: ${maxRetries - 1})`);
        const failIcon = await locateFn('.aliyunCaptcha-checkbox-icon-fail, .aliyunCaptcha-refresh');
        if (failIcon) {
            try { await humanClick(page, failIcon); } catch {}
        }

        await page.waitForTimeout(1000 + Math.random() * 1000);
        maxRetries--;
    }
    return false;
}

module.exports = { launchBrowser, locateInAnyFrame, humanClick, handleCaptcha };
