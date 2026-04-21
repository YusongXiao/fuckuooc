const { USERNAME, PASSWORD } = require('./config');
const { launchBrowser, locateInAnyFrame, humanClick, handleCaptcha } = require('./browser');
const { learnCourse } = require('./course');
const { createLogger } = require('./logger');

const MAX_CONCURRENT = 3;

async function run() {
    const { browser, context, page } = await launchBrowser();

    // 1. 登录
    console.log('🌐 访问 UOOC...');

    const MAX_LOGIN_RETRIES = 3;
    let usernameInput = null;

    for (let loginAttempt = 1; loginAttempt <= MAX_LOGIN_RETRIES; loginAttempt++) {
        if (loginAttempt > 1) {
            console.log(`🔄 刷新重试登录页 (${loginAttempt}/${MAX_LOGIN_RETRIES})...`);
            try { await page.reload({ waitUntil: 'networkidle', timeout: 30000 }); } catch {}
            await page.waitForTimeout(2000);
        } else {
            await page.goto('https://www.uooc.net.cn/', { waitUntil: 'networkidle' });
            await page.waitForTimeout(2000);
        }

        try {
            await page.waitForSelector('#loginBtn', { state: 'visible', timeout: 10000 });
            await page.click('#loginBtn');
        } catch {
            console.log('⚠️ 未找到登录按钮，重试...');
            await page.screenshot({ path: 'error_login.png' });
            continue;
        }
        await page.waitForTimeout(2000);

        usernameInput = await locateInAnyFrame(page, '#account1');
        if (usernameInput) break;

        console.log(`⚠️ 未找到用户名输入框，重试... (${loginAttempt}/${MAX_LOGIN_RETRIES})`);
        await page.screenshot({ path: 'debug_screen.png' });
    }

    if (!usernameInput) {
        console.error('❌ 多次重试后仍未找到用户名输入框，退出');
        await browser.close();
        return;
    }

    const locate = (sel) => locateInAnyFrame(page, sel);
    await usernameInput.fill(USERNAME);
    const passwordInput = await locate('#password');
    await passwordInput.fill(PASSWORD);

    await handleCaptcha(page, locate, async () => {
        const btn = await locate('button[type="submit"].btn.btn-warning:visible');
        if (!btn) return false;
        return !(await btn.evaluate(el => el.disabled));
    });

    console.log('🚀 提交登录...');
    const submitBtn = await locate('button[type="submit"].btn.btn-warning:visible');
    if (submitBtn) await humanClick(page, submitBtn);
    await page.waitForTimeout(5000);

    // 2. 进入个人页
    try {
        const avatar = page.locator('a.layout-header-avatar, #top_avatar');
        await avatar.first().waitFor({ state: 'visible', timeout: 10000 });
        await avatar.first().click();
        console.log('✅ 已点击顶部头像');
    } catch {}
    await page.waitForTimeout(3000);

    // 3. 收集课程链接
    await page.waitForTimeout(3000);
    const continueBtns = page.locator('a:has-text("继续学习"), a:has-text("开始学习")');
    try {
        await continueBtns.first().waitFor({ state: 'visible', timeout: 10000 });
    } catch {}

    const count = await continueBtns.count();
    console.log(`🔎 找到 ${count} 个课程`);

    const courseLinks = [];
    for (let i = 0; i < count; i++) {
        const href = await continueBtns.nth(i).getAttribute('href');
        if (!href) continue;
        let url = href.startsWith('http') ? href : new URL(href, page.url()).toString();
        const m = url.match(/\/home\/learn(\/new)?\/(\d+)/);
        if (m) url = `http://www.uooc.net.cn/home/course/${m[2]}`;
        courseLinks.push(url);
        console.log(`   📌 课程 ${i + 1}: ${url}`);
    }

    if (courseLinks.length === 0) {
        console.log('⚠️ 没有课程可学习');
        return;
    }

    // 4. 并行学习课程（最多同时 MAX_CONCURRENT 个）
    console.log(`\n🚀 开始并行学习，最大并发: ${MAX_CONCURRENT}\n`);

    // 用于并发控制的任务处理器
    async function processCourse(link, index) {
        const courseId = link.match(/\/course\/(\d+)/)?.[1] || '';
        const tag = `[课程${index + 1}/${courseLinks.length}:${courseId}]`;
        const log = createLogger(tag, index);

        // 每个课程开一个新 tab（共享登录 session）
        const coursePage = await context.newPage();

        try {
            log('📖 打开课程页...');
            const MAX_GOTO_RETRIES = 3;
            let gotoOk = false;
            for (let attempt = 1; attempt <= MAX_GOTO_RETRIES; attempt++) {
                try {
                    await coursePage.goto(link, { timeout: 30000 });
                    gotoOk = true;
                    break;
                } catch (e) {
                    if (attempt < MAX_GOTO_RETRIES) {
                        log(`⚠️ 页面加载超时，刷新重试 (${attempt}/${MAX_GOTO_RETRIES - 1})...`);
                        try { await coursePage.reload({ timeout: 30000 }); gotoOk = true; break; } catch {}
                    } else {
                        throw e;
                    }
                }
            }
            await coursePage.waitForTimeout(3000);

            const learnBtn = coursePage.locator('a.btn.btn-danger:has-text("开始学习"), a.btn.btn-danger:has-text("继续学习")');
            await learnBtn.first().waitFor({ state: 'visible', timeout: 5000 });
            await learnBtn.first().click();
            log('✅ 进入学习');

            await learnCourse(coursePage, courseId, log);
            log('🏁 课程完成');
        } catch (e) {
            log(`⚠️ 跳过: ${e.message}`);
        } finally {
            await coursePage.close();
        }
    }

    // 并发池：最多同时跑 MAX_CONCURRENT 个任务
    const pending = new Set();
    const queue = courseLinks.map((link, i) => () => processCourse(link, i));

    for (const task of queue) {
        if (pending.size >= MAX_CONCURRENT) {
            // 等待任意一个完成
            await Promise.race(pending);
        }
        const p = task().then(
            () => pending.delete(p),
            () => pending.delete(p)
        );
        pending.add(p);
    }

    // 等待剩余任务全部完成
    await Promise.all(pending);

    console.log('\n🏁 所有课程处理完毕');
}

module.exports = { run };
