const { VideoTracker } = require('./video');
const { processQuizQuestions, clickQuizTaskIfAvailable } = require('./quiz');
const {
    clickDiscussionTaskIfAvailable,
    handleLearningDiscussionTask,
    isDiscussionTask
} = require('./discussion');

async function initSectionList(page) {
    await page.evaluate(() => {
        const items = Array.from(document.querySelectorAll('.oneline')).filter(el => el.offsetParent !== null);
        window.__uoocSectionList = items;
        let idx = items.findIndex(el => el.classList.contains('active') || el.closest('.active'));
        if (idx < 0) idx = 0;
        window.__uoocSectionIndex = idx;
    });
}

async function goToNextSection(page) {
    return page.evaluate(() => {
        const items = Array.from(document.querySelectorAll('.oneline')).filter(el => el.offsetParent !== null);
        const idx = items.findIndex(el =>
            el.classList.contains('active') ||
            el.closest('.active') ||
            (el.closest('li')?.classList.contains('active'))
        );
        if (idx === -1 || idx >= items.length - 1) return false;
        const next = items[idx + 1];
        try {
            next.scrollIntoView({ block: 'center' });
        } catch {}
        next.click();
        return true;
    });
}

async function goToPrevUncompleted(page) {
    return page.evaluate(() => {
        const chapters = Array.from(document.querySelectorAll('.catalogItem'));
        let curIdx = chapters.findIndex(chapter => {
            const header = chapter.querySelector('.basic.chapter');
            return header && header.classList.contains('active');
        });
        if (curIdx === -1) {
            curIdx = chapters.findIndex(chapter => chapter.querySelector('.oneline.active, .basic.active'));
        }
        for (let index = curIdx - 1; index >= 0; index--) {
            const header = chapters[index].querySelector('.basic.chapter');
            if (header && header.classList.contains('uncomplete')) {
                const label = chapters[index].querySelector('.oneline');
                if (label) {
                    try {
                        label.scrollIntoView({ block: 'center' });
                    } catch {}
                    label.click();
                    return true;
                }
            }
        }
        return false;
    });
}

async function learnCourse(page, courseId, log, options = {}) {
    const tracker = new VideoTracker(courseId, log);
    const allowInlineDiscussion = options.enableDiscussion && !options.enableTaskWorker;

    log('🎬 开始自动学习...');
    await initSectionList(page);

    let quizRetries = 0;
    const maxQuizRetries = 3;
    let gatelockRetries = 0;
    const maxGatelockRetries = 10;

    while (true) {
        await page.waitForTimeout(3000);

        const quizPassed = await page.evaluate(() => {
            const dialogs = document.querySelectorAll('.layui-layer-content');
            for (const dialog of dialogs) {
                if ((dialog.innerText || '').includes('测验通过')) return true;
            }
            return false;
        });

        if (quizPassed) {
            log('✅ 检测到测验已通过');
            try {
                const okBtn = page.locator('.layui-layer-btn0');
                if (await okBtn.count() > 0) await okBtn.first().click();
            } catch {}
            await page.waitForTimeout(1000);
            quizRetries = 0;
            if (!await goToNextSection(page)) {
                log('🏁 已完成所有章节');
                break;
            }
            continue;
        }

        if (await isDiscussionTask(page)) {
            if (allowInlineDiscussion) {
                log('💬 检测到当前为讨论任务');
                const handled = await handleLearningDiscussionTask(page, courseId, log, options);
                if (!handled) {
                    log('⚠️ 当前讨论任务处理失败，尝试跳到下一节');
                }
            } else {
                log('💬 当前为讨论任务，已交给评论/作业窗口处理，跳过本节');
            }
            await page.waitForTimeout(1000);
            if (!await goToNextSection(page)) {
                log('🏁 已完成所有章节');
                break;
            }
            continue;
        }

        const isQuiz = await page.evaluate(() => {
            if (document.querySelector('video')) return false;
            const active = document.querySelector('.oneline.active') || document.querySelector('.oneline.ng-binding.active');
            if (active) {
                const text = (active.innerText || '').trim();
                if (text.includes('测验') || text.includes('测试')) return true;
            }
            const bodyText = document.body.innerText || '';
            return bodyText.includes('提交试卷') || bodyText.includes('开始测验') || bodyText.includes('重新测验');
        });

        if (isQuiz) {
            if (quizRetries >= maxQuizRetries) {
                log('⚠️ 测验重试次数已达上限，跳过本节');
                quizRetries = 0;
                if (!await goToNextSection(page)) {
                    log('🏁 已完成所有章节');
                    break;
                }
                continue;
            }
            quizRetries++;
            await page.evaluate(() => {
                for (const block of document.querySelectorAll('.basic')) {
                    const tag = block.querySelector('.tag-source-name');
                    if (!tag) continue;
                    const text = (tag.innerText || '').trim();
                    if (text.includes('测验') || text.includes('测试')) {
                        try {
                            block.scrollIntoView({ block: 'center' });
                        } catch {}
                        block.click();
                        return;
                    }
                }
            });
            await processQuizQuestions(page, log, courseId);
            log('⏭️ 测验处理完毕');
        }

        if (await tracker.findUnwatchedVideo(page)) {
            quizRetries = 0;
            gatelockRetries = 0;
            log('📺 播放未看视频...');
            await tracker.playVideo(page);
            await tracker.markCurrentWatched(page);
            await page.waitForTimeout(3000);
            continue;
        }

        const skipReason = await page.evaluate(() => {
            const hint = document.querySelector('.unfoldInfo');
            if (hint) {
                const text = hint.innerText || '';
                if (text.includes('点击下方继续学习')) return 'empty';
                if (text.includes('闯关模式') || text.includes('请先完成之前')) return 'gatelock';
            }
            return null;
        });

        if (skipReason === 'empty') {
            log('⏭️ 空子节点，跳过...');
            quizRetries = 0;
            if (!await goToNextSection(page)) {
                log('🏁 已完成所有章节');
                break;
            }
            continue;
        }

        if (skipReason === 'gatelock') {
            gatelockRetries++;
            if (gatelockRetries > maxGatelockRetries) {
                log('⚠️ 闯关模式回退次数已达上限，跳过本节');
                gatelockRetries = 0;
                if (!await goToNextSection(page)) {
                    log('🏁 已完成所有章节');
                    break;
                }
                continue;
            }
            log(`🔁 闯关模式锁定，回找未完成章节 (${gatelockRetries}/${maxGatelockRetries})...`);
            quizRetries = 0;
            if (!await goToPrevUncompleted(page)) {
                log('⚠️ 未找到前置未完成章节，尝试跳过');
                gatelockRetries = 0;
                if (!await goToNextSection(page)) {
                    log('🏁 已完成所有章节');
                    break;
                }
            }
            continue;
        }

        if (allowInlineDiscussion && await clickDiscussionTaskIfAvailable(page)) {
            log('💬 处理讨论任务...');
            await handleLearningDiscussionTask(page, courseId, log, options);
            await page.waitForTimeout(1000);
            if (!await goToNextSection(page)) {
                log('🏁 已完成所有章节');
                break;
            }
            continue;
        }

        if (await clickQuizTaskIfAvailable(page)) {
            log('📝 处理测验任务...');
            await processQuizQuestions(page, log, courseId);
            continue;
        }

        quizRetries = 0;
        log('⏭️ 进入下一节...');
        if (!await goToNextSection(page)) {
            log('🏁 已完成所有章节');
            break;
        }
    }
}

module.exports = { learnCourse };
