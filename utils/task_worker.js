const { runCourseDiscussionAutomation } = require('./discussion');
const { runCourseHomeworkAutomation, fetchJson } = require('./task');

async function getCourseProgress(page, courseId) {
    await page.goto(`http://www.uooc.net.cn/home/course/${courseId}#/result`, {
        waitUntil: 'domcontentloaded',
        timeout: 60000
    });
    await page.waitForTimeout(2500);
    return fetchJson(page, `http://www.uooc.net.cn/home/course/progress?cid=${courseId}`);
}

function parseNumber(value, fallback = 0) {
    const parsed = Number.parseFloat(String(value ?? '').trim());
    return Number.isFinite(parsed) ? parsed : fallback;
}

function getDiscussionSnapshot(progress) {
    const data = progress?.data || progress || {};
    return {
        weight: parseNumber(data.discuz, 0),
        score: parseNumber(data.discuss_score, 0),
        avgScore: parseNumber(data.discuss_avg_score, 0),
        count: parseNumber(data.discuss_cnt ?? (parseNumber(data.discuss_publish_cnt, 0) + parseNumber(data.discuss_reply_cnt, 0)), 0),
        publishCount: parseNumber(data.discuss_publish_cnt, 0),
        replyCount: parseNumber(data.discuss_reply_cnt, 0)
    };
}

function getHomeworkSnapshot(progress) {
    const data = progress?.data || progress || {};
    return {
        done: parseNumber(data.homework_cnt, 0),
        total: parseNumber(data.homework_total, 0),
        avgScore: parseNumber(data.homework_avg_score, 0),
        weightedScore: parseNumber(data.homework_score, 0)
    };
}

function discussionNeedMore(snapshot) {
    if (snapshot.weight <= 0) return false;
    return snapshot.score + 0.001 < snapshot.weight;
}

async function runCourseTaskWorker(context, courseIds, options = {}) {
    const page = await context.newPage();
    try {
        await page.bringToFront().catch(() => {});
        for (let index = 0; index < courseIds.length; index++) {
            const courseId = courseIds[index];
            const log = options.createLogger
                ? options.createLogger(`[任务窗${index + 1}/${courseIds.length}:${courseId}]`, index)
                : console.log;

            log('📋 开始处理课程任务窗口');

            let progress;
            try {
                progress = await getCourseProgress(page, courseId);
                await page.bringToFront().catch(() => {});
            } catch (err) {
                log(`⚠️ 获取成绩进度失败: ${err.message}`);
                continue;
            }

            let homework = getHomeworkSnapshot(progress);
            let discussion = getDiscussionSnapshot(progress);

            log(`📊 作业进度 ${homework.done}/${homework.total}，讨论得分 ${discussion.score}/${discussion.weight}，讨论数 ${discussion.count}`);

            if (options.enableHomework) {
                const handled = await runCourseHomeworkAutomation(page, courseId, log, options).catch(err => {
                    log(`⚠️ 作业流程失败: ${err.message}`);
                    return 0;
                });
                if (handled > 0) {
                    progress = await getCourseProgress(page, courseId).catch(() => progress);
                    homework = getHomeworkSnapshot(progress);
                    discussion = getDiscussionSnapshot(progress);
                    log(`📊 作业处理后：${homework.done}/${homework.total}`);
                }
            }

            if (options.enableDiscussion) {
                let rounds = 0;
                while (discussionNeedMore(discussion)) {
                    rounds++;
                    log(`💬 讨论未满分，第 ${rounds} 轮补评论（当前 ${discussion.score}/${discussion.weight}，讨论数 ${discussion.count}）`);
                    const sent = await runCourseDiscussionAutomation(page, courseId, log, options).catch(err => {
                        log(`⚠️ 评论流程失败: ${err.message}`);
                        return 0;
                    });
                    if (sent <= 0) {
                        log('⚠️ 没有新的可评论目标，结束当前课程讨论补足');
                        break;
                    }

                    progress = await getCourseProgress(page, courseId).catch(() => progress);
                    discussion = getDiscussionSnapshot(progress);
                    log(`📊 评论后：讨论得分 ${discussion.score}/${discussion.weight}，讨论数 ${discussion.count}`);

                    if (rounds >= (options.discussionMaxRounds || 5)) {
                        log('⚠️ 达到评论轮次上限，切换下一门课程');
                        break;
                    }
                }
            }

            log('✅ 当前课程任务窗口处理完成');
        }
    } finally {
        await page.close().catch(() => {});
    }
}

module.exports = { runCourseTaskWorker, getCourseProgress, getDiscussionSnapshot, getHomeworkSnapshot };
