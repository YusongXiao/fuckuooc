const {
    USERNAME,
    PASSWORD,
    COURSE_CONCURRENCY,
    MAX_COURSES,
    COURSE_CENTER_URL,
    ENABLE_LEARNING,
    ENABLE_DISCUSSION,
    ENABLE_HOMEWORK,
    ENABLE_TASK_WORKER,
    DISCUSSION_INTERVAL_MS,
    DISCUSSION_MAX_POSTS,
    DISCUSSION_SCAN_PAGES,
    DISCUSSION_MAX_ROUNDS,
    HOMEWORK_MAX_TASKS
} = require('./config');
const { launchBrowser, locateInAnyFrame, humanClick, handleCaptcha } = require('./browser');
const { learnCourse } = require('./course');
const { runCourseTaskWorker } = require('./task_worker');
const { createLogger } = require('./logger');

const DEFAULT_OPTIONS = {
    enableLearning: ENABLE_LEARNING,
    enableDiscussion: ENABLE_DISCUSSION,
    enableHomework: ENABLE_HOMEWORK,
    enableTaskWorker: ENABLE_TASK_WORKER,
    discussionIntervalMs: DISCUSSION_INTERVAL_MS,
    discussionMaxPosts: DISCUSSION_MAX_POSTS,
    discussionScanPages: DISCUSSION_SCAN_PAGES,
    discussionMaxRounds: DISCUSSION_MAX_ROUNDS,
    homeworkMaxTasks: HOMEWORK_MAX_TASKS
};

async function collectCourseIds(page) {
    const buttons = page.locator('a.course-right-bottom-btn, a:has-text("继续学习"), a:has-text("开始学习"), a:has-text("查看课程")');
    try {
        await buttons.first().waitFor({ state: 'visible', timeout: 10000 });
    } catch {}

    const count = await buttons.count();
    console.log(`🔎 找到 ${count} 个课程按钮`);

    const courseIds = [];
    for (let index = 0; index < count; index++) {
        const href = await buttons.nth(index).getAttribute('href');
        if (!href) continue;
        const matches = href.match(/\d{6,}/g) || [];
        const courseId = matches[matches.length - 1];
        if (!courseId) continue;
        courseIds.push(courseId);
        console.log(`   📚 课程 ${index + 1}: ${courseId} (${href})`);
    }

    return [...new Set(courseIds)];
}

async function login(page) {
    console.log('🌐 访问 UOOC...');

    const maxLoginRetries = 3;
    let usernameInput = null;

    for (let attempt = 1; attempt <= maxLoginRetries; attempt++) {
        if (attempt > 1) {
            console.log(`🔄 刷新重试登录页 (${attempt}/${maxLoginRetries})...`);
            try {
                await page.reload({ waitUntil: 'networkidle', timeout: 30000 });
            } catch {}
            await page.waitForTimeout(2000);
        } else {
            await page.goto('https://www.uooc.net.cn/', { waitUntil: 'networkidle' });
            await page.waitForTimeout(2000);
        }

        try {
            await page.waitForSelector('#loginBtn', { state: 'visible', timeout: 10000 });
            await page.click('#loginBtn');
        } catch {
            console.log('⚠️ 未找到登录按钮，继续重试...');
            continue;
        }
        await page.waitForTimeout(2000);

        usernameInput = await locateInAnyFrame(page, '#account1');
        if (usernameInput) break;
        console.log(`⚠️ 未找到用户名输入框，继续重试... (${attempt}/${maxLoginRetries})`);
    }

    if (!usernameInput) {
        throw new Error('多次重试后仍未找到用户名输入框');
    }

    const locate = selector => locateInAnyFrame(page, selector);
    await usernameInput.fill(USERNAME);
    const passwordInput = await locate('#password');
    await passwordInput.fill(PASSWORD);

    await handleCaptcha(page, locate, async () => {
        const button = await locate('button[type="submit"].btn.btn-warning:visible');
        if (!button) return false;
        return !(await button.evaluate(element => element.disabled));
    });

    console.log('🔐 提交登录...');
    const submitBtn = await locate('button[type="submit"].btn.btn-warning:visible');
    if (submitBtn) await humanClick(page, submitBtn);
    await page.waitForTimeout(5000);
}

async function run(runtimeOptions = {}) {
    const options = { ...DEFAULT_OPTIONS, ...runtimeOptions };
    const { browser, context, page } = await launchBrowser();

    try {
        await login(page);

        try {
            await page.goto(COURSE_CENTER_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
        } catch {}
        await page.waitForTimeout(5000);

        let courseIds = await collectCourseIds(page);
        if (MAX_COURSES > 0) {
            courseIds = courseIds.slice(0, MAX_COURSES);
        }

        if (courseIds.length === 0) {
            console.log('⚠️ 没有课程可处理');
            return;
        }

        console.log('\n🚀 开始调度课程');
        console.log(`   学习窗口: ${options.enableLearning ? '开' : '关'} / 评论作业窗口: ${options.enableTaskWorker ? '开' : '关'}\n`);

        let taskWorkerPromise = Promise.resolve();
        const needTaskWorker = options.enableTaskWorker && (options.enableDiscussion || options.enableHomework);
        if (needTaskWorker) {
            console.log('🪟 正在启动评论/作业独立窗口...');
            taskWorkerPromise = runCourseTaskWorker(context, courseIds, {
                ...options,
                createLogger
            }).catch(err => {
                console.error('⚠️ 评论/作业窗口失败:', err.message);
            });
        }

        if (options.enableLearning) {
            async function processCourse(courseId, index) {
                const tag = `[课程${index + 1}/${courseIds.length}:${courseId}]`;
                const log = createLogger(tag, index);
                const learnPage = await context.newPage();
                try {
                    const oldLearnUrl = `http://www.uooc.net.cn/home/learn/index#/${courseId}/go`;
                    log(`📘 打开老界面学习页: ${oldLearnUrl}`);
                    await learnPage.goto(oldLearnUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
                    await learnPage.waitForTimeout(5000);
                    await learnCourse(learnPage, courseId, log, options);
                    log('🏁 课程完成');
                } catch (err) {
                    log(`⚠️ 学习流程失败: ${err.message}`);
                } finally {
                    await learnPage.close().catch(() => {});
                }
            }

            const pending = new Set();
            const queue = courseIds.map((courseId, index) => () => processCourse(courseId, index));

            for (const task of queue) {
                if (pending.size >= COURSE_CONCURRENCY) {
                    await Promise.race(pending);
                }
                const promise = task().then(
                    () => pending.delete(promise),
                    () => pending.delete(promise)
                );
                pending.add(promise);
            }

            await Promise.all(pending);
        } else {
            console.log('⏭️ 已关闭自动学习');
        }

        await taskWorkerPromise;
        console.log('\n🏁 所有课程处理完毕');
    } finally {
        await browser.close();
    }
}

module.exports = { run };
